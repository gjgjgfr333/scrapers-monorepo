import { setTimeout as sleep } from 'node:timers/promises';

import type { CheerioCrawler } from '@crawlee/cheerio';
import { createCheerioRouter } from '@crawlee/cheerio';

import { pushHotel, pushReviews, pushSummary } from './charging.js';
import type {
    CrawlState,
    DetailsUserData,
    HotelRef,
    PageUserData,
    RawSecondaryData,
    ReviewsUserData,
    ScrapeOptions,
} from './types.js';
import {
    buildDetailsUrl,
    buildReviewsPayload,
    buildSummary,
    emptyReviewState,
    extractHotelIdFromHtml,
    LABELS,
    mapHotel,
    mapReview,
    parseReviewPage,
    REQUEST_HEADERS,
    reviewPageKey,
    REVIEWS_ENDPOINT,
    selectReviews,
    shouldFetchNextPage,
    STUCK_PAGING_ERROR,
    tallyReviews,
} from './utils.js';

const STUCK_PAGING_RETRY_DELAY_MS = 15_000;

export const INITIAL_STATE: CrawlState = {
    hotels: {},
    hotelsPushed: 0,
    reviewsPushed: 0,
    hotelsNotFound: [],
    hotelsThrottled: [],
};

export const getState = async (crawler: CheerioCrawler) => crawler.useState<CrawlState>(INITIAL_STATE);

export const detailsRequest = (hotelId: number, inputUrl: string | null) => ({
    url: buildDetailsUrl(hotelId),
    label: LABELS.DETAILS,
    uniqueKey: `details:${hotelId}`,
    headers: REQUEST_HEADERS,
    userData: { hotelId, inputUrl } satisfies DetailsUserData,
});

export const reviewsRequest = (hotel: HotelRef, page: number, options: ScrapeOptions) => ({
    url: REVIEWS_ENDPOINT,
    method: 'POST' as const,
    payload: JSON.stringify(buildReviewsPayload(hotel.hotelId, page, options.sort)),
    headers: { ...REQUEST_HEADERS, 'content-type': 'application/json' },
    label: LABELS.REVIEWS,
    uniqueKey: `reviews:${hotel.hotelId}:${page}`,
    userData: { hotel, page } satisfies ReviewsUserData,
});

/** Saves the summary of a hotel whose reviews are finished, once */
export const finishHotelReviews = async (crawler: CheerioCrawler, hotel: HotelRef) => {
    const state = await getState(crawler);
    const hotelState = state.hotels[hotel.hotelId];
    if (!hotelState || hotelState.done) return;
    hotelState.done = true;
    // The seen ids are only needed while paging
    hotelState.seen = [];
    await pushSummary(buildSummary(hotel, hotelState));
};

export const createRouter = (options: ScrapeOptions) => {
    const router = createCheerioRouter();

    // Hotel page HTML: only used to find the numeric hotel id
    router.addHandler<PageUserData>(LABELS.PAGE, async ({ request, body, crawler, log }) => {
        const { inputUrl } = request.userData;
        const html = typeof body === 'string' ? body : body.toString();
        const hotelId = request.loadedUrl.includes('pagenotfound') ? null : extractHotelIdFromHtml(html);

        if (!hotelId) {
            log.warning('Hotel not found on Agoda, check the URL', { url: inputUrl });
            const state = await getState(crawler);
            state.hotelsNotFound.push(inputUrl);
            return;
        }

        await crawler.addRequests([detailsRequest(hotelId, inputUrl)]);
    });

    router.addHandler<DetailsUserData>(LABELS.DETAILS, async ({ request, json, crawler, log }) => {
        const { hotelId, inputUrl } = request.userData;
        const item = mapHotel((json ?? {}) as RawSecondaryData, hotelId, inputUrl);
        const state = await getState(crawler);

        if (!item) {
            log.warning('Agoda has no hotel with this id', { hotelId, url: inputUrl });
            state.hotelsNotFound.push(inputUrl ?? String(hotelId));
            return;
        }

        if (!(await pushHotel(item, crawler))) return;
        state.hotelsPushed++;
        log.info(`Hotel: ${item.hotelName}`, {
            hotelId,
            reviewScore: item.reviewScore,
            reviewsCount: item.reviewsCount,
        });

        if (options.includeReviews) {
            state.hotels[hotelId] = emptyReviewState();
            const hotel: HotelRef = { hotelId, hotelName: item.hotelName, hotelUrl: item.hotelUrl };
            await crawler.addRequests([reviewsRequest(hotel, 1, options)]);
        }
    });

    // One page of reviews of one hotel. Pages of a hotel are fetched one after another,
    // so the per-hotel state is never updated by two handlers at once.
    router.addHandler<ReviewsUserData>(LABELS.REVIEWS, async ({ request, json, crawler, log, session }) => {
        const { hotel, page } = request.userData;
        const state = await getState(crawler);
        const hotelState = state.hotels[hotel.hotelId] ?? emptyReviewState();
        state.hotels[hotel.hotelId] = hotelState;

        const parsed = parseReviewPage(json);
        if (!parsed) {
            log.warning('Unexpected review response, the Agoda API may have changed', { hotelId: hotel.hotelId, page });
            await finishHotelReviews(crawler, hotel);
            return;
        }

        // When Agoda limits a client it keeps answering every page with page 1. Retry later with a new
        // session (a new IP when a proxy is used) instead of treating the reviews as finished.
        const key = reviewPageKey(parsed.comments, options.providers);
        if (page === 1) hotelState.firstPageKey = key;
        else if (key !== '' && key === hotelState.firstPageKey) {
            session?.retire();
            // Agoda lifts the limit after a few minutes; wait longer on every retry
            await sleep(STUCK_PAGING_RETRY_DELAY_MS * (request.retryCount + 1));
            throw new Error(`${STUCK_PAGING_ERROR} (hotel ${hotel.hotelId}, page ${page})`);
        }

        if (Object.keys(parsed.available).length > 0) hotelState.available = parsed.available;

        const { selected, newWanted } = selectReviews(parsed.comments, hotelState, options);
        hotelState.noNewPages = newWanted === 0 ? hotelState.noNewPages + 1 : 0;

        const saved = await pushReviews(
            selected.map((review) => mapReview(review, hotel, options.includeReviewerName)),
            crawler,
        );
        tallyReviews(hotelState, saved);
        state.reviewsPushed += saved.length;

        log.debug('Review page', {
            hotelId: hotel.hotelId,
            page,
            received: parsed.comments.length,
            saved: saved.length,
        });

        if (saved.length === selected.length && shouldFetchNextPage(hotelState, page, options)) {
            await crawler.addRequests([reviewsRequest(hotel, page + 1, options)], { forefront: true });
            return;
        }

        log.info(`Reviews done: ${hotel.hotelName}`, {
            hotelId: hotel.hotelId,
            collected: hotelState.collected,
            pages: page,
            available: hotelState.available,
        });
        await finishHotelReviews(crawler, hotel);
    });

    return router;
};
