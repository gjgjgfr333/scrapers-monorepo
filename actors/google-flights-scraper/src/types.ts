import type { ProxyConfigurationOptions } from 'apify';

export type Mode = 'flights' | 'calendar';
export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

export interface Input {
    routes?: string[];
    departureDate?: string;
    departureDateTo?: string;
    returnAfterDays?: number;
    mode?: Mode;
    maxFlightsPerSearch?: number;
    adults?: number;
    cabinClass?: CabinClass;
    maxStops?: number;
    currency?: string;
    country?: string;
    language?: string;
    trackPriceChanges?: boolean;
    onlyChanged?: boolean;
    proxyConfiguration?: ProxyConfigurationOptions;
}

/** How the internal API names a place: ['LHR', 0] for an airport, ['/m/02_286', 4] for a city */
export type Location = [string, number];

export interface Route {
    /** `LHR-CDG` */
    route: string;
    origin: string;
    destination: string;
    /** Set once read from a search page; the calendar does not accept city codes like NYC */
    originLocation?: Location;
    destinationLocation?: Location;
}

/** Everything that defines one search apart from the route and the dates */
export interface SearchOptions {
    returnAfterDays: number;
    adults: number;
    cabinClass: CabinClass;
    /** -1 means any number of stops */
    maxStops: number;
    currency: string;
    country: string;
    language: string;
}

export interface Segment {
    flightNumber: string | null;
    airline: string | null;
    from: string | null;
    fromName: string | null;
    to: string | null;
    toName: string | null;
    departureDate: string | null;
    departureTime: string | null;
    arrivalDate: string | null;
    arrivalTime: string | null;
    durationMinutes: number | null;
    aircraft: string | null;
    legroom: string | null;
}

export interface Layover {
    airport: string | null;
    airportName: string | null;
    city: string | null;
    durationMinutes: number | null;
}

export interface PriceChange {
    previousPrice: number | null;
    priceChange: number | null;
    priceChangePct: number | null;
}

export interface FlightItem extends PriceChange {
    type: 'flight';
    route: string;
    origin: string;
    destination: string;
    departureAirport: string | null;
    arrivalAirport: string | null;
    departureDate: string;
    returnDate: string | null;
    price: number | null;
    currency: string;
    airlines: string[];
    flightNumbers: string[];
    stops: number;
    layovers: Layover[];
    departureTime: string | null;
    arrivalDate: string | null;
    arrivalTime: string | null;
    durationMinutes: number | null;
    aircraft: string[];
    segments: Segment[];
    co2Kg: number | null;
    typicalCo2Kg: number | null;
    co2VsTypicalPct: number | null;
    isBest: boolean;
    cabinClass: CabinClass;
    adults: number;
    googleFlightsUrl: string;
    scrapedAt: string;
}

export interface CalendarDayItem extends PriceChange {
    type: 'calendarDay';
    route: string;
    origin: string;
    destination: string;
    date: string;
    returnDate: string | null;
    minPrice: number;
    currency: string;
    cabinClass: CabinClass;
    adults: number;
    googleFlightsUrl: string;
    scrapedAt: string;
}

/** A flight as parsed from the page, before route and run fields are added */
export type ParsedFlight = Pick<
    FlightItem,
    | 'departureAirport'
    | 'arrivalAirport'
    | 'price'
    | 'airlines'
    | 'flightNumbers'
    | 'stops'
    | 'layovers'
    | 'departureTime'
    | 'arrivalDate'
    | 'arrivalTime'
    | 'durationMinutes'
    | 'aircraft'
    | 'segments'
    | 'co2Kg'
    | 'typicalCo2Kg'
    | 'co2VsTypicalPct'
    | 'isBest'
> & { departureDate: string | null };

export interface CalendarPrice {
    date: string;
    price: number;
}

export interface FlightsUserData {
    route: Route;
    date: string;
}

export interface CalendarUserData {
    route: Route;
    from: string;
    to: string;
}

export interface ResolveUserData {
    route: Route;
    date: string;
}

export interface CrawlState {
    flightsPushed: number;
    daysPushed: number;
    /** Items found on the source, before `onlyChanged` filtering */
    itemsFound: number;
    emptySearches: string[];
    failedSearches: string[];
}
