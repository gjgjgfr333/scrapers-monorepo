import type { ProxyConfigurationOptions } from 'apify';

export const ATS_NAMES = [
    'greenhouse',
    'lever',
    'ashby',
    'workable',
    'recruitee',
    'smartrecruiters',
    'workday',
] as const;
export type AtsName = (typeof ATS_NAMES)[number];

export interface Input {
    companies: string[];
    includeDescription?: boolean;
    keywords?: string[];
    locations?: string[];
    remoteOnly?: boolean;
    onlyNewSinceDays?: number;
    maxJobsPerCompany?: number;
    maxItems?: number;
    proxyConfiguration?: ProxyConfigurationOptions & { useApifyProxy?: boolean };
}

export interface JobFilters {
    keywords: string[];
    locations: string[];
    remoteOnly: boolean;
    onlyNewSinceDays: number;
}

export interface ScrapeOptions {
    includeDescription: boolean;
    filters: JobFilters;
    /** 0 means no limit */
    maxJobsPerCompany: number;
    maxItems: number;
}

/** One company board resolved from the input */
export interface CompanyRef {
    ats: AtsName;
    /** Board identifier in the ATS: slug, account, company id or Workday tenant */
    slug: string;
    /** Unique key of the board, used for deduplication and in the run summary */
    key: string;
    /** Value as the user entered it */
    input: string;
    /** Lever and Greenhouse EU data centre */
    eu?: boolean;
    /** Workday host, e.g. nvidia.wd5.myworkdayjobs.com */
    host?: string;
    /** Workday career site id, e.g. NVIDIAExternalCareerSite */
    site?: string;
}

export interface JobItem {
    ats: AtsName;
    company: string;
    companySlug: string;
    jobId: string;
    title: string;
    url: string;
    applyUrl: string | null;
    location: string | null;
    locations: string[];
    country: string | null;
    remote: boolean | null;
    workplaceType: 'onsite' | 'hybrid' | 'remote' | null;
    employmentType: string | null;
    department: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    salaryPeriod: string | null;
    postedAt: string | null;
    descriptionHtml: string | null;
    descriptionText: string | null;
    scrapedAt: string;
}

/** Pagination position of a list request */
export interface ListCursor {
    offset?: number;
    token?: string;
    /** Workday reports the total only on the first page */
    total?: number;
}

export interface HttpRequestSpec {
    url: string;
    method: 'GET' | 'POST';
    payload?: string;
    headers?: Record<string, string>;
    uniqueKey: string;
}

export interface ListPage {
    jobs: JobItem[];
    /** Jobs on this page reported by the source, before filters */
    listedCount: number;
    next: ListCursor | null;
    /** Total number of jobs the source reports, when it does */
    total: number | null;
}

export interface ListUserData {
    company: CompanyRef;
    cursor: ListCursor;
}

export interface DetailUserData {
    company: CompanyRef;
    item: JobItem;
    /** Path of the job in the Workday API */
    detailPath?: string;
}

export type CompanyStatus = 'pending' | 'ok' | 'empty' | 'not_found' | 'error';

export interface CompanySummary {
    input: string;
    ats: AtsName;
    slug: string;
    status: CompanyStatus;
    jobsListed: number;
    jobsMatched: number;
    jobsSaved: number;
    error: string | null;
}

export interface CrawlState {
    companies: Record<string, CompanySummary>;
    /** Jobs accepted for saving (pushed or waiting for details) */
    reserved: number;
    saved: number;
}
