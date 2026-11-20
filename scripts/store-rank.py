#!/usr/bin/env python3
"""
Where our Actors stand in Apify Store search, per query.

    python3 -I scripts/store-rank.py                                   # every Actor from scripts/store-queries.json
    python3 -I scripts/store-rank.py agoda-scraper                     # one Actor
    python3 -I scripts/store-rank.py agoda-scraper -q "hotel reviews"  # ad-hoc query instead of the saved ones
    python3 -I scripts/store-rank.py --csv store-rank.csv              # append results and show the change since last time
    python3 -I scripts/store-rank.py --json                            # raw rows

Positions follow the Store's default (relevance) order, the one people see when they search.
The search matches the Actor's title and description, not the README. Only the first --depth
results are checked (default 100); a lower position is shown as ">100".
Only the public Store API is used, no token needed.
"""
import argparse
import csv
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

API = 'https://api.apify.com/v2'
QUERIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'store-queries.json')


def search(query, depth):
    params = urllib.parse.urlencode({'search': query, 'limit': depth})
    request = urllib.request.Request(f'{API}/store?{params}', headers={'User-Agent': 'scrapers-monorepo'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)['data']
    return data['total'], data['items']


def last_positions(path, before=None):
    """Latest saved position per (actor, query) from the CSV history, optionally only before a date"""
    latest = {}
    if not path or not os.path.exists(path):
        return latest
    with open(path, newline='', encoding='utf-8') as file:
        for row in csv.DictReader(file):
            if before is None or row['date'] < before:
                latest[(row['actor'], row['query'])] = (row['date'], row['position'])
    return latest


def save_history(path, rows):
    """Adds today's rows to the CSV; a second run on the same day replaces that day's rows"""
    fields = ['date', 'actor', 'query', 'position', 'total']
    fresh = {(row['date'], row['actor'], row['query']) for row in rows}
    kept = []
    if os.path.exists(path):
        with open(path, newline='', encoding='utf-8') as file:
            kept = [row for row in csv.DictReader(file) if (row['date'], row['actor'], row['query']) not in fresh]
    with open(path, 'w', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        writer.writerows(kept)
        for row in rows:
            writer.writerow({key: '' if row[key] is None else row[key] for key in fields})


def fmt(position, depth):
    return f'#{position}' if position else f'>{depth}'


def change(before, after):
    """'+5' when the Actor moved up, '-3' when down, 'new' when it entered the checked range"""
    if before is None:
        return ''
    before = int(before) if before else None
    if before == after:
        return '='
    if before is None:
        return 'new'
    if after is None:
        return 'out'
    return f'{before - after:+d}'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('actors', nargs='*', help='Actor names (default: all in store-queries.json)')
    parser.add_argument('-q', '--query', action='append', help='query to check instead of the saved ones')
    parser.add_argument('--user', default='eugene_krabs', help='Store username (default: eugene_krabs)')
    parser.add_argument('--depth', type=int, default=100, help='how many results to look through (max 1000)')
    parser.add_argument('--csv', help='append results to this CSV and compare with its latest rows')
    parser.add_argument('--json', action='store_true', help='print rows as JSON')
    args = parser.parse_args()

    with open(QUERIES_FILE, encoding='utf-8') as file:
        saved = json.load(file)
    actors = args.actors or list(saved)
    unknown = [actor for actor in actors if actor not in saved and not args.query]
    if unknown:
        sys.exit(f'No saved queries for {", ".join(unknown)}: add them to {QUERIES_FILE} or pass -q')

    depth = max(1, min(args.depth, 1000))
    today = datetime.date.today().isoformat()
    history = last_positions(args.csv, before=today)
    rows = []

    for actor in actors:
        target = f'{args.user}/{actor}'
        for query in args.query or saved[actor]:
            total, items = search(query, depth)
            names = [f"{item['username']}/{item['name']}" for item in items]
            position = names.index(target) + 1 if target in names else None
            previous = history.get((actor, query))
            rows.append({
                'date': today,
                'actor': actor,
                'query': query,
                'position': position,
                'total': total,
                'previous': previous[1] if previous else None,
                'previousDate': previous[0] if previous else None,
                'change': change(previous[1], position) if previous else '',
                'top': [item['title'] for item in items[:3]],
            })

    if args.csv:
        save_history(args.csv, rows)

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return

    current = None
    for row in rows:
        if row['actor'] != current:
            current = row['actor']
            print(f'== {current}')
        since = f" (was {fmt(int(row['previous']) if row['previous'] else None, depth)} on {row['previousDate']}, {row['change']})" if row['previousDate'] else ''
        top = ' · '.join(title[:40] for title in row['top'])
        print(f"  {row['query']:24} {fmt(row['position'], depth):>5} of {row['total']:<6}{since}  top: {top}")


if __name__ == '__main__':
    main()
