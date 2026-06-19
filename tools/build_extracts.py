# Derives the app's standalone JSON extracts from ../../bq_export/*.csv.gz (read-only).
# Re-run after Cowork refreshes bq_export:  python tools/build_extracts.py
# Short keys keep payloads small: s=state(current) y=year n=seat-no j=normalized-seat-no
# c=seat-name r=reservation p=party a=alliance w=winner-name v=winner-share q=runnerup-party
# qn=runnerup-name m=margin-pct t=turnout-pct f=contested(fought) wo=won mo=poll-month
import csv, gzip, json, os, re
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
BQ = os.path.normpath(os.path.join(HERE, '..', '..', 'bq_export'))
OUT = os.path.normpath(os.path.join(HERE, '..', 'public', 'data'))
os.makedirs(os.path.join(OUT, 'split'), exist_ok=True)

def rows(name):
    with gzip.open(os.path.join(BQ, name + '.csv.gz'), 'rt', encoding='utf-8') as fh:
        yield from csv.DictReader(fh)

def num(x, nd=2):
    if x is None or x == '': return None
    try: v = float(x)
    except ValueError: return None
    return int(v) if nd == 0 else round(v, nd)

def i(x):
    v = num(x, 0); return v

def dump(name, obj):
    p = os.path.join(OUT, name)
    with open(p, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, separators=(',', ':'), ensure_ascii=False)
    print(f'{name:42s} {os.path.getsize(p)/1e6:6.2f} MB  rows={len(obj) if isinstance(obj,list) else "-"}')

# ── Party-name standardisation ──────────────────────────────────────────
# Sources disagree: TCPD uses short codes, wiki-era AE summaries use full English
# names (+ Wikipedia infobox junk rows), and the same party can appear as several
# tokens (Bharat Rashtra Samithi / BRS / TRS / BHRS). std() folds everything to one
# canonical code so AE and GE views line up. (canon() from scripts/alliances.py is the
# upstream code-variant mapper; we import it when available and layer full-name maps on top.)
import sys
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', '..', 'scripts')))
try:
    from alliances import canon as _canon
except Exception:
    def _canon(p): return p

FULLNAME = {
    'indian national congress': 'INC', 'bharatiya janata party': 'BJP',
    'bharat rashtra samithi': 'BRS', 'telangana rashtra samithi': 'BRS',
    'communist party of india': 'CPI', 'communist party of india (marxist)': 'CPM',
    'communist party of india  (marxist)': 'CPM',
    'communist party of india (marxist-leninist) (liberation)': 'CPI(ML)L',
    'jana sena party': 'JSP', 'janasena party': 'JSP', 'jana sena': 'JSP', 'janasena': 'JSP',
    'telugu desam party': 'TDP', 'ysr congress party': 'YSRCP',
    'yuvajana sramika rythu congress party': 'YSRCP',
    'all india majlis-e-ittehadul muslimeen': 'AIMIM', 'aam aadmi party': 'AAP',
    'dravida munnetra kazhagam': 'DMK', 'all india anna dravida munnetra kazhagam': 'AIADMK',
    'all india trinamool congress': 'AITC', 'trinamool congress': 'AITC',
    'nationalist congress party': 'NCP', 'nationalist congress party – sharadchandra pawar': 'NCP(SP)',
    'janata dal (united)': 'JD(U)', 'janata dal(united)': 'JD(U)', 'janata dal (secular)': 'JD(S)',
    'shiv sena': 'SHS', 'shiv sena (uddhav balasaheb thackeray)': 'SHS(UBT)',
    'biju janata dal': 'BJD', 'rashtriya janata dal': 'RJD', 'samajwadi party': 'SP',
    'bahujan samaj party': 'BSP', 'naam tamilar katchi': 'NTK', 'jharkhand mukti morcha': 'JMM',
    'rashtriya loktantrik party': 'RLP', 'shiromani akali dal': 'SAD', 'national people’s party': 'NPP',
    "national people's party": 'NPP', 'sikkim krantikari morcha': 'SKM',
    # regional / newer / split parties — fold the full ECI name to the abbreviation the
    # seats file already uses, so party-summary vote share joins to the seat winner.
    'bharat adivasi party': 'BAP', 'rashtriya lok dal': 'RLD',
    'sikkim democratic front': 'SDF', 'united peoples party, liberal': 'UPPL',
    "united people's party, liberal": 'UPPL', 'votpp': 'VPP',
    'voice of the people party': 'VPP', 'zoram peoples movement': 'ZPM',
    "zoram people's movement": 'ZPM', 'aisf': 'ISF',
    # double-space (not en-dash) variant of the Sharad-Pawar NCP, post whitespace-collapse
    'nationalist congress party sharadchandra pawar': 'NCP(SP)',
    'independents': 'IND', 'independent': 'IND', 'others': 'OTH', 'other parties': 'OTH',
}
# Wikipedia infobox / aggregate rows that are NOT parties — dropped from party summaries.
# Matched case-insensitively (sources vary "Invalid votes"/"Invalid Votes") and after footnote
# markers are stripped ("Independents[29]"), so junk stops leaking in as fake parties.
JUNK = {'OTH', 'NOTA'}
JUNK_WORDS = {'others', 'total', 'other parties and independents'}
JUNK_RE = re.compile(r'(valid votes|invalid|blank votes|registered voters|votes cast|vote statistics|'
                     r'turnout|abstention|tendered|none of the above|other parties)', re.I)
