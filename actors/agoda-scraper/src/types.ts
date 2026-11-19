import type { ProxyConfigurationOptions } from 'apify';

export type ReviewSort = 'newest' | 'highest' | 'lowest' | 'helpful';

/** Review sources Agoda shows on a hotel page; anything else is reported as `other` */
export type ReviewProvider = 'agoda' | 'booking' | 'other';

export interface Input {
    startUrls?: string[];
    hotelIds?: string[];
    includeReviews?: boolean;
    maxReviewsPerHotel?: number;
    reviewsSince?: string;
    providers?: ReviewProvider[];
    sort?: ReviewSort;
    includeReviewerName?: boolean;
    proxyConfiguration?: ProxyConfigurationOptions & { useApifyProxy?: boolean };
}

export interface ScrapeOptions {
    includeReviews: boolean;
    /** 0 means no limit */
    maxReviewsPerHotel: number;
    /** YYYY-MM-DD or null */
    reviewsSince: string | null;
    providers: ReviewProvider[];
    sort: ReviewSort;
    includeReviewerName: boolean;
}

// Subset of the GetSecondaryData response that the Actor reads
export interface RawSecondaryData {
    hotelId?: number | null;
    hotelInfo?: {
        name?: string | null;
        englishName?: string | null;
        accommodationType?: string | null;
        starRating?: { value?: number | null } | null;
        address?: {
            full?: string | null;
            address?: string | null;
            areaName?: string | null;
            cityName?: string | null;
            countryName?: string | null;
            postalCode?: string | null;
        } | null;
    } | null;
    reviews?: {
        score?: string | number | null;
        scoreText?: string | null;
        reviewsCount?: number | null;
        recommendationScore?: number | null;
        demographic?: {
            grades?: RawGrade[] | null;
            scoreDistribution?: { id?: string | null; count?: number | null }[] | null;
        } | null;
    } | null;
    aboutHotel?: { hotelDesc?: { overview?: string | null } | null } | null;
    mapParams?: { latlng?: (number | null)[] | null } | null;
    featuresYouLove?: { features?: { text?: string | null }[] | null } | null;
    mosaicInitData?: { images?: { location?: string | null }[] | null } | null;
    searchbox?: { config?: { defaultSearchURL?: string | null } | null } | null;
}

export interface RawGrade {
    id?: string | null;
    name?: string | null;
    score?: number | null;
    cityAverage?: number | null;
}

export interface RawReview {
    hotelReviewId: number;
    providerId?: number | null;
    reviewProviderText?: string | null;
    rating?: number | null;
    ratingText?: string | null;
    reviewTitle?: string | null;
    reviewComments?: string | null;
    reviewPositives?: string | null;
    reviewNegatives?: string | null;
    translateSource?: string | null;
    reviewDate?: string | null;
    checkInDate?: string | null;
    checkOutDate?: string | null;
    checkInDateMonthAndYear?: string | null;
    helpfulVotes?: number | null;
    ugcImages?: { url?: string | null }[] | null;
    reviewerInfo?: {
        countryName?: string | null;
        displayMemberName?: string | null;
        reviewGroupName?: string | null;
        roomTypeName?: string | null;
        lengthOfStay?: number | null;
    } | null;
}

export interface RawReviewPage {
    comments?: RawReview[] | null;
    providerList?: { id?: number | null; totalIndex?: number | null }[] | null;
}

export interface CategoryScore {
    id: string | null;
    name: string | null;
    score: number | null;
    cityAverage: number | null;
}

export interface HotelItem {
    type: 'hotel';
    hotelId: number;
    hotelUrl: string | null;
    hotelName: string;
    englishName: string | null;
    accommodationType: string | null;
    starRating: number | null;
    address: string | null;
    street: string | null;
    area: string | null;
    city: string | null;
    country: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
    reviewScore: number | null;
    reviewScoreText: string | null;
    reviewsCount: number | null;
    recommendationScore: number | null;
    categoryScores: CategoryScore[];
    scoreDistribution: Record<string, number>;
    description: string | null;
    highlights: string[];
    images: string[];
    scrapedAt: string;
}

export interface ReviewItem {
    type: 'review';
    hotelId: number;
    hotelName: string;
    hotelUrl: string | null;
    reviewId: number;
    provider: ReviewProvider;
    rating: number | null;
    ratingText: string | null;
    title: string | null;
    text: string | null;
    positives: string | null;
    negatives: string | null;
    language: string | null;
    reviewDate: string | null;
    checkInDate: string | null;
    checkOutDate: string | null;
    stayMonth: string | null;
    travelerType: string | null;
    roomType: string | null;
    lengthOfStay: number | null;
    reviewerCountry: string | null;
    helpfulVotes: number;
    images: string[];
    reviewerName?: string | null;
    scrapedAt: string;
}

export interface HotelSummaryItem {
    type: 'hotelSummary';
    hotelId: number;
    hotelName: string;
    hotelUrl: string | null;
    reviewsAvailable: Record<string, number>;
    reviewsCollected: number;
    reviewsByProvider: Record<string, number>;
    averageRatingCollected: number | null;
    ratingDistribution: Record<string, number>;
    travelerTypes: Record<string, number>;
    scrapedAt: string;
}

export type DatasetItem = HotelItem | ReviewItem | HotelSummaryItem;

/** Hotel fields every review carries */
export interface HotelRef {
    hotelId: number;
    hotelName: string;
    hotelUrl: string | null;
}

export interface PageUserData {
    inputUrl: string;
}

export interface DetailsUserData {
    hotelId: number;
    inputUrl: string | null;
}

export interface ReviewsUserData {
    hotel: HotelRef;
    page: number;
}

/** Per-hotel review progress, kept in crawler state so it survives migrations */
export interface HotelReviewState {
    seen: number[];
    collected: number;
    noNewPages: number;
    /** Ids at the top of page 1, to notice when Agoda keeps answering with page 1 */
    firstPageKey: string | null;
    available: Record<string, number>;
    ratingSum: number;
    ratingCount: number;
    byProvider: Record<string, number>;
    ratingDistribution: Record<string, number>;
    travelerTypes: Record<string, number>;
    done: boolean;
}

export interface CrawlState {
    hotels: Record<string, HotelReviewState>;
    hotelsPushed: number;
    reviewsPushed: number;
    hotelsNotFound: string[];
    /** Hotels whose review paging Agoda stopped serving (it answered every page with page 1) */
    hotelsThrottled: number[];
}
