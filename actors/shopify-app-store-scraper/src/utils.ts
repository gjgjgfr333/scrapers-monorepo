export const LABELS = {
    APP: 'APP',
    REVIEWS: 'REVIEWS',
    CATEGORY: 'CATEGORY',
    SITEMAP: 'SITEMAP',
} as const;

export const BASE_URL = 'https://apps.shopify.com';
export const SITEMAP_URL = `${BASE_URL}/sitemap_apps_en.xml`;

/** First path segments of apps.shopify.com that are not app handles */
const RESERVED_PATHS = new Set([
    'categories',
    'collections',
    'partners',
    'search',
    'stories',
    'extensions',
    'sitemap.xml',
    'internal',
    'services',
    'login',
]);

const HANDLE_RE = /^[a-z0-9][a-z0-9-]*$/;
const LOCALE_RE = /^[a-z]{2}(-[a-z]{2})?$/i;

/**
 * Turns an app URL (`https://apps.shopify.com/judgeme`, `…/judgeme/reviews?page=2`, `apps.shopify.com/judgeme`)
 * or a bare handle (`judgeme`) into the handle, or null when it is not an app.
 */
export const parseAppInput = (value: string): string | null => {
    const raw = value.trim();
    if (!raw) return null;
    if (HANDLE_RE.test(raw.toLowerCase()) && !raw.includes('.')) return raw.toLowerCase();

    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        return null;
    }
    if (url.hostname.toLowerCase() !== 'apps.shopify.com') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    // Localized pages look like /de/judgeme or /pt-BR/judgeme
    if (segments.length > 1 && LOCALE_RE.test(segments[0]) && segments[1] !== 'reviews') segments.shift();
    const handle = segments[0]?.toLowerCase();
    if (!handle || RESERVED_PATHS.has(handle) || !HANDLE_RE.test(handle)) return null;
    return handle;
};

/**
 * Turns a category URL (`https://apps.shopify.com/categories/<slug>`, with or without `/all` and query)
 * or a bare slug into the slug, or null.
 */
export const parseCategoryInput = (value: string): string | null => {
    const raw = value.trim();
    if (!raw) return null;
    if (HANDLE_RE.test(raw.toLowerCase())) return raw.toLowerCase();

    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        return null;
    }
    if (url.hostname.toLowerCase() !== 'apps.shopify.com') return null;
    const match = url.pathname.match(/\/categories\/([a-z0-9-]+)/i);
    return match ? match[1].toLowerCase() : null;
};

export const appUrl = (handle: string) => `${BASE_URL}/${handle}`;

export const reviewsUrl = (handle: string, page: number, ratings: number[]) => {
    const params = new URLSearchParams({ sort_by: 'newest' });
    if (ratings.length > 0 && ratings.length < 5)
        for (const rating of ratings) params.append('ratings[]', String(rating));
    params.set('page', String(page));
    return `${BASE_URL}/${handle}/reviews?${params.toString()}`;
};

/** A leaf category redirects here to its paged listing; a parent category shows its subcategories */
export const categoryUrl = (slug: string, page = 1) =>
    page > 1 ? `${BASE_URL}/categories/${slug}/all?page=${page}` : `${BASE_URL}/categories/${slug}`;

/** Collapses whitespace and trims, null for an empty string */
export const cleanText = (value: string | null | undefined): string | null => {
    if (value == null) return null;
    const text = value
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text || null;
};

/** Collapses all whitespace, newlines included */
export const oneLine = (value: string | null | undefined): string | null => {
    if (value == null) return null;
    const text = value.replace(/\s+/g, ' ').trim();
    return text || null;
};

/** "1,234" → 1234, "4.8" → 4.8, anything else → null */
export const parseNumber = (value: string | null | undefined): number | null => {
    if (value == null) return null;
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
};

const MONTHS: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
};

/** "November 19, 2026" (also inside a longer text) → "2026-11-19", else null */
export const parseEnglishDate = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const match = value.match(
        /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/i,
    );
    if (!match) return null;
    const month = MONTHS[match[1].toLowerCase()];
    return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
};

/** "2026-11-01" or any date string → UTC midnight of that day, null for empty or invalid */
export const parseSinceDate = (value: string | null | undefined): Date | null => {
    if (!value?.trim()) return null;
    const date = new Date(value.trim());
    if (Number.isNaN(date.getTime())) return null;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

/** Whether a YYYY-MM-DD date is on or after `since` */
export const isOnOrAfter = (date: string | null, since: Date | null) => {
    if (!since) return true;
    if (!date) return true;
    return new Date(`${date}T00:00:00Z`).getTime() >= since.getTime();
};

/** Ratings between min and max, both clamped to 1..5 */
export const ratingRange = (min: number | undefined, max: number | undefined): number[] => {
    const low = Math.min(5, Math.max(1, Math.round(min ?? 1)));
    const high = Math.min(5, Math.max(1, Math.round(max ?? 5)));
    const result: number[] = [];
    for (let rating = Math.min(low, high); rating <= Math.max(low, high); rating++) result.push(rating);
    return result;
};

/** Handles of every app URL in a sitemap urlset */
export const parseSitemapHandles = (xml: string): string[] => {
    const handles: string[] = [];
    for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const handle = parseAppInput(match[1]);
        if (handle) handles.push(handle);
    }
    return handles;
};
