#!/usr/bin/env python3
"""Build the CANDIDATE overlay — top-5 candidate lists for the elections the workbooks lack.

The app carries seat results (winner, party, vote share, margin) for every election it covers, but
`../bq_export/fact_ae_candidates.csv.gz` has ZERO candidate rows for 16 recent assembly elections,
so the positions table had nothing to show for them and the year silently vanished from its picker.

ADDITIVE app-lane overlay, exactly like tools/build_overlay.mjs did for 2004: writes
public/data/cand_overlay/<slug>.json which data.ts merges under the main cand/<slug>.json at load,
so re-running build_candidates.py (or a Cowork bq_export refresh) cannot wipe it.

    python tools/build_cand_overlay.py <dir-with-downloaded-sources>

SOURCES (all third-party compilations of ECI output; provenance note in CONVENTIONS.md):
  A  thecont1/india-votes-data          {YEAR}Assembly-{SS}.csv   HR/JH/JK 2024, BR/DL 2025, AS/KL/PY 2026
  B  azadecon/assembly_elections_2023   b/{cg|mp|mz|raj}/{AC}.xlsx  CG/MP/MZ/RJ 2023
  C  data-analytics.github.io           {ap,od}2024.csv           AP + Odisha 2024

STILL MISSING, deliberately: Arunachal Pradesh 2024 and Sikkim 2024 — no fetchable candidate-level
source was found for either, so they keep showing "winners only" in the picker.

THE GATE. Every election is checked against the app's OWN recorded winner for each seat before it
is written: the top candidate's party must match seats_ae.json for that seat. An election below
MIN_AGREE is refused rather than shipped, because a candidate table that contradicts the winner
already on screen is worse than no candidate table at all.
"""
import csv, io, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
OUT = os.path.join(APP, 'public', 'data', 'cand_overlay')
TOP_N = 5
MIN_AGREE = 0.98          # share of seats whose winner must match the app's own record

sys.path.insert(0, HERE)
from partystd import load_std
std = load_std()

SRC_A = [
    ('2024Assembly-HR', 'Haryana', 2024), ('2024Assembly-JH', 'Jharkhand', 2024),
    ('2024Assembly-JK', 'Jammu & Kashmir', 2024), ('2025Assembly-BR', 'Bihar', 2025),
    ('2025Assembly-DL', 'Delhi', 2025), ('2026Assembly-AS', 'Assam', 2026),
    ('2026Assembly-KL', 'Kerala', 2026), ('2026Assembly-PY', 'Puducherry', 2026),
]
SRC_B = [('cg', 'Chhattisgarh', 2023, 90), ('mp', 'Madhya Pradesh', 2023, 230),
         ('mz', 'Mizoram', 2023, 40), ('raj', 'Rajasthan', 2023, 200)]
SRC_C = [('ap2024', 'Andhra Pradesh', 2024), ('od2024', 'Odisha', 2024)]


def slug(s):
    return re.sub(r'_+', '_', re.sub(r'[^a-z0-9]+', '_', s.lower())).strip('_')


def tc(s):
    return (s or '').strip()


def app_seats():
    """(state, year, seat_no) -> the app's own seat row."""
    out = {}
    with io.open(os.path.join(APP, 'public', 'data', 'seats_ae.json'), encoding='utf-8') as fh:
        for r in json.load(fh):
            out[(r['s'], int(r['y']), int(r['n']))] = r
    return out


def seat_shell(app_row, name):
    return {'n': name or app_row['c'], 'r': app_row.get('r'), 't': app_row.get('t'), 'vv': None, 'c': []}


def finish(seats):
    """Rank, trim to TOP_N, and fill vote share from the seat's own total where the source omits it."""
    for s in seats.values():
        s['c'].sort(key=lambda c: (c[2] is not None, c[2]), reverse=True)
        total = s['vv'] or sum(c[2] or 0 for c in s['c'])
        s['vv'] = total or None
        for c in s['c']:
            if c[3] is None and total and c[2] is not None:
                c[3] = round(c[2] / total * 100, 2)
        s['c'] = s['c'][:TOP_N]
    return seats


def read_a(src, stem, state, year, app):
    path = os.path.join(src, stem + '.csv')
    if not os.path.exists(path):
        return None
    seats, per = {}, defaultdict(list)
    for r in csv.DictReader(io.open(path, encoding='utf-8')):
        per[int(r['constituency_no'])].append(
            (tc(r['candidate']), std(r['party']),
             int(r['evm_votes'] or 0) + int(r['postal_votes'] or 0), None, tc(r['constituency'])))
    for no, rows in per.items():
        a = app.get((state, year, no))
        if not a:
            continue
        s = seat_shell(a, rows[0][4])
        s['c'] = [[c[0], c[1], c[2], c[3]] for c in rows]
        seats[str(no)] = s
    return finish(seats)


