/**
 * Per-ATS knowledge: how to request a list page, how to read it, which jobs need a detail request
 * and how the detail answer completes a job. Everything here is pure and covered by tests on fixtures.
 */
import type { CompanyRef, HttpRequestSpec, JobItem, ListCursor, ListPage } from './types.js';
import {
    cleanString,
    daysAgoToIso,
    decodeEntities,
    htmlToText,
    inferRemote,
    normalizeEmploymentType,
    normalizeSalaryPeriod,
    normalizeWorkplaceType,
    toCountryCode,
    toIsoDate,
    toNumber,
    uniqueStrings,
    workdayDaysAgo,
} from './utils.js';

/** Lever answers up to this many postings per request */
export const LEVER_PAGE_SIZE = 100;
/** SmartRecruiters caps `limit` at 100 */
export const SMARTRECRUITERS_PAGE_SIZE = 100;
/** Workday answers 400 to `limit` above 20 */
export const WORKDAY_PAGE_SIZE = 20;
/** Workday search returns at most 2000 jobs; offsets past that start over from the first page */
export const WORKDAY_MAX_RESULTS = 2000;

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const asArray = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

const emptyItem = (company: CompanyRef, scrapedAt: string): Omit<JobItem, 'jobId' | 'title' | 'url'> => ({
    ats: company.ats,
    company: company.slug,
    companySlug: company.slug,
    applyUrl: null,
    location: null,
    locations: [],
    country: null,
    remote: null,
    workplaceType: null,
    employmentType: null,
    department: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    postedAt: null,
    descriptionHtml: null,
    descriptionText: null,
    scrapedAt,
});

const withDescription = (item: JobItem, html: string | null, includeDescription: boolean): JobItem =>
    includeDescription ? { ...item, descriptionHtml: html, descriptionText: htmlToText(html) } : item;

const workdayApiBase = (company: CompanyRef) => `https://${company.host}/wday/cxs/${company.slug}/${company.site}`;

/** Whether jobs of this ATS need one request per job to get the description */
export const needsDetailRequest = (company: CompanyRef, includeDescription: boolean): boolean =>
    includeDescription && ['workable', 'smartrecruiters', 'workday'].includes(company.ats);

