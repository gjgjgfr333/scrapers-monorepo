import { setTimeout as sleep } from 'node:timers/promises';

import type { CheerioCrawler } from '@crawlee/cheerio';
import { createCheerioRouter } from '@crawlee/cheerio';

import { parseAppPage, parseCategoryPage, parseReviewsPage } from './appstore.js';
import { isCostLimitReached, pushItem } from './charging.js';
import type {
    AppItem,
    AppUserData,
    CategoryUserData,
    CrawlState,
    ReviewOptions,
    ReviewsUserData,
    ScrapeOptions,
} from './types.js';
import { appUrl, categoryUrl, isOnOrAfter, LABELS, parseSitemapHandles, reviewsUrl } from './utils.js';

export const appRequest = (handle: string, input: string) => ({
    url: appUrl(handle),
    uniqueKey: `app:${handle}`,
    label: LABELS.APP,
    userData: { handle, input } satisfies AppUserData,
});

export const categoryRequest = (slug: string, input: string, page = 1) => ({
    url: categoryUrl(slug, page),
    uniqueKey: `category:${slug}:${page}`,
    label: LABELS.CATEGORY,
    userData: { slug, input, page } satisfies CategoryUserData,
});

export const reviewsRequest = (handle: string, appName: string | null, page: number, ratings: number[]) => ({
    url: reviewsUrl(handle, page, ratings),
    label: LABELS.REVIEWS,
    userData: { handle, appName, page } satisfies ReviewsUserData,
});

/**
 * Registers apps in the run state and returns the ones to request: new handles only, at most `maxApps`
 * in the whole run (0 means no limit).
 */
export const reserveApps = (state: CrawlState, handles: string[], input: string, maxApps: number) => {
    /* eslint-disable no-param-reassign -- the run state lives in crawler.useState and is updated in place */
    const accepted: string[] = [];
    for (const handle of handles) {
        if (state.apps[handle]) continue;
        if (maxApps > 0 && state.appsQueued >= maxApps) break;
        state.apps[handle] = { handle, input, status: 'pending', reviewCount: null, reviewsSaved: 0, error: null };
        state.appsQueued += 1;
        accepted.push(handle);
    }
    /* eslint-enable no-param-reassign */
    return accepted;
};

/** How many reviews the app has for the selected ratings, from its rating distribution */
export const expectedReviews = (app: AppItem, ratings: number[]) => {
    if (!app.ratingDistribution) return app.reviewCount;
    return ratings.reduce((sum, rating) => sum + app.ratingDistribution![String(rating) as '1'], 0);
};

/**
 * The App Store answers 429 (as text/plain) when requests come too fast. Crawlee would retry at once, so wait
 * first (2, 4, 8… seconds with jitter, at most a minute to stay under the handler timeout) and then throw to retry.
 */
const backOffIfRateLimited = async (status: number, retryCount: number) => {
    if (status !== 429) return;
    await sleep(Math.min(60_000, 2000 * 2 ** retryCount) + Math.random() * 1000);
    throw new Error('The Shopify App Store answered HTTP 429 (too many requests)');
};

const enqueueReviews = async (crawler: CheerioCrawler, app: AppItem, options: ReviewOptions) => {
    if (!options.includeReviews || expectedReviews(app, options.ratings) === 0) return;
    await crawler.addRequests([reviewsRequest(app.handle, app.name, 1, options.ratings)]);
};

