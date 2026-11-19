import type { AppliedFacets, JobItem, SiteRef } from './types.js';

export const LABELS = {
    LIST: 'LIST',
    DETAIL: 'DETAIL',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    bull: '•',
    middot: '·',
    copy: '©',
    reg: '®',
    trade: '™',
    euro: '€',
    pound: '£',
};

/** Decodes HTML entities: named ones from a small table plus every numeric one */
export const decodeEntities = (value: string): string =>
    value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
        if (entity[0] === '#') {
            const code =
                entity[1] === 'x' || entity[1] === 'X'
                    ? Number.parseInt(entity.slice(2), 16)
                    : Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    });

/** Plain text of an HTML fragment: block elements become line breaks, list items get a dash */
export const htmlToText = (html: string | null | undefined): string | null => {
    if (!html) return null;
    const text = decodeEntities(
        html
            .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<li[^>]*>/gi, '\n- ')
            .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section|article|header|blockquote)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            // A fragment cut in the middle of a tag
            .replace(/<[^>]*$/, ''),
    )
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text || null;
};

export const cleanString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
};

export const uniqueStrings = (values: unknown[]): string[] => [
    ...new Set(values.map(cleanString).filter((value): value is string => value !== null)),
];

/** ISO 8601 from a date string; a bare date ("2026-11-18") becomes midnight UTC */
export const toIsoDate = (value: unknown): string | null => {
    const text = cleanString(value);
    if (!text) return null;
    const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
};

/** Two-letter country code, upper case, or null */
export const toCountryCode = (value: unknown): string | null => {
    const code = cleanString(value);
    return code && /^[a-z]{2}$/i.test(code) ? code.toUpperCase() : null;
};

/** Normalizes Workday time types ("Full time", "Full Time", "Part time") */
export const normalizeTimeType = (value: unknown): string | null => {
    const raw = cleanString(value);
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower.includes('full')) return 'full-time';
    if (lower.includes('part')) return 'part-time';
    return raw;
};

/** Maps Workday remote types ("Remote", "Hybrid", "Flex", "Office - Flexible", "On-site") to onsite, hybrid or remote */
export const normalizeWorkplaceType = (value: unknown): JobItem['workplaceType'] => {
    const raw = cleanString(value);
    if (!raw) return null;
    const compact = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (compact.includes('hybrid') || compact.includes('flex')) return 'hybrid';
    if (compact.includes('remote') || compact.includes('virtual') || compact.includes('telework')) return 'remote';
    if (compact.includes('onsite') || compact.includes('office') || compact.includes('inperson')) return 'onsite';
    return null;
};

/** Workplace type from the remote type, or from "Remote" in the locations when the site does not say */
export const workplaceTypeOf = (remoteType: string | null, locations: (string | null)[]): JobItem['workplaceType'] => {
    const fromType = normalizeWorkplaceType(remoteType);
    if (fromType) return fromType;
    return locations.some((place) => place && /\bremote\b/i.test(place)) ? 'remote' : null;
};

/**
 * Days since a Workday "postedOn" string: "Posted Today", "Posted Yesterday", "Posted 3 Days Ago",
 * "Posted 30+ Days Ago" (counted as 30). Null when the wording is unknown.
 */
export const workdayDaysAgo = (postedOn: unknown): number | null => {
    const text = cleanString(postedOn)?.toLowerCase();
    if (!text) return null;
    if (text.includes('today')) return 0;
    if (text.includes('yesterday')) return 1;
    const match = /(\d+)\+?\s*day/.exec(text);
    return match ? Number(match[1]) : null;
};

export const daysAgoToIso = (days: number | null, now = Date.now()): string | null => {
    if (days === null) return null;
    return `${new Date(now - days * DAY_MS).toISOString().slice(0, 10)}T00:00:00.000Z`;
};

/** Whether a job published at `postedAt` is within the last `days` days (true when unknown or no filter) */
export const isRecent = (postedAt: string | null, days: number, now = Date.now()): boolean => {
    if (days <= 0 || !postedAt) return true;
    return now - Date.parse(postedAt) <= days * DAY_MS;
};

// Workday facet value ids are 32 hexadecimal characters
const FACET_ID = /^[0-9a-f]{32}$/i;

/** Copy of applied facets with one facet replaced, keys sorted for stable unique keys */
export const withFacet = (facets: AppliedFacets, param: string, ids: string[]): AppliedFacets =>
    Object.fromEntries(
        Object.entries({ ...facets, [param]: ids }).sort(([a], [b]) => a.localeCompare(b)),
    ) as AppliedFacets;

/**
 * Resolves a Workday career site URL: tenant.wdN.myworkdayjobs.com/[lang/]Site[/job/...][?facet=id&q=text].
 * Query parameters whose values are Workday ids become search filters, `q` becomes the search text
 * (`defaultSearchText` when the URL has none).
 */
export const parseSiteUrl = (value: string, defaultSearchText = ''): SiteRef | null => {
    const input = value.trim();
    if (!input) return null;

    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase();
    if (!/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(host)) return null;

    const tenant = host.split('.')[0];
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    let site: string | undefined;
    if (segments[0] === 'wday' && segments[1] === 'cxs') site = segments[3];
    else site = (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(segments[0] ?? '') ? segments.slice(1) : segments)[0];
    if (!site) return null;

    const appliedFacets: AppliedFacets = {};
    for (const [param, raw] of url.searchParams) {
        const ids = raw.split(',').filter((id) => FACET_ID.test(id));
        if (ids.length > 0) appliedFacets[param] = [...new Set([...(appliedFacets[param] ?? []), ...ids])];
    }
    const searchText = url.searchParams.get('q')?.trim() || defaultSearchText.trim();
    const sortedFacets = Object.keys(appliedFacets).length
        ? Object.entries(appliedFacets).reduce<AppliedFacets>((acc, [param, ids]) => withFacet(acc, param, ids), {})
        : {};

    return {
        host,
        tenant,
        site,
        appliedFacets: sortedFacets,
        searchText,
        key: `${host}/${site}?${JSON.stringify(sortedFacets)}&q=${searchText}`,
        input,
    };
};
