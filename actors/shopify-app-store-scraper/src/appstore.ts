import type { CheerioCrawlingContext } from '@crawlee/cheerio';

import type { AppItem, PricingPlan, ReviewItem } from './types.js';
import { appUrl, BASE_URL, cleanText, oneLine, parseCategoryInput, parseEnglishDate, parseNumber } from './utils.js';

// Types of the `$` Crawlee passes to handlers (cheerio's own ESM typings do not match Crawlee's CJS ones)
type CheerioAPI = CheerioCrawlingContext['$'];
type Node = ReturnType<CheerioAPI>;
type Element = Node[number];

/** Text of a block with paragraphs and line breaks kept as newlines */
const blockText = ($: CheerioAPI, node: Node): string | null => {
    if (node.length === 0) return null;
    const copy = node.first().clone();
    copy.find('br').replaceWith('\n');
    copy.find('p, li').each((_, element) => {
        $(element).append('\n\n');
    });
    return cleanText(copy.text());
};

/** The element that follows a label such as `<p>Languages</p>` inside `scope` */
const afterLabel = ($: CheerioAPI, scope: Node, label: string): Node => {
    const labelNode = scope
        .find('p, dt, h2, h3, span')
        .filter((_, element) => oneLine($(element).text()) === label)
        .first();
    return labelNode.next();
};

const findSoftwareApplication = ($: CheerioAPI): Record<string, unknown> | null => {
    for (const element of $('script[type="application/ld+json"]').toArray()) {
        try {
            const data: unknown = JSON.parse($(element).text());
            const nodes = Array.isArray(data) ? data : [data];
            for (const node of nodes) {
                if (
                    node &&
                    typeof node === 'object' &&
                    (node as Record<string, unknown>)['@type'] === 'SoftwareApplication'
                ) {
                    return node as Record<string, unknown>;
                }
            }
        } catch {
            // Broken JSON-LD, the HTML fallbacks below still work
        }
    }
    return null;
};

const asString = (value: unknown): string | null => (typeof value === 'string' ? cleanText(value) : null);

/** "Prices in EUR are estimates … (1 EUR = 1.0994 USD)" → 1.0994 */
export const parseUsdRate = (text: string | null | undefined): number | null => {
    const match = text?.match(/1\s+[A-Z]{3}\s*=\s*([\d.,]+)\s*USD/);
    return match ? parseNumber(match[1]) : null;
};

/** "€13.64 EUR/month", "Free", "$9.99/year", "$100 one-time charge" → price and period */
export const parsePriceText = (text: string | null): { price: number | null; period: string | null } => {
    if (!text) return { price: null, period: null };
    if (/^free\b/i.test(text.trim())) return { price: 0, period: null };
    const price = parseNumber(text.replace(/^[^\d]*/, ''));
    let period: string | null = null;
    if (/\/\s*month|per month|monthly/i.test(text)) period = 'month';
    else if (/\/\s*year|per year|annually|yearly/i.test(text)) period = 'year';
    else if (/one[- ]time/i.test(text)) period = 'one-time';
    return { price, period };
};

const roundCents = (value: number) => Math.round(value * 100) / 100;

export const parsePlans = ($: CheerioAPI): PricingPlan[] => {
    const section = $('#adp-pricing');
    const usdRate = parseUsdRate(oneLine(section.find('[data-testid="exchange-rate-disclaimer"]').text()));
    const plans: PricingPlan[] = [];

    section.find('[data-pricing-component-target="cardHeading"]').each((_, element) => {
        const heading = $(element);
        const card = heading.parent();
        const priceText = oneLine(heading.find('h3').attr('aria-label') ?? heading.find('h3').text());
        const { price, period } = parsePriceText(priceText);
        const currency =
            oneLine(heading.find('[data-test-id="price-currency"]').text()) ?? (price === 0 ? null : 'USD');
        let priceUsd: number | null = null;
        if (price != null) {
            if (price === 0 || currency === 'USD') priceUsd = price;
            else if (usdRate) priceUsd = roundCents(price * usdRate);
        }
        const trialText = card
            .parent()
            .children('p')
            .toArray()
            .map((node) => oneLine($(node).text()))
            .find((text) => text && /free trial/i.test(text));
        const trialDays = trialText ? parseNumber(trialText.match(/(\d+)[- ]day/i)?.[1]) : null;

        plans.push({
            name: oneLine(heading.find('[data-test-id="name"]').text()),
            price,
            currency,
            priceUsd,
            period,
            priceText,
            yearlyPriceText: oneLine(heading.find('[data-test-id="yearly-price"]').text()),
            additionalCharges: oneLine(heading.find('[data-test-id="additional-charges"]').text()),
            trialDays,
            features: card
                .find('[data-test-id="features"] li')
                .toArray()
                .map((node) => oneLine($(node).text()))
                .filter((text): text is string => Boolean(text)),
        });
    });
    return plans;
};

