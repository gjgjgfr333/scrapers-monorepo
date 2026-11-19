import { CheerioCrawler } from '@crawlee/cheerio';
import { Actor, log } from 'apify';

import { isBudgetReached } from './charging.js';
import { createRouter, detailsRequest, finishHotelReviews, getState } from './routes.js';
import type { Input, PageUserData, ReviewProvider, ReviewsUserData, ScrapeOptions } from './types.js';
import {
    hotelIdFromUrl,
    LABELS,
    normalizeDate,
    normalizeHotelUrl,
    parseHotelId,
    REQUEST_HEADERS,
    STUCK_PAGING_ERROR,
} from './utils.js';

await Actor.init();

const {
    startUrls = [],
    hotelIds = [],
    includeReviews = true,
    maxReviewsPerHotel = 100,
    reviewsSince = '',
    providers = ['agoda', 'booking', 'other'],
    sort = 'newest',
    includeReviewerName = false,
    proxyConfiguration: proxyInput,
} = (await Actor.getInput<Input>()) ?? ({} as Input);

const options: ScrapeOptions = {
    includeReviews,
    maxReviewsPerHotel: Math.max(0, Math.floor(maxReviewsPerHotel)),
    reviewsSince: normalizeDate(reviewsSince),
    providers: (providers.length > 0 ? providers : ['agoda', 'booking', 'other']) as ReviewProvider[],
    sort,
    includeReviewerName,
};

if (reviewsSince && !options.reviewsSince) {
    await Actor.fail(`"Reviews since" must be a date like 2025-01-31, got "${reviewsSince}".`);
}

// Hotels given by id (directly or in the URL) skip the hotel page
const idsFromInput = new Map<number, string | null>();
const pageUrls = new Set<string>();

for (const value of hotelIds) {
    const id = parseHotelId(value);
    if (id) idsFromInput.set(id, null);
    else log.warning('Skipping a hotel id that is not a number', { value });
}

for (const value of startUrls) {
    const raw = typeof value === 'string' ? value : (value as { url?: string })?.url;
    if (!raw) continue;
    const url = normalizeHotelUrl(raw);
    const id = hotelIdFromUrl(raw.trim());
    if (id) idsFromInput.set(id, url);
    else if (url && url.includes('/hotel/')) pageUrls.add(url);
    else log.warning('Skipping a URL that is not an Agoda hotel page', { url: raw });
}

if (idsFromInput.size === 0 && pageUrls.size === 0) {
    await Actor.fail(
        'No valid hotels provided. Add Agoda hotel URLs (agoda.com/<hotel>/hotel/<city>.html) or hotel ids.',
    );
}

const proxyConfiguration = proxyInput ? await Actor.createProxyConfiguration(proxyInput) : undefined;

const crawler = new CheerioCrawler({
    proxyConfiguration,
    additionalMimeTypes: ['application/json'],
    maxConcurrency: 5,
    maxRequestsPerMinute: 120,
    maxRequestRetries: 4,
    requestHandler: createRouter(options),
    failedRequestHandler: async ({ request, crawler: failedCrawler }, error) => {
        if (request.label === LABELS.REVIEWS) {
            const { hotel, page } = request.userData as ReviewsUserData;
            if (error.message.includes(STUCK_PAGING_ERROR)) {
                const state = await getState(failedCrawler as CheerioCrawler);
                state.hotelsThrottled.push(hotel.hotelId);
            }
            log.warning('Could not load a page of reviews, keeping the reviews collected so far', {
                hotelId: hotel.hotelId,
                page,
                error: error.message,
            });
            await finishHotelReviews(failedCrawler as CheerioCrawler, hotel);
            return;
        }

        const target =
            request.label === LABELS.PAGE ? (request.userData as PageUserData).inputUrl : (request.url as string);
        log.warning('Could not load the hotel, check that it exists on Agoda', { target, error: error.message });
        const state = await getState(failedCrawler as CheerioCrawler);
        state.hotelsNotFound.push(target);
    },
});

Actor.on('aborting', async () => {
    log.info('Actor is aborting, stopping the crawler');
    await crawler.autoscaledPool?.abort();
    await Actor.exit();
});

await crawler.run([
    ...[...idsFromInput].map(([id, url]) => detailsRequest(id, url)),
    ...[...pageUrls].map((url) => ({
        url,
        label: LABELS.PAGE,
        uniqueKey: `page:${url}`,
        headers: REQUEST_HEADERS,
        userData: { inputUrl: url } satisfies PageUserData,
    })),
]);

const state = await getState(crawler);
log.info('Run finished', {
    hotels: state.hotelsPushed,
    reviews: state.reviewsPushed,
    hotelsNotFound: state.hotelsNotFound.length,
});

if (state.hotelsPushed === 0 && !isBudgetReached()) {
    await Actor.fail(
        `No hotel could be scraped. Not found or not loaded: ${state.hotelsNotFound.slice(0, 5).join(', ') || 'none'}.`,
    );
}

if (state.hotelsThrottled.length > 0) {
    log.warning(
        'Agoda stopped serving further review pages for some hotels, so their reviews are incomplete. ' +
            'Run again later, use fewer hotels per run, or turn on Apify Proxy.',
        { hotelIds: state.hotelsThrottled },
    );
}

if (state.hotelsNotFound.length > 0 || state.hotelsThrottled.length > 0) {
    await Actor.setStatusMessage(
        [
            `Scraped ${state.hotelsPushed} hotels and ${state.reviewsPushed} reviews.`,
            state.hotelsNotFound.length > 0
                ? `${state.hotelsNotFound.length} hotels not found: ${state.hotelsNotFound.slice(0, 3).join(', ')}.`
                : '',
            state.hotelsThrottled.length > 0
                ? `Reviews incomplete for ${state.hotelsThrottled.length} hotels: Agoda limited requests, see the log.`
                : '',
        ]
            .filter(Boolean)
            .join(' '),
        { isStatusMessageTerminal: true },
    );
}

await Actor.exit();
