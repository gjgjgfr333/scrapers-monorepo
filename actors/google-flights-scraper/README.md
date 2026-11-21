# Google Flights Scraper & API: Prices, Calendar & Tracking

## What does Google Flights Scraper do?

Google Flights Scraper extracts flight prices from [Google Flights](https://www.google.com/travel/flights) for a list of routes and dates. It has two modes:

- **Flights on each date:** every flight Google shows for a route and departure date, with price, airlines, flight numbers, stops and layovers, departure and arrival times, duration, aircraft, legroom and CO₂ emissions.
- **Price calendar:** the cheapest price for **every departure date** of a range, up to about 11 months ahead, one row per route and date. That is the table behind a price chart, and it costs a fraction of a full search.

Both modes can **track price changes between runs**: schedule the Actor and every item gets `previousPrice`, `priceChange` and `priceChangePct`, or turn on **Only changed prices** to receive (and pay for) only the dates and flights whose price moved.

- **One-way and round trips**, 1 to 9 adults, economy, premium economy, business and first.
- **Airport and city codes:** `LHR-CDG`, or `NYC-LON` for all airports of both cities.
- **Prices you can check on the site:** currency, country and language are explicit inputs, and every item links to the same search on Google Flights.
- **No login, cookies or API key.** No browser either, so runs are fast and cheap.
- **You pay per result**, not for run time, and you can cap the cost of every run.

Results can be downloaded as JSON, CSV, Excel or HTML, or read through the Apify API.

## What can you use Google Flights data for?

- **Fare alerts and "cheap flights" newsletters.** Run the price calendar daily for your routes and send the dates that got cheaper.
- **Travel startups and aggregators.** Feed price charts, "best time to fly" widgets and route pages.
- **Corporate travel management.** Watch the routes your team flies and book when prices drop.
- **Airline and airport analytics.** See who flies a route, how often, with how many stops and at what price.
- **Sustainability reporting.** Compare CO₂ emissions of flights on a route against the typical value.

## What data can you extract from Google Flights?

| Data           | Fields                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search         | `type`, `route`, `origin`, `destination`, `departureDate` / `date`, `returnDate`, `currency`, `cabinClass`, `adults`, `googleFlightsUrl`                  |
| Price          | `price` (flights), `minPrice` (calendar)                                                                                                                  |
| Flight         | `airlines`, `flightNumbers`, `departureAirport`, `arrivalAirport`, `departureTime`, `arrivalDate`, `arrivalTime`, `durationMinutes`, `aircraft`, `isBest` |
| Connections    | `stops`, `layovers` (airport, city, minutes), `segments` (each leg with flight number, airports, times, aircraft, legroom)                                |
| Emissions      | `co2Kg`, `typicalCo2Kg`, `co2VsTypicalPct`                                                                                                                |
| Price tracking | `previousPrice`, `priceChange`, `priceChangePct`                                                                                                          |

`type` is `flight` in the Flights mode and `calendarDay` in the Price calendar mode. The **Flights** and **Price calendar** views of the Output tab show them as tables.

## How to scrape Google Flights

1. Open the Actor in Apify Console and go to the **Input** tab.
2. Enter routes as pairs of IATA codes, one per line: `LHR-CDG`, `JFK-LAX`, `NYC-LON`.
3. Pick the mode, a departure date (a date like `2026-12-21` or relative, like `30 days`) and, for a range, the last departure date.
4. For round trips, set **Return after (days)**. Choose passengers, cabin, stops, currency and country.
5. Click **Start**. When the run finishes, open the **Output** tab and export the data in the format you need.

**Monitoring:** turn on **Track price changes**, save the input as a task and add a schedule (for example, daily). Relative dates such as `7 days` to `90 days` keep the window moving with the calendar.

## How much does it cost to scrape Google Flights?

The Actor uses pay-per-event pricing. You pay only for the items that land in the dataset:

| Event               | Charged for                                              | Price    | Per 1,000 |
| ------------------- | -------------------------------------------------------- | -------- | --------- |
| `flight`            | One flight with its price and details                    | $0.0005  | $0.50     |
| `calendar-day`      | The cheapest price of one route on one date              | $0.0003  | $0.30     |
| `apify-actor-start` | Each run, per GB of memory ($0.0002 at the default 4 GB) | $0.00005 | —         |

These are Free plan prices; on paid Apify plans (Starter, Scale, Business) they are 10–30 % lower. Flights without a price ("Price unavailable" on the site) are not saved and not charged. With **Only changed prices** you pay only for the items that are saved.

Examples:

| Run                                                  | Cost                |
| ---------------------------------------------------- | ------------------- |
| 2 routes, all flights on one date (about 50 flights) | about $0.03         |
| Price calendar of 1 route for 90 days                | about $0.03         |
| Price calendar of 20 routes for 90 days, daily       | about $0.54 a day   |
| 10 routes, 7 dates, up to 50 flights each            | about $1.75 at most |

To keep a run within a budget, set the maximum cost per run in the run options. When the limit is reached, the Actor stops and keeps everything it has already saved.

## Input

| Field                 | Type    | Default            | Description                                                                                 |
| --------------------- | ------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `routes`              | array   | —                  | Pairs of IATA codes `ORIGIN-DEST`: airports (`LHR-CDG`) or city codes (`NYC-LON`).          |
| `mode`                | string  | `flights`          | `flights`: every flight on each date. `calendar`: the cheapest price on each date.          |
| `departureDate`       | string  | 30 days from today | Departure date or first date of the range: `2026-12-21` or relative (`30 days`, `2 weeks`). |
| `departureDateTo`     | string  | `""`               | Last departure date of the range. Empty means one date.                                     |
| `returnAfterDays`     | integer | `0`                | `0` for one-way. `N` for a round trip returning N days later; prices are round-trip totals. |
| `maxFlightsPerSearch` | integer | `50`               | Flights mode: maximum flights per route and date, best first. `0` means all.                |
| `adults`              | integer | `1`                | Adult passengers, 1–9. Prices are totals for all passengers.                                |
| `cabinClass`          | string  | `economy`          | `economy`, `premium_economy`, `business` or `first`.                                        |
| `maxStops`            | integer | `-1`               | `-1` any, `0` nonstop only, `1` or `2` at most one or two stops.                            |
| `currency`            | string  | `USD`              | Currency of prices (ISO code).                                                              |
| `country`             | string  | `US`               | Country Google prices for (two-letter code). Fares differ by point of sale.                 |
| `language`            | string  | `en`               | Language of airport and airline names.                                                      |
| `trackPriceChanges`   | boolean | `false`            | Compare with the previous run and add `previousPrice`, `priceChange`, `priceChangePct`.     |
| `onlyChanged`         | boolean | `false`            | Save only items whose price changed since the previous run.                                 |
| `proxyConfiguration`  | object  | no proxy           | Proxy settings.                                                                             |

Example: a 90-day price calendar for round trips of one week, in euros, for German point of sale:

```json
{
    "routes": ["FRA-JFK", "MUC-LHR"],
    "mode": "calendar",
    "departureDate": "7 days",
    "departureDateTo": "97 days",
    "returnAfterDays": 7,
    "currency": "EUR",
    "country": "DE",
    "trackPriceChanges": true
}
```

## Output

A flight (Flights mode):

```json
{
    "type": "flight",
    "route": "LHR-CDG",
    "origin": "LHR",
    "destination": "CDG",
    "departureAirport": "LHR",
    "arrivalAirport": "CDG",
    "departureDate": "2026-12-21",
    "departureTime": "10:00",
    "arrivalDate": "2026-12-21",
    "arrivalTime": "19:10",
    "durationMinutes": 490,
    "price": 213,
    "airlines": ["KLM"],
    "flightNumbers": ["KL1004", "KL1411"],
    "stops": 1,
    "layovers": [
        { "airport": "AMS", "airportName": "Amsterdam Airport Schiphol", "city": "Amsterdam", "durationMinutes": 330 }
    ],
    "aircraft": ["Airbus A321neo"],
    "segments": [
        {
            "flightNumber": "KL1004",
            "airline": "KLM",
            "from": "LHR",
            "fromName": "Heathrow Airport",
            "to": "AMS",
            "toName": "Amsterdam Airport Schiphol",
            "departureDate": "2026-12-21",
            "departureTime": "10:00",
            "arrivalDate": "2026-12-21",
            "arrivalTime": "12:25",
            "durationMinutes": 85,
            "aircraft": "Airbus A321neo",
            "legroom": "29 in"
        }
    ],
    "co2Kg": 82,
    "typicalCo2Kg": 53,
    "co2VsTypicalPct": 55,
    "isBest": false,
    "returnDate": null,
    "currency": "USD",
    "cabinClass": "economy",
    "adults": 1,
    "googleFlightsUrl": "https://www.google.com/travel/flights?tfs=CBwQAhoeEgoyMDI2LTEyLTIxagcIARIDTEhScgcIARIDQ0RHQAFIAXABggELCP___________wGYAQI&hl=en&gl=US&curr=USD",
    "previousPrice": null,
    "priceChange": null,
    "priceChangePct": null,
    "scrapedAt": "2026-11-21T18:01:46.322Z"
}
```

A day of the price calendar:

```json
{
    "type": "calendarDay",
    "route": "LHR-CDG",
    "origin": "LHR",
    "destination": "CDG",
    "date": "2026-12-21",
    "returnDate": null,
    "minPrice": 103,
    "currency": "USD",
    "cabinClass": "economy",
    "adults": 1,
    "googleFlightsUrl": "https://www.google.com/travel/flights?tfs=CBwQAhoeEgoyMDI2LTEyLTIxagcIARIDTEhScgcIARIDQ0RHQAFIAXABggELCP___________wGYAQI&hl=en&gl=US&curr=USD",
    "previousPrice": null,
    "priceChange": null,
    "priceChangePct": null,
    "scrapedAt": "2026-11-21T18:01:49.879Z"
}
```

With price tracking on, the second and later runs fill `previousPrice`, `priceChange` (new minus previous) and `priceChangePct`.

## Tips

- **Use the price calendar to find dates, then flights to see the options.** A 90-day calendar takes two requests; searching every date one by one takes 90.
- **Set the country of the traveller.** Google prices the same flight differently by point of sale. `country` and `currency` are sent with every request.
- **Prices are totals.** For several adults and round trips the price is the total for all passengers and both directions, as on the site.
- **History is per route and options.** Changing the cabin, passengers, stops, trip length, currency or country starts a new history. It lives in your named key-value store `google-flights-history`; delete it there to start over.

## Integrations and API

Use the Actor from your code through the [Apify API](https://docs.apify.com/api/v2), the [JavaScript](https://docs.apify.com/api/client/js) or [Python](https://docs.apify.com/api/client/python) client, or connect results to Make, Zapier, Google Sheets, Slack, webhooks and other [integrations](https://apify.com/integrations).

```bash
curl -X POST "https://api.apify.com/v2/acts/eugene_krabs~google-flights-scraper/run-sync-get-dataset-items?token=<YOUR_TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"routes": ["LHR-CDG"], "mode": "calendar", "departureDate": "7 days", "departureDateTo": "60 days"}'
```

## FAQ

**Why does a price differ from what I see on Google Flights?**
Fares change many times a day and depend on the country you search from. Open `googleFlightsUrl` of the item: it is the same search with the same currency and country. Different results usually mean the fare changed or your browser uses another country.

**Does the price calendar show airlines and stops?**
No. Google's price graph gives only the cheapest price of each date. Run the Flights mode for the dates you are interested in to see the flights.

**Can I scrape return flights of a round trip?**
For round trips the Actor saves the outbound flights with the round-trip total price, as Google shows them first. Return flight options are not collected.

**Is scraping Google Flights legal?**
The Actor reads only public pages that Google allows for automated access in its robots.txt, without logging in. Check that your use of the data complies with Google's terms and the laws that apply to you.

## Limitations

- Results are the flights Google shows on the first results page (usually 10–100 per date); "more flights" options hidden behind extra clicks are not loaded.
- Only one-way and round trips; multi-city trips, children and infants are not supported yet.
- Booking links and fare details (baggage, fare classes) are not collected.
- Google may limit frequent requests from one IP. If searches fail, run fewer routes at once or turn on Apify Proxy.
