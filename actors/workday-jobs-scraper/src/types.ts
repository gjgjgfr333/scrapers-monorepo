import type { ProxyConfigurationOptions } from 'apify';

export interface Input {
    startUrls: string[];
    searchText?: string;
    includeDescription?: boolean;
    postedWithinDays?: number;
    splitBeyond2000?: boolean;
    maxJobsPerSite?: number;
    maxItems?: number;
    proxyConfiguration?: ProxyConfigurationOptions & { useApifyProxy?: boolean };
}

export interface ScrapeOptions {
    includeDescription: boolean;
    postedWithinDays: number;
    splitBeyond2000: boolean;
    /** 0 means no limit */
    maxJobsPerSite: number;
    maxItems: number;
}

/** Workday search filters: facet parameter → selected value ids */
export type AppliedFacets = Record<string, string[]>;

/** One Workday career site resolved from the input */
export interface SiteRef {
    /** e.g. nvidia.wd5.myworkdayjobs.com */
    host: string;
    /** e.g. nvidia */
    tenant: string;
    /** e.g. NVIDIAExternalCareerSite */
    site: string;
    /** Filters taken from the URL query */
    appliedFacets: AppliedFacets;
    searchText: string;
    /** Unique key for deduplication and the run summary */
    key: string;
    input: string;
}

export interface FacetValue {
    id: string;
    descriptor: string | null;
    count: number;
}

export interface Facet {
    param: string;
    descriptor: string | null;
    values: FacetValue[];
}

export interface SplitPlan {
    param: string;
    /** Value ids to search together; every group has fewer than 2000 jobs unless one value alone has more */
    groups: string[][];
}

/** One job of a list page, before details */
export interface ListedJob {
    title: string;
    externalPath: string;
    locationsText: string | null;
    postedOn: string | null;
    remoteType: string | null;
    reqId: string | null;
}

export interface JobItem {
    company: string;
    legalEntity: string | null;
    tenant: string;
    site: string;
    jobId: string;
    title: string;
    url: string;
    applyUrl: string | null;
    location: string | null;
    additionalLocations: string[];
    country: string | null;
    countryCode: string | null;
    remoteType: string | null;
    workplaceType: 'onsite' | 'hybrid' | 'remote' | null;
    timeType: string | null;
    postedAt: string | null;
    postedAtApproximate: boolean;
    postedOn: string | null;
    applyDeadline: string | null;
    descriptionHtml: string | null;
    descriptionText: string | null;
    scrapedAt: string;
}

export interface ListUserData {
    site: SiteRef;
    facets: AppliedFacets;
    offset: number;
    /** Total of this search, known from its first page */
    total: number | null;
}

export interface DetailUserData {
    site: SiteRef;
    item: JobItem;
}

export type SiteStatus = 'pending' | 'ok' | 'empty' | 'not_found' | 'error';

export interface SiteSummary {
    input: string;
    tenant: string;
    site: string;
    status: SiteStatus;
    /** Jobs the site has, estimated from facet counts when the search is capped at 2000 */
    estimatedTotal: number | null;
    /** Unique jobs listed by the searches */
    jobsFound: number;
    /** Jobs taken after the date filter and limits */
    jobsMatched: number;
    jobsSaved: number;
    /** Searches that hit the 2000 cap and could not be split further */
    cappedSearches: number;
    error: string | null;
}

export interface CrawlState {
    sites: Record<string, SiteSummary>;
    /** `${site.key}|${externalPath}` of every job already taken */
    seen: Record<string, true>;
    reserved: number;
    saved: number;
}
