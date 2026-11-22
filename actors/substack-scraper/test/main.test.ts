import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
    archivePublicationInfo,
    buildArchiveUrl,
    buildSearchUrl,
    flattenComments,
    mapPost,
    normalizePublicationUrl,
    parseArchivePage,
    parseSearchPage,
    parseSubscriberCount,
    publicationInfo,
    searchResultPublicationUrl,
} from '../src/utils.js';

// A real post search answer for "climate policy" (2026-11-22), trimmed to four posts
const searchFixture = JSON.parse(readFileSync(new URL('fixtures/search-page.json', import.meta.url), 'utf8'));

describe('normalizePublicationUrl', () => {
    it('should turn a handle into a substack.com origin', () => {
        expect(normalizePublicationUrl('lenny')).toBe('https://lenny.substack.com');
    });

    it('should add the scheme to a bare domain', () => {
        expect(normalizePublicationUrl('lenny.substack.com')).toBe('https://lenny.substack.com');
    });

    it('should keep only the origin of a post URL', () => {
        expect(normalizePublicationUrl('https://www.lennysnewsletter.com/p/some-post?utm=1')).toBe(
            'https://www.lennysnewsletter.com',
        );
    });

    it('should reject empty and malformed values', () => {
        expect(normalizePublicationUrl('   ')).toBeNull();
        expect(normalizePublicationUrl('https://')).toBeNull();
    });
});

describe('buildArchiveUrl', () => {
    it('should build the first archive page without a cursor', () => {
        expect(buildArchiveUrl('https://lenny.substack.com', 'new')).toBe(
            'https://lenny.substack.com/api/v1/archive?sort=new&limit=20',
        );
    });

    it('should pass the encoded cursor of the next page', () => {
        expect(buildArchiveUrl('https://lenny.substack.com', 'top', 'eyJ4IjoxfQ==')).toBe(
            'https://lenny.substack.com/api/v1/archive?sort=top&limit=20&cursor=eyJ4IjoxfQ%3D%3D',
        );
    });
});

describe('parseArchivePage', () => {
    it('should read posts and the next cursor', () => {
        const page = parseArchivePage({ posts: [{ id: 1 }], nextCursor: 'abc' });
        expect(page?.posts).toHaveLength(1);
        expect(page?.nextCursor).toBe('abc');
    });

    it('should accept the older plain array response', () => {
        expect(parseArchivePage([{ id: 1 }])).toEqual({ posts: [{ id: 1 }], nextCursor: null });
    });

    it('should treat a missing or empty cursor as the last page', () => {
        expect(parseArchivePage({ posts: [], nextCursor: null })?.nextCursor).toBeNull();
        expect(parseArchivePage({ posts: [], nextCursor: '' })?.nextCursor).toBeNull();
    });

    it('should reject an error response', () => {
        expect(parseArchivePage({ errors: [{ param: 'offset' }] })).toBeNull();
        expect(parseArchivePage(undefined)).toBeNull();
    });
});

describe('mapPost', () => {
    it('should map a raw post and fill defaults', () => {
        const item = mapPost(
            {
                id: 1,
                slug: 'hello',
                title: 'Hello',
                audience: 'only_paid',
                postTags: [{ name: 'ai' }, { name: null }],
                publishedBylines: [{ name: 'Jane', handle: 'jane' }],
            },
            'https://example.substack.com',
        );

        expect(item.url).toBe('https://example.substack.com/p/hello');
        expect(item.isPaid).toBe(true);
        expect(item.tags).toEqual(['ai']);
        expect(item.authors).toEqual([{ name: 'Jane', handle: 'jane' }]);
        expect(item.reactionCount).toBe(0);
        expect(item.bodyHtml).toBeNull();
    });
});