export const createRouter = (options: ScrapeOptions) => {
    const router = createCheerioRouter();

    router.addHandler<AppUserData>(LABELS.APP, async ({ request, response, $, crawler, log }) => {
        const { handle } = request.userData;
        const state = await crawler.useState<CrawlState>();
        const summary = state.apps[handle];
        const status = response.statusCode ?? 0;
        await backOffIfRateLimited(status, request.retryCount);

        if (status === 404) {
            summary.status = 'not_found';
            summary.error = `There is no app "${handle}" in the Shopify App Store (HTTP 404)`;
            log.warning(summary.error, { input: summary.input });
            return;
        }
        if (status >= 400) throw new Error(`The Shopify App Store answered HTTP ${status}`);

        const app = parseAppPage($, handle);
        if (!app) throw new Error('The page has no app details, the Shopify App Store layout may have changed');

        summary.reviewCount = app.reviewCount;
        if (!(await pushItem(app, crawler))) return;
        summary.status = 'ok';
        state.appsSaved += 1;
        log.info(`${handle}: ${app.name}, ${app.reviewCount} reviews, ${app.plans.length} plans`);

        await enqueueReviews(crawler as CheerioCrawler, app, options);
    });

    router.addHandler<ReviewsUserData>(LABELS.REVIEWS, async ({ request, response, $, crawler, log }) => {
        const { handle, appName, page } = request.userData;
        const state = await crawler.useState<CrawlState>();
        const summary = state.apps[handle];
        const status = response.statusCode ?? 0;
        await backOffIfRateLimited(status, request.retryCount);
        if (status >= 400) throw new Error(`The Shopify App Store answered HTTP ${status} for reviews page ${page}`);

        const parsed = parseReviewsPage($, handle, appName);
        // Reviews come newest first, so once a whole page is older than `reviewsSince` the rest is too
        const recent = parsed.reviews.filter((review) => isOnOrAfter(review.date, options.reviewsSince));

        let stopped = false;
        for (const review of recent) {
            if (options.maxReviewsPerApp > 0 && summary.reviewsSaved >= options.maxReviewsPerApp) break;
            if (!(await pushItem(review, crawler))) {
                stopped = true;
                break;
            }
            summary.reviewsSaved += 1;
            state.reviewsSaved += 1;
        }

        const limitReached = options.maxReviewsPerApp > 0 && summary.reviewsSaved >= options.maxReviewsPerApp;
        const olderOnly = parsed.reviews.length > 0 && recent.length === 0;
        if (parsed.hasNext && !limitReached && !olderOnly && !stopped && !isCostLimitReached()) {
            await crawler.addRequests([reviewsRequest(handle, appName, page + 1, options.ratings)]);
        } else {
            log.info(`${handle}: ${summary.reviewsSaved} reviews saved`, { pages: page });
        }
    });

    router.addHandler<CategoryUserData>(LABELS.CATEGORY, async ({ request, response, $, crawler, log }) => {
        const { slug, input, page } = request.userData;
        const state = await crawler.useState<CrawlState>();
        const source = state.sources[input];
        const status = response.statusCode ?? 0;
        await backOffIfRateLimited(status, request.retryCount);

        if (status === 404) {
            if (page === 1 && source.appsFound === 0 && source.status !== 'ok') {
                source.status = 'not_found';
                source.error = `There is no category "${slug}" in the Shopify App Store (HTTP 404)`;
                log.warning(source.error);
            }
            return;
        }
        if (status >= 400) throw new Error(`The Shopify App Store answered HTTP ${status} for category ${slug}`);

        const parsed = parseCategoryPage($, slug, request.loadedUrl ?? request.url);
        if (!parsed.isListing) {
            // A parent category: walk its subcategories, each is a paged listing or another parent
            if (parsed.subcategories.length === 0) {
                throw new Error(`Category ${slug} lists neither apps nor subcategories`);
            }
            await crawler.addRequests(parsed.subcategories.map((child) => categoryRequest(child, input)));
            log.info(`${slug}: parent category, ${parsed.subcategories.length} subcategories`);
            return;
        }

        const accepted = reserveApps(state, parsed.handles, input, options.maxApps);
        source.appsFound += accepted.length;
        source.status = 'ok';
        source.error = null;
        await crawler.addRequests(accepted.map((handle) => appRequest(handle, input)));
        log.info(`${slug} page ${page}: ${parsed.handles.length} apps, ${accepted.length} new`);

        const full = options.maxApps > 0 && state.appsQueued >= options.maxApps;
        if (parsed.hasNext && !full && !isCostLimitReached()) {
            await crawler.addRequests([categoryRequest(slug, input, page + 1)]);
        }
    });

    router.addHandler(LABELS.SITEMAP, async ({ request, response, body, crawler, log }) => {
        const state = await crawler.useState<CrawlState>();
        const source = state.sources[request.userData.input as string];
        const status = response.statusCode ?? 0;
        await backOffIfRateLimited(status, request.retryCount);
        if (status >= 400) throw new Error(`The Shopify App Store sitemap answered HTTP ${status}`);

        const handles = parseSitemapHandles(body.toString());
        if (handles.length === 0) throw new Error('The Shopify App Store sitemap lists no apps');
        const accepted = reserveApps(state, handles, source.input, options.maxApps);
        source.appsFound += accepted.length;
        source.status = 'ok';
        await crawler.addRequests(accepted.map((handle) => appRequest(handle, source.input)));
        log.info(`Sitemap: ${handles.length} apps listed, ${accepted.length} queued`);
    });

    return router;
};
