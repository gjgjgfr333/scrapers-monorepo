# Agoda Scraper: Hotels & Reviews

## What does Agoda Scraper do?

Agoda Scraper extracts hotel details and guest reviews from [Agoda](https://www.agoda.com). Give it hotel URLs or ids and it returns:

- **one record per hotel**: name, star rating, full address, GPS coordinates, overall guest score, scores by category (cleanliness, location, service, facilities, value for money, …) with the city average, score distribution, recommendation rate, description, highlights and photos;
- **one record per review**: rating, title, text, what the guest liked and disliked, language, review date, check-in and check-out dates, traveler type, room type, nights stayed and reviewer country;
- **one summary per hotel**: how many reviews Agoda has per source, how many were collected, their average rating and distribution by score and traveler type.

Agoda shows two kinds of reviews on every hotel page: reviews from its own guests and reviews from **Booking.com**. The Actor collects both and marks each review with its `provider`, so one run gives you two review sources, and you can keep only the one you need.

- **No login, cookies or API key.** The Actor reads only what Agoda shows to any visitor.
- **Hotels and reviews in one Actor**, or hotel details only.
- **Every review has `hotelId` and `reviewId`**, so you can join and deduplicate results across runs.
- **Filter by source and by date**, sort by newest, highest or lowest rating, or most helpful.
- **You pay per result**, not for run time, and you can cap the cost of every run.

Results can be downloaded as JSON, CSV, Excel or HTML, or read through the Apify API.

## What can you use Agoda data for?

- **Reputation management.** Collect new reviews of your hotels on a schedule and react to bad ones.
- **Competitor analysis.** Compare category scores of hotels in one city against each other and against the city average.
- **Hospitality market research.** Agoda is the leading booking platform in Asia; see how hotels in a destination are rated and by whom (couples, families, business travelers).
- **Sentiment analysis and AI.** Use review texts and the liked and disliked parts as training data or as context for an LLM.
- **Hotel databases.** Enrich your list of properties with addresses, coordinates, star ratings and photos.

## What data can you extract from Agoda?

| Data | Fields |
| --- | --- |
| Hotel | `hotelId`, `hotelUrl`, `hotelName`, `englishName`, `accommodationType`, `starRating`, `description`, `highlights`, `images` |
| Location | `address`, `street`, `area`, `city`, `country`, `postalCode`, `latitude`, `longitude` |
| Scores | `reviewScore`, `reviewScoreText`, `reviewsCount`, `recommendationScore`, `categoryScores`, `scoreDistribution` |
| Review | `reviewId`, `provider`, `rating`, `ratingText`, `title`, `text`, `positives`, `negatives`, `language`, `reviewDate`, `helpfulVotes`, `images` |
| Stay | `checkInDate`, `checkOutDate`, `stayMonth`, `travelerType`, `roomType`, `lengthOfStay`, `reviewerCountry` |
| Summary | `reviewsAvailable`, `reviewsCollected`, `reviewsByProvider`, `averageRatingCollected`, `ratingDistribution`, `travelerTypes` |

Every item has a `type` field: `hotel`, `review` or `hotelSummary`.

## How to scrape Agoda hotels and reviews

1. Open the Actor in Apify Console and go to the **Input** tab.
2. Paste one or more Agoda hotel URLs, for example `https://www.agoda.com/marina-bay-sands/hotel/singapore-sg.html`. Any language version works, and dates or other search parameters in the URL are ignored. You can also enter numeric hotel ids.
3. Choose whether you want reviews, how many per hotel, from which sources and in which order.
4. Click **Start**. When the run finishes, open the **Output** tab. The **Hotels** and **Reviews** views show the two kinds of records as tables; export the data in the format you need.

## How much does it cost to scrape Agoda?

The Actor uses pay-per-event pricing. You pay only for the data that lands in the dataset:

| Event | Charged for | Price | Per 1,000 |
| --- | --- | --- | --- |
| `hotel` | A hotel with its details and scores | $0.002 | $2.00 |
| `review` | Each review | $0.0015 | $1.50 |
| `apify-actor-start` | Each run, per GB of memory ($0.0002 at the default 4 GB) | $0.00005 | — |

The per-hotel summary is free. These are Free plan prices; on paid Apify plans (Starter, Scale, Business) they are 10–30 % lower.

Examples:

| Run | Cost |
| --- | --- |
| 1 hotel with its 50 newest reviews | about $0.08 |
| 100 hotels, details only | about $0.20 |
| 10 hotels with 200 reviews each | about $3.02 |
| 1,000 reviews of one hotel | about $1.50 |

To keep a run within a budget, set the maximum cost per run in the run options. When the limit is reached, the Actor stops and keeps everything it has already saved.

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `startUrls` | array | — | Agoda hotel pages, e.g. `https://www.agoda.com/hotel-vendome/hotel/nice-fr.html`. |
| `hotelIds` | array | `[]` | Numeric Agoda hotel ids, as an alternative to URLs. |
| `includeReviews` | boolean | `true` | Collect guest reviews. Turn off to get only hotel details. |
| `maxReviewsPerHotel` | integer | `100` | Maximum number of reviews per hotel. `0` means all reviews Agoda returns. |
| `reviewsSince` | string | `""` | Save only reviews written on or after this date (`YYYY-MM-DD`). |
| `providers` | array | all | Review sources to keep: `agoda`, `booking` (Booking.com reviews shown on Agoda), `other`. |
| `sort` | string | `newest` | `newest`, `highest`, `lowest` or `helpful`. |
| `includeReviewerName` | boolean | `false` | Add the reviewer's first name (personal data). |
| `proxyConfiguration` | object | no proxy | Proxy settings. Agoda usually works without a proxy. |

Give at least one URL or id. Example:

```json
{
    "startUrls": ["https://www.agoda.com/hotel-vendome/hotel/nice-fr.html"],
    "hotelIds": ["185945"],
    "maxReviewsPerHotel": 200,
    "providers": ["agoda", "booking"],
    "sort": "newest",
    "reviewsSince": "2026-01-01"
}
```

## Output

A hotel:

```json
{
    "type": "hotel",
    "hotelId": 1593,
    "hotelUrl": "https://www.agoda.com/hotel-vendome/hotel/nice-fr.html",
    "hotelName": "Hotel Vendome",
    "englishName": "Hotel Vendome",
    "accommodationType": "Hotel",
    "starRating": 3,
    "address": "26 Rue Pastorelli, Nice City Center, Nice, France, 06000",
    "street": "26 Rue Pastorelli",
    "area": "Nice City Center",
    "city": "Nice",
    "country": "France",
    "postalCode": "06000",
    "latitude": 43.700801849365234,
    "longitude": 7.271229267120361,
    "reviewScore": 8.5,
    "reviewScoreText": "Excellent",
    "reviewsCount": 247,
    "recommendationScore": 96,
    "categoryScores": [
        { "id": "cleanliness", "name": "Cleanliness", "score": 8.6, "cityAverage": 7.5 },
        { "id": "facilities", "name": "Facilities", "score": 7.9, "cityAverage": 7.2 }
    ],
    "scoreDistribution": { "exceptional": 110, "excellent": 51, "very_good": 18, "good": 17, "below_expectation": 15 },
    "description": "Hotel Vendome: A Charming Stay in the Heart of Nice\n\nWelcome to Hotel Vendome, a delightful 3-star hotel…",
    "highlights": ["860 meters to public transportation", "670 meters to the beach", "Free Wi-Fi in all rooms!"],
    "images": ["https://pix8.agoda.net/hotelImages/1593/0/15329df4e33a98f2788cc514179ee192.jpeg?ce=3&s=1024x768"],
    "scrapedAt": "2026-11-19T18:44:35.236Z"
}
```

A review from an Agoda guest:

```json
{
    "type": "review",
    "hotelId": 1593,
    "hotelName": "Hotel Vendome",
    "hotelUrl": "https://www.agoda.com/hotel-vendome/hotel/nice-fr.html",
    "reviewId": 1161728874,
    "provider": "agoda",
    "rating": 4.8,
    "ratingText": "Review score",
    "title": "Very very basic hotel at $250 a night",
    "text": "Very out dated, rooms are very small, hotel allows pet and you can hear a dog howling all night during my stay.\nNot recommended at all.",
    "positives": null,
    "negatives": null,
    "language": "en",
    "reviewDate": "2026-08-12",
    "checkInDate": "2026-08-08",
    "checkOutDate": "2026-08-12",
    "stayMonth": "August 2026",
    "travelerType": "Solo traveler",
    "roomType": "Single Room",
    "lengthOfStay": 4,
    "reviewerCountry": "United States",
    "helpfulVotes": 0,
    "images": [],
    "scrapedAt": "2026-11-19T18:44:35.461Z"
}
```

A Booking.com review shown on Agoda:

```json
{
    "type": "review",
    "hotelId": 1593,
    "hotelName": "Hotel Vendome",
    "hotelUrl": "https://www.agoda.com/hotel-vendome/hotel/nice-fr.html",
    "reviewId": 1203510012,
    "provider": "booking",
    "rating": 7,
    "ratingText": "Very good",
    "title": "Very good",
    "text": "Staff\n\nLittle elevator",
    "positives": "Staff",
    "negatives": "Little elevator",
    "language": "en",
    "reviewDate": "2026-11-02",
    "checkInDate": null,
    "checkOutDate": null,
    "stayMonth": null,
    "travelerType": "Group",
    "roomType": null,
    "lengthOfStay": null,
    "reviewerCountry": null,
    "helpfulVotes": 0,
    "images": [],
    "scrapedAt": "2026-11-19T18:44:35.461Z"
}
```

The summary of the reviews collected for a hotel, saved after its last review:

```json
{
    "type": "hotelSummary",
    "hotelId": 1593,
    "hotelName": "Hotel Vendome",
    "hotelUrl": "https://www.agoda.com/hotel-vendome/hotel/nice-fr.html",
    "reviewsAvailable": { "agoda": 93, "booking": 1835 },
    "reviewsCollected": 50,
    "reviewsByProvider": { "agoda": 25, "booking": 25 },
    "averageRatingCollected": 8.25,
    "ratingDistribution": { "exceptional": 32, "excellent": 8, "very_good": 1, "good": 1, "below_expectation": 8 },
    "travelerTypes": { "Solo traveler": 18, "Couple": 18, "Group": 10, "Family with young children": 3, "Family with teens": 1 },
    "scrapedAt": "2026-11-19T18:44:35.936Z"
}
```

Ratings are on Agoda's 0–10 scale for both sources. Agoda reviews have stay details (dates, room, nights, country) and mostly free text; Booking.com reviews have the liked and disliked parts (`positives`, `negatives`, joined in `text`) and no stay details. `reviewerName` is present only when `includeReviewerName` is on.

## Tips

- **Start small.** Run one hotel with 20–50 reviews first to check that the output has what you need.
- **Monitor new reviews cheaply.** Schedule a run with `sort` set to `newest` and `reviewsSince` set to the date of the previous run; you pay only for the reviews that are saved.
- **Keep one source.** Set `providers` to `agoda` or `booking` when you need only one of them.
- **Use the summary.** `reviewsAvailable` tells you how many reviews Agoda has, so you can check how much of a hotel you covered.
- **Get the worst reviews first.** `sort: lowest` with a small `maxReviewsPerHotel` gives the complaints without going through all reviews.

## Integrations and API

Agoda Scraper runs on the Apify platform, so you can start it from the [Apify API](https://docs.apify.com/api/v2), the JavaScript and Python clients or the CLI, run it on a [schedule](https://docs.apify.com/platform/schedules), and send the results on with [webhooks](https://docs.apify.com/platform/integrations/webhooks) or the ready-made [integrations](https://docs.apify.com/platform/integrations) for Make, Zapier, n8n, Google Sheets and others. AI agents can call it through the [Apify MCP server](https://mcp.apify.com).

## FAQ

### Do I need an Agoda account or an API key?

No. The Actor does not log in and needs no cookies or keys.

### Why do I get fewer reviews than the hotel's review count?

`reviewsCount` counts all ratings, including those without text; only reviews with text are listed. Beyond that, Agoda returns at most 100 pages, i.e. about **2,000 reviews per source per hotel**, and it lists Booking.com reviews in a shifting order with repeats, so for hotels with thousands of Booking.com reviews a run collects part of them (about 1,000 of 1,835 in our tests). The Actor removes the repeats, so every saved review is unique, and `reviewsAvailable` in the summary shows how many Agoda reports. To cover more of a large hotel, run it with different `sort` orders.

### Can I filter reviews by date?

Yes, with `reviewsSince`. Agoda does not list reviews strictly by date, so the Actor still pages through the reviews, but saves and charges only those written on or after the date.

### What happens if a hotel does not exist?

It is skipped with a warning in the log and in the run's status message, and the other hotels are scraped as usual. If none of the hotels can be scraped, the run fails with the reason.

### Do I need a proxy?

Usually not. When one client sends many requests in a short time, Agoda may start answering every page of reviews with the first page for a few minutes. The Actor notices this, waits and retries; if the limit lasts, it saves what it has and says in the log which hotels have incomplete reviews. For runs with many large hotels, turn on Apify Proxy in `proxyConfiguration`.

### Can it scrape prices and room availability?

Not yet. This version collects hotel details, scores and reviews.

### Is it legal to scrape Agoda?

The Actor collects only publicly available data. Reviews are written by people, and reviewer names are personal data protected by GDPR and similar laws, which is why names are off by default. Make sure you have a legitimate reason to collect and use the data, and consult a lawyer if you are not sure.

## Support

Found a bug or miss a field? Open an issue in the **Issues** tab of the Actor and describe the input you used.
