
// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { CheerioCrawler } from '@crawlee/cheerio';
// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor, log } from 'apify';

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// note that we need to use `.js` even when inside TS files
import { isBudgetReached, pushPosts } from './charging.js';
import { createRouter, hostRateLimited, initialState, searchRequest, waitForHostSlot } from './routes.js';
import type { ArchiveUserData, CrawlState, Input, PostUserData, ScrapeOptions, SearchUserData } from './types.js';
import { buildArchiveUrl, LABELS, normalizePublicationUrl } from './utils.js';

await Actor.init();

// Structure of input is defined in input_schema.json
const {
    publications = [],
    searchQueries = [],
    maxPostsPerSearch = 50,
    searchDateRange = 'any',
    maxPostsPerPublication = 50,
    sort = 'new',
    includeBody = true,
    includeComments = false,
    maxCommentsPerPost = 100,
    proxyConfiguration: proxyInput,
} = (await Actor.getInput<Input>()) ?? ({} as Input);

const publicationUrls = [
    ...new Set(publications.map(normalizePublicationUrl).filter((url): url is string => url !== null)),
];

const queries = [...new Set(searchQueries.map((query) => query.trim()).filter(Boolean))];

if (publicationUrls.length === 0 && queries.length === 0) {
    await Actor.fail(
        'Nothing to scrape. Add a Substack publication URL or handle, or a search query to find posts across Substack.',
    );
}

const options: ScrapeOptions = {
    maxPostsPerPublication,
    maxPostsPerSearch,
    searchDateRange: ['day', 'week', 'month', 'year'].includes(searchDateRange) ? searchDateRange : 'any',
    sort,
    includeBody,
    includeComments,
    maxCommentsPerPost,
};

const proxyConfiguration = proxyInput ? await Actor.createProxyConfiguration(proxyInput) : undefined;

const crawler = new CheerioCrawler({
    proxyConfiguration,
    // The Substack API responds with JSON
    additionalMimeTypes: ['application/json'],
    maxConcurrency: 10,
    // Substack answers bursts with 429: requests are paced per host and a rate-limited host is paused (routes.ts)
    maxRequestRetries: 6,
    preNavigationHooks: [
        async ({ request }) => {
            await waitForHostSlot(request.url);
        },
    ],
    errorHandler: async ({ request, log: requestLog }, error) => {
        if (!error.message.includes('429')) return;
        const pause = hostRateLimited(request.url, request.retryCount);
        requestLog.info(`Substack is rate limiting requests, pausing ${new URL(request.url).host} for ${pause / 1000} s`);
    },
    requestHandler: createRouter(options),
    failedRequestHandler: async ({ request, crawler: failedCrawler }, error) => {
        if (request.label === LABELS.SEARCH) {
            const { query, page } = request.userData as SearchUserData;
            log.warning('Could not load Substack search results', { query, page, error: error.message });
            return;
        }
        if (request.label === LABELS.ARCHIVE) {
            const { publicationUrl } = request.userData as ArchiveUserData;
            log.warning('Could not load the publication archive, check that the publication exists', {
                publicationUrl,
                error: error.message,
            });
            return;
        }

        // Keep the post even when its body or comments could not be loaded
        const { item } = request.userData as PostUserData;
        log.warning('Could not load post details, saving the post without them', { url: item.url });
        await pushPosts([item], failedCrawler);
    },
});

Actor.on('aborting', async () => {
    log.info('Actor is aborting, stopping the crawler');
    await crawler.autoscaledPool?.abort();
    await Actor.exit();
});

await crawler.run([
    ...publicationUrls.map((publicationUrl) => ({
        url: buildArchiveUrl(publicationUrl, sort),
        label: LABELS.ARCHIVE,
        userData: { publicationUrl, cursor: null } satisfies ArchiveUserData,
    })),
    ...queries.map((query) => searchRequest(query, 0, options)),
]);

const state = await crawler.useState<CrawlState>(initialState());
if (state.postsFound === 0 && !isBudgetReached()) {
    await Actor.fail(
        'No posts found. Check that the publications exist and have public posts, or try other search queries or a longer date range.',
    );
}

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();
