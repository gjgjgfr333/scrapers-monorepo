import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
    applyDetail,
    buildDetailRequest,
    buildListRequest,
    needsDetailRequest,
    parseListPage,
    workdayDetailPath,
} from '../src/ats.js';
import type { CompanyRef, JobFilters, JobItem } from '../src/types.js';
import {
    decodeEntities,
    htmlToText,
    inferRemote,
    matchesFilters,
    normalizeEmploymentType,
    normalizeSalaryPeriod,
    normalizeWorkplaceType,
    parseCompanyInput,
    toIsoDate,
    workdayDaysAgo,
} from '../src/utils.js';

const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const company = (input: string): CompanyRef => {
    const ref = parseCompanyInput(input);
    if (!ref) throw new Error(`Cannot parse ${input}`);
    return ref;
};

const NOW = Date.parse('2026-11-19T12:00:00Z');
const NO_FILTERS: JobFilters = { keywords: [], locations: [], remoteOnly: false, onlyNewSinceDays: 0 };

describe('parseCompanyInput', () => {
    it.each([
        ['https://boards.greenhouse.io/airbnb', 'greenhouse', 'airbnb'],
        ['https://job-boards.greenhouse.io/airbnb/jobs/123', 'greenhouse', 'airbnb'],
        ['boards.greenhouse.io/embed/job_board?for=stripe', 'greenhouse', 'stripe'],
        ['https://boards-api.greenhouse.io/v1/boards/airbnb/jobs', 'greenhouse', 'airbnb'],
        ['https://jobs.lever.co/palantir', 'lever', 'palantir'],
        ['https://jobs.lever.co/palantir/6ed76ce8-4156', 'lever', 'palantir'],
        ['https://jobs.ashbyhq.com/ramp', 'ashby', 'ramp'],
        ['https://apply.workable.com/huggingface/', 'workable', 'huggingface'],
        ['https://huggingface.workable.com', 'workable', 'huggingface'],
        ['https://bunq.recruitee.com/', 'recruitee', 'bunq'],
        ['https://jobs.smartrecruiters.com/BoschGroup', 'smartrecruiters', 'BoschGroup'],
        ['https://careers.smartrecruiters.com/BoschGroup/it', 'smartrecruiters', 'BoschGroup'],
        ['greenhouse:airbnb', 'greenhouse', 'airbnb'],
        ['Lever:palantir', 'lever', 'palantir'],
    ])('%s → %s %s', (input, ats, slug) => {
        expect(parseCompanyInput(input)).toMatchObject({ ats, slug });
    });

    it('reads the EU data centre of Lever and Greenhouse', () => {
        expect(company('https://jobs.eu.lever.co/acme')).toMatchObject({ ats: 'lever', eu: true });
        expect(company('https://job-boards.eu.greenhouse.io/acme')).toMatchObject({ ats: 'greenhouse', eu: true });
        expect(buildListRequest(company('https://jobs.eu.lever.co/acme'), {}, true).url).toContain('api.eu.lever.co');
    });

    it('reads the Workday tenant and site with or without a language prefix', () => {
        const expected = {
            ats: 'workday',
            slug: 'nvidia',
            host: 'nvidia.wd5.myworkdayjobs.com',
            site: 'NVIDIAExternalCareerSite',
        };
        expect(parseCompanyInput('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite')).toMatchObject(
            expected,
        );
        expect(
            parseCompanyInput('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x_JR1'),
        ).toMatchObject(expected);
        expect(
            parseCompanyInput('https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs'),
        ).toMatchObject(expected);
    });

    it('rejects unsupported values', () => {
        expect(parseCompanyInput('')).toBeNull();
        expect(parseCompanyInput('https://example.com/careers')).toBeNull();
        expect(parseCompanyInput('workday:nvidia')).toBeNull();
        expect(parseCompanyInput('https://jobs.lever.co/')).toBeNull();
        expect(parseCompanyInput('https://nvidia.wd5.myworkdayjobs.com/')).toBeNull();
    });

    it('gives the same key to the same board written differently', () => {
        expect(company('https://boards.greenhouse.io/airbnb').key).toBe(company('greenhouse:airbnb').key);
    });
});

