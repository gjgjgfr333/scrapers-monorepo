import { CheerioCrawler, type RequestOptions } from '@crawlee/cheerio';
import { Actor, log } from 'apify';

import { isBudgetReached } from './charging.js';
import { PriceHistory } from './history.js';
import { calendarRequests, createRouter, getState, searchRequest } from './routes.js';
import type { CabinClass, CalendarUserData, FlightsUserData, Input, Mode, Route, SearchOptions } from './types.js';
import {
    addDays,
    CABIN_CODES,
    CALENDAR_CHUNK_DAYS,
    chunkRange,
    dateRange,
    daysBetween,
    LABELS,
    MAX_DAYS_AHEAD,
    parseDateInput,
    parseRoute,
    toIsoDate,
} from './utils.js';

await Actor.init();

const {
    routes = [],
    departureDate = '',
    departureDateTo = '',
    returnAfterDays = 0,
    mode = 'flights',
    maxFlightsPerSearch = 50,
    adults = 1,
    cabinClass = 'economy',
    maxStops = -1,
    currency = 'USD',
    country = 'US',
    language = 'en',
    trackPriceChanges = false,
    onlyChanged = false,
    proxyConfiguration: proxyInput,
} = (await Actor.getInput<Input>()) ?? ({} as Input);

const today = toIsoDate(new Date());

const parsedRoutes = new Map<string, Route>();
for (const value of routes) {
    const route = parseRoute(value);
    if (route) parsedRoutes.set(route.route, route);
    else log.warning('Skipping a route that is not a pair of IATA codes like LHR-CDG', { value });
}
if (parsedRoutes.size === 0) {
    await Actor.fail('No valid routes provided. Add routes as pairs of IATA airport or city codes, e.g. LHR-CDG.');
}

const from = parseDateInput(departureDate, today) ?? addDays(today, 30);
if (departureDate && !parseDateInput(departureDate, today)) {
    await Actor.fail(`"Departure date" must be a date like 2026-12-21 or "30 days", got "${departureDate}".`);
}
const to = parseDateInput(departureDateTo, today) ?? from;
if (departureDateTo && !parseDateInput(departureDateTo, today)) {
    await Actor.fail(`"Departure date to" must be a date like 2026-12-31 or "60 days", got "${departureDateTo}".`);
}
if (from < today) await Actor.fail(`"Departure date" ${from} is in the past.`);
if (to < from) await Actor.fail(`"Departure date to" ${to} is before "Departure date" ${from}.`);

const lastDay = addDays(today, MAX_DAYS_AHEAD);
const rangeEnd = to > lastDay ? lastDay : to;
if (rangeEnd !== to) log.warning(`Google Flights sells tickets about 11 months ahead, the range ends at ${rangeEnd}`);
if (rangeEnd < from)
    await Actor.fail(`"Departure date" ${from} is too far ahead, the last bookable day is ${lastDay}.`);

const options: SearchOptions = {
    returnAfterDays: Math.max(0, Math.floor(returnAfterDays)),
    adults: Math.min(9, Math.max(1, Math.floor(adults))),
    cabinClass: (cabinClass in CABIN_CODES ? cabinClass : 'economy') as CabinClass,
    maxStops: maxStops < 0 ? -1 : Math.min(2, Math.floor(maxStops)),
    currency: currency.trim().toUpperCase() || 'USD',
    country: country.trim().toUpperCase() || 'US',
    language: language.trim() || 'en',
};
const searchMode: Mode = mode === 'calendar' ? 'calendar' : 'flights';
const history = new PriceHistory(trackPriceChanges || onlyChanged);

const calendarChunks = chunkRange(from, rangeEnd, CALENDAR_CHUNK_DAYS);
const requests: RequestOptions[] = [...parsedRoutes.values()].flatMap((route) =>
    searchMode === 'flights'
        ? dateRange(from, rangeEnd).map((date) => searchRequest(route, date, options))
        : calendarRequests(route, calendarChunks, options),
);

log.info('Starting', {
    mode: searchMode,
    routes: parsedRoutes.size,
    from,
    to: rangeEnd,
    days: daysBetween(from, rangeEnd) + 1,
    requests: requests.length,
    ...options,
});

const proxyConfiguration = proxyInput ? await Actor.createProxyConfiguration(proxyInput) : undefined;

const crawler = new CheerioCrawler({
    proxyConfiguration,
    additionalMimeTypes: ['application/json'],
    maxConcurrency: 4,
    maxRequestsPerMinute: 60,
    maxRequestRetries: 5,
    useSessionPool: true,
    persistCookiesPerSession: false,
    requestHandlerTimeoutSecs: 90,
    requestHandler: createRouter({
        options,
        maxFlightsPerSearch: Math.max(0, Math.floor(maxFlightsPerSearch)),
        onlyChanged,
        history,
        calendarChunks,
    }),
    failedRequestHandler: async ({ request, crawler: failedCrawler }, error) => {
        const { route } = request.userData as FlightsUserData | CalendarUserData;
        const what =
            request.label === LABELS.CALENDAR
                ? `${route.route} ${(request.userData as CalendarUserData).from}..${(request.userData as CalendarUserData).to}`
                : `${route.route} ${(request.userData as FlightsUserData).date}`;
        log.warning('Could not load a search', { search: what, error: error.message });
        const state = await getState(failedCrawler as CheerioCrawler);
        state.failedSearches.push(`${what}: ${error.message.slice(0, 200)}`);
    },
});

Actor.on('aborting', async () => {
    log.info('Actor is aborting, saving price history and stopping the crawler');
    await history.persist();
    await crawler.autoscaledPool?.abort();
    await Actor.exit();
});
Actor.on('migrating', async () => {
    await history.persist();
});

await crawler.run(requests);
await history.persist();

const state = await getState(crawler);
const pushed = state.flightsPushed + state.daysPushed;
log.info('Run finished', {
    flights: state.flightsPushed,
    calendarDays: state.daysPushed,
    found: state.itemsFound,
    emptySearches: state.emptySearches.length,
    failedSearches: state.failedSearches.length,
});

if (state.itemsFound === 0 && !isBudgetReached()) {
    const reasons = [
        state.emptySearches.length > 0
            ? `no flights for ${state.emptySearches.slice(0, 5).join(', ')} (check the IATA codes, dates and stops filter)`
            : '',
        state.failedSearches.length > 0 ? `failed: ${state.failedSearches.slice(0, 3).join('; ')}` : '',
    ].filter(Boolean);
    await Actor.fail(`Google Flights returned no results: ${reasons.join('; ') || 'no searches were made'}.`);
}

const notes = [
    searchMode === 'flights' ? `Saved ${state.flightsPushed} flights.` : `Saved ${state.daysPushed} calendar days.`,
    onlyChanged ? `${state.itemsFound} found, ${pushed} with a changed price since the last run.` : '',
    state.emptySearches.length > 0 ? `No flights for ${state.emptySearches.length} searches.` : '',
    state.failedSearches.length > 0 ? `${state.failedSearches.length} searches failed, see the log.` : '',
].filter(Boolean);
await Actor.setStatusMessage(notes.join(' '), { isStatusMessageTerminal: true });

await Actor.exit();
