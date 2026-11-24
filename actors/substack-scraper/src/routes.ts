import { setTimeout as sleep } from 'node:timers/promises';

import { type CheerioCrawler, createCheerioRouter } from '@crawlee/cheerio';

import { pushPosts } from './charging.js';
import type {
    ArchiveUserData,
    CrawlState,
    PostItem,
    PostUserData,
    RawComment,
    RawPost,
    ScrapeOptions,
    SearchUserData,
} from './types.js';
import {
    archivePublicationInfo,
    buildArchiveUrl,
    buildCommentsUrl,
    buildPostUrl,
    buildSearchUrl,
    flattenComments,
    LABELS,
    mapPost,
    MAX_SEARCH_PAGE,
    parseArchivePage,
    parseSearchPage,
    publicationInfo,
    searchResultPublicationUrl,
} from './utils.js';

/**
 * Substack answers bursts with 429: substack.com after about a dozen searches, the publication domains when a run
 * from shared datacenter IPs loads many posts at once. Requests are paced per host: searches always 1.5 s apart,
 * other hosts without a pause until they answer 429, then 1 s apart. A 429 also stops the whole host for
 * 10, 20, 40, then 60 s, so the other requests to it do not use up their retries meanwhile.
 */
const SEARCH_INTERVAL_MS = 1500;
const RATE_LIMITED_INTERVAL_MS = 1000;

interface HostPace {
    nextAt: number;
    interval: number;
}
const hostPace = new Map<string, HostPace>();

const paceOf = (url: string) => {
    const { host } = new URL(url);
    let pace = hostPace.get(host);
    if (!pace) {
        pace = { nextAt: 0, interval: host === 'substack.com' ? SEARCH_INTERVAL_MS : 0 };
        hostPace.set(host, pace);
    }
    return pace;
};

/** Waits for the request's turn on its host; call it before every request */
export const waitForHostSlot = async (url: string) => {
    const pace = paceOf(url);
    const now = Date.now();
    const at = Math.max(now, pace.nextAt);
    pace.nextAt = at + pace.interval;
    if (at > now) await sleep(at - now);
};

/** Pause after a 429: 10, 20, 40, then 60 s */
export const rateLimitBackoffMs = (retryCount: number) => Math.min(60_000, 10_000 * 2 ** retryCount);

/** Records a 429 from the request's host: pauses the host and spaces out its later requests; returns the pause */
export const hostRateLimited = (url: string, retryCount: number) => {
    const pace = paceOf(url);
    const pause = rateLimitBackoffMs(retryCount);
    pace.nextAt = Math.max(pace.nextAt, Date.now() + pause);
    pace.interval = Math.max(pace.interval, RATE_LIMITED_INTERVAL_MS);
    return pause;
};

export const initialState = (): CrawlState => ({
    postsPerPublication: {},
    postsPerSearch: {},
    searchPostIds: {},
    postsFound: 0,
});

export const searchRequest = (query: string, page: number, options: ScrapeOptions) => ({
    url: buildSearchUrl(query, page, options.searchDateRange),
    uniqueKey: `search:${options.searchDateRange}:${page}:${query}`,
    label: LABELS.SEARCH,
    userData: { query, page } satisfies SearchUserData,
});

