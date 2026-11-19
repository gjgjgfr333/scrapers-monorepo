import type {
    CategoryScore,
    HotelItem,
    HotelRef,
    HotelReviewState,
    HotelSummaryItem,
    RawReview,
    RawReviewPage,
    RawSecondaryData,
    ReviewItem,
    ReviewProvider,
    ReviewSort,
    ScrapeOptions,
} from './types.js';

export const LABELS = {
    PAGE: 'PAGE',
    DETAILS: 'DETAILS',
    REVIEWS: 'REVIEWS',
} as const;

export const AGODA_ORIGIN = 'https://www.agoda.com';
/** Agoda localizes texts by this header; English keeps rating labels and traveler types stable */
export const REQUEST_HEADERS = { 'accept-language': 'en-US,en;q=0.9' };

export const REVIEWS_ENDPOINT = `${AGODA_ORIGIN}/api/cronos/property/review/ReviewComments`;

/** Reviews per provider per page; the site itself asks for 5, above 100 the API returns nothing */
export const REVIEWS_PAGE_SIZE = 20;

/**
 * The review API is not stable: Booking.com reviews come back in a shifting order, with repeated
 * reviews and empty pages in the middle. Paging stops after this many pages without a new review.
 */
export const MAX_PAGES_WITHOUT_NEW_REVIEWS = 10;

/** The API answers empty pages after page 100, i.e. at most 2,000 reviews per source and hotel */
export const MAX_REVIEW_PAGE = 100;

/** Agoda's own provider ids */
export const PROVIDER_IDS = { agoda: 332, booking: 3038 } as const;

const SORT_IDS: Record<ReviewSort, number> = { newest: 1, highest: 2, lowest: 3, helpful: 7 };

const nonEmpty = (value: string | null | undefined): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
};