CODEFIX = {'TRS': 'BRS', 'BHRS': 'BRS'}  # unify Telangana party code across cycles

# cp1252 mojibake (en-dash 0x96, apostrophe 0x92) and smart punctuation leak in from
# wiki/ECI sources — e.g. "Party<0x96>Sharadchandra", "People<0x92>s". Fold to plain
# forms so the FULLNAME lookup and whitespace-collapse below can match.
_PUNCT = {
    0x91: "'", 0x92: "'", 0x2018: "'", 0x2019: "'",
    0x93: '"', 0x94: '"', 0x201c: '"', 0x201d: '"',
    0x96: ' ', 0x97: ' ', 0x2013: ' ', 0x2014: ' ',
}
def std(p):
    if p is None or p == '': return p
    p = str(p).strip()
    p = re.sub(r'\s*\[[^\]]*\]\s*$', '', p)   # drop Wikipedia footnote markers ("Independents[29]")
    p = p.translate(_PUNCT)                   # normalise cp1252 mojibake / smart punctuation
    p = re.sub(r'\s+', ' ', p).strip()        # collapse internal whitespace ("NCP  SP", dash→space)
    p = FULLNAME.get(p.lower(), p)   # full English name → code
    p = _canon(p)                    # abbreviation variants (CPI(M)→CPM, ADMK→AIADMK, …)
    p = CODEFIX.get(p, p)            # TRS/BHRS → BRS
    return p
def is_junk(p):
    if p is None or str(p).strip() == '': return True
    c = std(p)
    if c in JUNK: return True
    s = str(c).strip().lower()
    return s in JUNK_WORDS or bool(JUNK_RE.search(s))

# ── Alliance-label normalisation ────────────────────────────────────────
# House rule (root CLAUDE.md): a pre-poll alliance containing BJP → "BJP Alliance (name)",
# containing INC → "INC Alliance (name)"; any other bloc keeps its own front name; a party
# with no coalition is "Unaligned". Sources break this several ways, which astd() repairs so
# seat facts and party summaries agree (audited across all AE+GE):
#   1) regional NDA/UPA brands left un-prefixed (Andhra's "Kutami" → "BJP Alliance (NDA)");
#   2) a solo party's OWN NAME used as its "alliance" (YSRCP/BRS/AIMIM/AAP/BSP…) ≡ Unaligned;
#   3) BJP / INC themselves left "Unaligned"/own-name where they led with no state allies —
#      they always anchor their own bloc, so → "BJP Alliance (BJP)" / "INC Alliance (INC)";
#   4) independents normalised to one label.
# Plus a tiny per-(state,year,party) override for memberships the source got outright wrong.
# Canonically this belongs upstream in scripts/alliances.py (Cowork lane) — keep it short.
ALLIANCE_FOLD = {
    'kutami': 'BJP Alliance (NDA)',     # Andhra 2024 NDA = TDP + Jana Sena (JSP) + BJP
}
ALLIANCE_OVERRIDE = {
    ('Andhra Pradesh', 2024): {'TDP': 'BJP Alliance (NDA)', 'JSP': 'BJP Alliance (NDA)', 'BJP': 'BJP Alliance (NDA)'},
    ('Telangana', 2023): {'CPI': 'INC Alliance (INC-CPI)'},   # CPI fought 2023 inside the Congress front
}
def astd(s, y, p, a):
    """Normalise an alliance label for (state, year, party-code)."""
    ov = ALLIANCE_OVERRIDE.get((s, y))
    if ov and p in ov: return ov[p]
    a = (a or '').strip()
    if a.lower() in ALLIANCE_FOLD: return ALLIANCE_FOLD[a.lower()]
    code = std(a) if a else None              # is the "alliance" really just a party's name?
    if p == 'BJP' or code == 'BJP': return a if a.startswith('BJP Alliance') else 'BJP Alliance (BJP)'
    if p == 'INC' or code == 'INC': return a if a.startswith('INC Alliance') else 'INC Alliance (INC)'
    if p == 'IND' or code == 'IND': return 'Independent/Unaligned'
    if code and code == p: return 'Unaligned'   # ran under its own banner → solo
    return a or None
    return None

