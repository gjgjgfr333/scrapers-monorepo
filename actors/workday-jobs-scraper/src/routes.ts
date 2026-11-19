import { setTimeout as sleep } from 'node:timers/promises';

import { createCheerioRouter } from '@crawlee/cheerio';

import { pushJobs } from './charging.js';
import type { AppliedFacets, CrawlState, DetailUserData, ListUserData, ScrapeOptions, SiteRef } from './types.js';
import { isRecent, LABELS, withFacet, workdayDaysAgo } from './utils.js';
import {
    applyDetail,
    buildDetailRequest,
    buildListRequest,
    estimateTotal,
    mapListedJob,
    PAGE_SIZE,
    parseListPage,
    planSplit,
    SEARCH_CAP,
} from './workday.js';

export const listRequest = (site: SiteRef, facets: AppliedFacets, offset: number, total: number | null) => ({
    ...buildListRequest(site, facets, offset),
    label: LABELS.LIST,
    userData: { site, facets, offset, total } satisfies ListUserData,
});

const siteName = (site: SiteRef) => `${site.tenant}/${site.site}`;

/**
 * Workday answers 429 when requests come too fast. Crawlee would retry at once, so wait first
 * (2, 4, 8… seconds with jitter) and then throw to retry.
 */
const backOffIfRateLimited = async (status: number, retryCount: number) => {
    if (status !== 429) return;
    await sleep(2000 * 2 ** retryCount + Math.random() * 1000);
    throw new Error('Workday answered HTTP 429 (too many requests)');
};

export const createRouter = (options: ScrapeOptions) => {
    const router = createCheerioRouter();

    router.addHandler<ListUserData>(LABELS.LIST, async ({ request, response, json, crawler, log }) => {
        const { site, facets, offset } = request.userData;
        const state = await crawler.useState<CrawlState>();
        const summary = state.sites[site.key];
        const status = response.statusCode ?? 0;
        await backOffIfRateLimited(status, request.retryCount);
        const isRootSearch = offset === 0 && JSON.stringify(facets) === JSON.stringify(site.appliedFacets);

        if (status === 404 || status === 422) {
            summary.status = 'not_found';
            summary.error = `The Workday career site "${siteName(site)}" does not exist (HTTP ${status}). Open the career page in a browser and copy its URL, e.g. https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite.`;
            log.warning(summary.error, { input: site.input });
            return;
        }
        if (status === 400 && isRootSearch && Object.keys(facets).length > 0) {
            summary.status = 'error';
            summary.error = `Workday rejected the filters in the URL of "${siteName(site)}" (HTTP 400). Remove the query part of the URL or copy it again from the career page.`;
            log.warning(summary.error, { input: site.input });
            return;
        }
        if (status >= 400) throw new Error(`Workday answered HTTP ${status}`);

        const page = parseListPage(json);
        if (!page) throw new Error('Unexpected answer from the Workday API');
        if (summary.status === 'pending' || summary.status === 'error') summary.status = 'ok';

        const total = offset === 0 ? page.total : (request.userData.total ?? 0);

        if (offset === 0) {
            if (isRootSearch) {
                summary.estimatedTotal = estimateTotal(page.total, page.facets);
                if (page.total === 0) {
                    summary.status = 'empty';
                    summary.error = `No open jobs on "${siteName(site)}"${site.searchText ? ` for "${site.searchText}"` : ''}.`;
                    return;
                }
            }

            if (page.total >= SEARCH_CAP) {
                const plan = options.splitBeyond2000 ? planSplit(page.total, page.facets, facets) : null;
                if (plan) {
                    log.info(`${siteName(site)}: search capped at ${SEARCH_CAP}, splitting by ${plan.param}`, {
                        estimatedTotal: estimateTotal(page.total, page.facets),
                        searches: plan.groups.length,
                        facets,
                    });
                    await crawler.addRequests(
                        plan.groups.map((ids) => listRequest(site, withFacet(facets, plan.param, ids), 0, null)),
                    );
                    return;
                }
                summary.cappedSearches += 1;
                log.warning(
                    options.splitBeyond2000
                        ? `${siteName(site)}: a search has ${SEARCH_CAP}+ jobs and no filter left to split it, only the first ${SEARCH_CAP} are reachable`
                        : `${siteName(site)}: only the first ${SEARCH_CAP} jobs are reachable with "Split beyond 2000" turned off`,
                    { facets },
                );
            }
        }

        // The same job can come from several searches (a job in two locations), keep the first one
        const fresh = page.jobs.filter((job) => {
            const key = `${site.key}|${job.externalPath}`;
            if (state.seen[key]) return false;
            state.seen[key] = true;
            return true;
        });
        summary.jobsFound += fresh.length;

        const items = fresh.map((job) => mapListedJob(site, job));
        const matching = items.filter((item) => isRecent(item.postedAt, options.postedWithinDays));
        const siteLeft =
            options.maxJobsPerSite > 0 ? options.maxJobsPerSite - summary.jobsMatched : Number.POSITIVE_INFINITY;
        const globalLeft = options.maxItems - state.reserved;
        const accepted = matching.slice(0, Math.max(0, Math.min(siteLeft, globalLeft)));
        summary.jobsMatched += accepted.length;
        state.reserved += accepted.length;

        if (options.includeDescription) {
            await crawler.addRequests(
                accepted.map((item) => ({
                    ...buildDetailRequest(site, item.url.replace(`https://${site.host}/${site.site}`, '')),
                    label: LABELS.DETAIL,
                    userData: { site, item } satisfies DetailUserData,
                })),
            );
        } else {
            await pushJobs(accepted, site.key, crawler, options.maxItems);
        }

        log.debug(`${siteName(site)}: offset ${offset}, ${page.jobs.length} jobs, ${accepted.length} taken`);

        // Without search text Workday lists newest first: once a whole page is older than the date filter,
        // later pages are too. With search text it sorts by relevance, so every page has to be read.
        const allTooOld =
            options.postedWithinDays > 0 &&
            !site.searchText &&
            page.jobs.length > 0 &&
            page.jobs.every((job) => (workdayDaysAgo(job.postedOn) ?? 0) > options.postedWithinDays);
        const nextOffset = offset + PAGE_SIZE;
        const limitReached = accepted.length < matching.length || state.reserved >= options.maxItems;
        if (page.jobs.length > 0 && nextOffset < Math.min(total, SEARCH_CAP) && !limitReached && !allTooOld) {
            await crawler.addRequests([listRequest(site, facets, nextOffset, total)]);
        }
    });

    router.addHandler<DetailUserData>(LABELS.DETAIL, async ({ request, response, json, crawler, log }) => {
        const { site, item } = request.userData;
        let completed = item;
        await backOffIfRateLimited(response.statusCode ?? 0, request.retryCount);

        if ((response.statusCode ?? 0) >= 400) {
            log.warning('Job details are not available, saving the job without them', {
                url: item.url,
                statusCode: response.statusCode,
            });
        } else {
            completed = applyDetail(item, json);
        }

        if (isRecent(completed.postedAt, options.postedWithinDays)) {
            await pushJobs([completed], site.key, crawler, options.maxItems);
        }
    });

    return router;
};
