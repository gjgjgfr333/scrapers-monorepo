import { createCheerioRouter } from '@crawlee/cheerio';

import {
    applyDetail,
    buildDetailRequest,
    buildListRequest,
    needsDetailRequest,
    parseListPage,
    workdayDetailPath,
} from './ats.js';
import { pushJobs } from './charging.js';
import type {
    CompanyRef,
    CrawlState,
    DetailUserData,
    HttpRequestSpec,
    ListCursor,
    ListUserData,
    ScrapeOptions,
} from './types.js';
import { LABELS, matchesFilters } from './utils.js';

export const listRequest = (company: CompanyRef, cursor: ListCursor, includeDescription: boolean) => {
    const spec: HttpRequestSpec = buildListRequest(company, cursor, includeDescription);
    return {
        ...spec,
        label: LABELS.LIST,
        userData: { company, cursor } satisfies ListUserData,
    };
};

const NOT_FOUND_HINTS: Partial<Record<CompanyRef['ats'], string>> = {
    smartrecruiters: 'SmartRecruiters company identifiers are case-sensitive, e.g. "BoschGroup".',
    workday:
        'Check the career site name in the URL, e.g. https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite.',
};

const boardName = (company: CompanyRef) => (company.site ? `${company.slug}/${company.site}` : company.slug);

export const createRouter = (options: ScrapeOptions) => {
    const router = createCheerioRouter();

    router.addHandler<ListUserData>(LABELS.LIST, async ({ request, response, json, crawler, log }) => {
        const { company, cursor } = request.userData;
        const state = await crawler.useState<CrawlState>();
        const summary = state.companies[company.key];
        const isFirstPage = !cursor.offset && !cursor.token;

        if (response.statusCode === 404) {
            summary.status = 'not_found';
            summary.error =
                `The ${company.ats} board "${boardName(company)}" does not exist (HTTP 404). ${NOT_FOUND_HINTS[company.ats] ?? ''}`.trim();
            log.warning(summary.error, { input: company.input });
            return;
        }
        if ((response.statusCode ?? 0) >= 400) {
            throw new Error(`The ${company.ats} API answered HTTP ${response.statusCode}`);
        }

        const page = parseListPage(company, json, cursor, options.includeDescription);
        if (!page) throw new Error(`Unexpected answer from the ${company.ats} API`);

        summary.jobsListed += page.listedCount;
        if (summary.status === 'pending' || summary.status === 'error') summary.status = 'ok';

        if (isFirstPage && company.ats === 'workday' && (page.total ?? 0) >= 2000) {
            log.warning('Workday search returns at most 2000 jobs per career site, the rest cannot be reached', {
                input: company.input,
            });
        }

        // Cheap filters first, so jobs that cannot match never cost a detail request
        const matching = page.jobs.filter((job) => matchesFilters(job, options.filters, true));
        const perCompanyLeft =
            options.maxJobsPerCompany > 0 ? options.maxJobsPerCompany - summary.jobsMatched : Number.POSITIVE_INFINITY;
        const globalLeft = options.maxItems - state.reserved;
        const accepted = matching.slice(0, Math.max(0, Math.min(perCompanyLeft, globalLeft)));
        summary.jobsMatched += accepted.length;
        state.reserved += accepted.length;

        if (needsDetailRequest(company, options.includeDescription)) {
            await crawler.addRequests(
                accepted.map((item) => {
                    const detailPath = company.ats === 'workday' ? workdayDetailPath(item, company) : undefined;
                    return {
                        ...buildDetailRequest(company, item, detailPath),
                        label: LABELS.DETAIL,
                        userData: { company, item, detailPath } satisfies DetailUserData,
                    };
                }),
            );
        } else {
            await pushJobs(
                accepted.filter((job) => matchesFilters(job, options.filters)),
                company.key,
                crawler,
                options.maxItems,
            );
        }

        log.info(
            `${company.ats} ${boardName(company)}: ${page.listedCount} jobs on the page, ${accepted.length} taken`,
            {
                total: page.total,
                offset: cursor.offset,
            },
        );

        const limitReached = accepted.length < matching.length;
        if (page.next && !limitReached && state.reserved < options.maxItems) {
            await crawler.addRequests([listRequest(company, page.next, options.includeDescription)]);
        } else if (summary.jobsListed === 0) {
            summary.status = 'empty';
            summary.error =
                `No open jobs on the ${company.ats} board "${boardName(company)}". ${NOT_FOUND_HINTS[company.ats] ?? ''}`.trim();
        }
    });

    router.addHandler<DetailUserData>(LABELS.DETAIL, async ({ request, response, json, crawler, log }) => {
        const { company, item } = request.userData;
        let completed = item;

        if ((response.statusCode ?? 0) >= 400) {
            log.warning('Job details are not available, saving the job without them', {
                url: item.url,
                statusCode: response.statusCode,
            });
        } else {
            completed = applyDetail(company, item, json);
        }

        if (matchesFilters(completed, options.filters)) {
            await pushJobs([completed], company.key, crawler, options.maxItems);
        }
    });

    return router;
};