# Normalized seat number `j` — one continuity domain per seat across renumberings.
# AE domain = undivided-AP/2008-era numbering (matches the AC geojson).
def j_ae(s, y, n):
    if s == 'Andhra Pradesh' and y >= 2014: return n + 119  # post-split AP renumbered 1-175
    return n

# GE domain = current (2019+) numbering.
def j_ge(s, y, n, cname):
    if s == 'Andhra Pradesh' and y <= 2014: return n - 17       # undivided PC numbering (TG block first)
    if s == 'Dadra & Nagar Haveli and Daman & Diu':              # merged UT: two seats both n=1 pre-2020
        return 1 if 'DAMAN' in cname.upper() else 2
    if s == 'Ladakh': return 1                                   # n=4 as J&K PC pre-2019, n=1 in 2024
    if s == 'Jammu & Kashmir' and y <= 2019 and n >= 5: return n - 1  # old: 4=Ladakh,5=Udhampur,6=Jammu → new 4,5
    return n

# PC valid votes from the candidates table — backfills 2024 GE percentages
# (fact_ge_winners 2024 has raw votes but total_valid_votes=0, so *_pct are null there).
PCV = {}
for _r in rows('fact_ge_candidates_pc'):
    if _r['election_type'] != 'GE': continue
    _pv = num(_r['pc_valid_votes'])
    if _pv: PCV[(int(_r['election_year']), _r['state_current'], i(_r['pc_no']))] = _pv

# ---- seat-level winners --------------------------------------------------
def seats(fact, arena):
    out = []
    for r in rows(fact):
        s = r['state_current']; y = int(r['election_year']); n = i(r['constituency_no'])
        v = num(r['winner_voteshare_pct'])
        m = num(r['margin_pct'])
        if arena == 'GE' and (m is None or v is None):
            pv = PCV.get((y, s, n))
            if pv:
                wv = num(r['winner_votes'], 0); mv = num(r['margin'], 0)
                if v is None and wv: v = round(wv / pv * 100, 2)
                if m is None and mv: m = round(mv / pv * 100, 2)
        if m is None:
            # wiki-era rows carry raw votes + winner share but no totals: derive the denominator
            wv = num(r['winner_votes'], 0); mv = num(r['margin'], 0)
            if wv and mv and v:
                m = round(mv / (wv / (v / 100)) * 100, 2)
        wp = std(r['winner_party'])
        out.append({
            's': s, 'y': y, 'n': n,
            'j': j_ae(s, y, n) if arena == 'AE' else j_ge(s, y, n, r['constituency_name']),
            'c': r['constituency_name'], 'r': r['reservation'] or None,
            'p': wp, 'a': astd(s, y, wp, r['winner_alliance']),
            'w': r['winner_name'] or None, 'v': v,
            'q': std(r['runnerup_party']) or None, 'qn': r['runnerup_name'] or None,
            'm': m, 't': num(r['turnout_pct']),
        })
    return out

