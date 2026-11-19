# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This Actor lives in `actors/agoda-scraper` of the scrapers monorepo; run every command below from this folder. Generic Apify Actor workflow, rules and the "ask first" list are in the root AGENTS.md and apply here:

@../../AGENTS.md

## Commands

```bash
apify run --purge                 # local run with storage/key_value_stores/default/INPUT.json, results in storage/datasets/default/
npm run build                     # tsc to dist/ (what CI and the Docker image run)
npm run lint                      # eslint with @apify/eslint-config; lint:fix to autofix
npm run format                    # prettier (4 spaces, single quotes, width 120); format:check to verify
npm test                          # vitest run
npx vitest run -t "mapHotel"      # single test by name
apify validate-schema             # after editing .actor/*.json
```

CI (root `.github/workflows/test.yaml`) runs `npm ci`, `npm run build`, `npm run lint`, `npm test` on Node 24 for every folder in `actors/`.

## Architecture

The Actor reads Agoda's unauthenticated JSON endpoints that the hotel page itself calls. `CheerioCrawler` is used as an HTTP crawler (`additionalMimeTypes: ['application/json']`); only the `PAGE` handler reads HTML, as a plain string.

Three request types (`src/routes.ts`, labels in `src/utils.ts`):

1. `PAGE` — the hotel page from `startUrls`, only to find the numeric hotel id (`propertyId:<id>` in the inline script). A missing hotel redirects to `/pagenotfound.html`. URLs with `hotel_id`/`hid` parameters and `hotelIds` skip this step.
2. `DETAILS` — `GET /api/cronos/property/BelowFoldParams/GetSecondaryData?hotel_id=<id>`. One JSON with name, address, star rating, `mapParams.latlng`, `reviews.demographic.grades` (category scores) and `scoreDistribution`, description, photos. An unknown id still answers 200, with `hotelInfo.name` null — `mapHotel` returns null then. Pushes the `hotel` item and starts the reviews.
3. `REVIEWS` — `POST /api/cronos/property/review/ReviewComments`, body from `buildReviewsPayload` (copied from what the site sends: `page`, not `pageNo`). Every page returns up to `pageSize` reviews **per source** (Agoda `providerId` 332 and Booking.com 3038) regardless of `providerIds`, so source filtering is done on our side. `providerList[].totalIndex` is the number of reviews per source. Pages of one hotel are requested one after another (`forefront`), which keeps the per-hotel state race-free; when the hotel is done, the free `hotelSummary` item is pushed.

Every item goes to the dataset through `src/charging.ts` (`pushHotel`, `pushReviews`, `pushSummary`), which charges the pay-per-event events `hotel` and `review` and aborts the crawler when the user's maximum run cost is reached. The event names must match Apify Console (Publication → Monetization); prices live there and in the README pricing table. Local charging test: `ACTOR_TEST_PAY_PER_EVENT=1 ACTOR_MAX_TOTAL_CHARGE_USD=<n> ACTOR_USE_CHARGING_LOG_DATASET=1` (every event costs $1, charges in `storage/datasets/charging_log/`).

Things that are not obvious from a single file:

- **The review API is unreliable, by design of Agoda.** Booking.com reviews come back in a shifting order, with repeats and empty pages in the middle; the same request twice gives different pages. Hence: deduplication by `reviewId` in `HotelReviewState.seen`, paging up to `maxReviewPages` (enough pages for the largest wanted source, at most `MAX_REVIEW_PAGE` = 100 — after page 100 the API answers empty), and stopping after `MAX_PAGES_WITHOUT_NEW_REVIEWS` (10) pages without a new review. With 6 a Booking.com walk stopped at 449 of ~1,050 reachable reviews.
- **Throttling looks like success.** After roughly a thousand requests from one IP in an hour, Agoda answers every page with page 1 for a few minutes (seen November 2026; the site in a browser did the same). The `REVIEWS` handler compares the first ids of the wanted sources (`reviewPageKey`) with page 1; on a match it retires the session, waits `15 s × (retry + 1)` and throws `STUCK_PAGING_ERROR`, so Crawlee retries. If retries run out, `failedRequestHandler` records the hotel in `hotelsThrottled`, saves its summary and the run's status message says reviews are incomplete. The key must ignore other sources: Agoda reviews kept paging while the Booking.com part was stuck.
- Review dates are local dates with a `+07:00` offset; `datePart` keeps `YYYY-MM-DD` instead of converting to UTC, which would shift them by a day.
- Booking.com reviews have no free text (`reviewComments` empty) and no stay details; `text` falls back to the liked and disliked parts. Field fill rates in a mixed run are therefore about 50 % for the stay fields — expected.
- All items share `hotelId`, `hotelName`, `hotelUrl` so one dataset view (`overview`) works for every `type`; dataset views cannot filter rows.
- `reviewsCount` on the hotel (e.g. 247) counts ratings without text too; `totalIndex` (e.g. 93) is what can be listed.
- The run fails (`Actor.fail`) when no hotel was saved, unless the cost limit stopped it.

Pure logic (URL and id parsing, payload, `mapHotel`, `mapReview`, `selectReviews`, paging decisions, summary) is in `src/utils.ts` and covered by `test/main.test.ts` with fixtures in `test/fixtures/` (trimmed real responses from November 2026); tests do not hit the network.

## Keeping things in sync

A new input option touches four places: `Input`/`ScrapeOptions` in `src/types.ts`, the destructuring in `src/main.ts`, `.actor/input_schema.json`, and the input table in `README.md`. A new output field touches the item type in `src/types.ts`, `mapHotel` or `mapReview`, `.actor/dataset_schema.json`, and the README output example.
