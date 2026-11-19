# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This Actor lives in `actors/shopify-app-store-scraper` of the scrapers monorepo; run every command below from this folder. Generic Apify Actor workflow, rules and the "ask first" list are in the root AGENTS.md and apply here:

@../../AGENTS.md

## Commands

```bash
apify run --purge                 # local run with storage/key_value_stores/default/INPUT.json, results in storage/datasets/default/
npm run build                     # tsc to dist/ (what CI and the Docker image run)
npm run lint                      # eslint with @apify/eslint-config; lint:fix to autofix
npm run format                    # prettier (4 spaces, single quotes, width 120); format:check to verify
npm test                          # vitest run
npx vitest run -t "parseAppPage"  # tests by name
apify validate-schema             # after editing .actor/*.json
```

CI (root `.github/workflows/test.yaml`) runs `npm ci`, `npm run build`, `npm run lint`, `npm test` on Node 24 for every folder in `actors/`.

## Architecture

The Actor parses the server-rendered HTML of `apps.shopify.com` with `CheerioCrawler` (no browser, no API). Four labels in `src/routes.ts`:

- `APP` — `/<handle>`. Parsed by `parseAppPage`; pushes the `app` item and enqueues reviews page 1.
- `REVIEWS` — `/<handle>/reviews?sort_by=newest&ratings[]=…&page=N`, 10 reviews per page. Pushes reviews up to `maxReviewsPerApp`, enqueues the next page while `a[rel=next]` exists.
- `CATEGORY` — `/categories/<slug>`. A leaf category redirects to `/categories/<slug>/all` (24 apps per page, `?page=N`); a parent category answers a page of sections, and the handler enqueues every subcategory whose slug starts with `<slug>-`.
- `SITEMAP` — `/sitemap_apps_en.xml` (about 30,000 handles, 5 MB) for `allApps`.

Files:

- `src/utils.ts` — input parsing (`parseAppInput`, `parseCategoryInput`), URL builders, text/number/date helpers, `parseSitemapHandles`.
- `src/appstore.ts` — `parseAppPage`, `parsePlans`, `parseReviewsPage`, `parseCategoryPage`. Pure, covered by `test/main.test.ts` on `test/fixtures/` (real pages with SVG, scripts and classes stripped).
- `src/routes.ts` — handlers, `reserveApps` (dedup by handle, `maxApps` across all sources), 429 backoff.
- `src/charging.ts` — `pushItem`, the only way to the dataset: `app` or `review` event; stops the crawler at the user's maximum run cost.
- `src/main.ts` — input, crawler, `RUN_SUMMARY`, `Actor.fail` when no app was saved.

Things that are not obvious from a single file:

- Selectors rely on section ids (`#adp-hero`, `#adp-details-section`, `#adp-pricing`, `#adp-reviews`, `#adp-developer`), `data-*` attributes (`data-merchant-review`, `data-review-content-id`, `data-test-id="name|price-currency|yearly-price|additional-charges|features"`, `data-app-card-handle-value`) and text labels ("Languages", "Works with", "Categories", "Launched"). Tailwind classes change and are never used. The "Built for Shopify" badge is searched only inside `#adp-hero`, because similar-app cards carry it too.
- **429 comes as `text/plain`.** Crawlee rejects unknown content types before the handler, so `text/plain` is in `additionalMimeTypes`; without it every 429 became a non-retried failure. 429 is also out of `blockedStatusCodes`, the handler sleeps 2ⁿ s (max 60 s) and throws. About 2 requests/s is the limit (`maxRequestsPerMinute: 120`, concurrency 5).
- `robots.txt` disallows `*q=*`, so there is no keyword search mode.
- Past the last reviews page the App Store answers 200 with no reviews, not 404. Unknown apps and categories answer 404.
- Plan prices are in the visitor's currency (EUR from Europe, USD on Apify). `#adp-pricing [data-testid="exchange-rate-disclaimer"]` states the rate ("1 EUR = 1.0994 USD"), used for `priceUsd`.
- `ratings[]` filters on the server; `expectedReviews` skips the reviews request when the distribution says there are none for the selected stars.
- `reviewsSince` stops paging once a whole page is older (edited reviews carry the edit date, so one older review does not end the scan).
- Review permalinks are `/reviews/<id>`, not `/<handle>/reviews/<id>` (404).
- Both events share one budget, so `pushItem` keeps the cost of in-flight charges in dollars. Locally an event has no price before its first charge and the SDK charges $1; the code assumes that.
- `cheerio` is a direct dependency at the version `@crawlee/cheerio` uses. Its ESM typings do not match Crawlee's CJS ones, so `src/appstore.ts` takes the `$` type from `CheerioCrawlingContext`.
- The named `charging_log` dataset is not purged by `apify run --purge`; delete `storage/datasets/charging_log` between charging tests.

## Keeping things in sync

A new input option touches four places: `Input`/`ScrapeOptions` in `src/types.ts`, the destructuring in `src/main.ts`, `.actor/input_schema.json`, and the input table in `README.md`. A new output field touches `AppItem`/`ReviewItem`, the parser in `src/appstore.ts`, `.actor/dataset_schema.json`, and the README output example. Prices live in Apify Console and the README pricing table; the event names `app` and `review` are in `src/charging.ts`.