const parseRatingDistribution = ($: CheerioAPI): AppItem['ratingDistribution'] => {
    const distribution: Record<string, number> = {};
    $('#adp-reviews a[href*="ratings"]').each((_, element) => {
        const link = $(element);
        const rating = decodeURIComponent(link.attr('href') ?? '').match(/ratings\[\]=([1-5])/)?.[1];
        const count = parseNumber(link.attr('aria-label'));
        if (rating && count != null && distribution[rating] === undefined) distribution[rating] = count;
    });
    if (Object.keys(distribution).length === 0) return null;
    const result = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const key of Object.keys(result) as (keyof typeof result)[]) result[key] = distribution[key] ?? 0;
    return result;
};

/** "English, Spanish, and Romanian" → ["English", "Spanish", "Romanian"] */
export const splitList = (text: string | null): string[] =>
    (text ?? '')
        .split(/,\s*|\s+and\s+/)
        .map((part) => part.replace(/^and\s+/, '').trim())
        .filter(Boolean);

/** Parses an app page. Returns null when the page is not an app (no hero section) */
export const parseAppPage = ($: CheerioAPI, handle: string, scrapedAt = new Date().toISOString()): AppItem | null => {
    const hero = $('#adp-hero');
    if (hero.length === 0) return null;
    const ld = findSoftwareApplication($);
    const aggregate = (ld?.aggregateRating ?? null) as Record<string, unknown> | null;

    const name = asString(ld?.name) ?? oneLine(hero.find('h1').first().text());
    const title = oneLine($('title').first().text())?.replace(/\s*\|\s*Shopify App Store\s*$/, '') ?? null;
    const subtitle = name && title?.startsWith(`${name} - `) ? oneLine(title.slice(name.length + 3)) : null;

    const developerLink = afterLabel($, hero, 'Developer').find('a').first();
    const developerHref = developerLink.attr('href');
    const image = Array.isArray(ld?.image) ? ld.image[0] : ld?.image;

    const details = $('#adp-details-section');
    const appDetails = details.find('#app-details');
    const description =
        blockText($, appDetails.find('[data-truncate-content-copy]')) ?? blockText($, appDetails.children('p'));

    const categoriesBlock = afterLabel($, details, 'Categories');
    const categories = categoriesBlock
        .find('a[href*="/categories/"]')
        .filter((_, element) => $(element).closest('ul').length === 0)
        .toArray()
        .map((element) => oneLine($(element).text()))
        .filter((text): text is string => Boolean(text));

    const rating =
        typeof aggregate?.ratingValue === 'number'
            ? aggregate.ratingValue
            : parseNumber(afterLabel($, hero, 'Rating').find('span').first().text());
    const reviewCount =
        typeof aggregate?.ratingCount === 'number'
            ? aggregate.ratingCount
            : (parseNumber(hero.find('#reviews-link').attr('aria-label')) ?? 0);

    return {
        type: 'app',
        handle,
        url: appUrl(handle),
        name,
        subtitle,
        introduction: asString(ld?.description),
        headline: oneLine(appDetails.find('h2').first().text()),
        description,
        highlights: appDetails
            .children('ul')
            .find('li')
            .toArray()
            .map((element) => oneLine($(element).text()))
            .filter((text): text is string => Boolean(text)),
        iconUrl: typeof image === 'string' ? image : null,
        developer: oneLine(developerLink.text()) ?? asString(ld?.brand),
        developerUrl: developerHref ? new URL(developerHref, BASE_URL).href : null,
        rating: reviewCount > 0 ? rating : null,
        reviewCount,
        ratingDistribution: parseRatingDistribution($),
        pricingSummary: oneLine(afterLabel($, hero, 'Pricing').children('div').first().text()),
        plans: parsePlans($),
        categories: [...new Set(categories)],
        languages: splitList(oneLine(afterLabel($, details, 'Languages').text())),
        worksWith: afterLabel($, details, 'Works with')
            .find('li')
            .toArray()
            .map((element) => oneLine($(element).text()))
            .filter((text): text is string => Boolean(text)),
        launchedAt: parseEnglishDate(oneLine(afterLabel($, $('#adp-developer'), 'Launched').text())),
        builtForShopify: hero.find('[data-element="built-for-shopify-badge"]').length > 0,
        scrapedAt,
    };
};