def fill_reservation(seats_list, label):
    """Reservation (GEN/SC/ST and Sikkim's BL) is FIXED within a delimitation, so derive ONE
    canonical category per (state, normalized seat `j`) and apply it to every election of that
    seat. A seat reserved (SC/ST/BL) in ANY election is reserved in ALL — so this also REPAIRS
    years that shipped every seat as GEN (e.g. GE-2024 lost all SC/ST labels). Returns seats
    with no source in any election (residual blanks) for reporting."""
    res = defaultdict(Counter)
    for r in seats_list:
        v = (r['r'] or '').strip().upper()
        if v: res[(r['s'], r['j'])][v] += 1
    def canon(c):
        for cat in ('SC', 'ST', 'BL', 'SAN'):   # reserved category wins over a stray GEN
            if c.get(cat): return cat
        return c.most_common(1)[0][0] if c else None
    filled = 0; fixed = 0; blanks = []
    for r in seats_list:
        cur = (r['r'] or '').strip().upper() or None
        cn = canon(res.get((r['s'], r['j'])))
        if cn:
            if cur is None: filled += 1
            elif cn != cur: fixed += 1   # repaired a wrong label (e.g. 2024 GEN → SC)
            r['r'] = cn
        else:
            r['r'] = None; blanks.append((r['s'], r['y'], r['n'], r['c']))
    print(f'reservation fill [{label}]: filled {filled} blanks, repaired {fixed} mislabelled, residual blanks {len(blanks)}')
    return blanks

seats_ae = seats('fact_ae_winners', 'AE')
seats_ge = seats('fact_ge_winners', 'GE')
res_blanks = fill_reservation(seats_ae, 'AE') + fill_reservation(seats_ge, 'GE')
if res_blanks:
    print('⚠ RESIDUAL reservation blanks (no carry-forward source — TELL THE USER):')
    for s, y, n, c in res_blanks: print(f'    {s} {y} AC/PC {n} {c}')
dump('seats_ae.json', seats_ae)
dump('seats_ge.json', seats_ge)
seat_count = Counter()  # expected seats per (arena, state, year) — gates candidate-coverage checks
for arena, lst in (('AE', seats_ae), ('GE', seats_ge)):
    for r in lst: seat_count[(arena, r['s'], r['y'])] += 1

# ---- party summaries -----------------------------------------------------
# Vote-share backfill for the recent assembly elections that shipped as WINNERS-ONLY in
# bq_export (no candidate votes → null party vote share, which broke the swing chart and the
# vote line). Statewide party vote-share % from the official results via Wikipedia/ECI
# (compiled 2026-06-17). Applied ONLY where the source voteshare is null, so a later
# bq_export refresh transparently overrides it. Keys are std() party codes; values are % of
# total valid votes. Unreliable combined-Independent/residual figures are intentionally omitted.
# (Pending: Kerala 2026 — not yet in a reliable source at compile time.)
VOTESHARE_SUPPLEMENT = {
    ('Chhattisgarh', 2023): {'BJP': 46.27, 'INC': 42.23, 'GGP': 1.11, 'BSP': 2.05},
    ('Mizoram', 2023): {'ZPM': 37.87, 'MNF': 35.11, 'INC': 20.80, 'BJP': 5.05},
    ('Arunachal Pradesh', 2024): {'BJP': 54.57, 'NPP': 16.11, 'NCP': 10.43, 'PPA': 7.24, 'INC': 5.56, 'IND': 4.66},
    ('Haryana', 2024): {'BJP': 39.94, 'INC': 39.09, 'INLD': 4.14, 'BSP': 1.82, 'JJP': 0.90},
    ('Jammu & Kashmir', 2024): {'JKNC': 23.43, 'BJP': 25.63, 'INC': 11.97, 'JKPDP': 8.87, 'JKPC': 2.5, 'CPM': 0.59, 'AAP': 0.52},
    ('Jharkhand', 2024): {'JMM': 23.44, 'BJP': 33.18, 'INC': 15.56, 'JLKM': 6.20, 'RJD': 3.44, 'AJSU': 3.54, 'CPI(ML)L': 1.89, 'JD(U)': 0.81, 'LJP(RV)': 0.61},
    ('Assam', 2026): {'BJP': 37.81, 'INC': 29.84, 'AGP': 6.48, 'AIUDF': 5.46, 'BPF': 3.73, 'RD': 2.68, 'AJP': 2.52, 'AITC': 0.89},
}

def party(fact, state_col='state_current'):
    out = []
    for r in rows(fact):
        p = std(r['party'])
        if not p or is_junk(p): continue   # drop Wikipedia infobox / aggregate rows
        s = r[state_col] if state_col else None
        y = int(r['election_year'])
        v = num(r['voteshare_pct'])
        if v is None and s is not None:    # winners-only election → fill from the sourced supplement
            v = VOTESHARE_SUPPLEMENT.get((s, y), {}).get(p)
        out.append({**({'s': s} if state_col else {}),
                    'y': y, 'p': p, 'a': astd(s, y, p, r['alliance']),
                    'f': i(r['seats_contested']), 'wo': i(r['seats_won']), 'v': v})
    return out