export const buildListRequest = (
    company: CompanyRef,
    cursor: ListCursor,
    includeDescription: boolean,
): HttpRequestSpec => {
    const slug = encodeURIComponent(company.slug);
    const get = (url: string): HttpRequestSpec => ({ url, method: 'GET', uniqueKey: url });

    switch (company.ats) {
        case 'greenhouse':
            return get(
                `https://boards-api${company.eu ? '.eu' : ''}.greenhouse.io/v1/boards/${slug}/jobs?content=${includeDescription}`,
            );
        case 'lever':
            return get(
                `https://api${company.eu ? '.eu' : ''}.lever.co/v0/postings/${slug}?mode=json&skip=${cursor.offset ?? 0}&limit=${LEVER_PAGE_SIZE}`,
            );
        case 'ashby':
            return get(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
        case 'recruitee':
            return get(`https://${slug}.recruitee.com/api/offers/`);
        case 'smartrecruiters':
            return get(
                `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=${SMARTRECRUITERS_PAGE_SIZE}&offset=${cursor.offset ?? 0}`,
            );
        case 'workable': {
            const url = `https://apply.workable.com/api/v3/accounts/${slug}/jobs`;
            return {
                url,
                method: 'POST',
                payload: JSON.stringify(cursor.token ? { token: cursor.token } : {}),
                headers: JSON_HEADERS,
                uniqueKey: `${url}#token=${cursor.token ?? ''}`,
            };
        }
        case 'workday': {
            const url = `${workdayApiBase(company)}/jobs`;
            const offset = cursor.offset ?? 0;
            return {
                url,
                method: 'POST',
                payload: JSON.stringify({ appliedFacets: {}, limit: WORKDAY_PAGE_SIZE, offset, searchText: '' }),
                headers: JSON_HEADERS,
                uniqueKey: `${url}#offset=${offset}`,
            };
        }
        default:
            throw new Error(`Unsupported ATS: ${String(company.ats)}`);
    }
};

export const buildDetailRequest = (company: CompanyRef, item: JobItem, detailPath?: string): HttpRequestSpec => {
    const slug = encodeURIComponent(company.slug);
    let url: string;
    switch (company.ats) {
        case 'workable':
            url = `https://apply.workable.com/api/v2/accounts/${slug}/jobs/${encodeURIComponent(item.jobId)}`;
            break;
        case 'smartrecruiters':
            url = `https://api.smartrecruiters.com/v1/companies/${slug}/postings/${encodeURIComponent(item.jobId)}`;
            break;
        case 'workday':
            url = `${workdayApiBase(company)}${detailPath ?? ''}`;
            break;
        default:
            throw new Error(`${company.ats} does not need detail requests`);
    }
    return { url, method: 'GET', headers: { Accept: 'application/json' }, uniqueKey: url };
};

// ---------- Greenhouse ----------

const mapGreenhouseJob = (company: CompanyRef, job: Json, includeDescription: boolean, scrapedAt: string): JobItem => {
    const metadata = asArray(job.metadata);
    const metaValue = (pattern: RegExp) => {
        const value = metadata.find((entry) => pattern.test(String(entry.name ?? '')))?.value;
        return Array.isArray(value) ? cleanString(value[0]) : cleanString(value);
    };
    const location = cleanString(asObject(job.location).name);
    const content = cleanString(job.content);
    const url =
        cleanString(job.absolute_url) ?? `https://job-boards.greenhouse.io/${company.slug}/jobs/${String(job.id)}`;

    const item: JobItem = {
        ...emptyItem(company, scrapedAt),
        company: cleanString(job.company_name) ?? company.slug,
        jobId: String(job.id),
        title: cleanString(job.title) ?? '',
        url,
        applyUrl: url,
        location,
        locations: uniqueStrings([location, ...asArray(job.offices).map((office) => office.name)]),
        workplaceType: normalizeWorkplaceType(metaValue(/workplace|remote/i)),
        employmentType: normalizeEmploymentType(metaValue(/employment type|job type|time type/i)),
        department: cleanString(asArray(job.departments)[0]?.name),
        postedAt: toIsoDate(job.first_published) ?? toIsoDate(job.updated_at),
    };
    // Greenhouse escapes the HTML of the description
    return withDescription(item, content ? decodeEntities(content) : null, includeDescription);
};

// ---------- Lever ----------

const mapLeverJob = (company: CompanyRef, job: Json, includeDescription: boolean, scrapedAt: string): JobItem => {
    const categories = asObject(job.categories);
    const salary = asObject(job.salaryRange);
    const location = cleanString(categories.location);
    const lists = asArray(job.lists)
        .map((list) => `<h3>${String(list.text ?? '')}</h3><ul>${String(list.content ?? '')}</ul>`)
        .join('');
    const html = [cleanString(job.description), lists || null, cleanString(job.additional)].filter(Boolean).join('');

    const item: JobItem = {
        ...emptyItem(company, scrapedAt),
        jobId: String(job.id),
        title: cleanString(job.text) ?? '',
        url: cleanString(job.hostedUrl) ?? `https://jobs.lever.co/${company.slug}/${String(job.id)}`,
        applyUrl: cleanString(job.applyUrl),
        location,
        locations: uniqueStrings([
            location,
            ...(Array.isArray(categories.allLocations) ? categories.allLocations : []),
        ]),
        country: toCountryCode(job.country),
        workplaceType: normalizeWorkplaceType(job.workplaceType),
        employmentType: normalizeEmploymentType(categories.commitment),
        department: cleanString(categories.department) ?? cleanString(categories.team),
        salaryMin: toNumber(salary.min),
        salaryMax: toNumber(salary.max),
        salaryCurrency: cleanString(salary.currency),
        salaryPeriod: normalizeSalaryPeriod(salary.interval),
        postedAt: toIsoDate(job.createdAt),
    };
    return withDescription(item, html || null, includeDescription);
};

// ---------- Ashby ----------

const mapAshbyJob = (company: CompanyRef, job: Json, includeDescription: boolean, scrapedAt: string): JobItem => {
    const location = cleanString(job.location);
    const compensation = asObject(job.compensation);
    const salary =
        asArray(compensation.summaryComponents).find((component) => component.compensationType === 'Salary') ?? {};
    const address = asObject(asObject(job.address).postalAddress);

    const item: JobItem = {
        ...emptyItem(company, scrapedAt),
        jobId: String(job.id),
        title: cleanString(job.title) ?? '',
        url: cleanString(job.jobUrl) ?? `https://jobs.ashbyhq.com/${company.slug}/${String(job.id)}`,
        applyUrl: cleanString(job.applyUrl),
        location,
        locations: uniqueStrings([location, ...asArray(job.secondaryLocations).map((entry) => entry.location)]),
        country: toCountryCode(address.addressCountry),
        remote: typeof job.isRemote === 'boolean' ? job.isRemote : null,
        workplaceType: normalizeWorkplaceType(job.workplaceType),
        employmentType: normalizeEmploymentType(job.employmentType),
        department: cleanString(job.department) ?? cleanString(job.team),
        salaryMin: toNumber(salary.minValue),
        salaryMax: toNumber(salary.maxValue),
        salaryCurrency: cleanString(salary.currencyCode),
        salaryPeriod: normalizeSalaryPeriod(salary.interval),
        postedAt: toIsoDate(job.publishedAt),
    };
    return withDescription(item, cleanString(job.descriptionHtml), includeDescription);
};

// ---------- Workable ----------

const workableLocation = (location: Json): string | null =>
    uniqueStrings([location.city, location.region, location.country]).join(', ') || null;

const mapWorkableJob = (company: CompanyRef, job: Json, scrapedAt: string): JobItem => {
    const shortcode = String(job.shortcode ?? job.id);
    const location = workableLocation(asObject(job.location));
    const url = `https://apply.workable.com/${company.slug}/j/${shortcode}/`;
    const workplaceType = normalizeWorkplaceType(job.workplace);

    return {
        ...emptyItem(company, scrapedAt),
        jobId: shortcode,
        title: cleanString(job.title) ?? '',
        url,
        applyUrl: `${url}apply/`,
        location,
        locations: uniqueStrings([location, ...asArray(job.locations).map(workableLocation)]),
        country: toCountryCode(asObject(job.location).countryCode),
        remote: typeof job.remote === 'boolean' ? job.remote : null,
        workplaceType: workplaceType ?? (job.remote === true ? 'remote' : null),
        employmentType: normalizeEmploymentType(job.type),
        department: Array.isArray(job.department) ? cleanString(job.department[0]) : cleanString(job.department),
        postedAt: toIsoDate(job.published),
    };
};

// ---------- Recruitee ----------

const mapRecruiteeOffer = (
    company: CompanyRef,
    offer: Json,
    includeDescription: boolean,
    scrapedAt: string,
): JobItem => {
    const salary = asObject(offer.salary);
    const location = cleanString(offer.location);
    let workplaceType: JobItem['workplaceType'] = null;
    if (offer.remote === true) workplaceType = 'remote';
    else if (offer.hybrid === true) workplaceType = 'hybrid';
    else if (offer.on_site === true) workplaceType = 'onsite';
    const html = [cleanString(offer.description), cleanString(offer.requirements)].filter(Boolean).join('');

    const item: JobItem = {
        ...emptyItem(company, scrapedAt),
        company: cleanString(offer.company_name) ?? company.slug,
        jobId: String(offer.id),
        title: cleanString(offer.title) ?? '',
        url: cleanString(offer.careers_url) ?? `https://${company.slug}.recruitee.com/o/${String(offer.slug)}`,
        applyUrl: cleanString(offer.careers_apply_url),
        location,
        locations: uniqueStrings([
            location,
            ...asArray(offer.locations).map((entry) => uniqueStrings([entry.city, entry.country]).join(', ')),
        ]),
        country: toCountryCode(offer.country_code),
        remote: typeof offer.remote === 'boolean' ? offer.remote : null,
        workplaceType,
        employmentType: normalizeEmploymentType(offer.employment_type_code),
        department: cleanString(offer.department),
        salaryMin: toNumber(salary.min),
        salaryMax: toNumber(salary.max),
        salaryCurrency: cleanString(salary.currency),
        salaryPeriod: normalizeSalaryPeriod(salary.period),
        postedAt: toIsoDate(offer.published_at) ?? toIsoDate(offer.created_at),
    };
    return withDescription(item, html || null, includeDescription);
};

// ---------- SmartRecruiters ----------

const smartRecruitersLocation = (location: Json): string | null => {
    const full = cleanString(location.fullLocation);
    if (full) return uniqueStrings(full.split(',')).join(', ') || null;
    return uniqueStrings([location.city, location.region, location.country]).join(', ') || null;
};

const mapSmartRecruitersPosting = (company: CompanyRef, posting: Json, scrapedAt: string): JobItem => {
    const location = asObject(posting.location);
    const locationText = smartRecruitersLocation(location);
    let workplaceType: JobItem['workplaceType'] = null;
    if (location.remote === true) workplaceType = 'remote';
    else if (location.hybrid === true) workplaceType = 'hybrid';
    else if (location.remote === false) workplaceType = 'onsite';
    const companyName = cleanString(asObject(posting.company).name);

    return {
        ...emptyItem(company, scrapedAt),
        company: companyName ?? company.slug,
        jobId: String(posting.id),
        title: cleanString(posting.name) ?? '',
        url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company.slug)}/${String(posting.id)}`,
        location: locationText,
        locations: uniqueStrings([locationText]),
        country: toCountryCode(location.country),
        remote: typeof location.remote === 'boolean' ? location.remote : null,
        workplaceType,
        employmentType: normalizeEmploymentType(asObject(posting.typeOfEmployment).label),
        department: cleanString(asObject(posting.department).label) ?? cleanString(asObject(posting.function).label),
        postedAt: toIsoDate(posting.releasedDate),
    };
};

// ---------- Workday ----------

const mapWorkdayPosting = (company: CompanyRef, posting: Json, scrapedAt: string, now: number): JobItem => {
    const path = cleanString(posting.externalPath) ?? '';
    const bullet = Array.isArray(posting.bulletFields) ? cleanString(posting.bulletFields[0]) : null;
    const location = cleanString(posting.locationsText);
    return {
        ...emptyItem(company, scrapedAt),
        jobId: bullet ?? path.split('_').pop() ?? path,
        title: cleanString(posting.title) ?? '',
        url: `https://${company.host}/${company.site}${path}`,
        location,
        locations: uniqueStrings([location]),
        // Approximate until the detail request brings the exact date
        postedAt: daysAgoToIso(workdayDaysAgo(posting.postedOn), now),
    };
};

