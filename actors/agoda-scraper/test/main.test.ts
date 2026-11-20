import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { RawReview, RawSecondaryData } from '../src/types.js';
import {
    buildReviewsPayload,
    buildSummary,
    datePart,
    emptyReviewState,
    extractHotelIdFromHtml,
    hotelIdFromUrl,
    htmlToText,
    mapHotel,
    mapReview,
    maxReviewPages,
    MAX_PAGES_WITHOUT_NEW_REVIEWS,
    normalizeDate,
    normalizeHotelUrl,
    parseReviewPage,
    reviewPageKey,
    selectReviews,
    shouldFetchNextPage,
    tallyReviews,
} from '../src/utils.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const secondaryData = fixture('secondary-data.json') as RawSecondaryData;
const reviewPage = fixture('review-comments.json');
const hotel = {
    hotelId: 1593,
    hotelName: 'Hotel Vendome',
    hotelUrl: 'https://www.agoda.com/hotel-vendome/hotel/nice-fr.html',
};

const review = (id: number, providerId: number, reviewDate: string): RawReview => ({
    hotelReviewId: id,
    providerId,
    rating: 8,
    reviewDate,
});

describe('URLs and ids', () => {
    it('should drop search parameters and the subdomain from a hotel URL', () => {
        expect(normalizeHotelUrl('https://agoda.com/hotel-vendome/hotel/nice-fr.html?checkIn=2026-12-01&los=2')).toBe(
            'https://www.agoda.com/hotel-vendome/hotel/nice-fr.html',
        );
        expect(normalizeHotelUrl('www.agoda.com/en-gb/hotel-vendome/hotel/nice-fr.html')).toBe(
            'https://www.agoda.com/en-gb/hotel-vendome/hotel/nice-fr.html',
        );
    });

    it('should reject non-Agoda URLs', () => {
        expect(normalizeHotelUrl('https://www.booking.com/hotel/fr/vendome.html')).toBeNull();
        expect(normalizeHotelUrl('https://agoda.com.evil.example/hotel/x.html')).toBeNull();
    });

    it('should read a hotel id from URL parameters', () => {
        expect(hotelIdFromUrl('https://www.agoda.com/partners/partnersearch.aspx?hid=185945')).toBe(185945);
        expect(hotelIdFromUrl('https://www.agoda.com/x?hotel_id=1593&all=false')).toBe(1593);
        expect(hotelIdFromUrl('https://www.agoda.com/hotel-vendome/hotel/nice-fr.html')).toBeNull();
    });

    it('should find the hotel id in the page HTML', () => {
        expect(
            extractHotelIdFromHtml('...,isPackages:!1,urlMappingId:19998153,subTypeId:0,propertyId:1593,pageTypeId:7'),
        ).toBe(1593);
        expect(extractHotelIdFromHtml('<html>nothing here</html>')).toBeNull();
    });

    it('should build the review request the hotel page sends', () => {
        expect(buildReviewsPayload(1593, 3, 'helpful')).toMatchObject({
            hotelId: 1593,
            providerId: 332,
            providerIds: [332],
            page: 3,
            pageSize: 20,
            sorting: 7,
        });
    });
});