export interface ReviewsPage {
    reviews: ReviewItem[];
    hasNext: boolean;
}

export const parseReviewsPage = (
    $: CheerioAPI,
    handle: string,
    appName: string | null,
    scrapedAt = new Date().toISOString(),
): ReviewsPage => {
    const reviews: ReviewItem[] = [];

    $('[data-merchant-review]').each((_, element) => {
        const block = $(element);
        const reviewId = block.attr('data-review-content-id');
        if (!reviewId) return;
        const outsideReply = (_index: number, node: Element) =>
            $(node).closest('[data-merchant-review-reply]').length === 0;

        const stars = block.find('[aria-label$="out of 5 stars"]').first();
        const dateText = oneLine(stars.next().text());
        const store = block.find('span[title]').filter(outsideReply).first();
        let storeCountry: string | null = null;
        let usageDuration: string | null = null;
        for (const node of store.parent().nextAll('div').toArray()) {
            const text = oneLine($(node).text());
            if (!text) continue;
            if (/using the app/i.test(text)) usageDuration = text;
            else storeCountry ??= text;
        }

        const reply = block.find('[data-merchant-review-reply]');
        const replyText = blockText($, reply.find('[data-truncate-content-copy]'));
        const replyHeader = oneLine(reply.find('[id^="review-reply-"] div').first().text());

        reviews.push({
            type: 'review',
            appHandle: handle,
            appName,
            reviewId,
            reviewUrl: `${BASE_URL}/reviews/${reviewId}`,
            rating: parseNumber(stars.attr('aria-label')),
            date: parseEnglishDate(dateText),
            edited: /^edited\b/i.test(dateText ?? ''),
            text: blockText($, block.find('[data-truncate-content-copy]').filter(outsideReply)),
            storeName: oneLine(store.attr('title') ?? store.text()),
            storeCountry,
            usageDuration,
            developerReply: replyText,
            developerReplyDate: replyText ? parseEnglishDate(replyHeader) : null,
            scrapedAt,
        });
    });

    return { reviews, hasNext: reviews.length > 0 && $('a[rel="next"]').length > 0 };
};

export interface CategoryPage {
    /** True for a paged listing (a leaf category), false for a parent category that lists subcategories */
    isListing: boolean;
    handles: string[];
    hasNext: boolean;
    subcategories: string[];
}

export const parseCategoryPage = ($: CheerioAPI, slug: string, loadedUrl: string): CategoryPage => {
    const isListing = /\/categories\/[^/]+\/all\b/.test(new URL(loadedUrl).pathname);
    const handles = [
        ...new Set(
            $('[data-app-card-handle-value]')
                .toArray()
                .map((element) => $(element).attr('data-app-card-handle-value') ?? '')
                .filter(Boolean),
        ),
    ];
    const subcategories = [
        ...new Set(
            $('a[href*="/categories/"]')
                .toArray()
                .map((element) => parseCategoryInput(new URL($(element).attr('href') ?? '', BASE_URL).href))
                .filter((child): child is string => Boolean(child) && child !== slug && child!.startsWith(`${slug}-`)),
        ),
    ];
    return {
        isListing,
        handles,
        hasNext: isListing && $('a[rel="next"]').length > 0,
        subcategories,
    };
};
