import type { AtsName, CompanyRef, JobFilters, JobItem } from './types.js';
import { ATS_NAMES } from './types.js';

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
        .replace(/[ \t\u00a0]+/g, ' ')
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

export const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value.replace(/[,\s]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

/** ISO 8601 string from a date string, a Unix time in milliseconds or Recruitee's "2026-11-18 16:23:32 UTC" */
export const toIsoDate = (value: unknown): string | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const normalized = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, '$1T$2Z');
    const time = Date.parse(normalized);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
};

// Country names and three-letter codes that ATS APIs return instead of ISO alpha-2 (Ashby does)
const COUNTRY_CODES: Record<string, string> = {
    usa: 'US',
    'united states': 'US',
    'united states of america': 'US',
    canada: 'CA',
    can: 'CA',
    mexico: 'MX',
    brazil: 'BR',
    bra: 'BR',
    argentina: 'AR',
    colombia: 'CO',
    'united kingdom': 'GB',
    uk: 'GB',
    gbr: 'GB',
    ireland: 'IE',
    irl: 'IE',
    germany: 'DE',
    deu: 'DE',
    france: 'FR',
    fra: 'FR',
    spain: 'ES',
    esp: 'ES',
    portugal: 'PT',
    italy: 'IT',
    netherlands: 'NL',
    nld: 'NL',
    belgium: 'BE',
    switzerland: 'CH',
    austria: 'AT',
    poland: 'PL',
    pol: 'PL',
    sweden: 'SE',
    denmark: 'DK',
    norway: 'NO',
    finland: 'FI',
    estonia: 'EE',
    czechia: 'CZ',
    'czech republic': 'CZ',
    romania: 'RO',
    greece: 'GR',
    turkey: 'TR',
    türkiye: 'TR',
    israel: 'IL',
    isr: 'IL',
    'united arab emirates': 'AE',
    india: 'IN',
    ind: 'IN',
    singapore: 'SG',
    sgp: 'SG',
    japan: 'JP',
    jpn: 'JP',
    'south korea': 'KR',
    china: 'CN',
    'hong kong': 'HK',
    australia: 'AU',
    aus: 'AU',
    'new zealand': 'NZ',
    philippines: 'PH',
    'south africa': 'ZA',
    nigeria: 'NG',
};

/** Two-letter country code, upper case, from a code or a common country name; null for anything else */
export const toCountryCode = (value: unknown): string | null => {
    const code = cleanString(value);
    if (!code) return null;
    if (/^[a-z]{2}$/i.test(code)) return code.toUpperCase();
    return COUNTRY_CODES[code.toLowerCase()] ?? null;
};

export const uniqueStrings = (values: unknown[]): string[] => [
    ...new Set(values.map(cleanString).filter((value): value is string => value !== null)),
];

/** Maps the employment type wording of every ATS to full-time, part-time, contract, temporary or internship */
export const normalizeEmploymentType = (value: unknown): string | null => {
    const raw = cleanString(value);
    if (!raw) return null;
    const compact = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (compact.includes('intern') || compact.includes('trainee') || compact.includes('apprentice'))
        return 'internship';
    if (compact.includes('contract') || compact.includes('freelance') || compact.includes('contractor'))
        return 'contract';
    if (compact.includes('temp') || compact.includes('seasonal')) return 'temporary';
    if (compact.includes('part')) return 'part-time';
    if (compact.includes('full') || compact.includes('permanent') || compact.includes('regular')) return 'full-time';
    return raw;
};

/** Maps workplace wording (OnSite, on_site, In office, Hybrid, Remote…) to onsite, hybrid or remote */
export const normalizeWorkplaceType = (value: unknown): JobItem['workplaceType'] => {
    const raw = cleanString(value);
    if (!raw) return null;
    const compact = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (compact.includes('hybrid')) return 'hybrid';
    if (compact.includes('remote')) return 'remote';
    if (compact.includes('onsite') || compact.includes('office') || compact.includes('inperson')) return 'onsite';
    return null;
};