def read_b(src, folder, state, year, n_seats, app):
    try:
        import openpyxl
    except ImportError:
        print('  !! openpyxl not installed — skipping', state, year)
        return None
    base = os.path.join(src, 'b', folder)
    if not os.path.isdir(base):
        return None
    seats = {}
    for no in range(1, n_seats + 1):
        p = os.path.join(base, str(no) + '.xlsx')
        a = app.get((state, year, no))
        if not os.path.exists(p) or not a:
            continue
        ws = openpyxl.load_workbook(p, read_only=True).active
        s = seat_shell(a, None)
        for r in ws.iter_rows(min_row=2, values_only=True):
            if not r or r[1] is None:
                continue
            name = tc(str(r[1]))
            if name.upper() in ('TOTAL', 'NONE', ''):
                continue
            total, pct = r[5], r[6]
            s['c'].append([name, std(str(r[2] or '')),
                           int(total) if total is not None else None,
                           round(float(pct), 2) if pct is not None else None])
        if s['c']:
            seats[str(no)] = s
    return finish(seats)


def read_c(src, stem, state, year, app):
    path = os.path.join(src, stem + '.csv')
    if not os.path.exists(path):
        return None
    seats, per = {}, defaultdict(list)
    # not valid UTF-8 (stray 0xa0 bytes), and both files mix 2019 and 2024 rows
    for r in csv.DictReader(io.open(path, encoding='latin-1')):
        if r['YEAR'] != str(year):
            continue
        per[int(float(r['AC_NO']))].append(
            (tc(r['NAME']), std(r['PARTY']), int(float(r['VOTES'])),
             round(float(r['vote_percent']), 2), tc(r['AC_NAME']), r.get('polled_votes')))
    for no, rows in per.items():
        a = app.get((state, year, no))
        if not a:
            continue
        s = seat_shell(a, rows[0][4])
        try:
            s['vv'] = int(float(rows[0][5]))
        except (TypeError, ValueError):
            pass
        s['c'] = [[c[0], c[1], c[2], c[3]] for c in rows]
        seats[str(no)] = s
    return finish(seats)


def gate(state, year, seats, app):
    """The app's own winners are the authority. -> (ship?, agreement, (checked, sample misses))."""
    ok = n = 0
    misses = []
    for no, s in seats.items():
        a = app.get((state, year, int(no)))
        if not a or not s['c']:
            continue
        n += 1
        if s['c'][0][1] == a['p']:
            ok += 1
        elif len(misses) < 3:
            misses.append('AC %s %s: overlay says %s, app says %s' % (no, s['n'], s['c'][0][1], a['p']))
    return (ok / n if n else 0) >= MIN_AGREE, (ok / n if n else 0), (n, misses)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '.'
    app = app_seats()
    os.makedirs(OUT, exist_ok=True)
    per_state = defaultdict(dict)
    print('  gate: an election ships only if >= %.0f%% of its seats agree with the app\'s own winner\n' % (MIN_AGREE * 100))
    print('  %-28s %6s %18s  verdict' % ('election', 'seats', 'winner agreement'))

    jobs = []
    for stem, st, yr in SRC_A:
        jobs.append((st, yr, (lambda p=stem, s=st, y=yr: read_a(src, p, s, y, app))))
    for folder, st, yr, n in SRC_B:
        jobs.append((st, yr, (lambda f=folder, s=st, y=yr, k=n: read_b(src, f, s, y, k, app))))
    for stem, st, yr in SRC_C:
        jobs.append((st, yr, (lambda p=stem, s=st, y=yr: read_c(src, p, s, y, app))))

    shipped = refused = 0
    for state, year, fn in jobs:
        seats = fn()
        label = '%s %s' % (state, year)
        if not seats:
            print('  %-28s %6s %18s  SKIPPED' % (label, '-', 'source missing'))
            continue
        keep, agree, (n, misses) = gate(state, year, seats, app)
        print('  %-28s %6d %18s  %s' % (label, len(seats), '%.1f%% of %d' % (agree * 100, n),
                                        'ship' if keep else 'REFUSED — contradicts the app'))
        for m in misses:
            print('        ' + m)
        if keep:
            per_state[slug(state)].setdefault('AE', {})[str(year)] = seats
            shipped += 1
        else:
            refused += 1

    total = 0
    for st, payload in sorted(per_state.items()):
        p = os.path.join(OUT, st + '.json')
        with io.open(p, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, separators=(',', ':'), ensure_ascii=False)
        total += os.path.getsize(p)
    with io.open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(sorted(per_state), fh, separators=(',', ':'))
    print('\n  wrote %d state files (%.0f KB) covering %d elections%s'
          % (len(per_state), total / 1024, shipped,
             ('; %d refused by the gate' % refused) if refused else ''))


if __name__ == '__main__':
    main()
