import type { CheerioCrawler } from '@crawlee/cheerio';
import { Actor, log } from 'apify';

import type { AppItem, ReviewItem } from './types.js';

// Pay-per-event names, they have to match the events configured for the Actor in Apify Console
export const CHARGE_EVENTS = {
    APP: 'app',
    REVIEW: 'review',
} as const;

type ChargeEvent = (typeof CHARGE_EVENTS)[keyof typeof CHARGE_EVENTS];

let stopMessagePrinted = false;
/** Cost in USD of charges started by parallel handlers that the charging manager does not count yet */
let inFlightUsd = 0;
let costLimitReached = false;

export const isCostLimitReached = () => costLimitReached;

const stop = async (crawler: Pick<CheerioCrawler, 'autoscaledPool'>, message: string) => {
    if (!stopMessagePrinted) {
        stopMessagePrinted = true;
        log.info(message);
    }
    await crawler.autoscaledPool?.abort();
};

/**
 * Pushes one item to the dataset and charges its event (`app` or `review`). Returns false, and stops the
 * crawler, when the maximum cost of the run set by the user does not allow one more event.
 */
export const pushItem = async (
    item: AppItem | ReviewItem,
    crawler: Pick<CheerioCrawler, 'autoscaledPool'>,
): Promise<boolean> => {
    const event: ChargeEvent = item.type === 'app' ? CHARGE_EVENTS.APP : CHARGE_EVENTS.REVIEW;
    const chargingManager = Actor.getChargingManager();
    // Locally an event has no price before its first charge; the SDK then charges $1, so assume that
    const price = chargingManager.getPricingInfo().perEventPrices[event] ?? 1;
    // Both events share one budget, so reserve what is in flight in dollars and convert it to this event
    const reservedEvents = price > 0 ? Math.ceil(inFlightUsd / price - 1e-9) : 0;

    if (costLimitReached || chargingManager.calculateMaxEventChargeCountWithinLimit(event) - reservedEvents < 1) {
        costLimitReached = true;
        await stop(crawler, 'The maximum cost of the run was reached, stopping the crawler');
        return false;
    }

    // Count before awaiting, so parallel handlers cannot overshoot the cost limit
    inFlightUsd += price;
    try {
        await Actor.pushData(item, event);
    } finally {
        inFlightUsd -= price;
    }
    return true;
};
