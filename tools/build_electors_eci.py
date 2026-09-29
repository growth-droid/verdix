#!/usr/bin/env python3
"""Build per-state OFFICIAL electorate extracts from the Election Commission's statistical reports.

Input : tools/sources/eci_electors/*.csv — one CSV per election, parsed from ECI's statistical
        reports (AC Wise Voters Information / Constituency Data Summary / PC Wise Voters Turn Out).
        These are COMMITTED to the repo on purpose: ECI purges old result folders (the archived
        LS 2024 path already 404s), so the parsed copy is the only guaranteed way to rebuild.
Output: public/data/electors_eci/<slug>.json, in the ElectorRec shape data.ts expects:
          { "AE": { "<year>": { "<seat_no>": { e, m, f, tg, svc, vm, vf, vtg, vp, vt, t } } },
            "GE": { ... keyed by PC number ... } }

CSV contract (header): arena,state,year,seat_no,seat_name,el_m,el_f,el_tg,el_total,svc,
                       vt_m,vt_f,vt_tg,vt_postal,vt_total,poll_pct,source_file

⚠ data.ts treats this file as AUTHORITATIVE over public/data/electors/ (the bq_export baseline):
ECI is the primary official source, and the TCPD-derived baseline is measurably wrong in places
(Karnataka 2023: 0 of 224 seats agree; it sums 637,011 too high and cannot reproduce the official
73.84% turnout, which ECI's own figures do exactly). So every row here is GATED and CHECKED:
  · against the app's own seats (state-year must exist; seat number must exist),
  · against the seat NAME, so a shifted row can't land on the wrong constituency,
  · for arithmetic (m + f + tg should equal e; voters should not exceed electors).
A row that fails a hard check is dropped and reported — never written.

Run from product/app:  python tools/build_electors_eci.py [csv_dir]
"""
import csv, glob, io, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
DATA = os.path.join(APP, 'public', 'data')
OUT = os.path.join(DATA, 'electors_eci')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'sources', 'eci_electors')

sys.path.insert(0, HERE)
from build_candidates import canon_state, load_allowed, norm_seat, slug


def num(x):
    if x is None:
        return None
    s = str(x).replace(',', '').strip()
    if s in ('', '-', 'NA', 'N/A', 'nan', 'None'):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v == v else None


def inum(x):
    v = num(x)
    return int(round(v)) if v is not None else None


def app_seats():
    """(arena, state, year) -> {seat_no: normalised seat name}, from the app's own seat files."""
    out = defaultdict(dict)
    for arena, fname in (('AE', 'seats_ae.json'), ('GE', 'seats_ge.json')):
        rows = json.load(io.open(os.path.join(DATA, fname), encoding='utf-8'))
        ov = os.path.join(DATA, 'overlay.json')
        if os.path.exists(ov):
            rows = rows + json.load(io.open(ov, encoding='utf-8')).get('seats_ae' if arena == 'AE' else 'seats_ge', [])
        for r in rows:
            out[(arena, r['s'], int(r['y']))][int(r['n'])] = norm_seat(r['c'])
    return out