describe('html helpers', () => {
    it('decodes named and numeric entities', () => {
        expect(decodeEntities('&lt;p&gt;Tom&amp;Jerry &#8217;s &#x2014; &rsquo;&nbsp;&unknown;')).toBe(
            '<p>Tom&Jerry ’s — ’ &unknown;',
        );
    });

    it('turns HTML into readable text', () => {
        expect(htmlToText('<h3>About</h3><p>We build&nbsp;things.</p><ul><li>One</li><li>Two</li></ul>')).toBe(
            'About\nWe build things.\n\n- One\n- Two',
        );
        expect(htmlToText('')).toBeNull();
        expect(htmlToText(null)).toBeNull();
    });
});

describe('normalizers', () => {
    it.each([
        ['FullTime', 'full-time'],
        ['Full-time', 'full-time'],
        ['fulltime_permanent', 'full-time'],
        ['full', 'full-time'],
        ['Part time', 'part-time'],
        ['Intern', 'internship'],
        ['Contract', 'contract'],
        ['freelance', 'contract'],
        ['Temporary', 'temporary'],
        ['Volunteer', 'Volunteer'],
    ])('employment type %s → %s', (raw, expected) => {
        expect(normalizeEmploymentType(raw)).toBe(expected);
    });

    it('maps workplace types and salary periods', () => {
        expect(normalizeWorkplaceType('OnSite')).toBe('onsite');
        expect(normalizeWorkplaceType('on_site')).toBe('onsite');
        expect(normalizeWorkplaceType('Hybrid')).toBe('hybrid');
        expect(normalizeWorkplaceType('remote')).toBe('remote');
        expect(normalizeWorkplaceType('unspecified')).toBeNull();
        expect(normalizeSalaryPeriod('1 YEAR')).toBe('year');
        expect(normalizeSalaryPeriod('per-hour-wage')).toBe('hour');
        expect(normalizeSalaryPeriod('NONE')).toBeNull();
    });

    it('parses dates of every ATS', () => {
        expect(toIsoDate('2026-11-18 16:23:32 UTC')).toBe('2026-11-18T16:23:32.000Z');
        expect(toIsoDate(1786469891368)).toBe(new Date(1786469891368).toISOString());
        expect(toIsoDate('2026-11-17T21:00:15-05:00')).toBe('2026-11-18T02:00:15.000Z');
        expect(toIsoDate('soon')).toBeNull();
    });

    it('reads Workday relative dates', () => {
        expect(workdayDaysAgo('Posted Today')).toBe(0);
        expect(workdayDaysAgo('Posted Yesterday')).toBe(1);
        expect(workdayDaysAgo('Posted 3 Days Ago')).toBe(3);
        expect(workdayDaysAgo('Posted 30+ Days Ago')).toBe(30);
        expect(workdayDaysAgo('Recently')).toBeNull();
    });
});

describe('Greenhouse', () => {
    const board = company('https://boards.greenhouse.io/airbnb');
    const page = parseListPage(board, fixture('greenhouse-jobs.json'), {}, true, NOW)!;

    it('maps jobs and unescapes the description', () => {
        expect(page.next).toBeNull();
        expect(page.jobs).toHaveLength(2);
        expect(page.jobs[0]).toMatchObject({
            ats: 'greenhouse',
            company: 'Airbnb',
            companySlug: 'airbnb',
            jobId: '8351513',
            title: 'Account Executive',
            url: 'https://careers.airbnb.com/positions/8351513?gh_jid=8351513',
            location: 'Singapore',
            workplaceType: 'hybrid',
            remote: false,
            department: 'Sales & Partnerships',
            postedAt: '2026-11-18T02:00:15.000Z',
        });
        expect(page.jobs[0].descriptionHtml).toMatch(/^<div class="content-intro">/);
        expect(page.jobs[0].descriptionText).not.toContain('<');
    });

    it('skips the description when it is not requested', () => {
        expect(buildListRequest(board, {}, false).url).toContain('content=false');
        const short = parseListPage(board, fixture('greenhouse-jobs.json'), {}, false, NOW)!;
        expect(short.jobs[0].descriptionHtml).toBeNull();
    });

    it('rejects an unexpected answer', () => {
        expect(parseListPage(board, { status: 404, error: 'Job not found' }, {}, true)).toBeNull();
    });
});

