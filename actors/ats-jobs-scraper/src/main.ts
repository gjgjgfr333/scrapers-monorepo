// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { CheerioCrawler } from '@crawlee/cheerio';
// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor, log } from 'apify';

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// note that we need to use `.js` even when inside TS files
import { pushJobs } from './charging.js';
import { createRouter, listRequest } from './routes.js';
import type { CompanyRef, CompanySummary, CrawlState, DetailUserData, Input, ListUserData } from './types.js';
import { LABELS, matchesFilters, parseCompanyInput } from './utils.js';

const SUMMARY_KEY = 'RUN_SUMMARY';

await Actor.init();

// Structure of input is defined in input_schema.json
const {
    companies = [],
    includeDescription = true,
    keywords = [],
    locations = [],
    remoteOnly = false,
    onlyNewSinceDays = 0,
    maxJobsPerCompany = 0,
    maxItems = 1000,
    proxyConfiguration: proxyInput,
} = (await Actor.getInput<Input>()) ?? ({} as Input);

const filters = {
    keywords: keywords.map((keyword) => keyword.trim()).filter(Boolean),
    locations: locations.map((place) => place.trim()).filter(Boolean),
    remoteOnly,
    onlyNewSinceDays: Math.max(0, onlyNewSinceDays),
};
const options = { includeDescription, filters, maxJobsPerCompany: Math.max(0, maxJobsPerCompany), maxItems };

const boards = new Map<string, CompanyRef>();
const unsupported: string[] = [];
for (const value of companies) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const company = parseCompanyInput(value);
    if (company) boards.set(company.key, company);
    else unsupported.push(value.trim());
}

if (unsupported.length > 0) {
    log.warning(
        'Some inputs are not career pages of a supported ATS (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters, Workday) and are skipped',
        { unsupported },
    );
}
if (boards.size === 0) {
    await Actor.fail(
        'No supported career pages in the input. Add URLs such as https://boards.greenhouse.io/airbnb, https://jobs.lever.co/palantir or https://jobs.ashbyhq.com/ramp.',
    );
}

const proxyConfiguration = proxyInput ? await Actor.createProxyConfiguration(proxyInput) : undefined;

const crawler = new CheerioCrawler({
    proxyConfiguration,
    // The ATS APIs answer JSON; Ashby and Workable answer a missing board with a text/plain 404
    additionalMimeTypes: ['application/json', 'text/plain'],
    maxConcurrency: 10,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 120,
    requestHandler: createRouter(options),
    failedRequestHandler: async ({ request, crawler: failedCrawler }, error) => {
        const state = await failedCrawler.useState<CrawlState>();

        if (request.label === LABELS.LIST) {
            const { company } = request.userData as ListUserData;
            const summary = state.companies[company.key];
            if (summary.jobsListed === 0) summary.status = 'error';
            summary.error = `Could not load the ${company.ats} board: ${error.message}`;
            log.warning(summary.error, { input: company.input });
            return;
        }

        // Keep the job even when its description could not be loaded
        const { company, item } = request.userData as DetailUserData;
        log.warning('Could not load job details, saving the job without them', { url: item.url });
        if (matchesFilters(item, filters)) await pushJobs([item], company.key, failedCrawler, maxItems);
    },
});

const state = await crawler.useState<CrawlState>({ companies: {}, reserved: 0, saved: 0 });
for (const company of boards.values()) {
    state.companies[company.key] ??= {
        input: company.input,
        ats: company.ats,
        slug: company.slug,
        status: 'pending',
        jobsListed: 0,
        jobsMatched: 0,
        jobsSaved: 0,
        error: null,
    } satisfies CompanySummary;
}

const saveSummary = async () => {
    await Actor.setValue(SUMMARY_KEY, {
        jobsSaved: state.saved,
        companies: Object.values(state.companies),
        unsupportedInputs: unsupported,
    });
};

Actor.on('aborting', async () => {
    log.info('Actor is aborting, saving the run summary and stopping the crawler');
    await saveSummary();
    await crawler.autoscaledPool?.abort();
    await Actor.exit();
});

await crawler.run([...boards.values()].map((company) => listRequest(company, {}, includeDescription)));

await saveSummary();

const summaries = Object.values(state.companies);
const failed = summaries.filter((summary) => ['not_found', 'error', 'empty'].includes(summary.status));
for (const summary of failed) log.warning(`${summary.input}: ${summary.error ?? summary.status}`);
log.info(`Saved ${state.saved} jobs from ${summaries.length - failed.length} of ${summaries.length} boards`);

if (state.saved === 0) {
    const reasons = failed.map((summary) => `${summary.input}: ${summary.error ?? summary.status}`);
    const filtersUsed =
        filters.keywords.length > 0 ||
        filters.locations.length > 0 ||
        filters.remoteOnly ||
        filters.onlyNewSinceDays > 0;
    await Actor.fail(
        reasons.length > 0
            ? `No jobs saved. ${reasons.join(' | ')}`
            : `No jobs saved: the boards have jobs, but none matched the filters${filtersUsed ? ' (keywords, locations, remote only, posted within)' : ''}.`,
    );
}

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();
