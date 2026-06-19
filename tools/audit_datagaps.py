# Read-only audit of every data gap in the app extracts + bq_export source. Reports by category.
# Re-run after a Cowork data refresh to confirm gaps closed:  python tools/audit_datagaps.py
import csv, gzip, json, os, sys
from collections import defaultdict, Counter
try: sys.stdout.reconfigure(encoding='utf-8')   # Windows console is cp1252 by default
except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
BQ = os.path.normpath(os.path.join(HERE, '..', '..', 'bq_export'))
DATA = os.path.normpath(os.path.join(HERE, '..', 'public', 'data'))
J = lambda f: json.load(open(os.path.join(DATA, f), encoding='utf-8'))
def rows(name):
    with gzip.open(os.path.join(BQ, name + '.csv.gz'), 'rt', encoding='utf-8') as fh:
        yield from csv.DictReader(fh)

seatsAE, seatsGE = J('seats_ae.json'), J('seats_ge.json')
turn = J('state_turnout.json'); byp = J('bypolls.json'); segs = J('segments.json')
def elc(rows_):
    c = Counter()
    for r in rows_: c[(r['s'], r['y'])] += 1
    return c
nAE, nGE = elc(seatsAE), elc(seatsGE)

def pct_missing(rows_, field):
    by = defaultdict(lambda: [0, 0])
    for r in rows_:
        k = (r['s'], r['y']); by[k][1] += 1
        if r.get(field) is None: by[k][0] += 1
    return by

print('================= DATA-GAPS REPORT =================')

print('\n### [1] TURNOUT ###')
# GE state turnout coverage
ge_ty = sorted({k.split('|')[1] for k in turn['GE']})
ae_ty = sorted({k.split('|')[1] for k in turn['AE']})
print(f'  GE state-turnout years present: {ge_ty}  (GE elections in data: {sorted({y for _,y in nGE})})')
print(f'  AE state-turnout: {len(turn["AE"])} state-year entries present')
# AE elections (from dim_ae_index) with null turnout
ae_null_t = []
for r in rows('dim_ae_index'):
    if not (r.get('turnout_pct') or '').strip():
        ae_null_t.append(f"{r['state_asthen']} {r['election_year']}")
print(f'  AE elections with NULL state turnout in dim_ae_index: {ae_null_t or "none"}')
# seat-level turnout fully missing per election
for tag, seats, n in [('AE', seatsAE, nAE), ('GE', seatsGE, nGE)]:
    pm = pct_missing(seats, 't')
    full = sorted([f'{s} {y} ({tot})' for (s, y), (m, tot) in pm.items() if m == tot])
    if full: print(f'  {tag}: seat-level turnout (t) ENTIRELY missing in {len(full)} elections:')
    for x in full: print('       ', x)

print('\n### [2] WINNER MARGIN % & VOTE-SHARE % (seat winners) ###')
for tag, seats in [('AE', seatsAE), ('GE', seatsGE)]:
    for field, lab in [('m', 'margin%'), ('v', 'winner share%')]:
        pm = pct_missing(seats, field)
        full = sorted([f'{s} {y} ({m}/{tot})' for (s, y), (m, tot) in pm.items() if m > 0])
        tot_missing = sum(m for m, _ in pm.values())
        if tot_missing:
            print(f'  {tag} {lab}: {tot_missing} seats missing across {len(full)} elections')
            part = [x for x in full if x.split("(")[1].split("/")[0] != x.split("/")[1].rstrip(") ")]
            for x in full[:60]: print('       ', x)

print('\n### [3] RUNNER-UP (party q) ###')
for tag, seats in [('AE', seatsAE), ('GE', seatsGE)]:
    pm = pct_missing(seats, 'q')
    full = sorted([f'{s} {y} ({m}/{tot})' for (s, y), (m, tot) in pm.items() if m > 0])
    if full:
        print(f'  {tag}: {sum(m for m,_ in pm.values())} winners missing runner-up across {len(full)} elections')
        for x in full[:40]: print('       ', x)

print('\n### [4] ALLIANCE ###')
for tag, seats in [('AE', seatsAE), ('GE', seatsGE)]:
    nullA = [f'{s} {y}' for (s, y), (m, tot) in pct_missing(seats, 'a').items() for _ in [0] if m > 0]
    print(f'  {tag}: seats with NULL alliance — {sum(1 for r in seats if r.get("a") is None)} seats'
          + (f' in {sorted(set(nullA))}' if nullA else ''))
# elections where EVERY winner is Unaligned/Independent (possible missing tags)
for tag, seats in [('AE', seatsAE), ('GE', seatsGE)]:
    byk = defaultdict(list)
    for r in seats: byk[(r['s'], r['y'])].append(r.get('a'))
    allun = [f'{s} {y}' for (s, y), al in byk.items() if all((a or 'Unaligned') in ('Unaligned', 'Independent/Unaligned') for a in al)]
    if allun: print(f'  {tag}: every winner Unaligned (no alliance tags at all): {sorted(allun)}')
print('  Unresolved seats-vs-summary disagreements: Maharashtra 2024 RYSP, Rajasthan 2023 RLP (micro-allies)')

print('\n### [5] FULL CANDIDATE LISTS (needed for alliance-arithmetic, AE→GE split, battleground) ###')
def cand_cov(fact, arena, ncol, expected):
    seen = defaultdict(set)
    for r in rows(fact):
        if r.get('election_type') != arena: continue
        n = r.get(ncol)
        if n: seen[(r['state_current'], int(r['election_year']))].add(n)
    out = []
    for (s, y), exp in expected.items():
        got = len(seen.get((s, y), set()))
        if got < exp * 0.95:
            out.append(f'{s} {y}: candidates for {got}/{exp} seats')
    return sorted(out)
ae_wo = cand_cov('fact_ae_candidates', 'AE', 'constituency_no', nAE)
ge_wo = cand_cov('fact_ge_candidates_pc', 'GE', 'pc_no', nGE)
print(f'  AE winners-only / partial candidate lists ({len(ae_wo)}):')
for x in ae_wo: print('       ', x)
print(f'  GE winners-only / partial candidate lists ({len(ge_wo)}):')
for x in ge_wo: print('       ', x)

print('\n### [6] BYPOLLS ###')
nov = sum(1 for r in byp if r.get('v') is None)
nom = sum(1 for r in byp if r.get('m') is None)
noret = sum(1 for r in byp if r.get('ret') not in ('Y', 'N'))
yrs_nov = sorted({r['y'] for r in byp if r.get('v') is None})
print(f'  bypolls total: {len(byp)}; missing votes/share: {nov} (years {yrs_nov}); missing margin: {nom}; missing retention: {noret}')

print('\n### [7] SEGMENTS / SPLIT (AE↔GE Compare) ###')
seg_states = defaultdict(set)
for r in segs: seg_states[r['y']].add(r['s'])
all_states = sorted({s for s, _ in nGE})
for y in sorted(seg_states):
    missing = sorted(set(all_states) - seg_states[y])
    print(f'  GE {y}: segments for {len(seg_states[y])} states; MISSING: {missing or "none"}')
print('  (J&K + Ladakh intentionally excluded — non-comparable segment numbering)')

print('\n### [8] KNOWN SOURCE CAVEATS (no action unless you have better data) ###')
print('  - GE-2024 PC/segment vote-shares are EVM-only; Surat 2024 absent (unopposed).')
print('  - J&K 2014↔2024 and Assam pre/post-2023 are different delimitations (never swing across).')
print('================= END =================')
