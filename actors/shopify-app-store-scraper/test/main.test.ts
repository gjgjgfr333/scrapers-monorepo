import { readFileSync } from 'node:fs';

import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';

import {
    parseAppPage,
    parseCategoryPage,
    parsePriceText,
    parseReviewsPage,
    parseUsdRate,
    splitList,
} from '../src/appstore.js';
import { expectedReviews, reserveApps } from '../src/routes.js';
import type { AppItem, CrawlState } from '../src/types.js';
import {
    categoryUrl,
    cleanText,
    isOnOrAfter,
    parseAppInput,
    parseCategoryInput,
    parseEnglishDate,
    parseNumber,
    parseSinceDate,
    parseSitemapHandles,
    ratingRange,
    reviewsUrl,
} from '../src/utils.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
// Tests load HTML with cheerio's ESM build; the handlers get the same API from Crawlee
const page = (name: string) => load(fixture(name)) as never;

const PRODUCT_REVIEWS = 'marketing-and-conversion-social-trust-product-reviews';

describe('parseAppInput', () => {
    it('reads handles and app URLs', () => {
        expect(parseAppInput('judgeme')).toBe('judgeme');
        expect(parseAppInput(' Judgeme ')).toBe('judgeme');
        expect(parseAppInput('https://apps.shopify.com/judgeme')).toBe('judgeme');
        expect(parseAppInput('apps.shopify.com/judgeme/reviews?page=2')).toBe('judgeme');
        expect(parseAppInput('https://apps.shopify.com/judgeme?surface_type=search')).toBe('judgeme');
        expect(parseAppInput('https://apps.shopify.com/de/judgeme')).toBe('judgeme');
        expect(parseAppInput('https://apps.shopify.com/pt-BR/klaviyo-email-marketing')).toBe('klaviyo-email-marketing');
    });

    it('rejects other pages and hosts', () => {
        expect(parseAppInput('https://apps.shopify.com/categories/store-design')).toBeNull();
        expect(parseAppInput('https://apps.shopify.com/partners/judge-me')).toBeNull();
        expect(parseAppInput('https://example.com/judgeme')).toBeNull();
        expect(parseAppInput('https://apps.shopify.com/')).toBeNull();
        expect(parseAppInput('')).toBeNull();
    });
});

describe('parseCategoryInput and URLs', () => {
    it('reads category URLs and slugs', () => {
        expect(parseCategoryInput(`https://apps.shopify.com/categories/${PRODUCT_REVIEWS}/all?page=3`)).toBe(
            PRODUCT_REVIEWS,
        );
        expect(parseCategoryInput('https://apps.shopify.com/categories/store-design')).toBe('store-design');
        expect(parseCategoryInput('store-design')).toBe('store-design');
        expect(parseCategoryInput('https://apps.shopify.com/judgeme')).toBeNull();
    });

    it('builds page URLs', () => {
        expect(categoryUrl('store-design')).toBe('https://apps.shopify.com/categories/store-design');
        expect(categoryUrl('x', 2)).toBe('https://apps.shopify.com/categories/x/all?page=2');
        expect(reviewsUrl('judgeme', 1, [1, 2, 3, 4, 5])).toBe(
            'https://apps.shopify.com/judgeme/reviews?sort_by=newest&page=1',
        );
        expect(reviewsUrl('judgeme', 3, [1, 2])).toBe(
            'https://apps.shopify.com/judgeme/reviews?sort_by=newest&ratings%5B%5D=1&ratings%5B%5D=2&page=3',
        );
    });
});

