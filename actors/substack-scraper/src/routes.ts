import { createCheerioRouter } from '@crawlee/cheerio';

import { pushPosts } from './charging.js';
import type {
    ArchiveUserData,
    CrawlState,
    PostItem,
    PostUserData,
    RawComment,
    RawPost,
    ScrapeOptions,
} from './types.js';
import {
    buildArchiveUrl,
    buildCommentsUrl,
    buildPostUrl,
    flattenComments,
    LABELS,
    mapPost,
    parseArchivePage,
} from './utils.js';

export const createRouter = (options: ScrapeOptions) => {
    const router = createCheerioRouter();

    const commentsRequest = (item: PostItem, apiBaseUrl: string) => ({
        url: buildCommentsUrl(apiBaseUrl, item.postId),
        label: LABELS.COMMENTS,
        userData: { item, apiBaseUrl } satisfies PostUserData,
    });

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

        const state = await crawler.useState<CrawlState>({ postsPerPublication: {} });
        const taken = state.postsPerPublication[publicationUrl] ?? 0;
        const posts = page.posts.slice(0, Math.max(options.maxPostsPerPublication - taken, 0));
        const total = taken + posts.length;
        state.postsPerPublication[publicationUrl] = total;

        // The publication may redirect to a custom domain, keep using the domain that answered
        const apiBaseUrl = new URL(request.loadedUrl).origin;
        const items = posts.map((post) => mapPost(post, publicationUrl));

        if (options.includeBody) {
            await crawler.addRequests(
                items.map((item) => ({
                    url: buildPostUrl(apiBaseUrl, item.slug),
                    label: LABELS.POST,
                    userData: { item, apiBaseUrl } satisfies PostUserData,
                })),
            );
        } else if (options.includeComments) {
            await crawler.addRequests(items.map((item) => commentsRequest(item, apiBaseUrl)));
        } else {
            await pushPosts(items, crawler);
        }

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