def baseline():
    """The bq_export totals already shipped in electors/, for the cross-check."""
    base = {}
    for f in glob.glob(os.path.join(DATA, 'electors', '*.json')):
        base[os.path.basename(f)[:-5]] = json.load(io.open(f, encoding='utf-8'))
    return base


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.csv')))
    if not files:
        sys.exit(f'no CSVs in {SRC}')
    allowed, known, numbering = load_allowed()
    seats = app_seats()
    base = baseline()

    per = defaultdict(lambda: {'AE': defaultdict(dict), 'GE': defaultdict(dict)})
    placed = defaultdict(lambda: {'AE': defaultdict(dict), 'GE': defaultdict(dict)})   # names placed per key
    stats = defaultdict(int)
    problems = []
    agree = defaultdict(lambda: [0, 0, 0])          # (arena,state,year) -> [compared, within 0.5%, sumdiff]

    for path in files:
        for r in csv.DictReader(io.open(path, encoding='utf-8-sig')):
            arena = (r.get('arena') or '').strip().upper()
            st = canon_state(r.get('state'), known)
            yr = inum(r.get('year'))
            no = inum(r.get('seat_no'))
            if arena not in ('AE', 'GE') or not st or yr is None or no is None:
                stats['malformed'] += 1
                continue
            if (st, yr) not in allowed[arena]:
                stats['not_carried'] += 1
                continue
            known_seats = seats.get((arena, st, yr), {})
            nm = norm_seat(r.get('seat_name'))
            if known_seats and no not in known_seats:
                stats['unknown_seat'] += 1       # e.g. Meghalaya 2023 Sohiong: countermanded, held later as a by-election
                problems.append(f'{arena} {st} {yr} seat {no} ({r.get("seat_name")}): not a seat in the app')
                continue
            if known_seats.get(no) and nm and not (known_seats[no] == nm or known_seats[no] in nm or nm in known_seats[no]):
                # Same number, different spelling. Audited across all 163 files: every case is a
                # transliteration or an old-vs-new name (Ujjain Uttar / North, Betanoti / Badasahi),
                # never a row shift: the longest run of consecutive mismatches is 3, and each run is
                # bracketed by exact matches. So the number stands.
                stats['name_variant'] += 1

            # Two seats can share a number. Pre-2020, Dadra & Nagar Haveli and Daman & Diu were
            # separate UTs each with PC 1; merged, they collide. Walk to the next free number so both
            # survive, the same rule build_electors.py and build_candidates.py use. The seat NAME is
            # stored on the record ('c') and the briefing verifies it on lookup, because the app's
            # own seat table still numbers both of them 1.
            key = no
            year_names = placed[st][arena][str(yr)]
            while str(key) in year_names and year_names[str(key)] != nm:
                key += 1
            if key != no:
                stats['renumbered'] += 1
            year_names[str(key)] = nm

            e = inum(r.get('el_total'))
            if not e or e <= 0:
                stats['no_electors'] += 1
                continue
            rec = {'e': e, 'c': (r.get('seat_name') or '').strip()}
            for k, col in (('m', 'el_m'), ('f', 'el_f'), ('tg', 'el_tg'), ('svc', 'svc'),
                           ('vm', 'vt_m'), ('vf', 'vt_f'), ('vtg', 'vt_tg'), ('vp', 'vt_postal'), ('vt', 'vt_total')):
                v = inum(r.get(col))
                if v is not None:
                    rec[k] = v
            t = num(r.get('poll_pct'))
            if t is not None:
                rec['t'] = round(t, 2)

            # ── hard checks ──
            if rec.get('vt') and rec['vt'] > e * 1.02:
                stats['voters_exceed_electors'] += 1
                problems.append(f'{arena} {st} {yr} seat {key}: {rec["vt"]:,} voted but only {e:,} electors — dropped')
                continue
            if 'm' in rec and 'f' in rec:
                g = rec['m'] + rec['f'] + rec.get('tg', 0)
                # some reports keep service electors outside the gender columns
                if abs(g - e) > max(50, e * 0.005) and abs(g + rec.get('svc', 0) - e) > max(50, e * 0.005):
                    stats['gender_not_summing'] += 1
                    problems.append(f'{arena} {st} {yr} seat {key}: m+f+tg = {g:,} vs total {e:,} — gender split dropped, total kept')
                    for k in ('m', 'f', 'tg'):
                        rec.pop(k, None)
                else:
                    stats['with_gender'] += 1

            per[st][arena][str(yr)][str(key)] = rec
            stats['kept'] += 1

            # ── cross-check against the bq_export baseline ──
            b = base.get(slug(st), {}).get(arena, {}).get(str(yr), {}).get(str(key))
            if b and b.get('e'):
                a = agree[(arena, st, yr)]
                a[0] += 1
                if abs(b['e'] - e) <= e * 0.005:
                    a[1] += 1
                a[2] += b['e'] - e

    os.makedirs(OUT, exist_ok=True)
    for st, doc in per.items():
        payload = {a: {y: dict(s) for y, s in doc[a].items()} for a in ('AE', 'GE')}
        with open(os.path.join(OUT, slug(st) + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, separators=(',', ':'))

    print(f'read {len(files)} CSVs from {SRC}')
    for k in ('kept', 'with_gender', 'renumbered', 'name_variant', 'not_carried', 'unknown_seat',
              'no_electors', 'gender_not_summing', 'voters_exceed_electors', 'malformed'):
        if stats[k]:
            print(f'   {k:<24} {stats[k]:,}')
    print(f'wrote {len(per)} state files -> public/data/electors_eci/')

    print('\ncross-check vs the bq_export baseline (seats within 0.5% / compared):')
    worst = sorted(agree.items(), key=lambda kv: kv[1][1] / max(1, kv[1][0]))
    for (arena, st, yr), (n, ok, diff) in worst[:15]:
        print(f'   {arena} {st:<26} {yr}  {ok:>4}/{n:<4} agree  · baseline sums {diff:+,} vs ECI')
    if problems:
        print(f'\n{len(problems)} rows needed attention (first 15):')
        for p in problems[:15]:
            print('   ' + p)


if __name__ == '__main__':
    main()