dump('party_ae.json', party('agg_ae_party_summary'))

# GE party summaries are computed from the PC-candidates fact table:
# the shipped agg_ge_* tables lack 2024 and carry a broken national seats_contested.
ge_state = {}           # (y, s, p) -> [contested, won, votes, alliance]
pc_valid = {}           # (y, s, pc) -> valid votes
for r in rows('fact_ge_candidates_pc'):
    if r['election_type'] != 'GE': continue  # bypoll candidate rows interleave odd years
    y = int(r['election_year']); s = r['state_current']; p = std(r['party'])
    if not p or is_junk(p): continue
    k = (y, s, p)
    e = ge_state.setdefault(k, [0, 0, 0.0, astd(s, y, p, r['alliance'])])
    e[0] += 1
    if num(r['position'], 0) == 1: e[1] += 1
    e[2] += num(r['votes']) or 0
    pv = num(r['pc_valid_votes'])
    if pv: pc_valid[(y, s, i(r['pc_no']))] = pv

state_valid = defaultdict(float); nat_valid = defaultdict(float)
for (y, s, _pc), v in pc_valid.items():
    state_valid[(y, s)] += v; nat_valid[y] += v

out_state = []
nat = {}                # (y, p) -> [contested, won, votes, alliance]
for (y, s, p), (f, w, votes, al) in sorted(ge_state.items()):
    sv = state_valid[(y, s)]
    out_state.append({'s': s, 'y': y, 'p': p, 'a': al, 'f': f, 'wo': w,
                      'v': round(votes / sv * 100, 2) if sv else None})
    e = nat.setdefault((y, p), [0, 0, 0.0, al])
    e[0] += f; e[1] += w; e[2] += votes
    if al: e[3] = al
dump('party_ge_state.json', out_state)
dump('party_ge_nat.json', [
    {'y': y, 'p': p, 'a': al, 'f': f, 'wo': w, 'v': round(votes / nat_valid[y] * 100, 2) if nat_valid[y] else None}
    for (y, p), (f, w, votes, al) in sorted(nat.items())
])

# ---- state-level turnout ----
# AE: dim_ae_index (full coverage incl. wiki-era), keyed by state_asthen.
# GE: agg_ge_state_turnout — the dedicated ECI-final table (elector-weighted, full coverage
#     incl. 2024), keyed by state_current; fall back to the mean of PC turnouts from
#     fact_ge_winners only for any (state,year) that table happens to miss.
turnout = {'AE': {}, 'GE': {}}
for r in rows('dim_ae_index'):
    t = num(r['turnout_pct'])
    if t is not None:
        turnout['AE'][f"{r['state_asthen']}|{int(r['election_year'])}"] = t
for r in rows('agg_ge_state_turnout'):
    t = num(r['turnout_pct'])
    if t is not None:
        turnout['GE'][f"{r['state_current']}|{int(float(r['election_year']))}"] = t
ge_turn = defaultdict(list)
for r in rows('fact_ge_winners'):
    t = num(r['turnout_pct'])
    if t is not None:
        ge_turn[f"{r['state_current']}|{int(float(r['election_year']))}"].append(t)
for k, v in ge_turn.items():
    turnout['GE'].setdefault(k, round(sum(v) / len(v), 2))
dump('state_turnout.json', turnout)

# ---- bypolls (AE + GE merged) -------------------------------------------
by = []
for fact, arena in [('fact_ae_bypolls', 'AE'), ('fact_ge_bypolls', 'GE')]:
    for r in rows(fact):
        wv = num(r['winner_voteshare_pct']); mp = num(r['margin_pct'])
        by.append({
            'arena': arena, 's': r['state_current'], 'y': int(r['election_year']),
            'mo': i(r['poll_month']), 'n': i(r['constituency_no']), 'c': r['constituency_name'],
            'r': r['reservation'] or None, 'p': std(r['winner_party']), 'a': r['winner_alliance'] or None,
            'w': r['winner_name'] or None, 'v': wv if wv else None, 'm': mp if mp else None,
            'prev': std(r['previous_winner_party']) or None,
            'ret': r['seat_retained'] or None, 'cause': r['cause'] or None,
        })
dump('bypolls.json', by)

