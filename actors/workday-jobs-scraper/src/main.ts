// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { CheerioCrawler } from '@crawlee/cheerio';
// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor, log } from 'apify';

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// note that we need to use `.js` even when inside TS files
import { pushJobs } from './charging.js';
import { createRouter, listRequest } from './routes.js';
import type { CrawlState, DetailUserData, Input, ListUserData, SiteRef, SiteSummary } from './types.js';
import { isRecent, LABELS, parseSiteUrl } from './utils.js';

const SUMMARY_KEY = 'RUN_SUMMARY';

await Actor.init();

// Structure of input is defined in input_schema.json
const {
    startUrls = [],
    searchText = '',
    includeDescription = true,
    postedWithinDays = 0,
    splitBeyond2000 = true,
    maxJobsPerSite = 0,
    maxItems = 1000,
    proxyConfiguration: proxyInput,
} = (await Actor.getInput<Input>()) ?? ({} as Input);

const options = {
    includeDescription,
    postedWithinDays: Math.max(0, postedWithinDays),
    splitBeyond2000,
    maxJobsPerSite: Math.max(0, maxJobsPerSite),
    maxItems,
};

const sites = new Map<string, SiteRef>();
const unsupported: string[] = [];
for (const value of startUrls) {
    // The requestListSources editor gives objects with a url, a plain list gives strings
    const raw = typeof value === 'string' ? value : (value as { url?: unknown } | null)?.url;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const site = parseSiteUrl(raw, searchText);
    if (site) sites.set(site.key, site);
    else unsupported.push(raw.trim());
}

if (unsupported.length > 0) {
    log.warning('Some inputs are not Workday career site URLs (*.myworkdayjobs.com) and are skipped', {
        unsupported,
    });
}
if (sites.size === 0) {
    await Actor.fail(
        'No Workday career site URLs in the input. Add URLs such as https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite.',
    );
}

const proxyConfiguration = proxyInput ? await Actor.createProxyConfiguration(proxyInput) : undefined;

const crawler = new CheerioCrawler({
    proxyConfiguration,
    additionalMimeTypes: ['application/json'],
    maxConcurrency: 8,
    // Workday rate-limits bursts with 429; a steady pace avoids most of them
    maxRequestsPerMinute: 300,
    maxRequestRetries: 5,
    // 429 goes to the handler, which waits before retrying; Crawlee would retry it at once
    sessionPoolOptions: { blockedStatusCodes: [401, 403] },
    requestHandlerTimeoutSecs: 120,
    requestHandler: createRouter(options),
    failedRequestHandler: async ({ request, crawler: failedCrawler }, error) => {
        const state = await failedCrawler.useState<CrawlState>();

        if (request.label === LABELS.LIST) {
            const { site } = request.userData as ListUserData;
            const summary = state.sites[site.key];
            if (summary.jobsFound === 0) summary.status = 'error';
            summary.error = `Could not load a search page: ${error.message}`;
            log.warning(summary.error, { input: site.input });
            return;
        }

        // Keep the job even when its description could not be loaded
        const { site, item } = request.userData as DetailUserData;
        log.warning('Could not load job details, saving the job without them', { url: item.url });
        if (isRecent(item.postedAt, options.postedWithinDays)) {
            await pushJobs([item], site.key, failedCrawler, maxItems);
        }
    },
});

const state = await crawler.useState<CrawlState>({ sites: {}, seen: {}, reserved: 0, saved: 0 });
for (const site of sites.values()) {
    state.sites[site.key] ??= {
        input: site.input,
        tenant: site.tenant,
        site: site.site,
        status: 'pending',
        estimatedTotal: null,
        jobsFound: 0,
        jobsMatched: 0,
        jobsSaved: 0,
        cappedSearches: 0,
        error: null,
    } satisfies SiteSummary;
}

const saveSummary = async () => {
    await Actor.setValue(SUMMARY_KEY, {
        jobsSaved: state.saved,
        sites: Object.values(state.sites),
        unsupportedInputs: unsupported,
    });
};

Actor.on('aborting', async () => {
    log.info('Actor is aborting, saving the run summary and stopping the crawler');
    await saveSummary();
    await crawler.autoscaledPool?.abort();
    await Actor.exit();
});

await crawler.run([...sites.values()].map((site) => listRequest(site, site.appliedFacets, 0, null)));

await saveSummary();

const summaries = Object.values(state.sites);
const failed = summaries.filter((summary) => ['not_found', 'error', 'empty'].includes(summary.status));
for (const summary of failed) log.warning(`${summary.input}: ${summary.error ?? summary.status}`);
for (const summary of summaries.filter((s) => s.status === 'ok')) {
    log.info(`${summary.tenant}/${summary.site}: ${summary.jobsFound} jobs found, ${summary.jobsSaved} saved`, {
        estimatedTotal: summary.estimatedTotal,
    });
}
log.info(`Saved ${state.saved} jobs from ${summaries.length - failed.length} of ${summaries.length} career sites`);

if (state.saved === 0) {
    const reasons = failed.map((summary) => `${summary.input}: ${summary.error ?? summary.status}`);
    await Actor.fail(
        reasons.length > 0
            ? `No jobs saved. ${reasons.join(' | ')}`
            : `No jobs saved: the career sites have jobs, but none was posted within the last ${options.postedWithinDays} days.`,
    );
}

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();
