export interface Input {
    apps?: string[];
    categories?: string[];
    allApps?: boolean;
    maxApps?: number;
    includeReviews?: boolean;
    maxReviewsPerApp?: number;
    reviewsSince?: string;
    minRating?: number;
    maxRating?: number;
    proxyConfiguration?: { useApifyProxy?: boolean; apifyProxyGroups?: string[]; proxyUrls?: string[] };
}

export interface ReviewOptions {
    includeReviews: boolean;
    /** 0 means no limit */
    maxReviewsPerApp: number;
    /** Only reviews on or after this day (UTC midnight), or null */
    reviewsSince: Date | null;
    /** Star ratings to ask for; all five means no filter */
    ratings: number[];
}

export interface ScrapeOptions extends ReviewOptions {
    /** 0 means no limit */
    maxApps: number;
}

export interface PricingPlan {
    name: string | null;
    /** Price in `currency`, 0 for a free plan, null when the page shows no number */
    price: number | null;
    currency: string | null;
    /** Price converted to USD with the rate the page states, when the page shows another currency */
    priceUsd: number | null;
    /** month, year, one-time, or null for a free plan */
    period: string | null;
    priceText: string | null;
    yearlyPriceText: string | null;
    additionalCharges: string | null;
    trialDays: number | null;
    features: string[];
}

export interface AppItem {
    type: 'app';
    handle: string;
    url: string;
    name: string | null;
    subtitle: string | null;
    introduction: string | null;
    headline: string | null;
    description: string | null;
    highlights: string[];
    iconUrl: string | null;
    developer: string | null;
    developerUrl: string | null;
    rating: number | null;
    reviewCount: number;
    ratingDistribution: Record<'1' | '2' | '3' | '4' | '5', number> | null;
    pricingSummary: string | null;
    plans: PricingPlan[];
    categories: string[];
    languages: string[];
    worksWith: string[];
    launchedAt: string | null;
    builtForShopify: boolean;
    scrapedAt: string;
}

export interface ReviewItem {
    type: 'review';
    appHandle: string;
    appName: string | null;
    reviewId: string;
    reviewUrl: string;
    rating: number | null;
    /** YYYY-MM-DD, the day the review was posted or last edited */
    date: string | null;
    edited: boolean;
    text: string | null;
    storeName: string | null;
    storeCountry: string | null;
    usageDuration: string | null;
    developerReply: string | null;
    developerReplyDate: string | null;
    scrapedAt: string;
}

export interface AppUserData {
    handle: string;
    input: string;
}

export interface ReviewsUserData {
    handle: string;
    appName: string | null;
    page: number;
}

export interface CategoryUserData {
    slug: string;
    input: string;
    page: number;
}

export type AppStatus = 'pending' | 'ok' | 'not_found' | 'error';

export interface AppSummary {
    handle: string;
    input: string;
    status: AppStatus;
    reviewCount: number | null;
    reviewsSaved: number;
    error: string | null;
}

export interface SourceSummary {
    input: string;
    status: 'pending' | 'ok' | 'not_found' | 'error';
    appsFound: number;
    error: string | null;
}

export interface CrawlState {
    apps: Record<string, AppSummary>;
    sources: Record<string, SourceSummary>;
    /** Apps queued so far, for `maxApps` */
    appsQueued: number;
    appsSaved: number;
    reviewsSaved: number;
}
