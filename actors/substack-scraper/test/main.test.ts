import { describe, expect, it } from 'vitest';

import { buildArchiveUrl, flattenComments, mapPost, normalizePublicationUrl, parseArchivePage } from '../src/utils.js';

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
