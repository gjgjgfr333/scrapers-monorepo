import {
    type CheerioCrawler,
    type CheerioCrawlingContext,
    createCheerioRouter,
    type RequestOptions,
} from '@crawlee/cheerio';
import { log } from 'apify';

import { pushItems } from './charging.js';
import type { PriceHistory } from './history.js';
import type {
    CalendarDayItem,
    CalendarUserData,
    CrawlState,
    FlightItem,
    FlightsUserData,
    ResolveUserData,
    Route,
    SearchOptions,
} from './types.js';
import {
    addDays,
    buildCalendarRequest,
    buildSearchUrl,
    computeChange,
    extractDataBlock,
    flightHistoryKey,
    FORMAT_CHANGED_ERROR,
    historyRecordKey,
    LABELS,
    parseCalendarResponse,
    parseFlights,
    parseLocations,
} from './utils.js';

export interface RouterOptions {
    options: SearchOptions;
    maxFlightsPerSearch: number;
    onlyChanged: boolean;
    history: PriceHistory;
}

// Skip the cookie consent page Google shows to European IPs
const headersFor = (options: SearchOptions) => ({
    'Accept-Language': `${options.language},en;q=0.8`,
    Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
});

export const searchRequest = (route: Route, date: string, options: SearchOptions): RequestOptions => ({
    url: buildSearchUrl(route, date, options),
    label: LABELS.FLIGHTS,
    headers: headersFor(options),
    userData: { route, date } satisfies FlightsUserData,
});

export const resolveRequest = (route: Route, from: string, to: string, options: SearchOptions): RequestOptions => ({
    url: buildSearchUrl(route, from, options),
    uniqueKey: `resolve:${route.route}:${from}:${to}`,
    label: LABELS.RESOLVE,
    headers: headersFor(options),
    userData: { route, from, to } satisfies ResolveUserData,
});

/** Calendar rejections that are retried before looking up place ids: Google sometimes rejects airports too */
const CALENDAR_ERROR_RETRIES = 2;

/** Place ids found by RESOLVE, per route, so the other chunks of the route skip the search page */
const resolvedPlaces = new Map<string, Pick<Route, 'originLocation' | 'destinationLocation'>>();

