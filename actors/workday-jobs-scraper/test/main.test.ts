import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { SiteRef } from '../src/types.js';
import {
    htmlToText,
    isRecent,
    normalizeTimeType,
    normalizeWorkplaceType,
    parseSiteUrl,
    toIsoDate,
    withFacet,
    workdayDaysAgo,
    workplaceTypeOf,
} from '../src/utils.js';
import {
    applyDetail,
    buildDetailRequest,
    buildListRequest,
    estimateTotal,
    flattenFacets,
    mapListedJob,
    packValues,
    parseListPage,
    planSplit,
    SEARCH_CAP,
} from '../src/workday.js';

const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const site = (input: string): SiteRef => {
    const ref = parseSiteUrl(input);
    if (!ref) throw new Error(`Cannot parse ${input}`);
    return ref;
};

const NOW = Date.parse('2026-11-19T12:00:00Z');
const NVIDIA = 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite';
const ID_A = '0c40f6bd1d8f10ae43ffaefd46dc7e78';
const ID_B = '2fcb99c455831013ea52b82135ba3266';

describe('parseSiteUrl', () => {
    it.each([
        NVIDIA,
        'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite',
        'nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Engineer_JR1',
        'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs',
    ])('%s', (input) => {
        expect(parseSiteUrl(input)).toMatchObject({
            host: 'nvidia.wd5.myworkdayjobs.com',
            tenant: 'nvidia',
            site: 'NVIDIAExternalCareerSite',
            appliedFacets: {},
            searchText: '',
        });
    });

    it('turns id query parameters into filters and q into the search text', () => {
        const ref = site(`${NVIDIA}?locationHierarchy1=${ID_B}&jobFamilyGroup=${ID_A}&q=python&source=linkedin`);
        expect(ref.appliedFacets).toEqual({ jobFamilyGroup: [ID_A], locationHierarchy1: [ID_B] });
        expect(Object.keys(ref.appliedFacets)).toEqual(['jobFamilyGroup', 'locationHierarchy1']);
        expect(ref.searchText).toBe('python');
    });

    it('uses the input search text when the URL has none', () => {
        expect(parseSiteUrl(NVIDIA, ' data ')?.searchText).toBe('data');
        expect(parseSiteUrl(`${NVIDIA}?q=gpu`, 'data')?.searchText).toBe('gpu');
    });

    it('gives different keys to different searches of one site', () => {
        expect(site(NVIDIA).key).toBe(site('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite').key);
        expect(site(NVIDIA).key).not.toBe(site(`${NVIDIA}?q=gpu`).key);
    });

    it('rejects other URLs', () => {
        expect(parseSiteUrl('')).toBeNull();
        expect(parseSiteUrl('https://jobs.lever.co/palantir')).toBeNull();
        expect(parseSiteUrl('https://nvidia.wd5.myworkdayjobs.com/')).toBeNull();
        expect(parseSiteUrl('not a url at all')).toBeNull();
    });
});

describe('requests', () => {
    it('builds search and detail requests', () => {
        const ref = site(`${NVIDIA}?q=gpu`);
        const request = buildListRequest(ref, { jobFamilyGroup: [ID_A] }, 40);
        expect(request.url).toBe('https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs');
        expect(JSON.parse(request.payload)).toEqual({
            appliedFacets: { jobFamilyGroup: [ID_A] },
            limit: 20,
            offset: 40,
            searchText: 'gpu',
        });
        expect(request.uniqueKey).not.toBe(buildListRequest(ref, {}, 40).uniqueKey);
        expect(buildDetailRequest(ref, '/job/X/Y_JR1').url).toBe(
            'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/X/Y_JR1',
        );
    });

    it('keeps facet keys sorted', () => {
        expect(Object.keys(withFacet({ timeType: ['a'] }, 'jobFamilyGroup', ['b']))).toEqual([
            'jobFamilyGroup',
            'timeType',
        ]);
    });
});

