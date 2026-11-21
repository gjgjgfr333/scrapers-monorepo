# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This Actor lives in `actors/google-flights-scraper` of the scrapers monorepo; run every command below from this folder. Generic Apify Actor workflow, rules and the "ask first" list are in the root AGENTS.md and apply here:

@../../AGENTS.md

## Commands

```bash
apify run --purge                 # local run with storage/key_value_stores/default/INPUT.json, results in storage/datasets/default/
npm run build                     # tsc to dist/ (what CI and the Docker image run)
npm run lint                      # eslint with @apify/eslint-config; lint:fix to autofix
npm run format                    # prettier (4 spaces, single quotes, width 120); test/fixtures is ignored
npm test                          # vitest run
npx vitest run -t "parseFlights"  # single test by name
apify validate-schema             # after editing .actor/*.json
```

`--purge` clears only the default storages: the price history in `storage/key_value_stores/google-flights-history/` survives, so a second `apify run` exercises price tracking.

## Architecture

No browser and no official API. `CheerioCrawler` is used as an HTTP client; handlers read `body` as text, never `$`. Three request types (`src/routes.ts`, labels in `src/utils.ts`):

1. `FLIGHTS` — `GET /travel/flights?tfs=…&hl=&gl=&curr=` (2.5 MB HTML). The search is the `tfs` parameter: a protobuf built by `encodeTfs` (legs with date, airports and max stops, one `8:1` per adult, cabin in field 9, trip type in field 19: 1 round trip, 2 one way). Flights are in `AF_initDataCallback({key: 'ds:1', data: …})`: `data[2][0]` "best" flights, `data[3][0]` the others; `mapFlight` documents the indices. Flights without a price are dropped.
2. `CALENDAR` — `POST /_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetCalendarGraph` with `f.req` (about 9 KB for two months). The answer is `)]}'` plus length-prefixed JSON lines; one is `["wrb.fr", null, "<json>"]` with `[date, null, [[null, price], token], status]` per day. The range is split into chunks of `CALENDAR_CHUNK_DAYS`.
3. `RESOLVE` — only when the calendar keeps rejecting a chunk (`wrb.fr` with an `ErrorResponse`, `parseCalendarResponse` returns `'error'`). Google sometimes rejects plain airports too, so a rejection is first retried `CALENDAR_ERROR_RETRIES` times. City codes such as `NYC` must be sent as Freebase ids (`['/m/02_286', 4]`); the search page has them in `data[1][0]`. The handler re-enqueues only that chunk with `originLocation`/`destinationLocation` set and caches the ids per route (`resolvedPlaces`) for the other chunks.

Items go to the dataset only through `pushItems` in `src/charging.ts`: one `flight` or `calendar-day` event per item, budget checks serialized through a promise queue (concurrent handlers otherwise overspend the max cost), crawler aborted at the limit.

Price history (`src/history.ts`): named store `google-flights-history`, one record per mode, route and search options (`historyRecordKey`), `{ prices: { <date or date|flights|time>: price } }`. Loaded lazily, written by `persist()` at the end and on `aborting`/`migrating`. `onlyChanged` keeps only items with a previous price that differs; new items are recorded but not saved.

Things that are not obvious from a single file:

- robots.txt of google.com disallows `/travel/flights/search`, `/travel/flights/s/`, `/travel/flights/booking`, `/travel/search` and `/travel/clk`. Use only `/travel/flights?tfs=` and `/_/FlightsFrontendUi/…`; never Google Hotels.
- Zero items found is a failure (`Actor.fail`), but zero items saved with `onlyChanged` is a normal outcome.
- The word `captcha` appears on normal pages; do not use it to detect blocks. Blocks come as 429 or a redirect to `/sorry/`.
- The `CONSENT`/`SOCS` cookies skip the consent page Google shows to European IPs.
- Prices are totals for all adults and, for round trips, both directions.

Pure logic (route and date parsing, `encodeTfs`, `buildCalendarRequest`, `extractDataBlock`, `parseFlights`, `parseCalendarResponse`, `parseLocations`, history keys) is in `src/utils.ts` and is covered by `test/main.test.ts` on real responses in `test/fixtures/` (trimmed on 2026-11-21). The test checks parsed prices against the page's `aria-label="From 103 US dollars…"`. `test/` is outside `tsconfig.json`'s `include` and is ignored by eslint.

## Keeping things in sync

A new input option touches `Input`/`SearchOptions` in `src/types.ts`, the destructuring in `src/main.ts`, `.actor/input_schema.json`, the input table in `README.md`, and `historyRecordKey` if it changes prices. A new output field touches `FlightItem`/`CalendarDayItem`, the mapping in `src/utils.ts` or `src/routes.ts`, `.actor/dataset_schema.json`, and the README output example. Event names in `src/charging.ts` must match Apify Console (Publishing → Monetization) and the README pricing table.