/** Maps salary intervals ("1 YEAR", "per-year-salary", "month", "hourly") to year, month, week, day or hour */
export const normalizeSalaryPeriod = (value: unknown): string | null => {
    const raw = cleanString(value);
    if (!raw) return null;
    const lower = raw.toLowerCase();
    for (const period of ['year', 'month', 'week', 'day', 'hour'] as const) {
        if (lower.includes(period)) return period;
    }
    if (lower.includes('annual')) return 'year';
    return null;
};

/**
 * Fills `remote` and `workplaceType` from the location text when the ATS did not say,
 * so "Remote (US)" or "US-Remote" counts as a remote job.
 */
export const inferRemote = (item: JobItem): JobItem => {
    const mentionsRemote = [item.location, ...item.locations].some((place) => place && /\bremote\b/i.test(place));
    const workplaceType = item.workplaceType ?? (mentionsRemote ? 'remote' : null);
    let { remote } = item;
    if (remote === null) {
        if (workplaceType === 'remote' || mentionsRemote) remote = true;
        else if (workplaceType) remote = false;
    }
    return { ...item, workplaceType, remote };
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
    const date = new Date(now - days * DAY_MS);
    return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
};

/**
 * Applies the input filters. With `partial` (list stage, before details are loaded) an unknown value
 * passes, so a job is dropped only once it is known not to match.
 */
export const matchesFilters = (item: JobItem, filters: JobFilters, partial = false, now = Date.now()): boolean => {
    if (filters.keywords.length > 0) {
        const title = item.title.toLowerCase();
        if (!filters.keywords.some((keyword) => title.includes(keyword.toLowerCase()))) return false;
    }

    if (filters.locations.length > 0) {
        const places = [item.location, ...item.locations]
            .filter((place): place is string => Boolean(place))
            .map((place) => place.toLowerCase());
        const country = item.country?.toLowerCase() ?? null;
        const matches = (wantedRaw: string) => {
            const wanted = wantedRaw.toLowerCase();
            // A two-letter value is a country code: compare whole words only, so "US" does not match "Austin"
            if (/^[a-z]{2}$/.test(wanted)) {
                const word = new RegExp(`(^|[^a-z])${wanted}([^a-z]|$)`);
                return country === wanted || places.some((place) => word.test(place));
            }
            return places.some((place) => place.includes(wanted));
        };
        if (places.length === 0 && country === null) {
            if (!partial) return false;
        } else if (!filters.locations.some(matches)) {
            return false;
        }
    }

    if (filters.remoteOnly && item.remote !== true && !(partial && item.remote === null)) return false;

    // Jobs without a publication date are kept: there is nothing to compare
    if (filters.onlyNewSinceDays > 0 && item.postedAt) {
        const age = now - Date.parse(item.postedAt);
        if (age > filters.onlyNewSinceDays * DAY_MS) return false;
    }

    return true;
};

const companyRef = (ats: AtsName, slug: string, input: string, extra: Partial<CompanyRef> = {}): CompanyRef => ({
    ats,
    slug,
    input,
    key: [ats, extra.eu ? 'eu' : null, extra.host ?? null, slug, extra.site ?? null].filter(Boolean).join(':'),
    ...extra,
});

const firstPathSegment = (url: URL): string | null => {
    const segment = url.pathname.split('/').find(Boolean);
    return segment ? decodeURIComponent(segment) : null;
};

/**
 * Resolves one input value to a company board. Accepts career page URLs of every supported ATS
 * (boards.greenhouse.io/x, jobs.lever.co/x, jobs.ashbyhq.com/x, apply.workable.com/x, x.recruitee.com,
 * jobs.smartrecruiters.com/X, x.wd5.myworkdayjobs.com/Site) and the short form "ats:slug".
 */