describe('list pages and facets', () => {
    const page = parseListPage(fixture('nvidia-jobs-first.json'))!;

    it('reads jobs and the capped total', () => {
        expect(page.total).toBe(2000);
        expect(page.jobs[0]).toMatchObject({
            externalPath: expect.stringMatching(/^\/job\//),
            reqId: expect.any(String),
        });
        expect(parseListPage({ errorCode: 'S21' })).toBeNull();
        expect(parseListPage(fixture('nvidia-jobs-later.json'))!.total).toBe(0);
    });

    it('flattens nested location facets', () => {
        expect(page.facets.map((facet) => facet.param)).toEqual([
            'jobFamilyGroup',
            'workerSubType',
            'timeType',
            'locationHierarchy2',
            'locationHierarchy1',
            'locations',
        ]);
        expect(page.facets[0].values[0]).toEqual({ id: ID_A, descriptor: 'Engineering', count: 1651 });
    });

    it('estimates the real number of jobs from single-value facets', () => {
        expect(estimateTotal(page.total, page.facets)).toBe(2626);
        expect(estimateTotal(10, [])).toBe(10);
        expect(estimateTotal(346, page.facets)).toBe(346);
    });

    it('splits a capped search by the cheapest complete facet', () => {
        const plan = planSplit(page.total, page.facets, {})!;
        expect(plan.param).toBe('jobFamilyGroup');
        const counts = new Map(page.facets[0].values.map((value) => [value.id, value.count]));
        for (const group of plan.groups) {
            expect(group.reduce((sum, id) => sum + counts.get(id)!, 0)).toBeLessThan(SEARCH_CAP);
        }
        expect(plan.groups.flat().sort()).toEqual(
            page.facets[0].values
                .filter((v) => v.count > 0)
                .map((v) => v.id)
                .sort(),
        );
        expect(plan.groups.length).toBeLessThan(page.facets[0].values.length);
    });

    it('does not split again by a facet that is already applied', () => {
        expect(planSplit(page.total, page.facets, { jobFamilyGroup: [ID_A] })!.param).not.toBe('jobFamilyGroup');
    });

    it('skips facets that leave some jobs out', () => {
        const pfizer = parseListPage(fixture('pfizer-jobs-first.json'))!;
        const jobFamily = pfizer.facets.find((facet) => facet.param === 'jobFamilyGroup')!;
        const sum = jobFamily.values.reduce((total, value) => total + value.count, 0);
        // One Pfizer job has no category, so its category facet cannot be used to split
        expect(sum).toBeLessThan(estimateTotal(pfizer.total, pfizer.facets));
        const plan = planSplit(pfizer.total, pfizer.facets, {});
        expect(plan?.param).not.toBe('jobFamilyGroup');
    });

    it('returns null when nothing can split the search', () => {
        expect(planSplit(2000, [], {})).toBeNull();
        const single = [{ param: 'timeType', descriptor: null, values: [{ id: 'a', descriptor: null, count: 2500 }] }];
        expect(planSplit(2000, single, {})).toBeNull();
    });

    it('packs values first-fit under the cap', () => {
        const values = [1500, 900, 700, 300, 2100, 0].map((count, index) => ({
            id: `v${index}`,
            descriptor: null,
            count,
        }));
        expect(packValues(values)).toEqual([['v4'], ['v0', 'v3'], ['v1', 'v2']]);
    });

    it('flattens raw facets', () => {
        expect(flattenFacets([{ facetParameter: 'distance', values: [{ id: 'x', count: 1 }] }])).toHaveLength(1);
        expect(flattenFacets(null)).toEqual([]);
    });
});

describe('jobs', () => {
    const ref = site('https://workday.wd5.myworkdayjobs.com/Workday');
    const listed = parseListPage(fixture('workday-jobs-first.json'))!.jobs;

    it('maps a listed job with an approximate date', () => {
        const item = mapListedJob(ref, { ...listed[0], postedOn: 'Posted 3 Days Ago' }, NOW);
        expect(item).toMatchObject({
            company: 'workday',
            tenant: 'workday',
            site: 'Workday',
            jobId: listed[0].reqId,
            url: `https://workday.wd5.myworkdayjobs.com/Workday${listed[0].externalPath}`,
            postedAt: '2026-11-16T00:00:00.000Z',
            postedAtApproximate: true,
            descriptionHtml: null,
        });
        expect(listed.some((job) => job.remoteType)).toBe(true);
    });

    it('completes a job from its details', () => {
        const item = mapListedJob(ref, listed[1], NOW);
        const full = applyDetail(item, fixture('workday-job.json'));
        expect(full).toMatchObject({
            legalEntity: 'Workday, Inc.',
            jobId: 'JR-0111783',
            location: 'USA, CA, Remote',
            additionalLocations: ['USA Remote'],
            remoteType: 'Remote',
            workplaceType: 'remote',
            timeType: 'full-time',
            postedAt: '2026-11-18T00:00:00.000Z',
            postedAtApproximate: false,
            applyDeadline: '2026-12-28T00:00:00.000Z',
            applyUrl: `${full.url}/apply`,
        });
        expect(full.descriptionText).toBeTruthy();
        expect(full.descriptionText).not.toContain('<');
    });

    it('reads the country of another tenant', () => {
        const bah = site('https://bah.wd1.myworkdayjobs.com/BAH_Jobs');
        const item = mapListedJob(
            bah,
            {
                title: 'x',
                externalPath: '/job/a_R1',
                locationsText: null,
                postedOn: null,
                remoteType: null,
                reqId: null,
            },
            NOW,
        );
        expect(item.jobId).toBe('R1');
        const full = applyDetail(item, fixture('bah-job.json'));
        expect(full).toMatchObject({ country: 'United States of America', countryCode: 'US', jobId: 'R0249350' });
    });

    it('keeps the job unchanged when details are empty', () => {
        const item = mapListedJob(ref, listed[0], NOW);
        expect(applyDetail(item, { errorCode: 'S21' })).toEqual(item);
    });
});

describe('helpers', () => {
    it('reads Workday relative dates', () => {
        expect(workdayDaysAgo('Posted Today')).toBe(0);
        expect(workdayDaysAgo('Posted Yesterday')).toBe(1);
        expect(workdayDaysAgo('Posted 7 Days Ago')).toBe(7);
        expect(workdayDaysAgo('Posted 30+ Days Ago')).toBe(30);
        expect(workdayDaysAgo(null)).toBeNull();
    });

    it('filters by age', () => {
        expect(isRecent('2026-11-16T00:00:00.000Z', 7, NOW)).toBe(true);
        expect(isRecent('2026-11-01T00:00:00.000Z', 7, NOW)).toBe(false);
        expect(isRecent(null, 7, NOW)).toBe(true);
        expect(isRecent('2026-01-01T00:00:00.000Z', 0, NOW)).toBe(true);
    });

    it('normalizes workplace and time types', () => {
        expect(normalizeWorkplaceType('Office - Flexible')).toBe('hybrid');
        expect(normalizeWorkplaceType('Flex')).toBe('hybrid');
        expect(normalizeWorkplaceType('Remote')).toBe('remote');
        expect(normalizeWorkplaceType('On-site')).toBe('onsite');
        expect(workplaceTypeOf(null, ['US, CA, Remote'])).toBe('remote');
        expect(workplaceTypeOf(null, ['US, CA, Santa Clara'])).toBeNull();
        expect(normalizeTimeType('Full Time')).toBe('full-time');
        expect(normalizeTimeType('Part time')).toBe('part-time');
        expect(toIsoDate('2026-11-18')).toBe('2026-11-18T00:00:00.000Z');
    });

    it('turns HTML into text', () => {
        expect(htmlToText('<p>We build&nbsp;GPUs.</p><ul><li>One</li><li>Two</li></ul><p>Cut <b')).toBe(
            'We build GPUs.\n\n- One\n- Two\nCut',
        );
    });
});
