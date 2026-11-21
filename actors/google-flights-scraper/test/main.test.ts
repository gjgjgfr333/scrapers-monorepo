import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { SearchOptions } from '../src/types.js';
import {
    addDays,
    buildCalendarRequest,
    buildSearchUrl,
    chunkRange,
    computeChange,
    dateRange,
    encodeTfs,
    extractDataBlock,
    flightHistoryKey,
    formatTime,
    historyRecordKey,
    parseCalendarResponse,
    parseDateInput,
    parseFlights,
    parseLocations,
    parseRoute,
} from '../src/utils.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const OPTIONS: SearchOptions = {
    returnAfterDays: 0,
    adults: 1,
    cabinClass: 'economy',
    maxStops: -1,
    currency: 'USD',
    country: 'US',
    language: 'en',
};

const LHR_CDG = { route: 'LHR-CDG', origin: 'LHR', destination: 'CDG' };

/** Prices of the "From 103 US dollars" labels the page shows for screen readers, in page order */
const ariaPrices = (html: string) =>
    [...html.matchAll(/aria-label="From ([\d,]+) /g)].map((match) => Number(match[1].replace(/,/g, '')));

describe('parseRoute', () => {
    it('should accept several separators and lowercase codes', () => {
        expect(parseRoute('LHR-CDG')).toEqual(LHR_CDG);
        expect(parseRoute(' lhr cdg ')).toEqual(LHR_CDG);
        expect(parseRoute('LHR>CDG')).toEqual(LHR_CDG);
        expect(parseRoute('LHR→CDG')).toEqual(LHR_CDG);
    });

    it('should reject malformed routes', () => {
        expect(parseRoute('LHR')).toBeNull();
        expect(parseRoute('LHR-LHR')).toBeNull();
        expect(parseRoute('London-Paris')).toBeNull();
        expect(parseRoute(42)).toBeNull();
    });
});

describe('parseDateInput', () => {
    it('should read absolute and relative dates', () => {
        expect(parseDateInput('2026-12-21', '2026-11-21')).toBe('2026-12-21');
        expect(parseDateInput('2026-12-21T00:00:00.000Z', '2026-11-21')).toBe('2026-12-21');
        expect(parseDateInput('30 days', '2026-11-21')).toBe('2026-12-21');
        expect(parseDateInput('2 weeks', '2026-11-21')).toBe('2026-12-05');
        expect(parseDateInput('1 month', '2026-11-21')).toBe('2026-12-21');
        expect(parseDateInput('today', '2026-11-21')).toBe('2026-11-21');
    });

    it('should reject empty and invalid values', () => {
        expect(parseDateInput('', '2026-11-21')).toBeNull();
        expect(parseDateInput('2026-02-30', '2026-11-21')).toBeNull();
        expect(parseDateInput('next friday', '2026-11-21')).toBeNull();
    });
});

describe('date ranges', () => {
    it('should list every date and split long ranges', () => {
        expect(dateRange('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
        expect(chunkRange('2026-12-01', '2027-03-31', 61)).toEqual([
            { from: '2026-12-01', to: '2027-01-30' },
            { from: '2027-01-31', to: '2027-03-31' },
        ]);
        expect(addDays('2027-02-27', 2)).toBe('2027-03-01');
    });
});

describe('encodeTfs', () => {
    // Values checked against live Google Flights searches on 2026-11-21
    it('should encode a one-way economy search', () => {
        expect(encodeTfs(LHR_CDG, '2026-12-21', OPTIONS)).toBe(
            'CBwQAhoeEgoyMDI2LTEyLTIxagcIARIDTEhScgcIARIDQ0RHQAFIAXABggELCP___________wGYAQI',
        );
    });

    it('should encode a round trip', () => {
        const route = { route: 'JFK-LAX', origin: 'JFK', destination: 'LAX' };
        expect(encodeTfs(route, '2027-01-15', { ...OPTIONS, returnAfterDays: 5 })).toBe(
            'CBwQAhoeEgoyMDI3LTAxLTE1agcIARIDSkZLcgcIARIDTEFYGh4SCjIwMjctMDEtMjBqBwgBEgNMQVhyBwgBEgNKRktAAUgBcAGCAQsI____________AZgBAQ',
        );
    });

    it('should encode passengers, cabin and stops', () => {
        const route = { route: 'JFK-LHR', origin: 'JFK', destination: 'LHR' };
        expect(encodeTfs(route, '2026-12-21', { ...OPTIONS, adults: 2, cabinClass: 'business', maxStops: 0 })).toBe(
            'CBwQAhogEgoyMDI2LTEyLTIxKABqBwgBEgNKRktyBwgBEgNMSFJAAUABSANwAYIBCwj___________8BmAEC',
        );
    });

    it('should add locale parameters to the search URL', () => {
        expect(buildSearchUrl(LHR_CDG, '2026-12-21', { ...OPTIONS, currency: 'EUR', country: 'DE' })).toMatch(
            /^https:\/\/www\.google\.com\/travel\/flights\?tfs=[\w-]+&hl=en&gl=DE&curr=EUR$/,
        );
    });
});

describe('buildCalendarRequest', () => {
    it('should send the route, dates and trip length', () => {
        const { url, payload } = buildCalendarRequest(LHR_CDG, '2026-12-01', '2027-01-31', {
            ...OPTIONS,
            returnAfterDays: 5,
            maxStops: 0,
        });
        expect(url).toContain('/GetCalendarGraph?hl=en&gl=US&curr=USD&rt=c');
        const outer = JSON.parse(decodeURIComponent(payload.replace(/^f\.req=/, ''))) as [null, string];
        const inner = JSON.parse(outer[1]) as unknown[];
        expect(inner[2]).toEqual(['2026-12-01', '2027-01-31']);
        expect(inner[4]).toEqual([5, 5]);
        const filters = inner[1] as unknown[];
        expect(filters[2]).toBe(1);
        const legs = filters[13] as unknown[][];
        expect(legs).toHaveLength(2);
        expect(legs[0][0]).toEqual([[['LHR', 0]]]);
        expect(legs[0][3]).toBe(1);
        expect(legs[1][6]).toBe('2026-12-06');
    });
});

describe('parseFlights', () => {
    it('should read one-way flights with prices matching the page labels', () => {
        const html = fixture('search-oneway.html');
        const flights = parseFlights(extractDataBlock(html)!);
        expect(flights).toHaveLength(17);
        expect(flights.map((f) => f.price)).toEqual(ariaPrices(html));
        expect(flights.filter((f) => f.isBest)).toHaveLength(3);

        expect(flights[0]).toMatchObject({
            departureAirport: 'LHR',
            arrivalAirport: 'CDG',
            departureDate: '2026-12-21',
            departureTime: '20:25',
            arrivalTime: '22:40',
            durationMinutes: 75,
            price: 103,
            airlines: ['British Airways'],
            flightNumbers: ['BA322'],
            stops: 0,
            layovers: [],
            aircraft: ['Airbus A321neo'],
            co2Kg: 45,
            typicalCo2Kg: 53,
            co2VsTypicalPct: -15,
            isBest: true,
        });
    });

    it('should read connections and layovers', () => {
        const flights = parseFlights(extractDataBlock(fixture('search-oneway.html'))!);
        const klm = flights.find((f) => f.flightNumbers.join() === 'KL1004,KL1411')!;
        expect(klm.stops).toBe(1);
        expect(klm.departureTime).toBe('10:00');
        expect(klm.layovers).toEqual([
            {
                airport: 'AMS',
                airportName: 'Amsterdam Airport Schiphol',
                city: 'Amsterdam',
                durationMinutes: 330,
            },
        ]);
        expect(klm.segments.map((s) => `${s.from}-${s.to}`)).toEqual(['LHR-AMS', 'AMS-CDG']);
    });

    it('should read round-trip totals', () => {
        const html = fixture('search-rt.html');
        const flights = parseFlights(extractDataBlock(html)!);
        expect(flights.length).toBeGreaterThan(0);
        expect(flights.map((f) => f.price)).toEqual(ariaPrices(html));
        expect(html).toContain('From 357 US dollars round trip total');
        expect(flights[0]).toMatchObject({ departureAirport: 'JFK', arrivalAirport: 'LAX', price: 357 });
    });

    it('should return nothing for a search without results', () => {
        expect(parseFlights(extractDataBlock(fixture('search-no-flights.html'))!)).toEqual([]);
    });

    it('should fail loudly when the format changes', () => {
        expect(() => parseFlights([null, null, 'oops', null])).toThrow(/changed the page format/);
        expect(() => parseFlights([null, null, [[[1, 2], [3]]], null])).toThrow(/no flight could be read/);
    });

    it('should return null without the data block', () => {
        expect(extractDataBlock('<html></html>')).toBeNull();
    });
});

describe('formatTime', () => {
    it('should fill omitted minutes', () => {
        expect(formatTime([7, 5])).toBe('07:05');
        expect(formatTime([10])).toBe('10:00');
        expect(formatTime([])).toBe('00:00');
        expect(formatTime(null)).toBeNull();
    });
});

describe('parseCalendarResponse', () => {
    it('should read the cheapest price of every date', () => {
        const prices = parseCalendarResponse(fixture('calendar-oneway.txt'))!;
        expect(prices).toHaveLength(62);
        expect(prices[0]).toEqual({ date: '2026-12-01', price: 158 });
        // Same day and price as the cheapest flight of search-oneway.html
        expect(prices.find((p) => p.date === '2026-12-21')).toEqual({ date: '2026-12-21', price: 103 });
    });

    it('should read round trips', () => {
        const prices = parseCalendarResponse(fixture('calendar-roundtrip.txt'))!;
        expect(prices).toHaveLength(11);
        expect(prices.find((p) => p.date === '2027-01-15')?.price).toBe(357);
    });

    it('should leave out days without flights', () => {
        expect(parseCalendarResponse(fixture('calendar-no-flights.txt'))).toEqual([]);
    });

    it('should report a rejected request', () => {
        const rejected =
            ")]}'\n\n269\n" +
            '[["wrb.fr",null,null,null,null,[3,null,[["type.googleapis.com/travel.frontend.flights.ErrorResponse",[]]]]]]\n';
        expect(parseCalendarResponse(rejected)).toBe('error');
    });

    it('should return null for an answer without data', () => {
        expect(parseCalendarResponse(')]}\'\n\n12\n[["e",4]]\n')).toBeNull();
    });
});

describe('price history', () => {
    it('should compute the change against the previous price', () => {
        expect(computeChange(110, 100)).toEqual({ previousPrice: 100, priceChange: 10, priceChangePct: 10 });
        expect(computeChange(90, 120)).toEqual({ previousPrice: 120, priceChange: -30, priceChangePct: -25 });
        expect(computeChange(100, undefined)).toEqual({ previousPrice: null, priceChange: null, priceChangePct: null });
    });

    it('should build stable keys with allowed characters only', () => {
        expect(historyRecordKey('calendar', LHR_CDG, OPTIONS)).toBe('calendar_LHR_CDG_ow_economy_1a_any_USD_US');
        expect(historyRecordKey('flights', LHR_CDG, { ...OPTIONS, returnAfterDays: 7, maxStops: 0 })).toBe(
            'flights_LHR_CDG_rt7_economy_1a_0s_USD_US',
        );
        expect(flightHistoryKey('2026-12-21', { flightNumbers: ['KL1004', 'KL1411'], departureTime: '10:00' })).toBe(
            '2026-12-21|KL1004+KL1411|10:00',
        );
    });
});

describe('parseLocations', () => {
    it('should read airport places of a search page', () => {
        expect(parseLocations(extractDataBlock(fixture('search-oneway.html'))!)).toEqual({
            origin: ['LHR', 0],
            destination: ['CDG', 0],
        });
    });

    it('should read city place ids', () => {
        const data = [null, [[[[['/m/02_286', 4], 'New York']], [[['/m/04jpl', 4], 'London']]]]];
        expect(parseLocations(data)).toEqual({ origin: ['/m/02_286', 4], destination: ['/m/04jpl', 4] });
    });

    it('should return null for an unknown route', () => {
        expect(parseLocations(extractDataBlock(fixture('search-no-flights.html'))!)).toBeNull();
    });
});