export const createRouter = (options: ScrapeOptions) => {
    const router = createCheerioRouter();

    const commentsRequest = (item: PostItem, apiBaseUrl: string) => ({
        url: buildCommentsUrl(apiBaseUrl, item.postId),
        label: LABELS.COMMENTS,
        userData: { item, apiBaseUrl } satisfies PostUserData,
    });

    /** Loads the body and comments when the options ask for them, otherwise saves the items right away */
    const deliver = async (
        items: { item: PostItem; apiBaseUrl: string }[],
        crawler: Parameters<typeof pushPosts>[1] & { addRequests: CheerioCrawler['addRequests'] },
    ) => {
        if (options.includeBody) {
            await crawler.addRequests(
                items.map(({ item, apiBaseUrl }) => ({
                    url: buildPostUrl(apiBaseUrl, item.slug),
                    label: LABELS.POST,
                    userData: { item, apiBaseUrl } satisfies PostUserData,
                })),
            );
        } else if (options.includeComments) {
            await crawler.addRequests(items.map(({ item, apiBaseUrl }) => commentsRequest(item, apiBaseUrl)));
        } else {
            await pushPosts(
                items.map(({ item }) => item),
                crawler,
            );
        }
    };

    router.addHandler<ArchiveUserData>(LABELS.ARCHIVE, async ({ request, response, json, crawler, log }) => {
        const { publicationUrl, cursor } = request.userData;
        const page = parseArchivePage(json);

        if (!page) {
            log.warning('Publication archive is not available, skipping', {
                publicationUrl,
                statusCode: response.statusCode,
            });
            return;
        }

        const state = await crawler.useState<CrawlState>(initialState());
        const taken = state.postsPerPublication[publicationUrl] ?? 0;
        const posts = page.posts.slice(0, Math.max(options.maxPostsPerPublication - taken, 0));
        const total = taken + posts.length;
        state.postsPerPublication[publicationUrl] = total;
        state.postsFound += posts.length;

        // The publication may redirect to a custom domain, keep using the domain that answered
        const apiBaseUrl = new URL(request.loadedUrl).origin;
        // Guest posts may have no byline of this publication: use the name found on any post of the page
        const name = page.posts.map((post) => archivePublicationInfo(post).name).find(Boolean) ?? null;
        const publication = { name, subscriberCount: null, subscriberCountText: null };
        await deliver(
            posts.map((post) => ({ item: mapPost(post, publicationUrl, publication), apiBaseUrl })),
            crawler,
        );

        log.info(`Found ${posts.length} posts`, { publicationUrl, page: cursor ? 'next' : 'first', total });

        if (page.posts.length > 0 && page.nextCursor && total < options.maxPostsPerPublication) {
            await crawler.addRequests([
                {
                    url: buildArchiveUrl(apiBaseUrl, options.sort, page.nextCursor),
                    label: LABELS.ARCHIVE,
                    userData: { publicationUrl, cursor: page.nextCursor } satisfies ArchiveUserData,
                },
            ]);
        }
    });

    // Pages of one query are fetched one after another, which keeps the per-query tally race-free
    router.addHandler<SearchUserData>(LABELS.SEARCH, async ({ request, response, json, crawler, log }) => {
        const { query, page: pageNumber } = request.userData;
        const page = parseSearchPage(json);
        if (!page) {
            throw new Error(`Substack search answered without results (status ${response.statusCode})`);
        }

        const state = await crawler.useState<CrawlState>(initialState());
        const taken = state.postsPerSearch[query] ?? 0;
        const items: { item: PostItem; apiBaseUrl: string }[] = [];
        for (const post of page.posts) {
            if (taken + items.length >= options.maxPostsPerSearch) break;
            const key = String(post.id);
            if (typeof post.id !== 'number' || !post.slug || state.searchPostIds[key]) continue;
            const publication = page.publications.get(post.publication_id ?? -1);
            const publicationUrl = searchResultPublicationUrl(post, publication);
            if (!publicationUrl) continue;
            state.searchPostIds[key] = true;
            items.push({
                item: mapPost(post, publicationUrl, publicationInfo(publication), query),
                apiBaseUrl: publicationUrl,
            });
        }
        const total = taken + items.length;
        state.postsPerSearch[query] = total;
        state.postsFound += items.length;

        await deliver(items, crawler);
        log.info(`Found ${items.length} posts`, { query, page: pageNumber, total });

        if (page.posts.length > 0 && page.more && total < options.maxPostsPerSearch && pageNumber < MAX_SEARCH_PAGE) {
            await crawler.addRequests([searchRequest(query, pageNumber + 1, options)]);
        }
    });

    router.addHandler<PostUserData>(LABELS.POST, async ({ request, json, crawler, log }) => {
        const { item, apiBaseUrl } = request.userData;
        const post = json as Partial<RawPost> | undefined;

        if (typeof post?.body_html === 'string') {
            item.bodyHtml = post.body_html;
            item.wordCount = post.wordcount ?? item.wordCount;
        } else {
            log.warning('Post body is not available', { url: item.url });
        }

        if (options.includeComments) {
            await crawler.addRequests([commentsRequest(item, apiBaseUrl)]);
            return;
        }

        await pushPosts([item], crawler);
    });

    router.addHandler<PostUserData>(LABELS.COMMENTS, async ({ request, json, crawler }) => {
        const { item } = request.userData;
        const comments = (json as { comments?: RawComment[] } | undefined)?.comments;

        item.comments = Array.isArray(comments) ? flattenComments(comments, options.maxCommentsPerPost) : [];
        await pushPosts([item], crawler);
    });

    return router;
};
