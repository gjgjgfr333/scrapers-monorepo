# Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters & Workday Jobs Scraper API

## What does ATS Jobs Scraper do?

ATS Jobs Scraper collects every open job straight from company career pages. Give it a list of career page URLs and it returns one clean record per job: title, location, remote or hybrid, employment type, department, salary range when the company publishes it, publication date, apply link and the full description in HTML and plain text.

It works with the seven applicant tracking systems most companies use for their career sites:

| ATS             | Example career page                                             |
| --------------- | --------------------------------------------------------------- |
| Greenhouse      | `https://boards.greenhouse.io/airbnb`                           |
| Lever           | `https://jobs.lever.co/palantir`                                |
| Ashby           | `https://jobs.ashbyhq.com/ramp`                                 |
| Workable        | `https://apply.workable.com/huggingface`                        |
| Recruitee       | `https://bunq.recruitee.com`                                    |
| SmartRecruiters | `https://jobs.smartrecruiters.com/BoschGroup`                   |
| Workday         | `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite` |

- **Live data.** Every run reads the career page as it is right now, not a database snapshot from last week.
- **One Actor for all seven ATS.** Mix Greenhouse, Lever, Workday and the others in one run; the ATS is detected from the URL.
- **One schema for every ATS.** Locations, workplace type, employment type and salary are normalized, so the data from different systems can go into one table.
- **No login, cookies or API key.** The Actor reads the public job board APIs that power the career pages.
- **You pay per job saved**, not for run time, and you can cap the cost of every run.

Results can be downloaded as JSON, CSV, Excel or HTML, or read through the Apify API.

## What can you use career page data for?

- **Recruiting and sourcing.** Watch the companies you hire against, or the ones your candidates want to join, and see new roles the day they open.
- **Sales signals.** A company hiring ten data engineers is likely buying data tools. Feed new openings at your target accounts into your CRM.
- **Job boards and aggregators.** Pull jobs directly from employers instead of reposts, with the original apply link.
- **Labour market and salary research.** Compare salary ranges, remote policies and hiring volume across companies and locations.
- **Competitive intelligence.** Hiring plans show where a competitor is investing: new offices, new teams, new products.

## What data can you extract?

| Data        | Fields                                                                          |
| ----------- | ------------------------------------------------------------------------------- |
| Job         | `jobId`, `title`, `url`, `applyUrl`, `postedAt`, `department`, `employmentType` |
| Location    | `location`, `locations`, `country`, `remote`, `workplaceType`                   |
| Salary      | `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod`                      |
| Description | `descriptionHtml`, `descriptionText`                                            |
| Source      | `ats`, `company`, `companySlug`, `scrapedAt`                                    |

