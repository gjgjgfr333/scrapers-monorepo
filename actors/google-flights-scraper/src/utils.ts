import type {
    CabinClass,
    CalendarPrice,
    Layover,
    Location,
    Mode,
    ParsedFlight,
    PriceChange,
    Route,
    SearchOptions,
    Segment,
} from './types.js';

export const LABELS = {
    FLIGHTS: 'FLIGHTS',
    CALENDAR: 'CALENDAR',
    /** Search page loaded only to learn how Google names the places of a route */
    RESOLVE: 'RESOLVE',
} as const;

export const SEARCH_URL = 'https://www.google.com/travel/flights';
export const CALENDAR_URL =
    'https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetCalendarGraph';

/** The calendar endpoint answers any range, the site itself asks for about two months at a time */
export const CALENDAR_CHUNK_DAYS = 61;
/** Google Flights sells tickets about 11 months ahead */
export const MAX_DAYS_AHEAD = 335;

export const FORMAT_CHANGED_ERROR = 'Google Flights changed the page format';

export const CABIN_CODES: Record<CabinClass, number> = {
    economy: 1,
    premium_economy: 2,
    business: 3,
    first: 4,
};

const isRecord = (value: unknown): value is unknown[] => Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** `LHR-CDG`, `lhr cdg`, `LHR>CDG`, `LHR→CDG` → { route: 'LHR-CDG', origin: 'LHR', destination: 'CDG' } */
export const parseRoute = (value: unknown): Route | null => {
    if (typeof value !== 'string') return null;
    const match = /^\s*([a-z]{3})\s*(?:-|–|>|→|\/|\s)\s*([a-z]{3})\s*$/i.exec(value);
    if (!match) return null;
    const origin = match[1].toUpperCase();
    const destination = match[2].toUpperCase();
    if (origin === destination) return null;
    return { route: `${origin}-${destination}`, origin, destination };
};

export const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

