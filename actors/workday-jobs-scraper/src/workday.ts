/**
 * Workday career site API (CXS): request builders, page parsing, the facet split that gets past
 * the 2000-job search cap, and job details. Pure, covered by tests on fixtures.
 */
import type { AppliedFacets, Facet, FacetValue, JobItem, ListedJob, SiteRef, SplitPlan } from './types.js';
import {
    cleanString,
    daysAgoToIso,
    htmlToText,
    normalizeTimeType,
    toCountryCode,
    toIsoDate,
    uniqueStrings,
    workdayDaysAgo,
    workplaceTypeOf,
} from './utils.js';

/** Workday answers 400 to `limit` above 20 */
export const PAGE_SIZE = 20;
/** A search returns at most 2000 jobs; offsets past that start over from the first page */
export const SEARCH_CAP = 2000;
/**
 * Facets in which every job has exactly one value, when the site has them. Their sum of counts is
 * the real number of jobs, which the capped `total` hides.
 */
const SINGLE_VALUE_FACETS = ['jobFamilyGroup', 'timeType', 'workerSubType'];

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const asArray = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

export const apiBase = (site: SiteRef) => `https://${site.host}/wday/cxs/${site.tenant}/${site.site}`;

export const buildListRequest = (site: SiteRef, facets: AppliedFacets, offset: number) => {
    const url = `${apiBase(site)}/jobs`;
    return {
        url,
        method: 'POST' as const,
        payload: JSON.stringify({ appliedFacets: facets, limit: PAGE_SIZE, offset, searchText: site.searchText }),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        uniqueKey: `${url}#${JSON.stringify(facets)}#q=${site.searchText}#offset=${offset}`,
    };
};

export const buildDetailRequest = (site: SiteRef, externalPath: string) => {
    const url = `${apiBase(site)}${externalPath}`;
    return { url, method: 'GET' as const, headers: { Accept: 'application/json' }, uniqueKey: url };
};

/** Flattens Workday facets; groups such as `locationMainGroup` nest the real facets one level down */
export const flattenFacets = (raw: unknown): Facet[] => {
    const result: Facet[] = [];
    const visit = (facet: Json) => {
        const values = asArray(facet.values);
        const param = cleanString(facet.facetParameter);
        if (!param) return;
        if (values.some((value) => typeof value.count === 'number')) {
            result.push({
                param,
                descriptor: cleanString(facet.descriptor),
                values: values
                    .filter((value) => typeof value.count === 'number' && cleanString(value.id))
                    .map((value): FacetValue => ({
                        id: String(value.id),
                        descriptor: cleanString(value.descriptor),
                        count: value.count as number,
                    })),
            });
        }
        for (const nested of values) if (nested.facetParameter) visit(nested);
    };
    for (const facet of asArray(raw)) visit(facet);
    return result;
};

export interface ListPage {
    total: number;
    jobs: ListedJob[];
    facets: Facet[];
}

/** Reads a search answer; null when it has an unexpected shape */
export const parseListPage = (json: unknown): ListPage | null => {
    const body = asObject(json);
    if (!Array.isArray(body.jobPostings)) return null;
    const jobs = asArray(body.jobPostings)
        .map((posting): ListedJob | null => {
            const externalPath = cleanString(posting.externalPath);
            if (!externalPath) return null;
            const bullet = Array.isArray(posting.bulletFields) ? cleanString(posting.bulletFields[0]) : null;
            return {
                title: cleanString(posting.title) ?? '',
                externalPath,
                locationsText: cleanString(posting.locationsText),
                postedOn: cleanString(posting.postedOn),
                remoteType: cleanString(posting.remoteType),
                reqId: bullet,
            };
        })
        .filter((job): job is ListedJob => job !== null);
    return {
        total: typeof body.total === 'number' ? body.total : 0,
        jobs,
        facets: flattenFacets(body.facets),
    };
};

const sumOf = (facet: Facet) => facet.values.reduce((sum, value) => sum + value.count, 0);
const maxOf = (facet: Facet) => facet.values.reduce((max, value) => Math.max(max, value.count), 0);

/**
 * Number of jobs a search really has. Workday reports at most 2000; the counts of a facet in which
 * every job has one value add up to the real number.
 */
export const estimateTotal = (total: number, facets: Facet[]): number => {
    // Under the cap the reported total is exact
    if (total < SEARCH_CAP) return total;
    const sums = facets.filter((facet) => SINGLE_VALUE_FACETS.includes(facet.param)).map(sumOf);
    return Math.max(total, ...sums);
};

