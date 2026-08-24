#!/usr/bin/env python3
"""Build per-state TOP-5 candidate extracts for the positions table.

Reads (read-only) ../bq_export/fact_ae_candidates.csv.gz + fact_ge_candidates_pc.csv.gz and
writes one compact file per state to public/data/cand/<slug>.json, so the app lazy-loads only
the state being viewed.

Shape (arrays, not objects, to keep the files small):
  { "AE": { "<year>": { "<seat_no>": { "n": "<seat name>", "r": "<reservation>",
                                       "t": <turnout%>, "vv": <valid votes>,
                                       "c": [ [candidate, party, votes, share%], ... up to 5 ] } } },
    "GE": { ... same, keyed by pc_no ... } }

Run from product/app:  python tools/build_candidates.py
"""
import csv, gzip, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
BQ = os.path.join(APP, '..', 'bq_export')
OUT = os.path.join(APP, 'public', 'data', 'cand')
TOP_N = 5

# The candidate tables also contain BY-ELECTION rows and a few legacy state spellings. The app's
# own seat files are the authority on which (state, year) pairs are real general elections and on
# how a state is named, so we gate every row against them.
NAME_FIX = {
    'nct of delhi': 'Delhi',
    'dadra & nagar haveli': 'Dadra & Nagar Haveli and Daman & Diu',
    'daman & diu': 'Dadra & Nagar Haveli and Daman & Diu',
    'dadra & nagar haveli and daman & diu': 'Dadra & Nagar Haveli and Daman & Diu',
    'orissa': 'Odisha',
    'pondicherry': 'Puducherry',
    'uttaranchal': 'Uttarakhand',
}

def canon_state(name, known):
    """Map a source state name onto the app's spelling."""
    raw = (name or '').strip()
    k = raw.lower().replace(' and ', ' & ')
    if k in NAME_FIX:
        return NAME_FIX[k]
    for app_name in known:
        if app_name.lower().replace(' and ', ' & ') == k:
            return app_name
    return raw

def load_allowed():
    """{'AE': {(state, year), ...}, 'GE': {...}} from the app's shipped extracts + the 2004 overlay."""
    data = os.path.join(APP, 'public', 'data')
    allowed, states = {}, set()
    for arena, fname in (('AE', 'seats_ae.json'), ('GE', 'seats_ge.json')):
        with open(os.path.join(data, fname), encoding='utf-8') as fh:
            rows = json.load(fh)
        pairs = {(r['s'], int(r['y'])) for r in rows}
        ov = os.path.join(data, 'overlay.json')
        if os.path.exists(ov):
            with open(ov, encoding='utf-8') as fh:
                o = json.load(fh)
            for r in o.get('seats_ae' if arena == 'AE' else 'seats_ge', []):
                pairs.add((r['s'], int(r['y'])))
        allowed[arena] = pairs
        states |= {s for s, _ in pairs}
    return allowed, states

def slug(s):
    return re.sub(r'_+', '_', re.sub(r'[^a-z0-9]+', '_', s.lower())).strip('_')

def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def inum(x):
    v = fnum(x)
    return int(v) if v is not None else None

# state_current in the source already carries the AP/Telangana split and Ladakh, so it matches
# the app's own state naming — no extra back-mapping needed here.
def build(fname, arena, seat_no_col, seat_name_col, valid_col, allowed, known_states):
    path = os.path.join(BQ, fname)
    if not os.path.exists(path):
        print(f'  !! missing {fname} — skipping {arena}')
        return {}
    per_state = defaultdict(lambda: defaultdict(dict))
    rows = 0
    skipped = [0]
    with gzip.open(path, 'rt', encoding='utf-8', errors='replace') as fh:
        for r in csv.DictReader(fh):
            pos = fnum(r.get('position'))
            if pos is None or pos > TOP_N:
                continue
            st = canon_state(r.get('state_current') or r.get('state_asthen'), known_states)
            yr = inum(r.get('election_year'))
            no = inum(r.get(seat_no_col))
            if not st or yr is None or no is None:
                continue
            # drop by-elections and anything the app does not itself carry as a general election
            if (st, yr) not in allowed[arena]:
                skipped[0] += 1
                continue
            bucket = per_state[st][str(yr)]
            seat = bucket.get(str(no))
            if seat is None:
                seat = {
                    'n': (r.get(seat_name_col) or '').strip(),
                    'r': (r.get('reservation') or '').strip() or None,
                    't': fnum(r.get('turnout_pct')),
                    'vv': inum(r.get(valid_col)),
                    'c': [],
                }
                bucket[str(no)] = seat
            seat['c'].append([
                (r.get('candidate') or '').strip(),
                (r.get('party') or '').strip(),
                inum(r.get('votes')),
                fnum(r.get('vote_share_pct')),
            ])
            rows += 1
    # keep each seat's candidates ordered by votes desc (source position can have ties/gaps)
    for st in per_state:
        for yr in per_state[st]:
            for seat in per_state[st][yr].values():
                seat['c'].sort(key=lambda c: (c[2] is not None, c[2]), reverse=True)
                seat['c'] = seat['c'][:TOP_N]
    print(f'  {arena}: {rows:,} candidate rows across {len(per_state)} states '
          f'({skipped[0]:,} rows skipped — by-elections / elections the app does not carry)')
    return per_state

def main():
    os.makedirs(OUT, exist_ok=True)
    allowed, known = load_allowed()
    print(f'  gating against the app: {len(allowed["AE"])} AE and {len(allowed["GE"])} GE state-elections')
    ae = build('fact_ae_candidates.csv.gz', 'AE', 'constituency_no', 'constituency_name', 'constituency_valid_votes', allowed, known)
    ge = build('fact_ge_candidates_pc.csv.gz', 'GE', 'pc_no', 'pc_name', 'pc_valid_votes', allowed, known)

    states = sorted(set(ae) | set(ge))
    index, total = {}, 0
    for st in states:
        payload = {'AE': ae.get(st, {}), 'GE': ge.get(st, {})}
        p = os.path.join(OUT, slug(st) + '.json')
        with open(p, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, separators=(',', ':'), ensure_ascii=False)
        kb = os.path.getsize(p) / 1024
        total += kb
        index[st] = slug(st)
        print(f'    {st:<32} {kb:7.0f} KB   AE years {len(payload["AE"])}  GE years {len(payload["GE"])}')
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(index, fh, separators=(',', ':'), ensure_ascii=False)
    print(f'\nwrote {len(states)} state files + index.json ({total/1024:.1f} MB total, lazy-loaded one at a time)')

if __name__ == '__main__':
    sys.exit(main())