describe('mapHotel', () => {
    it('should map the hotel details', () => {
        const item = mapHotel(secondaryData, 1593, null)!;
        expect(item).toMatchObject({
            type: 'hotel',
            hotelId: 1593,
            hotelName: 'Hotel Vendome',
            hotelUrl: 'https://www.agoda.com/hotel-vendome/hotel/nice-fr.html',
            accommodationType: 'Hotel',
            starRating: 3,
            street: '26 Rue Pastorelli',
            city: 'Nice',
            country: 'France',
            postalCode: '06000',
            reviewScore: 8.5,
            reviewsCount: 247,
            recommendationScore: 96,
        });
        expect(item.latitude).toBeCloseTo(43.7008, 3);
        expect(item.longitude).toBeCloseTo(7.2712, 3);
        expect(item.categoryScores[0]).toEqual({
            id: 'cleanliness',
            name: 'Cleanliness',
            score: 8.6,
            cityAverage: 7.5,
        });
        expect(item.scoreDistribution).toMatchObject({ exceptional: 110, below_expectation: 15 });
        expect(item.description).toMatch(/^Hotel Vendome: A Charming Stay/);
        expect(item.description).not.toMatch(/<b>/);
        expect(item.highlights.length).toBeGreaterThan(0);
        expect(item.images[0]).toMatch(/^https:\/\/pix\d+\.agoda\.net\//);
    });

    it('should return null for an unknown hotel', () => {
        expect(mapHotel({ hotelInfo: { name: null } }, 999999999, null)).toBeNull();
        expect(mapHotel({}, 999999999, null)).toBeNull();
    });
});

describe('reviews', () => {
    it('should parse a review page with the available counts per provider', () => {
        const page = parseReviewPage(reviewPage)!;
        expect(page.comments).toHaveLength(6);
        expect(page.available).toEqual({ agoda: 93, booking: 1835 });
        expect(parseReviewPage({ error: 'x' })).toBeNull();
    });

    it('should map an Agoda review', () => {
        const raw = parseReviewPage(reviewPage)!.comments.find((c) => c.providerId === 332)!;
        const item = mapReview(raw, hotel, false);
        expect(item).toMatchObject({ type: 'review', hotelId: 1593, provider: 'agoda', reviewId: raw.hotelReviewId });
        expect(item.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(item.checkInDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(item.text).toBeTruthy();
        expect(item).not.toHaveProperty('reviewerName');
    });

    it('should use liked and disliked parts as the text of a Booking.com review', () => {
        const item = mapReview(
            {
                hotelReviewId: 1,
                providerId: 3038,
                reviewComments: '',
                reviewPositives: 'Great location',
                reviewNegatives: ' ',
            },
            hotel,
            true,
        );
        expect(item.provider).toBe('booking');
        expect(item.text).toBe('Great location');
        expect(item.negatives).toBeNull();
        expect(item.reviewerName).toBeNull();
    });

    it('should keep the local date of a review', () => {
        expect(datePart('2024-06-02T00:00:00+07:00')).toBe('2024-06-02');
        expect(normalizeDate('2025-01-31')).toBe('2025-01-31');
        expect(normalizeDate('yesterday')).toBeNull();
    });

    it('should strip HTML from the description', () => {
        expect(htmlToText('<b>A &amp; B</b><br><br>Line')).toBe('A & B\n\nLine');
    });
});

describe('selectReviews', () => {
    const all = { providers: ['agoda', 'booking', 'other'] as const, reviewsSince: null, maxReviewsPerHotel: 0 };

    it('should skip reviews already seen on earlier pages', () => {
        const state = emptyReviewState();
        const first = selectReviews([review(1, 332, '2026-01-01'), review(2, 3038, '2026-01-01')], state, {
            ...all,
            providers: [...all.providers],
        });
        const second = selectReviews([review(2, 3038, '2026-01-01'), review(3, 332, '2026-01-01')], state, {
            ...all,
            providers: [...all.providers],
        });
        expect(first.selected.map((r) => r.hotelReviewId)).toEqual([1, 2]);
        expect(second.selected.map((r) => r.hotelReviewId)).toEqual([3]);
        expect(second.newWanted).toBe(1);
    });

    it('should filter by provider and date and respect the limit', () => {
        const state = emptyReviewState();
        state.collected = 1;
        const { selected } = selectReviews(
            [
                review(1, 332, '2026-03-01'),
                review(2, 3038, '2026-03-01'),
                review(3, 332, '2024-01-01'),
                review(4, 332, '2026-02-01'),
                review(5, 332, '2026-02-02'),
            ],
            state,
            { providers: ['agoda'], reviewsSince: '2025-01-01', maxReviewsPerHotel: 3 },
        );
        expect(selected.map((r) => r.hotelReviewId)).toEqual([1, 4]);
    });
});

describe('paging and summary', () => {
    it('should identify a page by the reviews of the wanted sources only', () => {
        const page1 = [review(1, 332, '2026-01-01'), review(2, 3038, '2026-01-01')];
        const page2 = [review(3, 332, '2026-01-01'), review(2, 3038, '2026-01-01')];
        expect(reviewPageKey(page1, ['booking'])).toBe(reviewPageKey(page2, ['booking']));
        expect(reviewPageKey(page1, ['agoda', 'booking'])).not.toBe(reviewPageKey(page2, ['agoda', 'booking']));
    });

    it('should page through enough pages for the largest wanted provider', () => {
        expect(maxReviewPages({ agoda: 93, booking: 1835 }, ['agoda'])).toBe(7);
        expect(maxReviewPages({ agoda: 93, booking: 1835 }, ['agoda', 'booking'])).toBe(94);
        expect(maxReviewPages({}, ['agoda'])).toBe(2);
        expect(maxReviewPages({ agoda: 3887 }, ['agoda'])).toBe(100);
    });

    it('should stop at the limit or after pages without new reviews', () => {
        const state = emptyReviewState();
        state.available = { agoda: 93 };
        const options = { providers: ['agoda' as const], maxReviewsPerHotel: 50 };
        expect(shouldFetchNextPage(state, 1, options)).toBe(true);
        expect(shouldFetchNextPage(state, 7, options)).toBe(false);
        state.collected = 50;
        expect(shouldFetchNextPage(state, 1, options)).toBe(false);
        state.collected = 0;
        state.noNewPages = MAX_PAGES_WITHOUT_NEW_REVIEWS;
        expect(shouldFetchNextPage(state, 1, options)).toBe(false);
    });

    it('should summarize the saved reviews', () => {
        const state = emptyReviewState();
        state.available = { agoda: 93, booking: 1835 };
        tallyReviews(state, [
            { ...mapReview(review(1, 332, '2026-01-01'), hotel, false), rating: 9.2, travelerType: 'Couple' },
            { ...mapReview(review(2, 3038, '2026-01-01'), hotel, false), rating: 5, travelerType: 'Couple' },
        ]);
        expect(buildSummary(hotel, state)).toMatchObject({
            type: 'hotelSummary',
            reviewsCollected: 2,
            reviewsByProvider: { agoda: 1, booking: 1 },
            averageRatingCollected: 7.1,
            ratingDistribution: { exceptional: 1, below_expectation: 1 },
            travelerTypes: { Couple: 2 },
            reviewsAvailable: { agoda: 93, booking: 1835 },
        });
    });
});