/** Path of the job in the Workday API, carried to the detail request */
export const workdayDetailPath = (item: JobItem, company: CompanyRef): string =>
    item.url.replace(`https://${company.host}/${company.site}`, '');

/**
 * Reads one list answer of any ATS. Returns null when the answer has an unexpected shape,
 * which the caller reports as a source error.
 */
export const parseListPage = (
    company: CompanyRef,
    json: unknown,
    cursor: ListCursor,
    includeDescription: boolean,
    now = Date.now(),
): ListPage | null => {
    const scrapedAt = new Date(now).toISOString();
    const body = asObject(json);

    switch (company.ats) {
        case 'greenhouse': {
            if (!Array.isArray(body.jobs)) return null;
            const jobs = asArray(body.jobs).map((job) => mapGreenhouseJob(company, job, includeDescription, scrapedAt));
            return { jobs: jobs.map(inferRemote), listedCount: jobs.length, next: null, total: jobs.length };
        }
        case 'lever': {
            if (!Array.isArray(json)) return null;
            const jobs = asArray(json).map((job) => mapLeverJob(company, job, includeDescription, scrapedAt));
            const offset = cursor.offset ?? 0;
            return {
                jobs: jobs.map(inferRemote),
                listedCount: jobs.length,
                next: jobs.length === LEVER_PAGE_SIZE ? { offset: offset + LEVER_PAGE_SIZE } : null,
                total: null,
            };
        }
        case 'ashby': {
            if (!Array.isArray(body.jobs)) return null;
            const jobs = asArray(body.jobs)
                .filter((job) => job.isListed !== false)
                .map((job) => mapAshbyJob(company, job, includeDescription, scrapedAt));
            return { jobs: jobs.map(inferRemote), listedCount: jobs.length, next: null, total: jobs.length };
        }
        case 'recruitee': {
            if (!Array.isArray(body.offers)) return null;
            const jobs = asArray(body.offers)
                .filter((offer) => offer.status === undefined || offer.status === 'published')
                .map((offer) => mapRecruiteeOffer(company, offer, includeDescription, scrapedAt));
            return { jobs: jobs.map(inferRemote), listedCount: jobs.length, next: null, total: jobs.length };
        }
        case 'workable': {
            if (!Array.isArray(body.results)) return null;
            const jobs = asArray(body.results).map((job) => mapWorkableJob(company, job, scrapedAt));
            const token = cleanString(body.nextPage);
            return {
                jobs: jobs.map(inferRemote),
                listedCount: jobs.length,
                next: token && jobs.length > 0 ? { token } : null,
                total: toNumber(body.total),
            };
        }
        case 'smartrecruiters': {
            if (!Array.isArray(body.content)) return null;
            const jobs = asArray(body.content).map((posting) => mapSmartRecruitersPosting(company, posting, scrapedAt));
            const total = toNumber(body.totalFound) ?? 0;
            const nextOffset = (cursor.offset ?? 0) + SMARTRECRUITERS_PAGE_SIZE;
            return {
                jobs: jobs.map(inferRemote),
                listedCount: jobs.length,
                next: jobs.length > 0 && nextOffset < total ? { offset: nextOffset } : null,
                total,
            };
        }
        case 'workday': {
            if (!Array.isArray(body.jobPostings)) return null;
            const jobs = asArray(body.jobPostings).map((posting) =>
                mapWorkdayPosting(company, posting, scrapedAt, now),
            );
            // The total comes only with the first page, later pages say 0
            const total = cursor.total ?? toNumber(body.total) ?? 0;
            const reachable = Math.min(total, WORKDAY_MAX_RESULTS);
            const nextOffset = (cursor.offset ?? 0) + WORKDAY_PAGE_SIZE;
            return {
                jobs: jobs.map(inferRemote),
                listedCount: jobs.length,
                next: jobs.length > 0 && nextOffset < reachable ? { offset: nextOffset, total } : null,
                total,
            };
        }
        default:
            return null;
    }
};

