import type {
    ArchiveSort,
    PostComment,
    PostItem,
    PublicationInfo,
    RawComment,
    RawPost,
    RawPublication,
    SearchDateRange,
    SearchPage,
} from './types.js';

// The archive endpoint rejects limits above 25 with 400
export const ARCHIVE_PAGE_SIZE = 20;

export const LABELS = {
    ARCHIVE: 'ARCHIVE',
    POST: 'POST',
    COMMENTS: 'COMMENTS',
    SEARCH: 'SEARCH',
} as const;

/** Post search answers pages 0 to 100 (20 posts each) and rejects later ones with 400 */
export const MAX_SEARCH_PAGE = 100;

/**
 * Accepts a publication handle ("lenny"), a domain ("lenny.substack.com")
 * or any URL on the publication and returns its origin.
 */
export const normalizePublicationUrl = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const hasScheme = /^https?:\/\//i.test(trimmed);
    const isHandle = !hasScheme && !/[./]/.test(trimmed);
    let candidate = hasScheme ? trimmed : `https://${trimmed}`;
    if (isHandle) candidate = `https://${trimmed}.substack.com`;

    try {
        const { origin, hostname } = new URL(candidate);
        return hostname.includes('.') ? origin : null;
    } catch {
        return null;
    }
};

/**
 * Archive page URL. Substack paginates the archive with an opaque cursor (`nextCursor` of the previous page);
 * the old `offset` parameter is rejected with 400 since November 2026.
 */
export const buildArchiveUrl = (baseUrl: string, sort: ArchiveSort, cursor: string | null = null): string =>
    `${baseUrl}/api/v1/archive?sort=${sort}&limit=${ARCHIVE_PAGE_SIZE}${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    }`;

/** Archive page: an object with `posts` and `nextCursor`, or a plain array of posts in the older API */
export const parseArchivePage = (json: unknown): { posts: RawPost[]; nextCursor: string | null } | null => {
    if (Array.isArray(json)) return { posts: json as RawPost[], nextCursor: null };
    const page = json as { posts?: unknown; nextCursor?: unknown } | null | undefined;
    if (!page || !Array.isArray(page.posts)) return null;
    return {
        posts: page.posts as RawPost[],
        nextCursor: typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null,
    };
};

export const buildPostUrl = (baseUrl: string, slug: string): string =>
    `${baseUrl}/api/v1/posts/${encodeURIComponent(slug)}`;

export const buildCommentsUrl = (baseUrl: string, postId: number): string =>
    `${baseUrl}/api/v1/post/${postId}/comments?all_comments=true&sort=best_first`;

/**
 * Post search across all of Substack. Without `includePlatformResults` the endpoint answers an empty list;
 * `sort` is ignored, results come by relevance.
 */
export const buildSearchUrl = (query: string, page: number, dateRange: SearchDateRange): string =>
    `https://substack.com/api/v1/post/search?query=${encodeURIComponent(query)}&page=${page}&includePlatformResults=true${
        dateRange === 'any' ? '' : `&dateRange=${dateRange}`
    }`;

export const parseSearchPage = (json: unknown): SearchPage | null => {
    const page = json as { results?: unknown; publications?: unknown; more?: unknown } | null | undefined;
    if (!page || !Array.isArray(page.results)) return null;
    const publications = new Map<number, RawPublication>();
    for (const publication of Array.isArray(page.publications) ? (page.publications as RawPublication[]) : []) {
        if (typeof publication?.id === 'number') publications.set(publication.id, publication);
    }
    return { posts: page.results as RawPost[], publications, more: page.more === true };
};

/** "654" → 654, "7.9K+" → 7900, "1.2M+" → 1200000; the "+" values are lower bounds */
export const parseSubscriberCount = (value: string | null | undefined): number | null => {
    const match = /^\s*([\d.,]+)\s*([KM])?\+?\s*$/i.exec(value ?? '');
    if (!match) return null;
    const number = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(number)) return null;
    const multiplier = { K: 1_000, M: 1_000_000 }[match[2]?.toUpperCase() ?? ''] ?? 1;
    return Math.round(number * multiplier);
};

export const publicationInfo = (publication: RawPublication | undefined): PublicationInfo => ({
    name: publication?.name ?? null,
    subscriberCount: parseSubscriberCount(publication?.freeSubscriberCountOrderOfMagnitude),
    subscriberCountText: publication?.freeSubscriberCountOrderOfMagnitude ?? null,
});

/** Origin of the publication of a search result: its `base_url`, else the origin of the post URL */
export const searchResultPublicationUrl = (post: RawPost, publication: RawPublication | undefined): string | null => {
    for (const candidate of [publication?.base_url, post.canonical_url]) {
        if (!candidate) continue;
        try {
            return new URL(candidate).origin;
        } catch {
            // try the next one
        }
    }
    return null;
};

/** Archive posts carry the publication name only inside the author bylines */
export const archivePublicationInfo = (post: RawPost): PublicationInfo => {
    const users = (post.publishedBylines ?? []).flatMap((byline) => byline.publicationUsers ?? []);
    const own = users.find((user) => user.publication_id === post.publication_id) ?? users[0];
    return { name: own?.publication?.name ?? null, subscriberCount: null, subscriberCountText: null };
};

const EMPTY_PUBLICATION: PublicationInfo = { name: null, subscriberCount: null, subscriberCountText: null };

export const mapPost = (
    post: RawPost,
    publicationUrl: string,
    publication: PublicationInfo = EMPTY_PUBLICATION,
    searchQuery: string | null = null,
): PostItem => ({
    publicationUrl,
    publicationName: publication.name,
    subscriberCount: publication.subscriberCount,
    subscriberCountText: publication.subscriberCountText,
    searchQuery,
    postId: post.id,
    url: post.canonical_url ?? `${publicationUrl}/p/${post.slug}`,
    slug: post.slug,
    title: post.title ?? null,
    subtitle: post.subtitle ?? null,
    description: post.description ?? null,
    type: post.type ?? null,
    audience: post.audience ?? null,
    isPaid: Boolean(post.audience) && post.audience !== 'everyone',
    postDate: post.post_date ?? null,
    wordCount: post.wordcount ?? null,
    reactionCount: post.reaction_count ?? 0,
    commentCount: post.comment_count ?? 0,
    restackCount: post.restacks ?? 0,
    coverImage: post.cover_image ?? null,
    section: post.section_name ?? null,
    tags: (post.postTags ?? []).map((tag) => tag.name).filter((name): name is string => Boolean(name)),
    authors: (post.publishedBylines ?? []).map((byline) => ({
        name: byline.name ?? null,
        handle: byline.handle ?? null,
    })),
    podcastUrl: post.podcast_url ?? null,
    previewText: post.truncated_body_text ?? null,
    bodyHtml: post.body_html ?? null,
});

/**
 * Flattens the comment tree depth-first, keeping the parent reference, up to `limit` comments.
 */
export const flattenComments = (comments: RawComment[], limit: number): PostComment[] => {
    const result: PostComment[] = [];

    const visit = (comment: RawComment, parentId: number | null): void => {
        if (result.length >= limit) return;
        result.push({
            id: comment.id,
            parentId,
            body: comment.body ?? null,
            date: comment.date ?? null,
            authorName: comment.name ?? null,
            authorHandle: comment.handle ?? null,
            reactionCount: comment.reaction_count ?? 0,
        });
        for (const child of comment.children ?? []) visit(child, comment.id);
    };

    for (const comment of comments) visit(comment, null);
    return result;
};
