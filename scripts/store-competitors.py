#!/usr/bin/env python3
"""
Competitors of an Actor idea in Apify Store: demand, quality and price.

    python3 -I scripts/store-competitors.py "substack"                 # search query
    python3 -I scripts/store-competitors.py "zillow" --limit 15
    python3 -I scripts/store-competitors.py --category REAL_ESTATE     # whole category, by popularity
    python3 -I scripts/store-competitors.py "substack" --json          # raw rows for further processing

Columns: users in the last 7 / 30 / 90 days and in total, share of successful public runs in 30 days,
rating (reviews), pricing model with the price of the main event per 1,000 on the Free plan, last update.
Only the public Store API is used, no token needed.
"""
import argparse
import json
import sys
import urllib.parse
import urllib.request

API = 'https://api.apify.com/v2'


def get(path, **params):
    query = urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, '')})
    url = f'{API}{path}' + (f'?{query}' if query else '')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'scrapers-monorepo'}), timeout=30) as r:
        return json.load(r)['data']


def event_price(event):
    """Free-plan price of one event: flat or the FREE tier of tiered pricing"""
    if event.get('eventPriceUsd') is not None:
        return event['eventPriceUsd']
    tiers = event.get('eventTieredPricingUsd') or {}
    free = tiers.get('FREE') or next(iter(tiers.values()), None)
    return free.get('tieredEventPriceUsd') if free else None


def pricing(info):
    """Short pricing summary: model and per-1,000 prices of result events (start events are shown per run)"""
    if not info:
        return 'free'
    model = info.get('pricingModel')
    if model == 'PAY_PER_EVENT':
        events = (info.get('pricingPerEvent') or {}).get('actorChargeEvents') or {}
        parts = []
        for name, event in events.items():
            price = event_price(event)
            if price is None:
                continue
            if 'start' in name:
                parts.append(f'start ${price:g}')
            else:
                parts.append(f'{name} ${price * 1000:.2f}/1k')
        return 'PPE: ' + ', '.join(parts)
    if model == 'PRICE_PER_DATASET_ITEM':
        return f"${(info.get('pricePerUnitUsd') or 0) * 1000:.2f}/1k results"
    if model == 'FLAT_PRICE_PER_MONTH':
        return f"${info.get('pricePerUnitUsd')}/month"
    return model or 'free'


def row(item):
    full = get(f"/acts/{item['username']}~{item['name']}")
    stats = full.get('stats') or {}
    runs = stats.get('publicActorRunStats30Days') or {}
    total = runs.get('TOTAL') or 0
    infos = full.get('pricingInfos') or []
    return {
        'actor': f"{item['username']}/{item['name']}",
        'title': item.get('title'),
        'users7d': stats.get('totalUsers7Days'),
        'users30d': stats.get('totalUsers30Days'),
        'users90d': stats.get('totalUsers90Days'),
        'usersTotal': stats.get('totalUsers'),
        'success30d': round(100 * (runs.get('SUCCEEDED') or 0) / total) if total else None,
        'runs30d': total,
        'rating': round(item.get('actorReviewRating') or 0, 1),
        'reviews': item.get('actorReviewCount') or 0,
        'pricing': pricing(infos[-1] if infos else None),
        'modified': (full.get('modifiedAt') or '')[:10],
        'created': (full.get('createdAt') or '')[:10],
        'deprecated': full.get('isDeprecated'),
        'url': f"https://apify.com/{item['username']}/{item['name']}",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('query', nargs='?', default='')
    parser.add_argument('--category')
    parser.add_argument('--limit', type=int, default=25)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    if not args.query and not args.category:
        parser.error('give a search query or --category')

    store = get('/store', search=args.query, category=args.category, sortBy='popularity', limit=args.limit)
    rows = [row(item) for item in store['items']]
    rows.sort(key=lambda r: r['users30d'] or 0, reverse=True)
    if args.json:
        json.dump({'total': store['total'], 'rows': rows}, sys.stdout, indent=2)
        return

    print(f"{store['total']} Actors in Store for this search, top {len(rows)} by users in 30 days\n")
    print('| Actor | Users 7d / 30d / 90d / total | Success 30d | Rating | Pricing (Free plan) | Updated |')
    print('|---|---|---|---|---|---|')
    for r in rows:
        success = f"{r['success30d']}% of {r['runs30d']}" if r['success30d'] is not None else '—'
        rating = f"{r['rating']} ({r['reviews']})" if r['reviews'] else '—'
        flag = ' (deprecated)' if r['deprecated'] else ''
        print(
            f"| [{r['actor']}]({r['url']}){flag} | {r['users7d']} / {r['users30d']} / {r['users90d']} / {r['usersTotal']} "
            f"| {success} | {rating} | {r['pricing']} | {r['modified']} |"
        )


if __name__ == '__main__':
    main()
