# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This Actor lives in `actors/workday-jobs-scraper` of the scrapers monorepo; run every command below from this folder. Generic Apify Actor workflow, rules and the "ask first" list are in the root AGENTS.md and apply here:

@../../AGENTS.md

## Commands

```bash
apify run --purge                 # local run with storage/key_value_stores/default/INPUT.json, results in storage/datasets/default/
npm run build                     # tsc to dist/ (what CI and the Docker image run)
npm run lint                      # eslint with @apify/eslint-config; lint:fix to autofix
npm run format                    # prettier (4 spaces, single quotes, width 120); format:check to verify
npm test                          # vitest run
npx vitest run -t "planSplit"     # tests by name
apify validate-schema             # after editing .actor/*.json
```

CI (root `.github/workflows/test.yaml`) runs `npm ci`, `npm run build`, `npm run lint`, `npm test` on Node 24 for every folder in `actors/`.

## Architecture

The Actor reads the unauthenticated JSON API (CXS) behind Workday career sites; `CheerioCrawler` is used as an HTTP client and handlers read `json`.

- Search: `POST https://{tenant}.wdN.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` with `{ appliedFacets, limit: 20, offset, searchText }`. Answers `{ total, jobPostings[], facets[] }`.
- Job: `GET …/wday/cxs/{tenant}/{site}{externalPath}`. Answers `{ jobPostingInfo, hiringOrganization }`.

Files:

- `src/utils.ts` — `parseSiteUrl` (URL → `SiteRef`; query parameters whose values are 32-hex Workday ids become `appliedFacets`, `q` becomes the search text), HTML helpers, normalizers, `workdayDaysAgo`, `isRecent`.
- `src/workday.ts` — request builders, `parseListPage`, `flattenFacets`, `estimateTotal`, `packValues`, `planSplit`, `mapListedJob`, `applyDetail`. Pure, covered by `test/main.test.ts` on `test/fixtures/`.
- `src/routes.ts` — `LIST` (one search page) and `DETAIL` (one job). On the first page of a search with `total >= 2000`, `LIST` asks `planSplit` and enqueues one search per value group instead of reading the page. Otherwise it dedupes jobs by `externalPath` in `state.seen`, applies the date filter and limits, then pushes jobs or enqueues `DETAIL`, and enqueues the next page.
- `src/charging.ts` — `pushJobs`, the only way to the dataset: one `job` event per item; stops at `maxItems` or the user's maximum run cost.
- `src/main.ts` — input, crawler, `RUN_SUMMARY` per site, `Actor.fail` when nothing was saved.

Things that are not obvious from a single file:

- The 2000 cap: `total` never exceeds 2000, and offsets ≥ 2000 silently start over from the first page. `total` is reported only on a search's first page (later pages say 0), so it travels in `userData.total`.
- Splitting: facet values of one parameter combine with OR (Engineering + Sales → 1651 + 311 = 1962). `estimateTotal` takes the sum of `jobFamilyGroup` / `timeType` / `workerSubType` counts as the real size (each job has one value there). `planSplit` only uses facets whose sum covers that estimate (on Pfizer one job has no category, so `jobFamilyGroup` is skipped there), prefers the smallest sum with every value under 2000, and `packValues` bins values first-fit under 2000. A group that is still ≥ 2000 is split again by another facet on its own first page.
- Location facets overlap (a job in two places is counted twice), hence the dedup by `externalPath`.
- Without search text Workday lists newest first, so the date filter stops paging once a whole page is older. With search text it sorts by relevance and pages are not stable (duplicates across pages, a few jobs never shown); every page is read and duplicates are dropped.
- Workday answers 429 to bursts. 429 is removed from `blockedStatusCodes` so it reaches the handler, which sleeps (2ⁿ s) and throws to retry; `maxRequestsPerMinute: 300` keeps the pace.
- Unknown tenant answers 422, unknown site 404, an invalid facet id 400 (reported as a filter problem when it is the URL's own filter).
- `limit` above 20 answers 400.
- Parallel `DETAIL` handlers push at the same time, so `pushJobs` counts charges in flight; without it a $5 test limit let 6 events through.

## Keeping things in sync

A new input option touches four places: `Input`/`ScrapeOptions` in `src/types.ts`, the destructuring in `src/main.ts`, `.actor/input_schema.json`, and the input table in `README.md`. A new output field touches `JobItem`, `mapListedJob`/`applyDetail` in `src/workday.ts`, `.actor/dataset_schema.json`, and the README output example. Prices live in Apify Console and the README pricing table; the event name `job` is in `src/charging.ts`.