export const calendarRequests = (
    route: Route,
    chunks: { from: string; to: string }[],
    options: SearchOptions,
): RequestOptions[] =>
    chunks.map((chunk) => {
        const { url, payload } = buildCalendarRequest(route, chunk.from, chunk.to, options);
        const places = route.originLocation ? `:${route.originLocation[0]}:${route.destinationLocation?.[0]}` : '';
        return {
            url,
            method: 'POST',
            payload,
            uniqueKey: `calendar:${route.route}${places}:${chunk.from}:${chunk.to}`,
            label: LABELS.CALENDAR,
            headers: { ...headersFor(options), 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            userData: { route, from: chunk.from, to: chunk.to } satisfies CalendarUserData,
        };
    });

/** How many times an empty search page is loaded again before it counts as "no flights" */
const EMPTY_RESULT_RETRIES = 2;

export const initialState = (): CrawlState => ({
    flightsPushed: 0,
    daysPushed: 0,
    itemsFound: 0,
    emptySearches: [],
    failedSearches: [],
});

export const getState = async (crawler: CheerioCrawler) => crawler.useState<CrawlState>(initialState());

const isChanged = (item: { previousPrice: number | null; priceChange: number | null }) =>
    item.previousPrice !== null && item.priceChange !== null && item.priceChange !== 0;

const bodyText = (body: CheerioCrawlingContext['body']) => (typeof body === 'string' ? body : body.toString('utf8'));

export const createRouter = ({ options, maxFlightsPerSearch, onlyChanged, history }: RouterOptions) => {
    const router = createCheerioRouter();

    // The calendar rejected a code (usually a city code like NYC): read the place ids from a search page
    router.addHandler(LABELS.RESOLVE, async ({ request, body, crawler }) => {
        const { route, from, to } = request.userData as ResolveUserData;
        const data = extractDataBlock(bodyText(body));
        if (!data) throw new Error(`${FORMAT_CHANGED_ERROR}: no flight data on the page`);
        const places = parseLocations(data);
        if (!places) {
            const state = await getState(crawler as CheerioCrawler);
            state.emptySearches.push(`${route.route} (unknown airport or city code)`);
            log.warning('Google Flights does not know this route, check the IATA codes', { route: route.route });
            return;
        }
        log.info('Using Google place ids for the price calendar', { route: route.route, ...places });
        const located = { originLocation: places.origin, destinationLocation: places.destination };
        resolvedPlaces.set(route.route, located);
        await crawler.addRequests(calendarRequests({ ...route, ...located }, [{ from, to }], options));
    });

    router.addHandler(LABELS.FLIGHTS, async ({ request, body, crawler }) => {
        const { route, date } = request.userData as FlightsUserData;
        const html = bodyText(body);
        if (request.loadedUrl?.includes('consent.google.') || request.loadedUrl?.includes('/sorry/')) {
            throw new Error(`Google answered with a consent or block page instead of results: ${request.loadedUrl}`);
        }
        const data = extractDataBlock(html);
        if (!data) throw new Error(`${FORMAT_CHANGED_ERROR}: no flight data on the page`);

        const parsed = parseFlights(data);
        const state = await getState(crawler as CheerioCrawler);
        const search = `${route.route} ${date}`;
        if (parsed.length === 0) {
            // Under load Google sometimes answers a busy route with an empty page; believe it only on the third try
            if (request.retryCount < EMPTY_RESULT_RETRIES) {
                throw new Error('Google Flights returned no flights, trying again to make sure');
            }
            state.emptySearches.push(search);
            log.warning('Google Flights found no flights', { route: route.route, date });
            return;
        }

        // Google lists some flights with "Price unavailable"; they are neither saved nor charged
        const priced = parsed.filter((flight) => flight.price !== null);
        const flights = maxFlightsPerSearch > 0 ? priced.slice(0, maxFlightsPerSearch) : priced;
        const returnDate = options.returnAfterDays > 0 ? addDays(date, options.returnAfterDays) : null;
        const recordKey = historyRecordKey('flights', route, options);
        const scrapedAt = new Date().toISOString();

        const items: FlightItem[] = [];
        for (const flight of flights) {
            const itemKey = flightHistoryKey(date, flight);
            const change = computeChange(flight.price, await history.get(recordKey, itemKey));
            items.push({
                type: 'flight',
                route: route.route,
                origin: route.origin,
                destination: route.destination,
                ...flight,
                departureDate: flight.departureDate ?? date,
                returnDate,
                currency: options.currency,
                cabinClass: options.cabinClass,
                adults: options.adults,
                googleFlightsUrl: request.url,
                ...change,
                scrapedAt,
            });
        }
        state.itemsFound += items.length;

        const toPush = onlyChanged ? items.filter(isChanged) : items;
        const saved = await pushItems(toPush, crawler);
        state.flightsPushed += saved.length;

        // Unchanged items need no update; changed ones are recorded only when the user got them
        for (const item of saved) await history.set(recordKey, flightHistoryKey(date, item), item.price);
        for (const item of items) {
            if (item.previousPrice === null) await history.set(recordKey, flightHistoryKey(date, item), item.price);
        }

        log.info('Saved flights', { route: route.route, date, found: items.length, saved: saved.length });
    });

    router.addHandler(LABELS.CALENDAR, async ({ request, body, crawler }) => {
        const { route, from, to } = request.userData as CalendarUserData;
        const prices = parseCalendarResponse(bodyText(body));
        if (prices === 'error') {
            if (request.retryCount < CALENDAR_ERROR_RETRIES || route.originLocation) {
                throw new Error('Google Flights rejected the price calendar request');
            }
            // Codes like NYC have to be sent as Google place ids
            const located = resolvedPlaces.get(route.route);
            await crawler.addRequests(
                located
                    ? calendarRequests({ ...route, ...located }, [{ from, to }], options)
                    : [resolveRequest(route, from, to, options)],
            );
            return;
        }
        if (prices === null) throw new Error(`${FORMAT_CHANGED_ERROR}: the price calendar answer has no data`);

        const state = await getState(crawler as CheerioCrawler);
        if (prices.length === 0) {
            state.emptySearches.push(`${route.route} ${from}..${to}`);
            log.warning('Google Flights has no prices for these dates', { route: route.route, from, to });
            return;
        }

        const recordKey = historyRecordKey('calendar', route, options);
        const scrapedAt = new Date().toISOString();
        const items: CalendarDayItem[] = [];
        for (const { date, price } of prices) {
            if (date < from || date > to) continue;
            const change = computeChange(price, await history.get(recordKey, date));
            items.push({
                type: 'calendarDay',
                route: route.route,
                origin: route.origin,
                destination: route.destination,
                date,
                returnDate: options.returnAfterDays > 0 ? addDays(date, options.returnAfterDays) : null,
                minPrice: price,
                currency: options.currency,
                cabinClass: options.cabinClass,
                adults: options.adults,
                googleFlightsUrl: buildSearchUrl(route, date, options),
                ...change,
                scrapedAt,
            });
        }
        state.itemsFound += items.length;

        const toPush = onlyChanged ? items.filter(isChanged) : items;
        const saved = await pushItems(toPush, crawler);
        state.daysPushed += saved.length;

        for (const item of saved) await history.set(recordKey, item.date, item.minPrice);
        for (const item of items) {
            if (item.previousPrice === null) await history.set(recordKey, item.date, item.minPrice);
        }

        log.info('Saved calendar days', { route: route.route, from, to, found: items.length, saved: saved.length });
    });

    return router;
};