Not every ATS publishes every field. Salary comes from Ashby, Recruitee and Lever when the company fills it in; Greenhouse, Workable, SmartRecruiters and Workday do not expose it in their public APIs. See [Limitations](#limitations).

## How to scrape jobs from career pages

1. Open the Actor in Apify Console and go to the **Input** tab.
2. Paste the career page URLs, one per line. Open a company's "Careers" page, click any job and copy the address of the job board: it usually starts with `boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `apply.workable.com`, `*.recruitee.com`, `jobs.smartrecruiters.com` or `*.myworkdayjobs.com`.
3. Optionally narrow the results: title keywords, locations, remote only, or jobs posted in the last N days.
4. Click **Start**. When the run finishes, open the **Output** tab and export the data in the format you need.

## How much does it cost to scrape career pages?

The Actor uses pay-per-event pricing. You pay only for the jobs that land in the dataset:

| Event               | Charged for                                              | Price    | Per 1,000 |
| ------------------- | -------------------------------------------------------- | -------- | --------- |
| `job`               | Each job saved to the dataset                            | $0.0015  | $1.50     |
| `apify-actor-start` | Each run, per GB of memory ($0.0002 at the default 4 GB) | $0.00005 | —         |

These are Free plan prices; on paid Apify plans the price per 1,000 jobs is $1.35 (Starter), $1.20 (Scale) and $1.05 (Business). Jobs dropped by your filters are not charged.

Examples:

| Run                                                                          | Cost                |
| ---------------------------------------------------------------------------- | ------------------- |
| One company with 200 open jobs                                               | about $0.30         |
| 20 companies, 50 newest jobs each                                            | about $1.50         |
| 10,000 jobs from 100 companies                                               | about $15           |
| Daily check of 50 companies for jobs posted in the last day (about 100 jobs) | about $0.15 per day |

To keep a run within a budget, set the maximum cost per run in the run options, or the **Max jobs in total** input. When the limit is reached, the Actor stops and keeps everything it has already saved.

## Input

| Field                | Type    | Default  | Description                                                                                                                                                   |
| -------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companies`          | array   | required | Career page URLs, one per line. The short form `ats:slug` also works, e.g. `greenhouse:airbnb`, `lever:palantir` (not for Workday, which needs the full URL). |
| `includeDescription` | boolean | `true`   | Return the full description as HTML and plain text. Workable, SmartRecruiters and Workday need one extra request per job for it.                              |
| `keywords`           | array   | `[]`     | Keep only jobs whose title contains one of these words (case-insensitive).                                                                                    |
| `locations`          | array   | `[]`     | Keep only jobs whose location contains one of these texts. A two-letter value such as `US` is a country code and matches whole words only.                    |
| `remoteOnly`         | boolean | `false`  | Keep only remote jobs.                                                                                                                                        |
| `onlyNewSinceDays`   | integer | `0`      | Keep only jobs published in the last N days. `0` keeps all. Jobs without a date are kept.                                                                     |
| `maxJobsPerCompany`  | integer | `0`      | Maximum jobs per career page. `0` means no limit.                                                                                                             |
| `maxItems`           | integer | `1000`   | Maximum jobs in the whole run.                                                                                                                                |
| `proxyConfiguration` | object  | no proxy | Proxy settings. The ATS APIs work without a proxy.                                                                                                            |

Example:

```json
{
    "companies": [
        "https://boards.greenhouse.io/airbnb",
        "https://jobs.lever.co/palantir",
        "https://jobs.ashbyhq.com/ramp",
        "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"
    ],
    "keywords": ["engineer", "data"],
    "locations": ["US", "Remote"],
    "onlyNewSinceDays": 7,
    "maxJobsPerCompany": 100
}
```

## Output

One dataset item per job, the same shape for every ATS:

```json
{
    "ats": "ashby",
    "company": "ramp",
    "companySlug": "ramp",
    "jobId": "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
    "title": "Software Engineer, Security, Cloud",
    "url": "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245",
    "applyUrl": "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application",
    "location": "New York, NY (HQ)",
    "locations": ["New York, NY (HQ)", "Remote (Canada)", "Remote (US)", "Miami, FL"],
    "country": "US",
    "remote": true,
    "workplaceType": "hybrid",
    "employmentType": "full-time",
    "department": "Engineering",
    "salaryMin": 211400,
    "salaryMax": 290600,
    "salaryCurrency": "USD",
    "salaryPeriod": "year",
    "postedAt": "2026-04-07T17:12:35.753Z",
    "descriptionHtml": "<h1><strong>About Ramp</strong></h1><p>Ramp is building the smart infrastructure for finance teams...</p>",
    "descriptionText": "About Ramp\nRamp is building the smart infrastructure for finance teams...",
    "scrapedAt": "2026-11-19T04:48:20.219Z"
}
```

- `workplaceType` is `onsite`, `hybrid` or `remote`; `employmentType` is `full-time`, `part-time`, `contract`, `temporary` or `internship` (or the ATS wording when it is something else).
- `remote` is `true` when the ATS marks the job as remote, or when a location says "Remote".
- `country` is a two-letter ISO code.
- `company` is the company name when the ATS gives it (Greenhouse, Recruitee, SmartRecruiters), otherwise the board slug.

The run also stores a **run summary** (key `RUN_SUMMARY` in the key-value store): for every career page the number of jobs listed, matched and saved, and why a page gave no jobs (`not_found`, `empty`, `error`).

## Tips

- **Monitor companies daily.** Schedule the Actor with `onlyNewSinceDays: 1` and you get only the jobs that opened since yesterday, at a few cents per run.
- **Turn off descriptions for counting and tracking.** Without `includeDescription` runs on Workable, SmartRecruiters and Workday are several times faster.
- **Use the summary.** If a page shows `not_found`, the company has moved to another ATS or the slug is wrong; open its career page again and copy the new URL.
- **SmartRecruiters IDs are case-sensitive.** `BoschGroup` works, `boschgroup` returns no jobs.

## Integrations and API

ATS Jobs Scraper runs on the Apify platform, so you can start it from the [Apify API](https://docs.apify.com/api/v2), the JavaScript and Python clients or the CLI, run it on a [schedule](https://docs.apify.com/platform/schedules), and send the results on with [webhooks](https://docs.apify.com/platform/integrations/webhooks) or the ready-made [integrations](https://docs.apify.com/platform/integrations) for Make, Zapier, n8n, Google Sheets, Slack and others. AI agents can call it through the [Apify MCP server](https://mcp.apify.com).

## FAQ

### How is this different from job databases on Apify Store?

Job databases search millions of jobs they collected earlier. This Actor goes to the career pages you choose and reads them live, so you get exactly the companies you care about, with today's data, at a lower price per job. It does not search across all companies: you bring the list.

### How do I find which ATS a company uses?

Open the company's careers page and click a job. The address bar or the "Apply" button shows the ATS: `greenhouse.io`, `lever.co`, `ashbyhq.com`, `workable.com`, `recruitee.com`, `smartrecruiters.com` or `myworkdayjobs.com`. Paste that URL.

### My company's career page is on its own domain. Does it work?

Many companies show a Greenhouse, Lever or Ashby board on their own site. Use the board URL or the short form, e.g. `greenhouse:airbnb` for careers.airbnb.com. If the page loads jobs from another system, it is not supported yet.

### Why do I get at most 2,000 jobs from a Workday site?

Workday's own search returns no more than 2,000 jobs per career site; the rest cannot be reached through it. The Actor warns in the log when a site has more.

### What happens if a career page does not exist?

It is skipped and listed in the run summary with the reason, and the other pages in the run are scraped as usual. A run that saves no jobs at all fails with a message that says why.

### Do I need a proxy?

No. The ATS APIs are public and answer without one.

### Is it legal to scrape career pages?

The Actor reads only job postings that employers publish for everyone to see, through the public APIs of their career pages, and it does not collect personal data. Check the terms of the sites you scrape and consult a lawyer if you plan to republish the data.

## Limitations

- Salary: Ashby and Recruitee when the company publishes it, Lever only for companies that fill in the salary range. Greenhouse, Workable, SmartRecruiters and Workday do not expose salary in their public APIs.
- `country` is not available for Greenhouse; `department` is not available for Workday.
- Workday: at most 2,000 jobs per career site. With `includeDescription` off, `postedAt` is approximate ("Posted 3 Days Ago"; "30+ Days Ago" counts as 30 days).
- Lever, Ashby and Workable give no display name, so `company` holds the board slug; for Workday it holds the tenant (e.g. `nvidia`).

## Support

Found a bug, miss a field or need another ATS? Open an issue in the **Issues** tab of the Actor and describe the input you used.