describe('Lever', () => {
    const board = company('https://jobs.lever.co/palantir');

    it('maps postings with lists and paginates by skip', () => {
        const page = parseListPage(board, fixture('lever-postings.json'), {}, true, NOW)!;
        expect(page.jobs[0]).toMatchObject({
            ats: 'lever',
            jobId: '6ed76ce8-4156-4b60-b120-403538bd66cd',
            title: 'Administrative Business Partner',
            url: 'https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd',
            applyUrl: 'https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply',
            location: 'Singapore, Singapore',
            country: 'SG',
            workplaceType: 'hybrid',
            employmentType: 'full-time',
            department: 'Administrative',
        });
        expect(page.jobs[0].descriptionHtml).toContain('<h3>Administrative Business Partner (Foundry)</h3>');
        // Two postings is less than a full page
        expect(page.next).toBeNull();
        expect(buildListRequest(board, { offset: 100 }, true).url).toContain('skip=100&limit=100');
    });

    it('asks for the next page after a full one', () => {
        const postings = fixture('lever-postings.json') as object[];
        const full = Array.from({ length: 100 }, (_, index) => ({ ...postings[0], id: `id-${index}` }));
        expect(parseListPage(board, full, { offset: 100 }, true)!.next).toEqual({ offset: 200 });
    });

    it('reads the salary range when the company publishes it', () => {
        const [posting] = fixture('lever-postings.json') as object[];
        const withSalary = {
            ...posting,
            salaryRange: { min: 100000, max: 150000, currency: 'USD', interval: 'per-year-salary' },
        };
        expect(parseListPage(board, [withSalary], {}, false)!.jobs[0]).toMatchObject({
            salaryMin: 100000,
            salaryMax: 150000,
            salaryCurrency: 'USD',
            salaryPeriod: 'year',
        });
    });
});