describe('small helpers', () => {
    it('parses numbers, dates and ratings', () => {
        expect(parseNumber('(50,422)')).toBe(50422);
        expect(parseNumber('4.8 out of 5 stars')).toBe(4.8);
        expect(parseNumber('none')).toBeNull();
        expect(parseEnglishDate('Edited June 12, 2026')).toBe('2026-06-12');
        expect(parseEnglishDate('Judge.me replied October 2, 2026')).toBe('2026-10-02');
        expect(parseEnglishDate('yesterday')).toBeNull();
        expect(ratingRange(undefined, undefined)).toEqual([1, 2, 3, 4, 5]);
        expect(ratingRange(4, 2)).toEqual([2, 3, 4]);
        expect(ratingRange(0, 9)).toEqual([1, 2, 3, 4, 5]);
        expect(cleanText('  a \n\n\n\n b  ')).toBe('a\n\nb');
    });

    it('compares dates with reviewsSince', () => {
        const since = parseSinceDate('2026-11-01');
        expect(since?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
        expect(parseSinceDate('not a date')).toBeNull();
        expect(parseSinceDate('')).toBeNull();
        expect(isOnOrAfter('2026-11-01', since)).toBe(true);
        expect(isOnOrAfter('2026-10-31', since)).toBe(false);
        expect(isOnOrAfter('2020-01-01', null)).toBe(true);
    });

    it('parses prices', () => {
        expect(parsePriceText('€13.64 EUR/month')).toEqual({ price: 13.64, period: 'month' });
        expect(parsePriceText('$1,200/year')).toEqual({ price: 1200, period: 'year' });
        expect(parsePriceText('$100 one-time charge')).toEqual({ price: 100, period: 'one-time' });
        expect(parsePriceText('Free to install')).toEqual({ price: 0, period: null });
        expect(parseUsdRate('Prices in EUR are estimates (1 EUR = 1.0994 USD). You')).toBe(1.0994);
        expect(parseUsdRate(null)).toBeNull();
        expect(splitList('English, Spanish, and Romanian')).toEqual(['English', 'Spanish', 'Romanian']);
        expect(splitList('English')).toEqual(['English']);
    });

    it('reads app handles from the sitemap', () => {
        const handles = parseSitemapHandles(fixture('sitemap-apps-en.xml'));
        expect(handles).toHaveLength(5);
        expect(handles[0]).toBe('folio-store-locator');
    });
});

describe('parseAppPage', () => {
    it('reads every field of a popular app', () => {
        const app = parseAppPage(page('app-judgeme.html'), 'judgeme', 'T')!;
        expect(app).toMatchObject({
            type: 'app',
            handle: 'judgeme',
            url: 'https://apps.shopify.com/judgeme',
            name: 'Judge.me Product Reviews App',
            subtitle: 'Collect unlimited product reviews, star ratings, testimonials',
            developer: 'Judge.me',
            developerUrl: 'https://apps.shopify.com/partners/judge-me',
            rating: 5,
            reviewCount: 50422,
            ratingDistribution: { '1': 156, '2': 40, '3': 80, '4': 830, '5': 49316 },
            pricingSummary: 'Free plan available. Free trial available.',
            categories: ['Product reviews', 'SEO'],
            launchedAt: '2015-06-25',
            builtForShopify: true,
            scrapedAt: 'T',
        });
        expect(app.introduction).toMatch(/^Send unlimited, automatic review requests/);
        expect(app.headline).toMatch(/^Sell more with unlimited product reviews/);
        expect(app.description).toMatch(/^Driving traffic is only half the battle/);
        expect(app.highlights).toHaveLength(5);
        expect(app.iconUrl).toMatch(/^https:\/\/cdn\.shopify\.com\//);
        expect(app.languages).toHaveLength(15);
        expect(app.languages.at(-1)).toBe('Romanian');
        expect(app.worksWith).toContain('Klaviyo: Email Marketing');
        expect(app.plans).toHaveLength(2);
        expect(app.plans[0]).toMatchObject({ name: 'Forever Free', price: 0, priceUsd: 0, period: null });
        expect(app.plans[1]).toMatchObject({
            name: 'Awesome',
            price: 13.64,
            currency: 'EUR',
            priceUsd: 15,
            period: 'month',
            trialDays: 15,
        });
        expect(app.plans[1].features).toContain('Google Shopping');
    });

    it('reads plan notes, yearly prices and the missing Built for Shopify badge', () => {
        const klaviyo = parseAppPage(page('app-klaviyo.html'), 'klaviyo-email-marketing')!;
        expect(klaviyo.builtForShopify).toBe(false);
        expect(klaviyo.pricingSummary).toBe('Free to install');
        expect(klaviyo.plans[1].additionalCharges).toMatch(/^Up to 1250 SMS/);

        const pagefly = parseAppPage(page('app-pagefly.html'), 'pagefly')!;
        expect(pagefly.builtForShopify).toBe(true);
        expect(pagefly.plans.map((plan) => plan.priceUsd)).toEqual([0, 24, 99, 299]);
        expect(pagefly.plans[2].yearlyPriceText).toBe('or €900.52 EUR/year and save 17%');
    });

    it('handles an app without reviews', () => {
        const app = parseAppPage(page('app-no-reviews.html'), 'friction-observatory')!;
        expect(app.reviewCount).toBe(0);
        expect(app.rating).toBeNull();
        expect(app.ratingDistribution).toBeNull();
        expect(app.plans[1].trialDays).toBe(14);
    });

    it('returns null for the not-found page', () => {
        expect(parseAppPage(page('app-not-found.html'), 'nope')).toBeNull();
    });
});

describe('parseReviewsPage', () => {
    it('reads reviews and developer replies', () => {
        const { reviews, hasNext } = parseReviewsPage(page('reviews-judgeme-1-star.html'), 'judgeme', 'Judge.me', 'T');
        expect(hasNext).toBe(true);
        expect(reviews).toHaveLength(10);
        expect(new Set(reviews.map((review) => review.reviewId)).size).toBe(10);
        expect(reviews.every((review) => review.rating === 1)).toBe(true);

        const replied = reviews.find((review) => review.reviewId === '2368666')!;
        expect(replied).toMatchObject({
            type: 'review',
            appHandle: 'judgeme',
            appName: 'Judge.me',
            reviewUrl: 'https://apps.shopify.com/reviews/2368666',
            date: '2026-09-21',
            edited: false,
            storeName: 'Wildaro',
            storeCountry: 'United States',
            usageDuration: '8 months using the app',
            developerReplyDate: '2026-10-02',
        });
        expect(replied.text).toMatch(/^if I could put 0 stars/);
        expect(replied.text).not.toMatch(/We're very sorry/);
        expect(replied.developerReply).toMatch(/^We're very sorry/);
        expect(replied.developerReply).toContain('\n\n');

        // A rating without text
        const empty = reviews.find((review) => review.reviewId === '2427624')!;
        expect(empty.text).toBeNull();
        expect(empty.developerReply).toBeNull();
    });

    it('marks edited reviews', () => {
        const { reviews } = parseReviewsPage(page('reviews-loox-edited.html'), 'loox', null);
        const edited = reviews.find((review) => review.reviewId === '2240945')!;
        expect(edited).toMatchObject({ edited: true, date: '2026-06-12' });
        expect(reviews.filter((review) => review.edited)).toHaveLength(1);
    });

    it('sees the end past the last page', () => {
        expect(parseReviewsPage(page('reviews-past-end.html'), 'judgeme', null)).toEqual({
            reviews: [],
            hasNext: false,
        });
    });
});

describe('parseCategoryPage', () => {
    it('reads a listing page and its next page', () => {
        const listing = parseCategoryPage(
            page('category-product-reviews.html'),
            PRODUCT_REVIEWS,
            `https://apps.shopify.com/categories/${PRODUCT_REVIEWS}/all`,
        );
        expect(listing.isListing).toBe(true);
        expect(listing.handles).toHaveLength(24);
        expect(listing.handles[0]).toBe('judgeme');
        expect(listing.hasNext).toBe(true);
    });

    it('stops on the last page', () => {
        const last = parseCategoryPage(
            page('category-last-page.html'),
            PRODUCT_REVIEWS,
            `https://apps.shopify.com/categories/${PRODUCT_REVIEWS}/all?page=21`,
        );
        expect(last.handles).toHaveLength(20);
        expect(last.hasNext).toBe(false);
    });
});

describe('run state', () => {
    const emptyState = (): CrawlState => ({ apps: {}, sources: {}, appsQueued: 0, appsSaved: 0, reviewsSaved: 0 });

    it('dedupes apps and respects maxApps', () => {
        const state = emptyState();
        expect(reserveApps(state, ['a', 'b', 'a'], 'x', 0)).toEqual(['a', 'b']);
        expect(reserveApps(state, ['b', 'c', 'd', 'e'], 'y', 3)).toEqual(['c']);
        expect(state.appsQueued).toBe(3);
        expect(state.apps.c.input).toBe('y');
    });

    it('counts expected reviews for a rating filter', () => {
        const app = parseAppPage(page('app-judgeme.html'), 'judgeme') as AppItem;
        expect(expectedReviews(app, [1, 2])).toBe(196);
        expect(expectedReviews({ ...app, ratingDistribution: null }, [1])).toBe(50422);
    });
});
