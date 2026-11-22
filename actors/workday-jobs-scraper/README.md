# Workday Jobs Scraper & API 💰$1/1K: Any myworkdayjobs Site

## What does Workday Jobs Scraper do?

Workday Jobs Scraper collects every open job from career sites built on [Workday](https://www.workday.com), the hiring system behind the career pages of Nvidia, Salesforce, Booz Allen Hamilton, Pfizer, banks, retailers, universities and thousands of other large employers (any address on `*.myworkdayjobs.com`). Give it one or more career site URLs and it returns one record per job: title, requisition ID, location and all additional locations, country, remote or hybrid, full-time or part-time, exact posting date, apply deadline, apply link and the full description.

- **More than 2,000 jobs per site.** Workday's own search stops at 2,000 results. When a site has more, the Actor splits the search by the site's own filters (job category, location…) and collects every job, without duplicates.
- **Keeps your filters.** Choose a location or a job category on the career site, copy the URL, and the Actor scrapes exactly that selection.
- **Exact dates.** The posting date comes from the job page, not from "Posted 30+ Days Ago".
- **Many companies in one run**, each with its own limit.
- **No login, cookies or API key**, and no proxy needed.
- **You pay per job saved**, not for run time.

Results can be downloaded as JSON, CSV, Excel or HTML, or read through the Apify API.

## What can you use Workday job data for?

- **Recruiting and sourcing.** Track every opening at the large employers you recruit for or compete with for talent.
- **Sales intelligence.** Hiring plans of enterprise accounts show new teams, new offices and new projects before they are announced.
- **Job boards and aggregators.** Pull jobs directly from the employer, with the original apply link and deadline.
- **Labour market research.** Compare hiring volume, locations, remote policies and job categories across companies over time.
- **Monitoring.** Schedule a daily run with "Posted within 1 day" to get only new openings.

## What data can you extract from Workday?

| Data        | Fields                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------ |
| Job         | `jobId`, `title`, `url`, `applyUrl`, `timeType`, `applyDeadline`                           |
| Date        | `postedAt`, `postedAtApproximate`, `postedOn`                                              |
| Location    | `location`, `additionalLocations`, `country`, `countryCode`, `remoteType`, `workplaceType` |
| Description | `descriptionHtml`, `descriptionText`                                                       |
| Company     | `company`, `legalEntity`, `tenant`, `site`                                                 |

## How to scrape jobs from a Workday career site

1. Open the company's career page. If the address contains `myworkdayjobs.com`, it is a Workday site. Optionally choose filters there (location, category).
2. Copy the URL from the address bar, e.g. `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`.
3. In Apify Console, paste one or more URLs into **Workday career site URLs**. Add search text or a "posted within" filter if you need them.
4. Click **Start**. When the run finishes, open the **Output** tab and export the data.

## How much does it cost to scrape Workday?

The Actor uses pay-per-event pricing. You pay only for the jobs that land in the dataset:

| Event               | Charged for                                              | Price    | Per 1,000 |
| ------------------- | -------------------------------------------------------- | -------- | --------- |
| `job`               | Each job saved to the dataset                            | $0.001   | $1.00     |
| `apify-actor-start` | Each run, per GB of memory ($0.0002 at the default 4 GB) | $0.00005 | —         |

These are Free plan prices; on paid Apify plans the price per 1,000 jobs is $0.90 (Starter), $0.80 (Scale) and $0.70 (Business). Jobs dropped by the date filter are not charged.

Examples:

| Run                                                   | Cost                |
| ----------------------------------------------------- | ------------------- |
| 100 newest jobs of one company                        | about $0.10         |
| Every job at Nvidia (about 2,600)                     | about $2.60         |
| 20 companies, jobs posted in the last day (about 300) | about $0.30 per day |

To keep a run within a budget, set the maximum cost per run in the run options or the **Max jobs in total** input. When the limit is reached, the Actor stops and keeps everything it has already saved.

## Input

| Field                | Type    | Default  | Description                                                                                                       |
| -------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `startUrls`          | array   | required | Workday career site URLs, with or without filters in the query.                                                   |
| `searchText`         | string  | `""`     | Keywords to search for on every site. A `?q=` in the URL takes precedence.                                        |
| `includeDescription` | boolean | `true`   | Load each job page: description, exact date, deadline, country, time type. Off is faster, with approximate dates. |
| `postedWithinDays`   | integer | `0`      | Keep only jobs posted in the last N days. `0` keeps all.                                                          |
| `splitBeyond2000`    | boolean | `true`   | Split searches with 2,000+ jobs by the site's filters to reach every job.                                         |
| `maxJobsPerSite`     | integer | `0`      | Maximum jobs per career site. `0` means no limit.                                                                 |
| `maxItems`           | integer | `1000`   | Maximum jobs in the whole run.                                                                                    |
| `proxyConfiguration` | object  | no proxy | Proxy settings. Workday works without a proxy.                                                                    |

Example:

```json
{
    "startUrls": [
        "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
        "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site",
        "https://workday.wd5.myworkdayjobs.com/Workday"
    ],
    "postedWithinDays": 7,
    "maxItems": 5000
}
```

## Output

One dataset item per job:

```json
{
    "company": "workday",
    "legalEntity": "Workday, Inc.",
    "tenant": "workday",
    "site": "Workday",
    "jobId": "JR-0111226",
    "title": "Senior Solution Consultant - HCM",
    "url": "https://workday.wd5.myworkdayjobs.com/Workday/job/USA-NY-Remote/Senior-Solution-Consultant---HCM_JR-0111226",
    "applyUrl": "https://workday.wd5.myworkdayjobs.com/Workday/job/USA-NY-Remote/Senior-Solution-Consultant---HCM_JR-0111226/apply",
    "location": "USA, NY, Remote",
    "additionalLocations": ["USA, CT, Remote", "USA, PA, Remote", "USA, NJ, Remote"],
    "country": "United States of America",
    "countryCode": "US",
    "remoteType": "Remote",
    "workplaceType": "remote",
    "timeType": "full-time",
    "postedAt": "2026-11-18T00:00:00.000Z",
    "postedAtApproximate": false,
    "postedOn": "Posted Today",
    "applyDeadline": null,
    "descriptionHtml": "<p><b>Your work days are brighter here.</b></p><p>We’re obsessed with making hard work pay off...</p>",
    "descriptionText": "Your work days are brighter here.\n\nWe’re obsessed with making hard work pay off...",
    "scrapedAt": "2026-11-19T05:37:00.531Z"
}
```

- `workplaceType` is `onsite`, `hybrid` or `remote`, derived from the site's own `remoteType` wording ("Office - Flexible", "Flex", "Remote Home-Based"…) or from "Remote" in the location.
- `remoteType` and `applyDeadline` are filled only on sites that use them.
- With `includeDescription` off, `postedAt` is calculated from "Posted N Days Ago" and `postedAtApproximate` is `true`; country, time type, deadline and description stay empty.

The run also stores a **run summary** (key `RUN_SUMMARY` in the key-value store): for every career site the estimated number of jobs, jobs found and saved, searches that could not be split below 2,000, and why a site gave no jobs (`not_found`, `empty`, `error`).

## Tips

- **Use the site's filters instead of search text for complete results.** Without search text Workday lists jobs newest first and every page is stable. With search text it sorts by relevance, and a few jobs can shift between pages and be missed.
- **Monitor new jobs cheaply.** With `postedWithinDays` and no search text, the Actor stops paging as soon as it reaches older jobs.
- **Turn off job details for counting.** Without `includeDescription` a site with 2,600 jobs is read in about 150 requests instead of 2,750.
- **Check the summary.** `estimatedTotal` vs `jobsFound` shows how complete the run was.

## Integrations and API

Workday Jobs Scraper runs on the Apify platform, so you can start it from the [Apify API](https://docs.apify.com/api/v2), the JavaScript and Python clients or the CLI, run it on a [schedule](https://docs.apify.com/platform/schedules), and send the results on with [webhooks](https://docs.apify.com/platform/integrations/webhooks) or the ready-made [integrations](https://docs.apify.com/platform/integrations) for Make, Zapier, n8n, Google Sheets, Slack and others. AI agents can call it through the [Apify MCP server](https://mcp.apify.com).

Need Greenhouse, Lever, Ashby, Workable, Recruitee or SmartRecruiters too? See [ATS Jobs Scraper](https://apify.com/eugene_krabs/ats-jobs-scraper), which reads all of them plus Workday in one run.

## FAQ

### How does it get past the 2,000-job limit?

Workday's search returns at most 2,000 jobs, but it also reports how many jobs each filter value has (for example 1,651 in Engineering, 311 in Sales). The Actor picks a filter that covers every job, groups its values into searches of fewer than 2,000 jobs each, and reads every search to the end. On Nvidia's site this collects all ~2,600 jobs with two searches.

### How do I know a career site uses Workday?

Its address contains `myworkdayjobs.com`, e.g. `https://pfizer.wd1.myworkdayjobs.com/PfizerCareers`. Some companies show the Workday site under their own domain; click any job, and the address or the "Apply" button usually leads to `myworkdayjobs.com`.

### Why is `company` the short name, not the full company name?

Workday does not give a display name. `company` is the tenant from the URL (`nvidia`); `legalEntity` is the hiring legal entity from the job page, e.g. "Workday, Inc.".

### What happens if a site does not exist?

It is skipped and listed in the run summary with the reason, and the other sites are scraped as usual. A run that saves no jobs at all fails with a message that says why.

### Do I need a proxy?

No. If a site answers "too many requests", the Actor slows down and retries on its own.

### Is it legal to scrape Workday career sites?

The Actor reads only job postings that employers publish for everyone to see, and it does not collect personal data. Check the terms of the sites you scrape and consult a lawyer if you plan to republish the data.

## Limitations

- Only `*.myworkdayjobs.com` addresses are supported; career sites embedded on other domains need their `myworkdayjobs.com` URL.
- With search text, Workday's relevance order can shift between pages, so a small share of matching jobs may be missed. Filters chosen on the site do not have this problem.
- A search that has 2,000+ jobs and no filter left to split it is limited to its first 2,000 jobs; the run summary counts such searches in `cappedSearches`.
- Salary is not published in Workday's job data.

## Support

Found a bug or miss a field? Open an issue in the **Issues** tab of the Actor and describe the input you used.
