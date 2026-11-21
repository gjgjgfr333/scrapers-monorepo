import { Actor, type KeyValueStore, log } from 'apify';

export const HISTORY_STORE_NAME = 'google-flights-history';

interface HistoryRecord {
    updatedAt: string;
    prices: Record<string, number>;
}

/**
 * Prices of earlier runs, kept in the named key-value store `google-flights-history` (named stores are not
 * deleted with the run). One record per route and search options; records are loaded on first use and
 * written back by `persist()`.
 */
export class PriceHistory {
    private store: Promise<KeyValueStore> | null = null;
    private readonly records = new Map<string, Promise<HistoryRecord>>();
    private readonly dirty = new Set<string>();

    constructor(private readonly enabled: boolean) {}

    get isEnabled() {
        return this.enabled;
    }

    private async openStore() {
        this.store ??= Actor.openKeyValueStore(HISTORY_STORE_NAME);
        return this.store;
    }

    private async record(key: string) {
        let record = this.records.get(key);
        if (!record) {
            record = this.openStore()
                .then(async (store) => store.getValue<HistoryRecord>(key))
                .then((value) => ({ updatedAt: value?.updatedAt ?? '', prices: { ...(value?.prices ?? {}) } }));
            this.records.set(key, record);
        }
        return record;
    }

    /** Previous price of an item, undefined when it was not seen before or history is off */
    async get(recordKey: string, itemKey: string): Promise<number | undefined> {
        if (!this.enabled) return undefined;
        const record = await this.record(recordKey);
        return record.prices[itemKey];
    }

    async set(recordKey: string, itemKey: string, price: number | null) {
        if (!this.enabled || price === null) return;
        const record = await this.record(recordKey);
        record.prices[itemKey] = price;
        record.updatedAt = new Date().toISOString();
        this.dirty.add(recordKey);
    }

    async persist() {
        if (!this.enabled || this.dirty.size === 0) return;
        const store = await this.openStore();
        const keys = [...this.dirty];
        this.dirty.clear();
        for (const key of keys) {
            const record = await this.records.get(key);
            if (record) await store.setValue(key, record);
        }
        log.info('Saved price history', { store: HISTORY_STORE_NAME, records: keys.length });
    }
}
