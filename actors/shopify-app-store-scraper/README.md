# Shopify App Store Scraper & API 💰$1/1K: Apps, Pricing, Reviews

## What does Shopify App Store Scraper do?

Shopify App Store Scraper extracts apps and merchant reviews from the [Shopify App Store](https://apps.shopify.com). Give it app URLs, whole categories or the entire catalog, and it returns one clean record per app (rating, review count, rating distribution, every pricing plan with its price, period, trial and features, categories, languages, integrations, developer, launch date, Built for Shopify badge) and one record per review (stars, date, text, store name and country, how long the store has used the app, developer reply).

- **No login, cookies or API key.** The Actor reads only what the App Store shows to any visitor.
- **Three ways to pick apps:** a list of URLs or handles, App Store categories (a parent category is expanded into all its subcategories), or the whole catalog from the App Store sitemap.
- **Pricing plans as structured data**, not one line of text: plan name, price, currency, price in USD, month or year, trial days, extra charges and features.
- **Reviews with filters:** newest first, only from a given date, only certain star ratings (for example only 1 and 2 stars), with the developer's reply.
- **You pay per result**, not for run time, and you can cap the cost of every run.

Results can be downloaded as JSON, CSV, Excel or HTML, or read through the Apify API.

## What can you use Shopify App Store data for?

- **Competitor research for app developers.** Compare ratings, review counts, pricing plans and features of every app in your category.
- **Review monitoring.** Schedule the Actor with `reviewsSince` and get every new review of your app and your competitors' apps, including the negative ones and how the developer answered.
- **Finding gaps in the market.** Read 1- and 2-star reviews of the leaders to see what merchants miss.
- **Market research.** Track how many apps a category has, how they price, how many are Built for Shopify, and which are new.
- **Lead lists for agencies and partners.** Collect app developers by category with their App Store pages.

## What data can you extract from the Shopify App Store?

Apps and reviews land in one dataset; the `type` field says which is which. The **Apps** and **Reviews** views in the Output tab show each of them as a table.

| Data      | Fields                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App       | `handle`, `url`, `name`, `subtitle`, `introduction`, `headline`, `description`, `highlights`, `iconUrl`                                                     |
| Rating    | `rating`, `reviewCount`, `ratingDistribution` (reviews per star)                                                                                            |
| Pricing   | `pricingSummary`, `plans` (`name`, `price`, `currency`, `priceUsd`, `period`, `priceText`, `yearlyPriceText`, `additionalCharges`, `trialDays`, `features`) |
| Listing   | `categories`, `languages`, `worksWith`, `launchedAt`, `builtForShopify`                                                                                     |
| Developer | `developer`, `developerUrl`                                                                                                                                 |
| Review    | `appHandle`, `appName`, `reviewId`, `reviewUrl`, `rating`, `date`, `edited`, `text`                                                                         |
| Reviewer  | `storeName`, `storeCountry`, `usageDuration`                                                                                                                |
| Reply     | `developerReply`, `developerReplyDate`                                                                                                                      |

## How to scrape the Shopify App Store

1. Open the Actor in Apify Console and go to the **Input** tab.
2. Add apps (`https://apps.shopify.com/judgeme` or just `judgeme`), categories (`https://apps.shopify.com/categories/marketing-and-conversion-social-trust-product-reviews`), or turn on **All apps**.
3. Set **Max apps** for the whole run and **Max reviews per app**. Turn reviews off if you need only app data.
4. Optionally filter reviews by date and star rating.
5. Click **Start**. When the run finishes, open the **Output** tab and export the data in the format you need.

## How much does it cost to scrape the Shopify App Store?

The Actor uses pay-per-event pricing. You pay only for the data that lands in the dataset:

| Event               | Charged for                                              | Price    | Per 1,000 |
| ------------------- | -------------------------------------------------------- | -------- | --------- |
| `app`               | One app with all its details and pricing plans           | $0.001   | $1.00     |
| `review`            | One merchant review                                      | $0.0005  | $0.50     |
| `apify-actor-start` | Each run, per GB of memory ($0.0002 at the default 4 GB) | $0.00005 | —         |

These are Free plan prices; on paid Apify plans (Starter, Scale, Business) they are 10–30 % lower.

Examples:

| Run                                                     | Cost                |
| ------------------------------------------------------- | ------------------- |
| 2 apps with their 20 newest reviews each                | about $0.02         |
| One category of 500 apps, no reviews                    | about $0.50         |
| 100 apps with 100 reviews each                          | about $5.10         |
| The whole catalog (about 30,000 apps), no reviews       | about $30           |
| Daily check of 10 apps for new reviews (about 50 a day) | about $0.04 per run |

To keep a run within a budget, set the maximum cost per run in the run options. When the limit is reached, the Actor stops and keeps everything it has already saved.

## Input

| Field                    | Type    | Default  | Description                                                                                                    |
| ------------------------ | ------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `apps`                   | array   | `[]`     | App Store URLs (`https://apps.shopify.com/judgeme`) or handles (`judgeme`).                                    |
| `categories`             | array   | `[]`     | Category URLs or slugs. A parent category (`marketing-and-conversion`) is expanded into all its subcategories. |
| `allApps`                | boolean | `false`  | Take apps from the App Store sitemap, the whole catalog. Set `maxApps` to `0` to take all of them.             |
| `maxApps`                | integer | `100`    | Maximum number of apps in the run, from all sources together. `0` means no limit.                              |
| `includeReviews`         | boolean | `true`   | Scrape merchant reviews of every app, newest first.                                                            |
| `maxReviewsPerApp`       | integer | `100`    | Maximum number of reviews per app. `0` means all of them.                                                      |
| `reviewsSince`           | string  | empty    | Only reviews posted or edited on this day or later, e.g. `2026-01-31`.                                         |
| `minRating`, `maxRating` | integer | `1`, `5` | Only reviews with this many stars.                                                                             |
| `proxyConfiguration`     | object  | no proxy | Proxy settings. The App Store works without a proxy.                                                           |

Example:

```json
{
    "apps": ["https://apps.shopify.com/judgeme", "klaviyo-email-marketing"],
    "maxReviewsPerApp": 20,
    "minRating": 1,
    "maxRating": 2
}
```

## Output

An app (lists shortened):

```json
{
    "type": "app",
    "handle": "judgeme",
    "url": "https://apps.shopify.com/judgeme",
    "name": "Judge.me Product Reviews App",
    "subtitle": "Collect unlimited product reviews, star ratings, testimonials",
    "introduction": "Send unlimited, automatic review requests via email, SMS, and push. Display stars and reviews on storefront, share reviews on social media and Google Shopping.",
    "headline": "Sell more with unlimited product reviews, UGC, star ratings, Google reviews and testimonials",
    "description": "Driving traffic is only half the battle – trust is what converts. Judge.me boosts conversion rate with unlimited product reviews, star ratings, and UGC (photo/v…",
    "highlights": [
        "Collect and manage unlimited reviews, photos, videos, testimonials, ratings",
        "Display eye-catching review widgets, testimonial sliders and product ratings"
    ],
    "iconUrl": "https://cdn.shopify.com/app-store/listing_images/8cada0f5da411a64e756606bb036f1ed/icon/CIfp9fWd34sDEAE=.png",
    "developer": "Judge.me",
    "developerUrl": "https://apps.shopify.com/partners/judge-me",
    "rating": 5,
    "reviewCount": 50426,
    "ratingDistribution": { "1": 156, "2": 40, "3": 80, "4": 830, "5": 49320 },
    "pricingSummary": "Free plan available. Free trial available.",
    "plans": [
        {
            "name": "Forever Free",
            "price": 0,
            "currency": null,
            "priceUsd": 0,
            "period": null,
            "priceText": "Free",
            "yearlyPriceText": null,
            "additionalCharges": null,
            "trialDays": null,
            "features": ["Unlimited product and store reviews", "Unlimited visual reviews (photos/videos)"]
        },
        {
            "name": "Awesome",
            "price": 15,
            "currency": "USD",
            "priceUsd": 15,
            "period": "month",
            "priceText": "$15/month",
            "yearlyPriceText": null,
            "additionalCharges": null,
            "trialDays": 15,
            "features": ["AI (replies, summary, translations)", "130+ integrations, inc. Klaviyo, Gorgias"]
        }
    ],
    "categories": ["Product reviews", "SEO"],
    "languages": ["English", "Spanish", "French", "Italian"],
    "worksWith": ["Checkout", "Customer accounts", "Shopify Flow"],
    "launchedAt": "2015-06-25",
    "builtForShopify": true,
    "scrapedAt": "2026-11-19T14:08:54.355Z"
}
```

A review:

```json
{
    "type": "review",
    "appHandle": "klaviyo-email-marketing",
    "appName": "Klaviyo: Email Marketing & SMS",
    "reviewId": "2430506",
    "reviewUrl": "https://apps.shopify.com/reviews/2430506",
    "rating": 5,
    "date": "2026-11-15",
    "edited": false,
    "text": "the best!",
    "storeName": "TRUEBEAUTYHAIR INC",
    "storeCountry": "United States",
    "usageDuration": "19 days using the app",
    "developerReply": "Thank you so much for the positive review!…",
    "developerReplyDate": "2026-11-16",
    "scrapedAt": "2026-11-19T12:45:52.331Z"
}
```

The key-value store also holds `RUN_SUMMARY`: apps and reviews saved, and for every app and category whether it worked (`ok`, `not_found`, `error`) and why not.

## Tips

- **Monitor reviews on a schedule.** Run daily with `reviewsSince` set to yesterday and `maxReviewsPerApp: 0`. The Actor stops reading an app as soon as its reviews are older than the date, so a daily run costs cents.
- **Collect complaints only.** `minRating: 1`, `maxRating: 2` asks the App Store for 1- and 2-star reviews directly, so you do not pay for the five-star ones.
- **Turn off reviews for catalog research.** One request per app is all it takes; a category of 500 apps runs in a few minutes.
- **Compare prices in USD.** `priceUsd` is always in US dollars. `price` and `currency` are what the App Store shows, which depends on the visitor's country (USD on Apify servers).

## Integrations and API

Shopify App Store Scraper runs on the Apify platform, so you can start it from the [Apify API](https://docs.apify.com/api/v2), the JavaScript and Python clients or the CLI, run it on a [schedule](https://docs.apify.com/platform/schedules), and send the results on with [webhooks](https://docs.apify.com/platform/integrations/webhooks) or the ready-made [integrations](https://docs.apify.com/platform/integrations) for Make, Zapier, n8n, Google Sheets, Slack and others. AI agents can call it through the [Apify MCP server](https://mcp.apify.com).

## FAQ

### Do I need a Shopify account or an API key?

No. The Actor reads the public App Store pages that anyone can open without logging in.

### Can it search the App Store by keyword?

No. The App Store's robots.txt does not allow automated search (`/search?q=`), and the Actor respects it. Use categories instead: every app is listed in at least one, and a parent category covers all its subcategories.

### Why do some reviews have no text?

Merchants can leave a star rating without writing anything. Such reviews are saved with `text: null`, because they count in the rating too.

### Why are prices in euros (or another currency)?

The App Store converts prices to the visitor's local currency. On Apify servers that is USD. If you use a proxy from another country, `price` and `currency` follow it, and `priceUsd` still gives the price in US dollars, converted at the rate the App Store states on the page.

### What happens if an app does not exist?

It is listed in `RUN_SUMMARY` as `not_found` and the run goes on with the other apps. If no app at all could be saved, the run fails with the reason.

### Does it collect personal data?

Reviews show the name of the merchant's store (a business), its country and how long it has used the app; the App Store does not show the names of the people who wrote them. The Actor does not collect developer e-mail addresses or postal addresses.

### Do I need a proxy?

No. The App Store answers too many requests per second with HTTP 429; the Actor keeps a steady pace and waits and retries when that happens.

### Is it legal to scrape the Shopify App Store?

The Actor collects only public data and follows the site's robots.txt. Check the [Shopify terms](https://www.shopify.com/legal/terms) and the laws that apply to you before you use the data, especially if you plan to republish it.

## Limitations

- About two requests per second: 1,000 apps with no reviews take roughly 10 minutes, and 10,000 reviews (1,000 pages) take about the same.
- An app that was removed from the App Store answers 404; it is listed as `not_found` in `RUN_SUMMARY` and not charged.
- Review dates are days, not timestamps. An edited review shows the edit date and `edited: true`.

## Support

Found a bug, miss a field or need another filter? Open an issue in the **Issues** tab of the Actor and describe the input you used.
