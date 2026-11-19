import type { CheerioCrawler } from '@crawlee/cheerio';
import { Actor, log } from 'apify';

import type { CrawlState, JobItem } from './types.js';

// Pay-per-event names, they have to match the events configured for the Actor in Apify Console
export const CHARGE_EVENTS = {
    JOB: 'job',
} as const;

let stopMessagePrinted = false;
/** Charges started by parallel handlers that the charging manager does not count yet */
let chargesInFlight = 0;

const stop = async (crawler: Pick<CheerioCrawler, 'autoscaledPool'>, message: string) => {
    if (!stopMessagePrinted) {
        stopMessagePrinted = true;
        log.info(message);
    }
    await crawler.autoscaledPool?.abort();
};

/**
 * Pushes jobs to the dataset and charges one `job` event per saved job. Stops the crawler once
 * `maxItems` jobs are saved or the maximum cost of the run set by the user is reached.
 */
export const pushJobs = async (
    items: JobItem[],
    siteKey: string,
    crawler: Pick<CheerioCrawler, 'autoscaledPool' | 'useState'>,
    maxItems: number,
) => {
    const chargingManager = Actor.getChargingManager();
    const state = await crawler.useState<CrawlState>();

    for (const item of items) {
        if (state.saved >= maxItems) {
            await stop(crawler, `Saved ${maxItems} jobs, the limit set in the input, stopping`);
            return;
        }
        if (chargingManager.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENTS.JOB) - chargesInFlight < 1) {
            await stop(crawler, 'The maximum cost of the run was reached, stopping the crawler');
            return;
        }

        // Count before awaiting, so parallel handlers cannot overshoot maxItems or the cost limit
        state.saved += 1;
        const summary = state.sites[siteKey];
        if (summary) summary.jobsSaved += 1;
        chargesInFlight += 1;
        try {
            await Actor.pushData(item, CHARGE_EVENTS.JOB);
        } finally {
            chargesInFlight -= 1;
        }
    }
};