describe('flattenComments', () => {
    it('should flatten nested comments and respect the limit', () => {
        const comments = [
            { id: 1, body: 'a', children: [{ id: 2, body: 'b', children: [{ id: 3, body: 'c' }] }] },
            { id: 4, body: 'd' },
        ];

        expect(flattenComments(comments, 10).map(({ id, parentId }) => [id, parentId])).toEqual([
            [1, null],
            [2, 1],
            [3, 2],
            [4, null],
        ]);
        expect(flattenComments(comments, 2)).toHaveLength(2);
    });
});

describe('buildSearchUrl', () => {
    it('should search across Substack with platform results', () => {
        expect(buildSearchUrl('climate policy', 0, 'any')).toBe(
            'https://substack.com/api/v1/post/search?query=climate%20policy&page=0&includePlatformResults=true',
        );
    });

    it('should add the date range unless it is any', () => {
        expect(buildSearchUrl('ai', 3, 'week')).toBe(
            'https://substack.com/api/v1/post/search?query=ai&page=3&includePlatformResults=true&dateRange=week',
        );
    });
});

describe('parseSubscriberCount', () => {
    it('should read exact and rounded counts', () => {
        expect(parseSubscriberCount('654')).toBe(654);
        expect(parseSubscriberCount('7.9K+')).toBe(7900);
        expect(parseSubscriberCount('158K+')).toBe(158000);
        expect(parseSubscriberCount('1.2M+')).toBe(1200000);
    });

    it('should return null for missing or unknown values', () => {
        expect(parseSubscriberCount(null)).toBeNull();
        expect(parseSubscriberCount(undefined)).toBeNull();
        expect(parseSubscriberCount('lots')).toBeNull();
    });
});

describe('parseSearchPage', () => {
    it('should read posts, publications and the more flag of a real answer', () => {
        const page = parseSearchPage(searchFixture);
        expect(page?.posts).toHaveLength(4);
        expect(page?.more).toBe(true);
        expect(page?.publications.size).toBe(4);
    });

    it('should reject an answer without results', () => {
        expect(parseSearchPage({ errors: [] })).toBeNull();
        expect(parseSearchPage(null)).toBeNull();
    });

    it('should map every result to its publication with the subscriber count', () => {
        const page = parseSearchPage(searchFixture)!;
        const items = page.posts.map((post) => {
            const publication = page.publications.get(post.publication_id!);
            return mapPost(post, searchResultPublicationUrl(post, publication)!, publicationInfo(publication), 'q');
        });

        expect(items[0]).toMatchObject({
            postId: 225970671,
            publicationUrl: 'https://www.jobsthatareleft.org',
            url: 'https://www.jobsthatareleft.org/p/climate-cabinet-senior-fellow-texas',
            publicationName: 'Jobs That Are Left from GAIN Power',
            subscriberCount: 7900,
            subscriberCountText: '7.9K+',
            searchQuery: 'q',
            bodyHtml: null,
        });
        expect(items.map((item) => item.subscriberCount)).toEqual([7900, 654, null, 158000]);
        for (const item of items) expect(item.url.startsWith(item.publicationUrl)).toBe(true);
    });
});

describe('searchResultPublicationUrl', () => {
    it('should fall back to the origin of the post URL', () => {
        expect(
            searchResultPublicationUrl({ id: 1, slug: 's', canonical_url: 'https://x.substack.com/p/s' }, undefined),
        ).toBe('https://x.substack.com');
        expect(searchResultPublicationUrl({ id: 1, slug: 's' }, undefined)).toBeNull();
    });
});

describe('archivePublicationInfo', () => {
    it('should take the publication name from the bylines', () => {
        const info = archivePublicationInfo({
            id: 1,
            slug: 's',
            publication_id: 10845,
            publishedBylines: [
                {
                    name: 'Lenny',
                    publicationUsers: [
                        { publication_id: 1, publication: { name: 'Other' } },
                        { publication_id: 10845, publication: { name: "Lenny's Newsletter" } },
                    ],
                },
            ],
        });
        expect(info).toEqual({ name: "Lenny's Newsletter", subscriberCount: null, subscriberCountText: null });
    });
});