# ---- GE segment winners (2009-19 direct; 2024 derived from candidates) ---
segs = []
for r in rows('fact_ge_segment_winners'):
    s = r['state_current']; y = int(r['election_year']); n = i(r['ac_segment_no'])
    lp = std(r['leading_party'])
    segs.append({'s': s, 'y': y, 'pc': i(r['pc_no']), 'pcn': r['pc_name'],
                 'n': n, 'c': r['ac_segment_name'],
                 'p': lp, 'a': astd(s, y, lp, r['leading_alliance']),
                 'v': num(r['leading_voteshare_pct']), 'tp': std(r['trailing_party']) or None,
                 'mg': i(r['margin']), 'sv': i(r['segment_valid_votes'])})
top24 = {}
for r in rows('fact_ge_candidates_segment'):
    if r['election_year'] != '2024': continue
    pos = num(r['position_in_segment'], 0)
    if pos not in (1, 2): continue
    k = (r['state_current'], i(r['pc_no']), i(r['ac_segment_no']))
    top24.setdefault(k, {})[pos] = r
for (s, pc, n), d in top24.items():
    one = d.get(1)
    if not one: continue
    two = d.get(2)
    mg = None
    if two and num(one['votes'], 0) is not None and num(two['votes'], 0) is not None:
        mg = num(one['votes'], 0) - num(two['votes'], 0)
    op = std(one['party'])
    segs.append({'s': s, 'y': 2024, 'pc': pc, 'pcn': one['pc_name'], 'n': n, 'c': one['ac_segment_name'],
                 'p': op, 'a': astd(s, 2024, op, one['alliance']), 'v': num(one['segment_vote_share_pct']),
                 'tp': std(two['party']) if two else None, 'mg': mg, 'sv': i(one['segment_valid_votes'])})
dump('segments.json', segs)

# ---- split-ticket pairs per (GE year, state) -----------------------------
# AE vote shares by (state, ac-in-segment-domain, party, ae_year)
# Segment ac numbering: AP stays undivided through GE-2014, new 1-175 from 2019 → normalize AP to undivided.
def seg_dom_ae(s, y, n):  # AE candidates → segment domain (undivided AP)
    return n + 119 if s == 'Andhra Pradesh' and y >= 2014 else n

def seg_dom_ge(s, y, n):  # GE segment rows → same domain
    return n + 119 if s == 'Andhra Pradesh' and y >= 2019 else n

ae_years = defaultdict(set)
ae_share = defaultdict(dict)  # (s, ae_y) -> {(dom_n, party): share}
for r in rows('fact_ae_candidates'):
    if r['election_type'] != 'AE': continue  # bypoll candidate rows would create phantom AE years
    s = r['state_current']; y = int(r['election_year']); n = i(r['constituency_no'])
    if n is None: continue
    v = num(r['vote_share_pct'])
    if v is None: continue
    ae_years[s].add(y)
    ae_share[(s, y)][(seg_dom_ae(s, y, n), std(r['party']))] = v

def nearest_ae(s, ge_y):
    ys = ae_years.get(s)
    if not ys: return None
    return min(ys, key=lambda ay: (abs(ay - ge_y), ay > ge_y))  # tie → earlier

SKIP_SPLIT = {'Jammu & Kashmir', 'Ladakh'}  # segment numbering unreliable across delimitations
ge_seg = defaultdict(list)  # (ge_y, s) -> candidate rows
for r in rows('fact_ge_candidates_segment'):
    s = r['state_current']
    if s in SKIP_SPLIT: continue
    ge_seg[(int(r['election_year']), s)].append(r)

slug = lambda s: re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')
manifest = {}
for (gy, s), lst in sorted(ge_seg.items()):
    ay = nearest_ae(s, gy)
    if ay is None: continue
    shares = ae_share.get((s, ay), {})
    per_seg = defaultdict(list)
    for r in lst:
        n = i(r['ac_segment_no'])
        gv = num(r['segment_vote_share_pct'])
        if n is None or gv is None: continue
        dom = seg_dom_ge(s, gy, n)
        p = std(r['party'])
        av = shares.get((dom, p))
        if av is None and gv < 5: continue          # unmatched minnows add noise only
        if av is None or (gv < 5 and av < 5):
            if av is None: continue
            if gv < 5 and av < 5: continue
        per_seg[(dom, r['ac_segment_name'], i(r['pc_no']), r['pc_name'])].append(
            {'p': p, 'a': astd(s, gy, p, r['alliance']), 'gv': gv, 'av': av})
    out = []
    for (dom, cname, pc, pcn), cands in per_seg.items():
        cands.sort(key=lambda x: -(x['gv'] or 0))
        for cnd in cands[:6]:
            out.append({'n': dom, 'c': cname, 'pc': pc, 'pcn': pcn, **cnd})
    if not out: continue
    fname = f'split/{gy}_{slug(s)}.json'
    dump(fname, {'ay': ay, 'rows': out})
    manifest.setdefault(str(gy), []).append(s)
