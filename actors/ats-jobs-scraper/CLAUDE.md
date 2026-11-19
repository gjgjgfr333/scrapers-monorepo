# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This Actor lives in `actors/ats-jobs-scraper` of the scrapers monorepo; run every command below from this folder. Generic Apify Actor workflow, rules and the "ask first" list are in the root AGENTS.md and apply here:

@../../AGENTS.md

## Commands

```bash
apify run --purge                 # local run with storage/key_value_stores/default/INPUT.json, results in storage/datasets/default/
npm run build                     # tsc to dist/ (what CI and the Docker image run)
npm run lint                      # eslint with @apify/eslint-config; lint:fix to autofix
npm run format                    # prettier (4 spaces, single quotes, width 120); format:check to verify
npm test                          # vitest run
npx vitest run -t "Workday"       # tests by name
apify validate-schema             # after editing .actor/*.json
```

CI (root `.github/workflows/test.yaml`) runs `npm ci`, `npm run build`, `npm run lint`, `npm test` on Node 24 for every folder in `actors/`.

## Architecture

The Actor reads the public JSON APIs behind company career pages of seven ATS: Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters and Workday. No HTML parsing: `CheerioCrawler` is used as an HTTP client, handlers read `json`.

- `src/utils.ts` — `parseCompanyInput` turns an input line (career page URL or `ats:slug`) into a `CompanyRef` with a dedup `key`; HTML/entity helpers; normalizers (employment type, workplace type, salary period, country code, dates); `matchesFilters`.
- `src/ats.ts` — everything ATS-specific: `buildListRequest`, `parseListPage` (maps raw jobs to `JobItem` and returns the next cursor), `needsDetailRequest`, `buildDetailRequest`, `applyDetail`. Pure, covered by `test/main.test.ts` on `test/fixtures/`.
- `src/routes.ts` — two labels. `LIST` reads a list page, applies the filters in partial mode, takes jobs up to `maxJobsPerCompany` / `maxItems`, then either pushes them or enqueues one `DETAIL` request per job, and enqueues the next list page. `DETAIL` completes the job and pushes it if it still matches the filters.
- `src/charging.ts` — `pushJobs` is the only way to the dataset: one `job` event per item, stops the crawler at `maxItems` or at the user's maximum run cost.
- `src/main.ts` — input, crawler, per-company `RUN_SUMMARY` in the key-value store, `Actor.fail` when nothing was saved.

| ATS             | List                                                                        | Pagination                         | Details (only with `includeDescription`)            |
| --------------- | --------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| Greenhouse      | `GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=`               | none                               | — (`content` is HTML-escaped)                       |
| Lever           | `GET api.lever.co/v0/postings/{slug}?mode=json&skip&limit=100`              | `skip` while a page is full        | —                                                   |
| Ashby           | `GET api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | none                               | —                                                   |
| Recruitee       | `GET {slug}.recruitee.com/api/offers/`                                      | none                               | —                                                   |
| Workable        | `POST apply.workable.com/api/v3/accounts/{slug}/jobs` `{token}`             | `nextPage` token, 10 per page      | `GET /api/v2/accounts/{slug}/jobs/{shortcode}`      |
| SmartRecruiters | `GET api.smartrecruiters.com/v1/companies/{id}/postings?limit=100&offset`   | `offset` < `totalFound`            | `GET …/postings/{id}`                               |
| Workday         | `POST {host}/wday/cxs/{tenant}/{site}/jobs` `{limit:20, offset}`            | `offset`, stop at min(total, 2000) | `GET {host}/wday/cxs/{tenant}/{site}{externalPath}` |

Things that are not obvious from a single file:

- Crawlee passes 4xx answers (except 401/403/429) to the handler. `LIST` treats 404 as "board not found"; `text/plain` is in `additionalMimeTypes` because Ashby and Workable answer a missing board with a `text/plain` 404.
- SmartRecruiters answers an unknown company with 200 and `totalFound: 0`, not 404, and company ids are case-sensitive: the summary then says `empty` with a hint.
- Workday: `limit` above 20 gives 400; `total` is reported only on the first page (later pages say 0), so it travels in the cursor; offsets at or past 2000 silently restart from the first page. `postedOn` is relative ("Posted 30+ Days Ago"); the exact `startDate` comes only from details.
- Filters run twice: in partial mode on the list (unknown values pass, so no detail request is wasted on a job that cannot match) and in full mode before pushing.
- Pages of one company are fetched one after another, so per-company counts in `crawler.useState` (`CrawlState`) are race-free; `reserved` caps detail requests at `maxItems` across companies.
- Greenhouse public API has no salary (`pay_transparency` returns empty ranges). Lever has `salaryRange` only for some companies. Ashby gives countries as names, mapped to ISO codes by a small table in `toCountryCode`.
- Detail handlers push in parallel, so `pushJobs` counts charges in flight (`chargesInFlight`); without it a $5 test limit saved 8–9 jobs and charged 6.
- Recruitee offers carry `mailbox_email` and application questions: not copied to the output.

## Keeping things in sync

A new input option touches four places: `Input`/`ScrapeOptions` in `src/types.ts`, the destructuring in `src/main.ts`, `.actor/input_schema.json`, and the input table in `README.md`. A new output field touches `JobItem`, `emptyItem` and the mappers in `src/ats.ts`, `.actor/dataset_schema.json`, and the README output example. A new ATS touches `ATS_NAMES`, `parseCompanyInput`, every function in `src/ats.ts`, a fixture and tests, and the ATS tables in README and here. Prices live in Apify Console and in the README pricing table; the event name `job` is in `src/charging.ts`.
