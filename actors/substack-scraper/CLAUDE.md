# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This Actor lives in `actors/substack-scraper` of the scrapers monorepo; run every command below from this folder. Generic Apify Actor workflow, rules and the "ask first" list are in the root AGENTS.md and apply here:

@../../AGENTS.md

## Commands

```bash
apify run --purge                 # local run with storage/key_value_stores/default/INPUT.json, results in storage/datasets/default/
npm run build                     # tsc to dist/ (what CI and the Docker image run)
npm run lint                      # eslint with @apify/eslint-config; lint:fix to autofix
npm run format                    # prettier (4 spaces, single quotes, width 120); format:check to verify
npm test                          # vitest run
npx vitest run -t "mapPost"       # single test by name
apify validate-schema             # after editing .actor/*.json
```

CI (root `.github/workflows/test.yaml`) runs `npm ci`, `npm run build`, `npm run lint`, `npm test` on Node 24 for every folder in `actors/`.

If vitest fails at startup with `Cannot find native binding` (rolldown), it is the npm optional-dependencies bug: remove `node_modules` and `package-lock.json` and reinstall. This is a package install, so ask first.

## Architecture

The Actor scrapes Substack through its unauthenticated JSON API, not HTML. `CheerioCrawler` is used only as an HTTP crawler: `additionalMimeTypes: ['application/json']` is set and handlers read `json`, never `$`.

One publication goes through up to three request types, chained via `request.userData` (`src/routes.ts`, labels in `src/utils.ts`):

1. `ARCHIVE` — `/api/v1/archive?sort=&limit=20&cursor=`. Answers `{ posts, nextCursor }` (older API: a plain array, `parseArchivePage` reads both). Lists posts without bodies, maps them to `PostItem`, and enqueues the page of `nextCursor` until `maxPostsPerPublication` is reached, the page is empty or there is no cursor.
2. `POST` — `/api/v1/posts/<slug>`, only when `includeBody` is on. Adds `bodyHtml`.
3. `COMMENTS` — `/api/v1/post/<id>/comments`, only when `includeComments` is on. Adds the flattened comment tree.

A search query goes through `SEARCH` — `https://substack.com/api/v1/post/search?query=&page=&includePlatformResults=true[&dateRange=day|week|month|year]`. Without `includePlatformResults` it answers an empty list; `sort` is ignored (relevance only); pages 0–100 work, 101+ answer 400. The answer has `results` (posts without bodies), `publications` (one object per result, matched by `publication_id`, with `base_url`, `name` and `freeSubscriberCountOrderOfMagnitude`: "654", "7.9K+") and `more`. Pages of one query are chained like archive pages; results then go through the same `POST`/`COMMENTS` stages, with the publication's `base_url` as `apiBaseUrl`.

The partially built `PostItem` travels in `userData.item` and is pushed to the dataset by whichever stage is last for the current options. `failedRequestHandler` in `src/main.ts` pushes the item anyway when a `POST` or `COMMENTS` request fails, so a post is never lost because of its details.

Every item goes to the dataset through `pushPosts` in `src/charging.ts`, never through the handler's own `pushData`. It charges the pay-per-event events (`post` or `post-with-content` depending on whether `bodyHtml` was loaded, plus `comment` per comment) and aborts the crawler when the user's maximum run cost is reached. The event names must match the ones configured in Apify Console (Publication → Monetization), and the prices live there and in the README pricing table, not in code. To exercise charging locally, run the built Actor with `ACTOR_TEST_PAY_PER_EVENT=1 ACTOR_MAX_TOTAL_CHARGE_USD=<n> ACTOR_USE_CHARGING_LOG_DATASET=1`; every event then costs $1 and the charges land in `storage/datasets/charging_log/`.

Things that are not obvious from a single file:

- The per-publication and per-query post tallies live in `crawler.useState` (`CrawlState`), keyed by the normalized publication URL or the query, so they survive migrations. Pages of one publication or query are fetched sequentially, which keeps the tallies race-free. `searchPostIds` saves a post found by several queries once.
- substack.com answers bursts of search requests with 429 after about a dozen. `waitForSearchSlot` (pre-navigation hook) spaces searches 1.5 s apart across all queries, and `errorHandler` waits 10, 20, 40, 60 s before retrying a 429; a 3-query run of 450 posts finished without failures. Other endpoints are on the publications' own domains and are not throttled.
- Subscriber counts exist only in search answers; the archive has none, so they are `null` for `publications` posts. The archive's publication name is read from the bylines (`publishedBylines[].publicationUsers[].publication.name`), once per page because guest posts may lack it.
- Zero posts found (and the cost limit not reached) fails the run with `Actor.fail`.
- Publications on `*.substack.com` may redirect to a custom domain. Follow-up requests use the origin of `request.loadedUrl` (`apiBaseUrl`), while `publicationUrl` stays the normalized input value.
- `ARCHIVE_PAGE_SIZE` is 20: since November 2026 the archive rejects `limit` above 25 and the `offset` parameter with 400 (the run then ended "successfully" with zero posts).
- A missing publication answers with `application/octet-stream`, which Crawlee rejects before the handler runs; it surfaces in `failedRequestHandler`, not in the `ARCHIVE` handler.
- Paid posts (`audience !== 'everyone'`) return only the public part of the body, and their comments come back empty.

Pure logic (URL normalization, URL builders, `parseArchivePage`, `parseSearchPage`, `parseSubscriberCount`, `mapPost`, `flattenComments`) is in `src/utils.ts` and is what `test/main.test.ts` covers; tests do not hit the network. `test/fixtures/search-page.json` is a real search answer trimmed on 2026-11-22 (ignored by prettier). `test/` is outside `tsconfig.json`'s `include` and is ignored by eslint.

## Keeping things in sync

A new input option touches four places: `Input`/`ScrapeOptions` in `src/types.ts`, the destructuring in `src/main.ts`, `.actor/input_schema.json`, and the input table in `README.md`. A new output field touches `PostItem`, `mapPost`, `.actor/dataset_schema.json`, and the README output example.
