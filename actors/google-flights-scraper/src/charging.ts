import type { CheerioCrawler } from '@crawlee/cheerio';
import { Actor, log } from 'apify';

import type { CalendarDayItem, FlightItem } from './types.js';

// Pay-per-event names, they have to match the events configured for the Actor in Apify Console
export const CHARGE_EVENTS = {
    FLIGHT: 'flight',
    CALENDAR_DAY: 'calendar-day',
} as const;

type Crawler = Pick<CheerioCrawler, 'autoscaledPool'>;

let budgetReached = false;

export const isBudgetReached = () => budgetReached;

const affordable = (eventName: string) => Actor.getChargingManager().calculateMaxEventChargeCountWithinLimit(eventName);

// Handlers run concurrently: without a queue two of them read the same remaining budget and both spend it
let queue: Promise<unknown> = Promise.resolve();

/**
 * Pushes as many items as the remaining budget pays for, one event each (`flight` or `calendar-day`),
 * and stops the crawler when the maximum cost of the run is reached. Returns the items actually saved.
 */
export const pushItems = async <T extends FlightItem | CalendarDayItem>(items: T[], crawler: Crawler): Promise<T[]> => {
    const run = queue.then(async () => {
        if (items.length === 0) return [];
        const eventName = items[0].type === 'flight' ? CHARGE_EVENTS.FLIGHT : CHARGE_EVENTS.CALENDAR_DAY;
        const count = budgetReached ? 0 : Math.min(items.length, affordable(eventName));
        const saved = items.slice(0, count);
        if (saved.length > 0) await Actor.pushData(saved, eventName);
        if (saved.length < items.length) {
            if (!budgetReached) {
                budgetReached = true;
                log.warning('The maximum cost of the run was reached, stopping the crawler');
            }
            await crawler.autoscaledPool?.abort();
        }
        return saved;
    });
    queue = run.catch(() => undefined);
    return run;
};