/**
 * Packs facet values into groups of fewer than 2000 jobs (first fit, biggest first). Values of one facet
 * are combined with OR, so a group is searched in one go. A value with 2000 or more jobs stays alone and
 * is split again by another facet.
 */
export const packValues = (values: FacetValue[], cap = SEARCH_CAP): string[][] => {
    const bins: { ids: string[]; count: number }[] = [];
    for (const value of [...values].filter((v) => v.count > 0).sort((a, b) => b.count - a.count)) {
        const bin = value.count < cap ? bins.find((candidate) => candidate.count + value.count < cap) : undefined;
        if (bin) {
            bin.ids.push(value.id);
            bin.count += value.count;
        } else {
            bins.push({ ids: [value.id], count: value.count });
        }
    }
    return bins.map((bin) => bin.ids);
};

/**
 * Chooses how to split a search that hit the cap. Only facets whose counts cover every job qualify
 * (some jobs may have no value in a facet). Among them, a facet with every value under the cap and the
 * smallest sum (least overlap, fewest requests) wins; otherwise the one with the smallest biggest value.
 * Null when no facet is left to split by.
 */
export const planSplit = (total: number, facets: Facet[], applied: Record<string, string[]>): SplitPlan | null => {
    const estimate = estimateTotal(total, facets);
    const candidates = facets.filter(
        // A facet with one value holding every job would not make the search smaller
        (facet) => !(facet.param in applied) && sumOf(facet) >= estimate && maxOf(facet) < estimate,
    );
    if (candidates.length === 0) return null;

    const underCap = candidates.filter((facet) => maxOf(facet) < SEARCH_CAP);
    const best =
        underCap.length > 0
            ? underCap.sort((a, b) => sumOf(a) - sumOf(b) || a.values.length - b.values.length)[0]
            : candidates.sort((a, b) => maxOf(a) - maxOf(b))[0];

    return { param: best.param, groups: packValues(best.values) };
};

/** Job of a list page as a dataset item, before details */
export const mapListedJob = (site: SiteRef, job: ListedJob, now = Date.now()): JobItem => {
    const days = workdayDaysAgo(job.postedOn);
    const location = job.locationsText;
    return {
        company: site.tenant,
        legalEntity: null,
        tenant: site.tenant,
        site: site.site,
        jobId: job.reqId ?? job.externalPath.split('_').pop() ?? job.externalPath,
        title: job.title,
        url: `https://${site.host}/${site.site}${job.externalPath}`,
        applyUrl: null,
        location,
        additionalLocations: [],
        country: null,
        countryCode: null,
        remoteType: job.remoteType,
        workplaceType: workplaceTypeOf(job.remoteType, [location]),
        timeType: null,
        postedAt: daysAgoToIso(days, now),
        postedAtApproximate: days !== null,
        postedOn: job.postedOn,
        applyDeadline: null,
        descriptionHtml: null,
        descriptionText: null,
        scrapedAt: new Date(now).toISOString(),
    };
};

/** Completes a job with its detail answer */
export const applyDetail = (item: JobItem, json: unknown): JobItem => {
    const body = asObject(json);
    const info = asObject(body.jobPostingInfo);
    if (!cleanString(info.title) && !cleanString(info.jobDescription)) return item;

    const requisitionCountry = asObject(asObject(info.jobRequisitionLocation).country);
    const location = cleanString(info.location) ?? item.location;
    const additionalLocations = uniqueStrings(asArray(info.additionalLocations) as unknown[]).filter(
        (place) => place !== location,
    );
    const remoteType = cleanString(info.remoteType) ?? item.remoteType;
    const url = cleanString(info.externalUrl) ?? item.url;
    const html = cleanString(info.jobDescription);
    const postedAt = toIsoDate(info.startDate);

    return {
        ...item,
        legalEntity: cleanString(asObject(body.hiringOrganization).name),
        jobId: cleanString(info.jobReqId) ?? item.jobId,
        title: cleanString(info.title) ?? item.title,
        url,
        applyUrl: info.canApply === false ? null : `${url}/apply`,
        location,
        additionalLocations,
        country: cleanString(asObject(info.country).descriptor) ?? cleanString(requisitionCountry.descriptor),
        countryCode: toCountryCode(requisitionCountry.alpha2Code),
        remoteType,
        workplaceType: workplaceTypeOf(remoteType, [location, ...additionalLocations]),
        timeType: normalizeTimeType(info.timeType),
        postedAt: postedAt ?? item.postedAt,
        postedAtApproximate: postedAt ? false : item.postedAtApproximate,
        postedOn: cleanString(info.postedOn) ?? item.postedOn,
        applyDeadline: toIsoDate(info.endDate),
        descriptionHtml: html,
        descriptionText: htmlToText(html),
    };
};