describe('Ashby', () => {
    it('maps jobs with compensation', () => {
        const page = parseListPage(
            company('https://jobs.ashbyhq.com/ramp'),
            fixture('ashby-job-board.json'),
            {},
            true,
            NOW,
        )!;
        const [first] = page.jobs;
        expect(first).toMatchObject({ ats: 'ashby', companySlug: 'ramp', employmentType: 'full-time' });
        expect(first.url).toMatch(/^https:\/\/jobs\.ashbyhq\.com\/ramp\//);
        expect(first.salaryMin).toBeGreaterThan(0);
        expect(first.salaryCurrency).toBe('USD');
        expect(first.salaryPeriod).toBe('year');
        expect(first.descriptionText).toBeTruthy();
        expect(page.jobs.every((job) => job.workplaceType !== null)).toBe(true);
    });
});

describe('Workable', () => {
    const board = company('https://apply.workable.com/huggingface');

    it('lists jobs and paginates with the token', () => {
        const page = parseListPage(board, fixture('workable-jobs.json'), {}, true, NOW)!;
        expect(page.next).toEqual({ token: 'WzE3OTM1Nzc2MDAwMDAsNTYzMTA2Nl0=' });
        expect(page.jobs[0]).toMatchObject({
            ats: 'workable',
            jobId: 'DB4D7C0EC8',
            url: 'https://apply.workable.com/huggingface/j/DB4D7C0EC8/',
            applyUrl: 'https://apply.workable.com/huggingface/j/DB4D7C0EC8/apply/',
            location: 'France',
            country: 'FR',
            remote: true,
            workplaceType: 'remote',
            department: 'Product',
            postedAt: '2026-09-21T00:00:00.000Z',
        });
        const next = buildListRequest(board, { token: 'abc' }, true);
        expect(next).toMatchObject({ method: 'POST', payload: '{"token":"abc"}' });
        expect(next.uniqueKey).not.toBe(buildListRequest(board, {}, true).uniqueKey);
    });

    it('adds the description from the detail request', () => {
        const [job] = parseListPage(board, fixture('workable-jobs.json'), {}, true, NOW)!.jobs;
        expect(needsDetailRequest(board, true)).toBe(true);
        expect(needsDetailRequest(board, false)).toBe(false);
        expect(buildDetailRequest(board, job).url).toBe(
            'https://apply.workable.com/api/v2/accounts/huggingface/jobs/DB4D7C0EC8',
        );
        const full = applyDetail(board, job, fixture('workable-job.json'));
        expect(full.descriptionHtml).toContain('Hugging Face');
        expect(full.descriptionText).not.toContain('<p>');
    });
});

describe('Recruitee', () => {
    it('maps offers', () => {
        const page = parseListPage(
            company('https://bunq.recruitee.com'),
            fixture('recruitee-offers.json'),
            {},
            true,
            NOW,
        )!;
        expect(page.jobs[0]).toMatchObject({
            ats: 'recruitee',
            company: 'bunq',
            title: 'Copywriter',
            url: 'https://careers.bunq.com/o/copywriter-3',
            applyUrl: 'https://careers.bunq.com/o/copywriter-3/c/new',
            location: 'Amsterdam, Noord-Holland, Netherlands',
            country: 'NL',
            remote: false,
            workplaceType: 'hybrid',
            employmentType: 'full-time',
            department: 'Content & Design',
            postedAt: '2026-11-18T16:23:32.000Z',
        });
        expect(page.jobs[0].locations).toContain('Sofia, Bulgaria');
        expect(page.jobs[0]).not.toHaveProperty('mailbox_email');
    });
});

describe('SmartRecruiters', () => {
    const board = company('https://jobs.smartrecruiters.com/BoschGroup');

    it('lists postings and paginates by offset up to totalFound', () => {
        const page = parseListPage(board, fixture('smartrecruiters-postings.json'), {}, true, NOW)!;
        expect(page.total).toBe(5121);
        expect(page.next).toEqual({ offset: 100 });
        expect(page.jobs[0]).toMatchObject({
            ats: 'smartrecruiters',
            company: 'Bosch Group',
            jobId: '744000162432498',
            location: 'bangalore, India',
            country: 'IN',
            remote: false,
            workplaceType: 'onsite',
            employmentType: 'full-time',
            department: 'Information Technology',
        });
        expect(parseListPage(board, { totalFound: 150, content: [{ id: 1 }] }, { offset: 100 }, true)!.next).toBeNull();
    });

    it('adds the description and links from the detail request', () => {
        const [job] = parseListPage(board, fixture('smartrecruiters-postings.json'), {}, true, NOW)!.jobs;
        const full = applyDetail(board, job, fixture('smartrecruiters-posting.json'));
        expect(full.url).toMatch(/^https:\/\/jobs\.smartrecruiters\.com\/BoschGroup\/744000162432498-/);
        expect(full.applyUrl).toContain('oga=true');
        expect(full.descriptionHtml).toContain('<h3>Company Description</h3>');
    });
});

describe('Workday', () => {
    const board = company('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');

    it('lists postings, keeps the first-page total and stops at 2000', () => {
        const first = parseListPage(board, fixture('workday-jobs.json'), {}, true, NOW)!;
        expect(first.total).toBe(2000);
        expect(first.next).toEqual({ offset: 20, total: 2000 });
        expect(first.jobs[0]).toMatchObject({
            ats: 'workday',
            companySlug: 'nvidia',
            jobId: 'JR2021220',
            title: 'Mechanical and Thermal Supply Base Engineer',
            url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Vietnam-Hanoi/Mechanical-and-Thermal-Supply-Base-Engineer_JR2021220',
            location: 'Vietnam, Hanoi',
            postedAt: '2026-11-19T00:00:00.000Z',
        });

        // Later pages report total 0; the total travels in the cursor
        const last = parseListPage(board, fixture('workday-jobs-page.json'), { offset: 1980, total: 2000 }, true, NOW)!;
        expect(last.next).toBeNull();
        expect(last.jobs[0].postedAt).toBe('2026-10-20T00:00:00.000Z');

        const request = buildListRequest(board, { offset: 40 }, true);
        expect(request.url).toBe('https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs');
        expect(JSON.parse(request.payload!)).toMatchObject({ limit: 20, offset: 40 });
    });

    it('completes the job from the detail request', () => {
        const [job] = parseListPage(board, fixture('workday-jobs.json'), {}, true, NOW)!.jobs;
        const path = workdayDetailPath(job, board);
        expect(path).toBe('/job/Vietnam-Hanoi/Mechanical-and-Thermal-Supply-Base-Engineer_JR2021220');
        expect(buildDetailRequest(board, job, path).url).toBe(
            'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/Vietnam-Hanoi/Mechanical-and-Thermal-Supply-Base-Engineer_JR2021220',
        );
        const full = applyDetail(board, job, fixture('workday-job.json'));
        expect(full).toMatchObject({
            country: 'VN',
            employmentType: 'full-time',
            postedAt: '2026-11-19T00:00:00.000Z',
            applyUrl: `${full.url}/apply`,
        });
        expect(full.descriptionText).toContain('NVIDIA');
    });
});

describe('filters', () => {
    const base: JobItem = {
        ats: 'lever',
        company: 'acme',
        companySlug: 'acme',
        jobId: '1',
        title: 'Senior Backend Engineer',
        url: 'https://jobs.lever.co/acme/1',
        applyUrl: null,
        location: 'Austin, TX',
        locations: ['Austin, TX'],
        country: null,
        remote: null,
        workplaceType: null,
        employmentType: null,
        department: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        postedAt: '2026-11-10T00:00:00.000Z',
        descriptionHtml: null,
        descriptionText: null,
        scrapedAt: '2026-11-19T12:00:00.000Z',
    };

    it('matches title keywords case-insensitively', () => {
        expect(matchesFilters(base, { ...NO_FILTERS, keywords: ['engineer'] })).toBe(true);
        expect(matchesFilters(base, { ...NO_FILTERS, keywords: ['sales', 'designer'] })).toBe(false);
    });

    it('treats two-letter locations as country codes', () => {
        expect(matchesFilters(base, { ...NO_FILTERS, locations: ['US'] })).toBe(false);
        expect(matchesFilters({ ...base, country: 'US' }, { ...NO_FILTERS, locations: ['us'] })).toBe(true);
        expect(
            matchesFilters({ ...base, location: 'US-Remote', locations: [] }, { ...NO_FILTERS, locations: ['US'] }),
        ).toBe(true);
        expect(matchesFilters(base, { ...NO_FILTERS, locations: ['austin'] })).toBe(true);
    });

    it('lets unknown values pass only at the list stage', () => {
        const remoteOnly = { ...NO_FILTERS, remoteOnly: true };
        expect(matchesFilters(base, remoteOnly, true)).toBe(true);
        expect(matchesFilters(base, remoteOnly)).toBe(false);
        expect(matchesFilters({ ...base, remote: true }, remoteOnly)).toBe(true);
    });

    it('filters by age and keeps jobs without a date', () => {
        expect(matchesFilters(base, { ...NO_FILTERS, onlyNewSinceDays: 14 }, false, NOW)).toBe(true);
        expect(matchesFilters(base, { ...NO_FILTERS, onlyNewSinceDays: 7 }, false, NOW)).toBe(false);
        expect(matchesFilters({ ...base, postedAt: null }, { ...NO_FILTERS, onlyNewSinceDays: 7 }, false, NOW)).toBe(
            true,
        );
    });

    it('infers remote from the location text', () => {
        expect(inferRemote({ ...base, location: 'Remote (US)' })).toMatchObject({
            remote: true,
            workplaceType: 'remote',
        });
        expect(inferRemote({ ...base, workplaceType: 'onsite' })).toMatchObject({ remote: false });
        expect(inferRemote(base)).toMatchObject({ remote: null, workplaceType: null });
    });
});