export const addDays = (isoDate: string, days: number) => {
    const date = new Date(`${isoDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return toIsoDate(date);
};

export const daysBetween = (from: string, to: string) =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Reads a date the way the Apify datepicker passes it: `2026-12-21` or relative to today, `30 days`, `2 weeks`,
 * `1 month`. Empty values and anything else give null.
 */
export const parseDateInput = (value: unknown, today: string): string | null => {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const text = value.trim().toLowerCase();

    const absolute = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (absolute) {
        const iso = `${absolute[1]}-${absolute[2]}-${absolute[3]}`;
        const parsed = new Date(`${iso}T00:00:00Z`);
        return Number.isNaN(parsed.getTime()) || toIsoDate(parsed) !== iso ? null : iso;
    }

    if (text === 'today') return today;
    if (text === 'tomorrow') return addDays(today, 1);

    const relative = /^\+?(\d+)\s*(day|week|month|year)s?$/.exec(text);
    if (!relative) return null;
    const amount = Number(relative[1]);
    const unit = relative[2];
    if (unit === 'day') return addDays(today, amount);
    if (unit === 'week') return addDays(today, amount * 7);
    const date = new Date(`${today}T00:00:00Z`);
    if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + amount);
    else date.setUTCFullYear(date.getUTCFullYear() + amount);
    return toIsoDate(date);
};

export const dateRange = (from: string, to: string) => {
    const dates: string[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
    return dates;
};

/** Splits [from, to] into consecutive chunks of at most `size` days */
export const chunkRange = (from: string, to: string, size: number) => {
    const chunks: { from: string; to: string }[] = [];
    for (let start = from; start <= to; start = addDays(start, size)) {
        const end = addDays(start, size - 1);
        chunks.push({ from: start, to: end < to ? end : to });
    }
    return chunks;
};

// --- tfs: the protobuf Google Flights keeps the search in, base64url-encoded ---

/* eslint-disable no-bitwise -- protobuf wire format */

const varint = (value: number): number[] => {
    // Negative numbers are encoded as 64-bit two's complement, as protobuf does for int32/int64
    let n = BigInt.asUintN(64, BigInt(value));
    const bytes: number[] = [];
    do {
        let byte = Number(n & 0x7fn);
        n >>= 7n;
        if (n > 0n) byte |= 0x80;
        bytes.push(byte);
    } while (n > 0n);
    return bytes;
};

const fieldKey = (field: number, wireType: number) => varint((field << 3) | wireType);
/* eslint-enable no-bitwise */
const intField = (field: number, value: number) => [...fieldKey(field, 0), ...varint(value)];
const bytesField = (field: number, value: number[] | string) => {
    const bytes = typeof value === 'string' ? [...Buffer.from(value, 'utf8')] : value;
    return [...fieldKey(field, 2), ...varint(bytes.length), ...bytes];
};

const airportMessage = (code: string) => [...intField(1, 1), ...bytesField(2, code)];

const legMessage = (date: string, from: string, to: string, maxStops: number) => [
    ...bytesField(2, date),
    ...(maxStops >= 0 ? intField(5, maxStops) : []),
    ...bytesField(13, airportMessage(from)),
    ...bytesField(14, airportMessage(to)),
];

/** Builds the `tfs` parameter of a Google Flights search: legs, passengers, cabin and trip type */
export const encodeTfs = (route: Route, date: string, options: SearchOptions) => {
    const legs = [legMessage(date, route.origin, route.destination, options.maxStops)];
    const returnDate = options.returnAfterDays > 0 ? addDays(date, options.returnAfterDays) : null;
    if (returnDate) legs.push(legMessage(returnDate, route.destination, route.origin, options.maxStops));

    const bytes = [
        ...intField(1, 28),
        ...intField(2, 2),
        ...legs.flatMap((leg) => bytesField(3, leg)),
        ...Array.from({ length: options.adults }, () => intField(8, 1)).flat(),
        ...intField(9, CABIN_CODES[options.cabinClass]),
        ...intField(14, 1),
        ...bytesField(16, intField(1, -1)),
        // 1 = round trip, 2 = one way
        ...intField(19, returnDate ? 1 : 2),
    ];
    return Buffer.from(bytes).toString('base64url');
};

const localeParams = (options: SearchOptions) =>
    `hl=${encodeURIComponent(options.language)}&gl=${encodeURIComponent(options.country)}&curr=${encodeURIComponent(options.currency)}`;

export const buildSearchUrl = (route: Route, date: string, options: SearchOptions) =>
    `${SEARCH_URL}?tfs=${encodeTfs(route, date, options)}&${localeParams(options)}`;

/** Stops filter of the internal API: 0 = any, 1 = nonstop, 2 = up to one stop, 3 = up to two stops */
const stopsCode = (maxStops: number) => (maxStops < 0 ? 0 : Math.min(maxStops, 2) + 1);

const calendarLeg = (from: Location, to: Location, date: string, maxStops: number) => [
    [[from]],
    [[to]],
    null,
    stopsCode(maxStops),
    null,
    null,
    date,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    3,
];

/**
 * The cheapest price for every departure date in [from, to], as the price graph of the site asks for it.
 * Round trips keep the same trip length for every date.
 */
export const buildCalendarRequest = (route: Route, from: string, to: string, options: SearchOptions) => {
    const roundTrip = options.returnAfterDays > 0;
    const origin: Location = route.originLocation ?? [route.origin, 0];
    const destination: Location = route.destinationLocation ?? [route.destination, 0];
    const legs = [calendarLeg(origin, destination, from, options.maxStops)];
    if (roundTrip) {
        legs.push(calendarLeg(destination, origin, addDays(from, options.returnAfterDays), options.maxStops));
    }
    const filters = [
        null,
        null,
        roundTrip ? 1 : 2,
        null,
        [],
        CABIN_CODES[options.cabinClass],
        [options.adults, 0, 0, 0],
        null,
        null,
        null,
        null,
        null,
        null,
        legs,
        null,
        null,
        null,
        1,
    ];
    const inner: unknown[] = [null, filters, [from, to]];
    if (roundTrip) inner.push(null, [options.returnAfterDays, options.returnAfterDays]);

    return {
        url: `${CALENDAR_URL}?${localeParams(options)}&rt=c`,
        payload: `f.req=${encodeURIComponent(JSON.stringify([null, JSON.stringify(inner)]))}`,
    };
};

// --- Parsing ---

/**
 * Returns the `data` of `AF_initDataCallback({key: 'ds:1', ..., data: [...]})` from a search page,
 * or null when the page has no such block.
 */
export const extractDataBlock = (html: string, key = 'ds:1'): unknown[] | null => {
    const start = html.indexOf(`AF_initDataCallback({key: '${key}'`);
    if (start === -1) return null;
    const dataStart = html.indexOf('data:', start);
    if (dataStart === -1) return null;

    // Find the end of the JSON array by bracket matching, skipping strings
    let depth = 0;
    let inString = false;
    const from = html.indexOf('[', dataStart);
    if (from === -1) return null;
    for (let i = from; i < html.length; i++) {
        const char = html[i];
        if (inString) {
            if (char === '\\') i++;
            else if (char === '"') inString = false;
        } else if (char === '"') inString = true;
        else if (char === '[') depth++;
        else if (char === ']') {
            depth--;
            if (depth === 0) {
                const parsed: unknown = JSON.parse(html.slice(from, i + 1));
                return isRecord(parsed) ? parsed : null;
            }
        }
    }
    return null;
};

/** [2026, 12, 21] → '2026-12-21' */
export const formatDate = (value: unknown): string | null => {
    if (!isRecord(value) || value.length < 3) return null;
    const [year, month, day] = value.map(num);
    if (year === null || month === null || day === null) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** [20, 25] → '20:25'; Google omits zero minutes ([10] is 10:00) and an empty array is midnight */
export const formatTime = (value: unknown): string | null => {
    if (!isRecord(value)) return null;
    const hours = num(value[0]) ?? 0;
    const minutes = num(value[1]) ?? 0;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const gramsToKg = (value: unknown) => {
    const grams = num(value);
    return grams === null ? null : Math.round(grams / 1000);
};

const mapSegment = (raw: unknown): Segment | null => {
    if (!isRecord(raw)) return null;
    const carrier = isRecord(raw[22]) ? raw[22] : [];
    const code = str(carrier[0]);
    const number = str(carrier[1]);
    return {
        flightNumber: code && number ? `${code}${number}` : null,
        airline: str(carrier[3]),
        from: str(raw[3]),
        fromName: str(raw[4]),
        to: str(raw[6]),
        toName: str(raw[5]),
        departureDate: formatDate(raw[20]),
        departureTime: formatTime(raw[8]),
        arrivalDate: formatDate(raw[21]),
        arrivalTime: formatTime(raw[10]),
        durationMinutes: num(raw[11]),
        aircraft: str(raw[17]),
        legroom: str(raw[14]),
    };
};

const mapLayover = (raw: unknown): Layover | null => {
    if (!isRecord(raw)) return null;
    return {
        airport: str(raw[1]),
        airportName: str(raw[4]),
        city: str(raw[5]),
        durationMinutes: num(raw[0]),
    };
};

/** Maps one result of the search page: [info, [[null, price], bookingToken], ...] */
export const mapFlight = (raw: unknown, isBest: boolean): ParsedFlight | null => {
    if (!isRecord(raw) || !isRecord(raw[0])) return null;
    const info = raw[0];
    const segments = (isRecord(info[2]) ? info[2] : []).map(mapSegment).filter((s): s is Segment => s !== null);
    if (segments.length === 0) return null;

    const priceBlock = isRecord(raw[1]) && isRecord(raw[1][0]) ? raw[1][0] : [];
    const emissions = isRecord(info[22]) ? info[22] : [];
    const names = isRecord(info[1]) ? info[1].map(str).filter((s): s is string => s !== null) : [];

    return {
        departureAirport: str(info[3]),
        arrivalAirport: str(info[6]),
        departureDate: formatDate(info[4]),
        departureTime: formatTime(info[5]),
        arrivalDate: formatDate(info[7]),
        arrivalTime: formatTime(info[8]),
        durationMinutes: num(info[9]),
        price: num(priceBlock[1]),
        airlines: names.length > 0 ? names : [...new Set(segments.map((s) => s.airline).filter((a) => a !== null))],
        flightNumbers: segments.map((s) => s.flightNumber).filter((n): n is string => n !== null),
        stops: segments.length - 1,
        layovers: (isRecord(info[13]) ? info[13] : []).map(mapLayover).filter((l): l is Layover => l !== null),
        aircraft: [...new Set(segments.map((s) => s.aircraft).filter((a): a is string => a !== null))],
        segments,
        co2Kg: gramsToKg(emissions[7]),
        typicalCo2Kg: gramsToKg(emissions[8]),
        co2VsTypicalPct: num(emissions[3]),
        isBest,
    };
};

/**
 * Flights of a search page in the order the site shows them: "best" flights first (data[2][0]),
 * then the other ones (data[3][0]). An empty list means Google found no flights.
 * Throws when the block is there but not in the known shape.
 */
export const parseFlights = (data: unknown[]): ParsedFlight[] => {
    // A search without results (unknown airport, no flights) answers with a short block
    if (data.length < 4) return [];
    const groups: [unknown, boolean][] = [
        [data[2], true],
        [data[3], false],
    ];
    const flights: ParsedFlight[] = [];
    let rawCount = 0;
    for (const [group, isBest] of groups) {
        if (group === null || group === undefined) continue;
        if (!isRecord(group)) throw new Error(`${FORMAT_CHANGED_ERROR}: flight group is not a list`);
        const list = group[0];
        if (list === null || list === undefined) continue;
        if (!isRecord(list)) throw new Error(`${FORMAT_CHANGED_ERROR}: flight list is not a list`);
        for (const raw of list) {
            rawCount++;
            const flight = mapFlight(raw, isBest);
            if (flight) flights.push(flight);
        }
    }
    if (rawCount > 0 && flights.length === 0) throw new Error(`${FORMAT_CHANGED_ERROR}: no flight could be read`);
    return flights;
};

/**
 * Reads a GetCalendarGraph answer: `)]}'` then length-prefixed JSON chunks, one of them
 * [["wrb.fr", null, "<json>"]] whose second element lists [date, null, [[null, price], token], status].
 * Days without flights have no price and are left out. Returns 'error' when Google rejects the request
 * (for example a city code it wants as a place id) and null when the answer has no data at all.
 */
export const parseCalendarResponse = (text: string): CalendarPrice[] | 'error' | null => {
    for (const line of text.split('\n')) {
        if (!line.startsWith('[')) continue;
        let chunk: unknown;
        try {
            chunk = JSON.parse(line);
        } catch {
            continue;
        }
        if (!isRecord(chunk)) continue;
        for (const entry of chunk) {
            if (!isRecord(entry) || entry[0] !== 'wrb.fr') continue;
            if (typeof entry[2] !== 'string') return entry[5] ? 'error' : null;
            const payload: unknown = JSON.parse(entry[2]);
            if (!isRecord(payload)) return null;
            const days = isRecord(payload[1]) ? payload[1] : [];
            const prices: CalendarPrice[] = [];
            for (const day of days) {
                if (!isRecord(day)) continue;
                const date = str(day[0]);
                const priceBlock = isRecord(day[2]) && isRecord(day[2][0]) ? day[2][0] : [];
                const price = num(priceBlock[1]);
                if (date && price !== null) prices.push({ date, price });
            }
            return prices;
        }
    }
    return null;
};

// --- Price history ---

export const computeChange = (price: number | null, previous: number | undefined): PriceChange => {
    if (price === null || previous === undefined)
        return { previousPrice: previous ?? null, priceChange: null, priceChangePct: null };
    const change = Math.round((price - previous) * 100) / 100;
    return {
        previousPrice: previous,
        priceChange: change,
        priceChangePct: previous === 0 ? null : Math.round((change / previous) * 10_000) / 100,
    };
};

/** Key of the history record for one route and set of search options (allowed key characters only) */
export const historyRecordKey = (mode: Mode, route: Route, options: SearchOptions) =>
    [
        mode,
        route.origin,
        route.destination,
        options.returnAfterDays > 0 ? `rt${options.returnAfterDays}` : 'ow',
        options.cabinClass,
        `${options.adults}a`,
        options.maxStops < 0 ? 'any' : `${options.maxStops}s`,
        options.currency,
        options.country,
    ]
        .join('_')
        .replace(/[^a-zA-Z0-9!\-_.'()]/g, '');

/** Identifies a flight across runs: date, flight numbers and departure time */
export const flightHistoryKey = (date: string, flight: Pick<ParsedFlight, 'flightNumbers' | 'departureTime'>) =>
    `${date}|${flight.flightNumbers.join('+')}|${flight.departureTime ?? ''}`;

/**
 * Places of a search page as the internal API names them: data[1][0] = [[origin...], [destination...]],
 * each starting with [[id, type], name]. Null when the page has no places (unknown airport).
 */
export const parseLocations = (data: unknown[]): { origin: Location; destination: Location } | null => {
    const block = isRecord(data[1]) && isRecord(data[1][0]) ? data[1][0] : [];
    const read = (side: unknown): Location | null => {
        const first = isRecord(side) && isRecord(side[0]) ? side[0] : [];
        const id = isRecord(first[0]) ? first[0] : [];
        const name = str(id[0]);
        const type = num(id[1]);
        return name !== null && type !== null ? [name, type] : null;
    };
    const origin = read(block[0]);
    const destination = read(block[1]);
    return origin && destination ? { origin, destination } : null;
};