dump('split/index.json', manifest)

# Per-state AE segment-share baselines for EVERY assembly year with candidate data, so the
# Compare deep-dive can follow the assembly-year picker (not just the nearest AE baked into the
# split file). Keyed "{seg_dom}|{party}" to join onto the GE split rows' n + p. One file per
# state that has GE segment data; AE years absent here are winners-only (no candidate shares).
for s in sorted({st for (_, st) in ge_seg}):
    per_ay = {}
    for ay in sorted(ae_years.get(s, [])):
        d = ae_share.get((s, ay))
        if not d: continue
        per_ay[str(ay)] = {f'{dom}|{p}': v for (dom, p), v in d.items()}
    if per_ay:
        dump(f'split/ae_{slug(s)}.json', per_ay)

# ---- alliance pooling counterfactual (Telangana-deck pattern) -----------
# "Hypothetically, had pre-poll allies not competed against each other": pool every
# candidate's votes into their alliance, re-decide each seat, compare with reality.
ALLIANCE_OK = lambda g: g and g not in ('Unaligned', 'Independent/Unaligned') and \
    (g.endswith('Alliance') or g in ('LDF', 'Left Front', 'TVK+', 'AITC+'))
base = lambda a: re.sub(r' \(.*\)$', '', a) if a else None
def grp(p, a):
    g = base(a)
    return g if g and g not in ('Unaligned', 'Independent/Unaligned') else p  # unaligned parties never pool

cf_out = []
for fact, arena, ncol, namecol in [
    ('fact_ae_candidates', 'AE', 'constituency_no', 'constituency_name'),
    ('fact_ge_candidates_pc', 'GE', 'pc_no', 'pc_name'),
]:
    per_sy = defaultdict(lambda: defaultdict(list))  # (s,y) -> n -> [(party, alliance, votes, name)]
    for r in rows(fact):
        if r['election_type'] != arena: continue
        v = num(r['votes'], 0)
        if not v: continue
        n = i(r[ncol])
        if n is None: continue
        cp = std(r['party'])
        per_sy[(r['state_current'], int(r['election_year']))][n].append(
            (cp, astd(r['state_current'], int(r['election_year']), cp, r['alliance']), v, r[namecol]))
    for (s, y), seatmap in sorted(per_sy.items()):
        # only where the candidate table is complete (caveat 3: 16 recent elections are winners-only)
        expected = seat_count.get((arena, s, y), 0)
        if not expected or len(seatmap) < expected * 0.98: continue
        if sum(len(c) for c in seatmap.values()) / len(seatmap) < 3: continue
        actual = Counter(); pooled = Counter(); ff = Counter(); flips = defaultdict(list)
        for n, cands in seatmap.items():
            w = max(cands, key=lambda c: c[2])
            wgrp = grp(w[0], w[1])
            actual[wgrp] += 1
            gv = Counter(); gparties = defaultdict(set)
            for p, a, v, _nm in cands:
                g = grp(p, a)
                gv[g] += v; gparties[g].add(p)
            pw = max(gv.items(), key=lambda kv: kv[1])[0]
            pooled[pw] += 1
            for g, ps in gparties.items():
                if len(ps) >= 2 and ALLIANCE_OK(g): ff[g] += 1
            if pw != wgrp and ALLIANCE_OK(pw):
                flips[pw].append({'n': n, 'c': cands[0][3], 'from': wgrp})
        for g in {k for k in list(actual) + list(pooled) if ALLIANCE_OK(k)}:
            if not ff[g] and actual[g] == pooled[g]: continue  # nothing to say
            cf_out.append({'arena': arena, 's': s, 'y': y, 'al': g,
                           'actual': actual[g], 'pooled': pooled[g], 'ff': ff[g],
                           'flips': sorted(flips[g], key=lambda f: f['n'])[:15]})
dump('alliance_cf.json', cf_out)
print('done')
