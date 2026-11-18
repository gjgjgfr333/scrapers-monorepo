# CLAUDE.md

Apify Actors of eugene_krabs, one folder per Actor in `actors/`. Generic Apify workflow, rules and the "ask first" list:

@AGENTS.md

## Layout

```
actors/<name>/        one Apify Actor: own package.json, .actor/, src/, test/, README (Store page), CLAUDE.md
scripts/              helpers shared by the skills (Python 3 stdlib + Pillow, run with python3 -I)
.claude/skills/       actor-idea, actor-build + ai-factory skills (/aif-*)
.github/              CI for every Actor, issue template "Идея актора"
```

Actors share no code at runtime: each is built and deployed from its own folder (`cd actors/<name> && apify push`). To start a new one, copy the layout of `actors/substack-scraper` (the `actor-build` skill does it), not `apify create` (interactive and initializes a nested git repo).

## Workflow

1. `/actor-idea [category]` — reads Apify Store in the user's Chrome, analyses competitors, files GitHub issues labelled `actor-idea`.
2. `/actor-build <issue>` — implements the Actor, checks it with real requests, deploys, sets up the Store page, prices and an example task, merges the PR and closes the issue.

Helpers:

```bash
python3 -I scripts/store-competitors.py "<query>" [--category CODE] [--limit N] [--json]   # demand, success rate, rating, price, last update
python3 -I scripts/render-icon.py actors/<name>/.actor/icon.svg                            # 512×512 PNG with rounded corners (macOS)
```

## Conventions

- Commit messages in English. Work in a branch (`actor/<name>`, `fix/…`, `chore/…`), PR into `main`, merge with a merge commit (`gh pr merge --merge`).
- CI (`.github/workflows/test.yaml`) runs `npm ci`, `build`, `lint`, `test` for every folder in `actors/` with a `package.json`.
- The repository is the source of truth for README, schemas and code; prices and Store texts are set in Apify Console and must match the README. Before `apify push`, merge the fresh `main`: push uploads the working copy, including README.
- Apify account: tabakevgenijj@gmail.com, username `eugene_krabs`. Never log in on the user's behalf.
