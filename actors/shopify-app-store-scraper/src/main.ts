// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { CheerioCrawler } from '@crawlee/cheerio';
// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor, log } from 'apify';

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// note that we need to use `.js` even when inside TS files
import { isCostLimitReached } from './charging.js';
import { appRequest, categoryRequest, createRouter, reserveApps } from './routes.js';
import type { AppUserData, CategoryUserData, CrawlState, Input, ScrapeOptions } from './types.js';
import { LABELS, parseAppInput, parseCategoryInput, parseSinceDate, ratingRange, SITEMAP_URL } from './utils.js';

const SUMMARY_KEY = 'RUN_SUMMARY';
const SITEMAP_INPUT = 'allApps';

await Actor.init();

// Structure of input is defined in input_schema.json
const {
    apps = [],
    categories = [],
    allApps = false,
    maxApps = 100,
    includeReviews = true,
    maxReviewsPerApp = 100,
    reviewsSince = '',
    minRating = 1,
    maxRating = 5,
    proxyConfiguration: proxyInput,
} = (await Actor.getInput<Input>()) ?? ({} as Input);

const since = parseSinceDate(reviewsSince);
if (reviewsSince?.trim() && !since) {
    await Actor.fail(`"Reviews since" must be a date such as 2026-01-31, got "${reviewsSince}".`);
}

const options: ScrapeOptions = {
    maxApps: Math.max(0, maxApps),
    includeReviews,
    maxReviewsPerApp: Math.max(0, maxReviewsPerApp),
    reviewsSince: since,
    ratings: ratingRange(minRating, maxRating),
};

const appHandles: { handle: string; input: string }[] = [];
const categorySlugs: { slug: string; input: string }[] = [];
const unsupported: string[] = [];
for (const value of apps) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const handle = parseAppInput(value);
    if (handle) appHandles.push({ handle, input: value.trim() });
    else unsupported.push(value.trim());
}
for (const value of categories) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const slug = parseCategoryInput(value);
    if (slug) categorySlugs.push({ slug, input: value.trim() });
    else unsupported.push(value.trim());
}

if (unsupported.length > 0) {
    log.warning('Some inputs are not Shopify App Store app or category pages and are skipped', { unsupported });
}
if (appHandles.length === 0 && categorySlugs.length === 0 && !allApps) {
    await Actor.fail(
        'Nothing to scrape. Add apps such as https://apps.shopify.com/judgeme, categories such as https://apps.shopify.com/categories/marketing-and-conversion-social-trust-product-reviews, or turn on "All apps".',
    );
}

const proxyConfiguration = proxyInput ? await Actor.createProxyConfiguration(proxyInput) : undefined;

const crawler = new CheerioCrawler({
    proxyConfiguration,
    // The sitemap is XML; 429 answers come as text/plain and have to reach the handler to back off
    additionalMimeTypes: ['application/xml', 'text/xml', 'text/plain'],
    maxConcurrency: 5,
    // The App Store answers 429 above roughly two requests per second
    maxRequestsPerMinute: 120,
    maxRequestRetries: 8,
    // 429 goes to the handler, which waits before retrying; Crawlee would retry it at once
    sessionPoolOptions: { blockedStatusCodes: [401, 403] },
    requestHandlerTimeoutSecs: 120,
    requestHandler: createRouter(options),
    failedRequestHandler: async ({ request, crawler: failedCrawler }, error) => {
        const state = await failedCrawler.useState<CrawlState>();
        if (request.label === LABELS.APP) {
            const summary = state.apps[(request.userData as AppUserData).handle];
            summary.status = 'error';
            summary.error = `Could not load the app page: ${error.message}`;
            log.warning(summary.error, { url: request.url });
        } else if (request.label === LABELS.REVIEWS) {
            const { handle, page } = request.userData as { handle: string; page: number };
            const summary = state.apps[handle];
            summary.error = `Could not load reviews page ${page}: ${error.message}`;
            log.warning(summary.error, { url: request.url });
        } else {
            const { input } = request.userData as CategoryUserData;
            const source = state.sources[input];
            if (source.status !== 'ok') source.status = 'error';
            source.error = `Could not load ${request.url}: ${error.message}`;
            log.warning(source.error);
        }
    },
});

const state = await crawler.useState<CrawlState>({
    apps: {},
    sources: {},
    appsQueued: 0,
    appsSaved: 0,
    reviewsSaved: 0,
});

const startRequests = [];
// Apps listed by hand come first and count toward `maxApps` too
for (const { handle, input } of appHandles) {
    for (const accepted of reserveApps(state, [handle], input, options.maxApps)) {
        startRequests.push(appRequest(accepted, input));
    }
}
for (const { slug, input } of categorySlugs) {
    state.sources[input] ??= { input, status: 'pending', appsFound: 0, error: null };
    startRequests.push(categoryRequest(slug, input));
}
if (allApps) {
    state.sources[SITEMAP_INPUT] ??= { input: SITEMAP_INPUT, status: 'pending', appsFound: 0, error: null };
    startRequests.push({ url: SITEMAP_URL, label: LABELS.SITEMAP, userData: { input: SITEMAP_INPUT } });
}

const saveSummary = async () => {
    await Actor.setValue(SUMMARY_KEY, {
        appsSaved: state.appsSaved,
        reviewsSaved: state.reviewsSaved,
        costLimitReached: isCostLimitReached(),
        apps: Object.values(state.apps),
        sources: Object.values(state.sources),
        unsupportedInputs: unsupported,
    });
};

Actor.on('aborting', async () => {
    log.info('Actor is aborting, saving the run summary and stopping the crawler');
    await saveSummary();
    await crawler.autoscaledPool?.abort();
    await Actor.exit();
});

await crawler.run(startRequests);

await saveSummary();

const appSummaries = Object.values(state.apps);
const failedApps = appSummaries.filter((summary) => summary.status === 'not_found' || summary.status === 'error');
const failedSources = Object.values(state.sources).filter((source) => source.status !== 'ok');
for (const summary of failedApps) log.warning(`${summary.input}: ${summary.error ?? summary.status}`);
for (const source of failedSources) log.warning(`${source.input}: ${source.error ?? source.status}`);
log.info(`Saved ${state.appsSaved} apps and ${state.reviewsSaved} reviews`);

if (state.appsSaved === 0) {
    const reasons = [...failedApps, ...failedSources].map((entry) => `${entry.input}: ${entry.error ?? entry.status}`);
    let reason = 'No apps saved: the categories listed no apps.';
    if (isCostLimitReached()) reason = 'No apps saved: the maximum cost of the run is too low for a single app.';
    else if (reasons.length > 0) reason = `No apps saved. ${reasons.join(' | ')}`;
    await Actor.fail(reason);
}

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();
