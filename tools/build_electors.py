#!/usr/bin/env python3
"""Build per-state ELECTORATE extracts for the constituency briefing.

The database has always carried `total_electors` for ~80% of assembly seats and ~75% of Lok Sabha
seats, but build_extracts.py never passed it through — so the app had turnout and no electorate.
This carries it, per seat per election, into public/data/electors/<slug>.json.

Shape (compact keys, lazy-loaded one state at a time like cand/):
  { "AE": { "<year>": { "<seat_no>": { "e": electors, "vv": valid_votes, "t": turnout%,
                                        "m": male, "f": female, "tg": third_gender,     <- when known
                                        "vm": male_voters, "vf": female_voters } } },  <- when known
    "GE": { ... same, keyed by pc_no ... } }

Gender fields are OPTIONAL — they arrive from electoral-roll sources merged in by
tools/build_electors_overlay.py, never estimated. A seat without them simply omits the keys.

Like build_candidates.py, every row is GATED against the app's own seats_ae/seats_ge, which strips
by-election rows and normalises legacy state spellings.

Run from product/app:  python tools/build_electors.py
"""
import csv, gzip, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
BQ = os.path.join(APP, '..', 'bq_export')
DATA = os.path.join(APP, 'public', 'data')
OUT = os.path.join(DATA, 'electors')

sys.path.insert(0, HERE)
from build_candidates import canon_state, load_allowed, norm_seat, slug  # one source of truth for the gate


def fnum(x):
    try:
        v = float(x)
        return v if v == v else None   # NaN -> None
    except (TypeError, ValueError):
        return None


def inum(x):
    v = fnum(x)
    return int(v) if v is not None else None


def build(fname, arena, allowed, known, numbering):
    per = defaultdict(lambda: defaultdict(dict))
    names = defaultdict(lambda: defaultdict(dict))    # state -> year -> key -> seat name, for the collision check
    kept = skipped = no_e = remapped = 0
    with gzip.open(os.path.join(BQ, fname), 'rt', encoding='utf-8', errors='replace') as fh:
        for r in csv.DictReader(fh):
            st = canon_state(r.get('state_current') or r.get('state_asthen'), known)
            yr = inum(r.get('election_year'))
            no = inum(r.get('constituency_no'))
            if not st or yr is None or no is None:
                continue
            if (st, yr) not in allowed[arena]:
                skipped += 1           # by-elections and anything the app does not carry
                continue
            # Same numbering repair as build_candidates.py: keep the source's own number unless it
            # is already held by a DIFFERENT constituency, then prefer the app's number for this
            # name — but only when that name is unambiguous in the state-year (India reuses
            # constituency names; blind re-keying merges real seats).
            nm = norm_seat(r.get('constituency_name'))
            key = str(no)
            held = names[st][str(yr)].get(key)
            if held is not None and held != nm:
                appn = numbering[arena].get((st, yr), {}).get(nm)
                if appn is not None and names[st][str(yr)].get(str(appn)) in (None, nm):
                    key = str(appn)
                else:
                    # No unambiguous app number — the pre-2020 Dadra & Nagar Haveli / Daman & Diu
                    # case, where two UTs each had a PC numbered 1. Walk to the next free number,
                    # exactly as build_candidates.py does, so both seats survive (the ECI itself
                    # numbered them 1 and 2 after the 2020 merger).
                    nxt = int(key)
                    while str(nxt) in names[st][str(yr)] and names[st][str(yr)][str(nxt)] != nm:
                        nxt += 1
                    key = str(nxt)
                remapped += 1
            e = inum(r.get('total_electors'))
            if e is None or e <= 0:
                no_e += 1
                continue
            rec = {'e': e, 'c': (r.get('constituency_name') or '').strip()}
            vv = inum(r.get('total_valid_votes'))
            if vv:
                rec['vv'] = vv
            t = fnum(r.get('turnout_pct'))
            if t is not None:
                rec['t'] = round(t, 2)
            per[st][str(yr)][key] = rec
            names[st][str(yr)][key] = nm
            kept += 1
    print(f'  {arena}: {kept:,} seats with electors · {no_e:,} with none in the source · '
          f'{remapped} re-numbered onto their own seat · {skipped:,} rows skipped (by-elections / not carried)')
    return per


def main():
    os.makedirs(OUT, exist_ok=True)
    allowed, known, numbering = load_allowed()
    ae = build('fact_ae_winners.csv.gz', 'AE', allowed, known, numbering)
    ge = build('fact_ge_winners.csv.gz', 'GE', allowed, known, numbering)
    states = sorted(set(ae) | set(ge))
    for st in states:
        doc = {'AE': ae.get(st, {}), 'GE': ge.get(st, {})}
        with open(os.path.join(OUT, slug(st) + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(doc, fh, separators=(',', ':'))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'\nwrote {len(states)} state files ({total/1024:.0f} KB total) -> public/data/electors/')


if __name__ == '__main__':
    main()
