import type { CheerioCrawler } from '@crawlee/cheerio';
import { Actor, log } from 'apify';

import type { HotelItem, HotelSummaryItem, ReviewItem } from './types.js';

// Pay-per-event names, they have to match the events configured for the Actor in Apify Console
export const CHARGE_EVENTS = {
    HOTEL: 'hotel',
    REVIEW: 'review',
} as const;

type Crawler = Pick<CheerioCrawler, 'autoscaledPool'>;

let budgetReached = false;

export const isBudgetReached = () => budgetReached;

const stopCrawler = async (crawler: Crawler) => {
    if (!budgetReached) {
        budgetReached = true;
        log.warning('The maximum cost of the run was reached, stopping the crawler');
    }
    await crawler.autoscaledPool?.abort();
};

const affordable = (eventName: string) => Actor.getChargingManager().calculateMaxEventChargeCountWithinLimit(eventName);

// Handlers run concurrently: without a queue two of them read the same remaining budget and both spend it
let queue: Promise<unknown> = Promise.resolve();

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
};

/** Pushes one hotel and charges the `hotel` event. Returns false when the budget does not allow it. */
export const pushHotel = async (item: HotelItem, crawler: Crawler): Promise<boolean> =>
    serialized(async () => {
        if (budgetReached || affordable(CHARGE_EVENTS.HOTEL) < 1) {
            await stopCrawler(crawler);
            return false;
        }
        await Actor.pushData(item, CHARGE_EVENTS.HOTEL);
        return true;
    });

/**
 * Pushes as many reviews as the remaining budget pays for, one `review` event each.
 * Returns the reviews that were actually saved.
 */
export const pushReviews = async (items: ReviewItem[], crawler: Crawler): Promise<ReviewItem[]> =>
    serialized(async () => {
        if (items.length === 0) return [];
        const count = budgetReached ? 0 : Math.min(items.length, affordable(CHARGE_EVENTS.REVIEW));
        const saved = items.slice(0, count);
        if (saved.length > 0) await Actor.pushData(saved, CHARGE_EVENTS.REVIEW);
        if (saved.length < items.length) await stopCrawler(crawler);
        return saved;
    });

/** The per-hotel summary is free */
export const pushSummary = async (item: HotelSummaryItem) => {
    await Actor.pushData(item);
};