/** Completes a job with its detail answer (description, exact date, apply link) */
export const applyDetail = (company: CompanyRef, item: JobItem, json: unknown): JobItem => {
    const body = asObject(json);

    switch (company.ats) {
        case 'workable': {
            const html = [cleanString(body.description), cleanString(body.requirements), cleanString(body.benefits)]
                .filter(Boolean)
                .join('');
            return withDescription(item, html || null, true);
        }
        case 'smartrecruiters': {
            const sections = asObject(asObject(body.jobAd).sections);
            const html = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
                .map((key) => asObject(sections[key]))
                .filter((section) => cleanString(section.text))
                .map((section) => `<h3>${String(section.title ?? '')}</h3>${String(section.text)}`)
                .join('');
            return withDescription(
                {
                    ...item,
                    url: cleanString(body.postingUrl) ?? item.url,
                    applyUrl: cleanString(body.applyUrl) ?? item.applyUrl,
                },
                html || null,
                true,
            );
        }
        case 'workday': {
            const info = asObject(body.jobPostingInfo);
            const requisitionCountry = asObject(asObject(info.jobRequisitionLocation).country);
            const location = cleanString(info.location) ?? item.location;
            const additional = Array.isArray(info.additionalLocations) ? info.additionalLocations : [];
            const url = cleanString(info.externalUrl) ?? item.url;
            return inferRemote(
                withDescription(
                    {
                        ...item,
                        url,
                        applyUrl: info.canApply === false ? null : `${url}/apply`,
                        location,
                        locations: uniqueStrings([location, ...additional]),
                        country: toCountryCode(requisitionCountry.alpha2Code),
                        workplaceType: normalizeWorkplaceType(info.remoteType) ?? item.workplaceType,
                        employmentType: normalizeEmploymentType(info.timeType),
                        postedAt: toIsoDate(info.startDate) ?? item.postedAt,
                    },
                    cleanString(info.jobDescription),
                    true,
                ),
            );
        }
        default:
            return item;
    }
};