export const parseCompanyInput = (value: string): CompanyRef | null => {
    const input = value.trim();
    if (!input) return null;

    const short = /^([a-z]+):([^/\s]+)$/i.exec(input);
    if (short && (ATS_NAMES as readonly string[]).includes(short[1].toLowerCase())) {
        const ats = short[1].toLowerCase() as AtsName;
        // Workday needs the host and the site, which only a URL carries
        if (ats === 'workday') return null;
        return companyRef(ats, short[2], input);
    }

    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    // boards.greenhouse.io/x, job-boards.greenhouse.io/x, boards.eu.greenhouse.io/x,
    // boards-api.greenhouse.io/v1/boards/x, boards.greenhouse.io/embed/job_board?for=x
    if (/(^|\.)greenhouse\.io$/.test(host)) {
        const eu = /\.eu\.greenhouse\.io$/.test(host);
        let slug = url.searchParams.get('for');
        if (!slug) {
            const boardsIndex = segments.indexOf('boards');
            slug = host.startsWith('boards-api') && boardsIndex >= 0 ? segments[boardsIndex + 1] : segments[0];
        }
        return slug && slug !== 'embed' ? companyRef('greenhouse', slug, input, eu ? { eu } : {}) : null;
    }

    // jobs.lever.co/x, jobs.eu.lever.co/x, api.lever.co/v0/postings/x
    if (/(^|\.)lever\.co$/.test(host)) {
        const eu = /\.eu\.lever\.co$/.test(host);
        const postingsIndex = segments.indexOf('postings');
        const slug = host.startsWith('api.') && postingsIndex >= 0 ? segments[postingsIndex + 1] : segments[0];
        return slug ? companyRef('lever', slug, input, eu ? { eu } : {}) : null;
    }

    // jobs.ashbyhq.com/x, api.ashbyhq.com/posting-api/job-board/x
    if (/(^|\.)ashbyhq\.com$/.test(host)) {
        const boardIndex = segments.indexOf('job-board');
        const slug = boardIndex >= 0 ? segments[boardIndex + 1] : segments[0];
        return slug ? companyRef('ashby', slug, input) : null;
    }

    // apply.workable.com/x, x.workable.com
    if (/(^|\.)workable\.com$/.test(host)) {
        if (host === 'apply.workable.com') {
            const slug = segments[0] === 'api' ? segments[segments.indexOf('accounts') + 1] : segments[0];
            return slug ? companyRef('workable', slug, input) : null;
        }
        const subdomain = host.replace(/\.workable\.com$/, '');
        return subdomain && !subdomain.includes('.') && !['www', 'jobs'].includes(subdomain)
            ? companyRef('workable', subdomain, input)
            : null;
    }

    // x.recruitee.com
    if (/\.recruitee\.com$/.test(host)) {
        const subdomain = host.replace(/\.recruitee\.com$/, '');
        return subdomain && !subdomain.includes('.') && subdomain !== 'www'
            ? companyRef('recruitee', subdomain, input)
            : null;
    }

    // jobs.smartrecruiters.com/X, careers.smartrecruiters.com/X, api.smartrecruiters.com/v1/companies/X
    if (/(^|\.)smartrecruiters\.com$/.test(host)) {
        const companiesIndex = segments.indexOf('companies');
        const slug = companiesIndex >= 0 ? segments[companiesIndex + 1] : firstPathSegment(url);
        return slug ? companyRef('smartrecruiters', slug, input) : null;
    }

    // tenant.wd5.myworkdayjobs.com/[en-US/]Site[/job/...], tenant.wd5.myworkdayjobs.com/wday/cxs/tenant/Site/jobs
    if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(host)) {
        const tenant = host.split('.')[0];
        let site: string | undefined;
        if (segments[0] === 'wday' && segments[1] === 'cxs') {
            site = segments[3];
        } else {
            const rest = /^[a-z]{2}(-[a-z]{2,4})?$/i.test(segments[0] ?? '') ? segments.slice(1) : segments;
            site = rest[0];
        }
        return site ? companyRef('workday', tenant, input, { host, site }) : null;
    }

    return null;
};