const finiteNumber = (value: unknown): number | null => {
    const number = typeof value === 'string' ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

/** "//pix8.agoda.net/x.jpg" → "https://pix8.agoda.net/x.jpg" */
export const absoluteUrl = (url: string | null | undefined): string | null => {
    const value = nonEmpty(url);
    if (!value) return null;
    if (value.startsWith('//')) return `https:${value}`;
    if (value.startsWith('/')) return `${AGODA_ORIGIN}${value}`;
    return value;
};

/** Hotel page URL without search parameters, or null when the input is not an Agoda URL */
export const normalizeHotelUrl = (input: string): string | null => {
    let url: URL;
    try {
        url = new URL(input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`);
    } catch {
        return null;
    }
    if (!/(^|\.)agoda\.com$/i.test(url.hostname)) return null;
    return `${AGODA_ORIGIN}${url.pathname}`;
};

export const parseHotelId = (value: string | number): number | null => {
    const text = String(value).trim();
    if (!/^\d{1,12}$/.test(text)) return null;
    const id = Number(text);
    return id > 0 ? id : null;
};

/** Hotel id written directly in the URL (`hotel_id`, `hid`, `hotelId` parameters), if any */
export const hotelIdFromUrl = (input: string): number | null => {
    try {
        const url = new URL(input.trim());
        for (const name of ['hotel_id', 'hid', 'hotelId', 'hotelid']) {
            const id = parseHotelId(url.searchParams.get(name) ?? '');
            if (id) return id;
        }
    } catch {
        // not a URL
    }
    return null;
};

/** Reads the hotel id from the HTML of an Agoda hotel page */
export const extractHotelIdFromHtml = (html: string): number | null => {
    const patterns = [/propertyId:(\d+)/, /hotel_id=(\d+)/, /[?&]hotelId=(\d+)/, /"hotelId":(\d+)/, /hotelId:(\d+)/];
    for (const pattern of patterns) {
        const match = pattern.exec(html);
        if (match) return parseHotelId(match[1]);
    }
    return null;
};

export const buildDetailsUrl = (hotelId: number): string =>
    `${AGODA_ORIGIN}/api/cronos/property/BelowFoldParams/GetSecondaryData?hotel_id=${hotelId}&all=false&price_view=2&isHotelLandSearch=true&currencyCode=USD`;

/** The request body the hotel page itself sends when paging through reviews */
export const buildReviewsPayload = (hotelId: number, page: number, sort: ReviewSort) => ({
    hotelId,
    providerId: PROVIDER_IDS.agoda,
    demographicId: 0,
    page,
    pageSize: REVIEWS_PAGE_SIZE,
    sorting: SORT_IDS[sort],
    providerIds: [PROVIDER_IDS.agoda],
    isReviewPage: false,
    isCrawlablePage: true,
    filters: { language: [], room: [] },
    searchKeyword: '',
    searchFilters: [],
});

const decodeEntities = (text: string): string =>
    text
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&amp;/g, '&');

/** Agoda's description is HTML with <b> and <br>; returns plain text with line breaks */
export const htmlToText = (html: string | null | undefined): string | null => {
    if (typeof html !== 'string') return null;
    const text = decodeEntities(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|h\d)>/gi, '\n')
            .replace(/<[^>]+>/g, ''),
    )
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
    return nonEmpty(text);
};

/** Builds the hotel item; returns null when Agoda does not know the hotel (no name) */
export const mapHotel = (data: RawSecondaryData, hotelId: number, inputUrl: string | null): HotelItem | null => {
    const info = data.hotelInfo;
    const name = nonEmpty(info?.name);
    if (!info || !name) return null;

    const address = info.address ?? {};
    const reviews = data.reviews ?? {};
    const [latitude, longitude] = data.mapParams?.latlng ?? [];
    const searchUrl = nonEmpty(data.searchbox?.config?.defaultSearchURL);

    const categoryScores: CategoryScore[] = (reviews.demographic?.grades ?? []).map((grade) => ({
        id: nonEmpty(grade.id),
        name: nonEmpty(grade.name),
        score: finiteNumber(grade.score),
        cityAverage: finiteNumber(grade.cityAverage),
    }));

    const scoreDistribution: Record<string, number> = {};
    for (const bucket of reviews.demographic?.scoreDistribution ?? []) {
        const id = nonEmpty(bucket.id);
        const count = finiteNumber(bucket.count);
        if (id && count !== null) scoreDistribution[id] = count;
    }

    return {
        type: 'hotel',
        hotelId,
        hotelUrl: searchUrl ? normalizeHotelUrl(absoluteUrl(searchUrl)!) : inputUrl,
        hotelName: name,
        englishName: nonEmpty(info.englishName),
        accommodationType: nonEmpty(info.accommodationType),
        starRating: finiteNumber(info.starRating?.value) || null,
        address: nonEmpty(address.full),
        street: nonEmpty(address.address),
        area: nonEmpty(address.areaName),
        city: nonEmpty(address.cityName),
        country: nonEmpty(address.countryName),
        postalCode: nonEmpty(address.postalCode),
        latitude: finiteNumber(latitude),
        longitude: finiteNumber(longitude),
        reviewScore: finiteNumber(reviews.score),
        reviewScoreText: nonEmpty(reviews.scoreText),
        reviewsCount: finiteNumber(reviews.reviewsCount),
        recommendationScore: finiteNumber(reviews.recommendationScore),
        categoryScores,
        scoreDistribution,
        description: htmlToText(data.aboutHotel?.hotelDesc?.overview),
        highlights: (data.featuresYouLove?.features ?? [])
            .map((feature) => nonEmpty(feature.text))
            .filter((text): text is string => text !== null),
        images: (data.mosaicInitData?.images ?? [])
            .map((image) => absoluteUrl(image.location))
            .filter((url): url is string => url !== null)
            .slice(0, 20),
        scrapedAt: new Date().toISOString(),
    };
};

export const providerOf = (review: Pick<RawReview, 'providerId'>): ReviewProvider => {
    if (review.providerId === PROVIDER_IDS.agoda) return 'agoda';
    if (review.providerId === PROVIDER_IDS.booking) return 'booking';
    return 'other';
};

/** "2025-01-04T08:41:00+07:00" → "2025-01-04"; Agoda writes local dates with a Bangkok offset */
export const datePart = (value: string | null | undefined): string | null => {
    const text = nonEmpty(value);
    if (!text) return null;
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    return match ? match[1] : null;
};

export const mapReview = (raw: RawReview, hotel: HotelRef, includeReviewerName: boolean): ReviewItem => {
    const reviewer = raw.reviewerInfo ?? {};
    const comment = nonEmpty(raw.reviewComments);
    const positives = nonEmpty(raw.reviewPositives);
    const negatives = nonEmpty(raw.reviewNegatives);
    const lengthOfStay = finiteNumber(reviewer.lengthOfStay);

    const item: ReviewItem = {
        type: 'review',
        hotelId: hotel.hotelId,
        hotelName: hotel.hotelName,
        hotelUrl: hotel.hotelUrl,
        reviewId: raw.hotelReviewId,
        provider: providerOf(raw),
        rating: finiteNumber(raw.rating),
        ratingText: nonEmpty(raw.ratingText),
        title: nonEmpty(raw.reviewTitle),
        // Booking.com reviews have no free text, only "liked" and "disliked" parts
        text: comment ?? ([positives, negatives].filter(Boolean).join('\n\n') || null),
        positives,
        negatives,
        language: nonEmpty(raw.translateSource),
        reviewDate: datePart(raw.reviewDate),
        checkInDate: datePart(raw.checkInDate),
        checkOutDate: datePart(raw.checkOutDate),
        stayMonth: nonEmpty(raw.checkInDateMonthAndYear),
        travelerType: nonEmpty(reviewer.reviewGroupName),
        roomType: nonEmpty(reviewer.roomTypeName),
        lengthOfStay: lengthOfStay && lengthOfStay > 0 ? lengthOfStay : null,
        reviewerCountry: nonEmpty(reviewer.countryName),
        helpfulVotes: finiteNumber(raw.helpfulVotes) ?? 0,
        images: (raw.ugcImages ?? []).map((image) => absoluteUrl(image.url)).filter((url): url is string => !!url),
        scrapedAt: new Date().toISOString(),
    };
    if (includeReviewerName) item.reviewerName = nonEmpty(reviewer.displayMemberName);
    return item;
};

export const parseReviewPage = (json: unknown): { comments: RawReview[]; available: Record<string, number> } | null => {
    if (!json || typeof json !== 'object') return null;
    const page = json as RawReviewPage;
    if (!Array.isArray(page.comments)) return null;

    const available: Record<string, number> = {};
    for (const provider of page.providerList ?? []) {
        const total = finiteNumber(provider.totalIndex);
        if (total === null) continue;
        const name = providerOf({ providerId: provider.id ?? null });
        available[name] = (available[name] ?? 0) + total;
    }

    return {
        comments: page.comments.filter((comment) => typeof comment?.hotelReviewId === 'number'),
        available,
    };
};

export const emptyReviewState = (): HotelReviewState => ({
    seen: [],
    collected: 0,
    noNewPages: 0,
    firstPageKey: null,
    available: {},
    ratingSum: 0,
    ratingCount: 0,
    byProvider: {},
    ratingDistribution: {},
    travelerTypes: {},
    done: false,
});

/** Marks the error thrown when Agoda answers a later page with the reviews of page 1 */
export const STUCK_PAGING_ERROR = 'Agoda answered with the first page of reviews again';

/**
 * Identifies a page by the ids of its first reviews from the wanted sources. Agoda may keep paging
 * its own reviews while answering the Booking.com part with page 1, so other sources are ignored.
 */
export const reviewPageKey = (comments: RawReview[], providers: ReviewProvider[]): string =>
    comments
        .filter((comment) => providers.includes(providerOf(comment)))
        .slice(0, 5)
        .map((comment) => comment.hotelReviewId)
        .join(',');

/** Same buckets as Agoda's score distribution */
export const ratingBucket = (rating: number): string => {
    if (rating >= 9) return 'exceptional';
    if (rating >= 8) return 'excellent';
    if (rating >= 7) return 'very_good';
    if (rating >= 6) return 'good';
    return 'below_expectation';
};

/**
 * Selects the reviews of one page that should be saved: wanted providers, not seen before,
 * not older than `reviewsSince`, and within the per-hotel limit. Updates the hotel state.
 */
export const selectReviews = (
    comments: RawReview[],
    state: HotelReviewState,
    options: Pick<ScrapeOptions, 'providers' | 'reviewsSince' | 'maxReviewsPerHotel'>,
): { selected: RawReview[]; newWanted: number } => {
    const seen = new Set(state.seen);
    const selected: RawReview[] = [];
    let newWanted = 0;

    for (const review of comments) {
        if (!options.providers.includes(providerOf(review))) continue;
        if (seen.has(review.hotelReviewId)) continue;
        seen.add(review.hotelReviewId);
        state.seen.push(review.hotelReviewId);
        newWanted++;

        const date = datePart(review.reviewDate);
        if (options.reviewsSince && (!date || date < options.reviewsSince)) continue;
        if (options.maxReviewsPerHotel > 0 && state.collected + selected.length >= options.maxReviewsPerHotel) continue;
        selected.push(review);
    }

    return { selected, newWanted };
};

/** Adds saved reviews to the per-hotel tallies used by the summary */
/* eslint-disable no-param-reassign -- the state object is updated in place on purpose */
export const tallyReviews = (state: HotelReviewState, reviews: ReviewItem[]) => {
    for (const review of reviews) {
        state.collected++;
        state.byProvider[review.provider] = (state.byProvider[review.provider] ?? 0) + 1;
        if (review.rating !== null) {
            state.ratingSum += review.rating;
            state.ratingCount++;
            const bucket = ratingBucket(review.rating);
            state.ratingDistribution[bucket] = (state.ratingDistribution[bucket] ?? 0) + 1;
        }
        if (review.travelerType) {
            state.travelerTypes[review.travelerType] = (state.travelerTypes[review.travelerType] ?? 0) + 1;
        }
    }
};
/* eslint-enable no-param-reassign */

/** Last page worth asking for: enough pages to cover the largest wanted provider, plus a margin */
export const maxReviewPages = (available: Record<string, number>, providers: ReviewProvider[]): number => {
    const largest = Math.max(0, ...providers.map((provider) => available[provider] ?? 0));
    return Math.min(Math.ceil(largest / REVIEWS_PAGE_SIZE) + 2, MAX_REVIEW_PAGE);
};

export const shouldFetchNextPage = (
    state: HotelReviewState,
    page: number,
    options: Pick<ScrapeOptions, 'providers' | 'maxReviewsPerHotel'>,
): boolean => {
    if (options.maxReviewsPerHotel > 0 && state.collected >= options.maxReviewsPerHotel) return false;
    if (state.noNewPages >= MAX_PAGES_WITHOUT_NEW_REVIEWS) return false;
    return page < maxReviewPages(state.available, options.providers);
};

export const buildSummary = (hotel: HotelRef, state: HotelReviewState): HotelSummaryItem => ({
    type: 'hotelSummary',
    hotelId: hotel.hotelId,
    hotelName: hotel.hotelName,
    hotelUrl: hotel.hotelUrl,
    reviewsAvailable: state.available,
    reviewsCollected: state.collected,
    reviewsByProvider: state.byProvider,
    averageRatingCollected:
        state.ratingCount > 0 ? Math.round((state.ratingSum / state.ratingCount) * 100) / 100 : null,
    ratingDistribution: state.ratingDistribution,
    travelerTypes: state.travelerTypes,
    scrapedAt: new Date().toISOString(),
});

export const normalizeDate = (value: string | null | undefined): string | null => {
    const text = nonEmpty(value);
    if (!text) return null;
    const date = datePart(text);
    if (!date || Number.isNaN(Date.parse(date))) return null;
    return date;
};
