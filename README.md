# Scrapers monorepo

Apify Actors by [eugene_krabs](https://apify.com/eugene_krabs). Each folder in `actors/` is a separate Actor.

| Actor | Store | What it does |
| --- | --- | --- |
| [substack-scraper](actors/substack-scraper) | [eugene_krabs/substack-scraper](https://apify.com/eugene_krabs/substack-scraper) | Posts, full text and comments of any Substack newsletter |
| [ats-jobs-scraper](actors/ats-jobs-scraper) | [eugene_krabs/ats-jobs-scraper](https://apify.com/eugene_krabs/ats-jobs-scraper) | Open jobs from career pages on Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters and Workday |

## Working on an Actor

```bash
cd actors/<name>
npm ci
npm run build && npm run lint && npm test
apify run --purge      # local run with storage/key_value_stores/default/INPUT.json
apify push             # deploy to Apify
```

New Actors start from an idea issue (`/actor-idea`) and are built with `/actor-build <issue>` — see [CLAUDE.md](CLAUDE.md).
