"""
LGD assembly-constituency code -> ECI AC number (as used by the Verdix app), state by state.

Inputs (read-only):
  LGD mirror (ramSeraph/opendata 'lgd-latest', 29 Sep 2026):
    assembly_constituencies, constituency_coverage, constituencies_mapping_urban, states
  App: public/data/seats_ae.json (AE seats), segments.json (AC -> PC per GE year), seats_ge.json
  Delimitation Order 2008 parse (order_parse/order_ac_extents_<state>.csv) - independent ECI
    number/name/reservation reference for 16 states (internal validation only).

Matching order per state (against the app "frame" = one delimitation's seat list):
  1. eci_code   - LGD 'Assembly Constituency ECI Code' (urban mapping) -> app seat n (or j for
                  undivided-AP numbering), accepted only if the names agree (similarity >= 0.6 or
                  phonetic-key equal, or PC agrees and similarity >= 0.45).
  2. exact_name - normalised names equal and unique on both sides.
  3. fuzzy      - phonetic-key equal, else best mutual candidate on name similarity with the
                  PC as tie-breaker (bonus when the LGD PC name agrees with the app seat's PC).
  4. manual     - hand pairings in MANUAL (each with a reason), for LGD renames/abbreviations.
Every non-exact pairing goes to review_non_exact.csv.
"""
import json, re, difflib, sys
from functools import lru_cache
from collections import defaultdict, Counter
import pandas as pd

OPT2 = 'C:/Users/minds/AppData/Local/Temp/claude/C--Users-minds-OneDrive-Desktop-Data-Project/b4ee2c9a-d22a-44f3-9d75-56cb29e4f656/scratchpad/census/option2/'
LGD = OPT2 + 'lgd/'
APP = 'C:/Users/minds/OneDrive/Desktop/Data Project/India Elections/product/app/'
OUT = APP + 'tools/sources/census2011/ac_level/crosswalk/'

# ---------------------------------------------------------------- normalisation
DIR = {'NORTH': 'N', 'UTTAR': 'N', 'UTTARA': 'N', 'SOUTH': 'S', 'DAKSHIN': 'S', 'DAKSHINA': 'S',
       'EAST': 'E', 'PURBA': 'E', 'PURVA': 'E', 'PURB': 'E', 'PURV': 'E', 'WEST': 'W', 'PASCHIM': 'W',
       'PASCHIMI': 'W', 'PACHIM': 'W', 'CENTRAL': 'C', 'MADHYA': 'C', 'CANTONMENT': 'CANTT',
       'CANT': 'CANTT', 'GRAMIN': 'RURAL', 'GRAMEEN': 'RURAL', 'AND': '', 'II': '2', 'I': '1',
       'III': '3', 'IV': '4', 'NAGAR': 'NAGAR', 'ST': 'SAINT'}
RES_RE = re.compile(r'\(\s*(S\.?\s*C|S\.?\s*T|B\.?\s*L)\s*\.?\)|\b(SC|ST|BL)\s*$|-\s*(SC|ST)\b', re.I)


def res_tag(s):
    if not isinstance(s, str):
        return None
    m = re.search(r'\(\s*(S\.?\s*C|S\.?\s*T|B\.?\s*L)\s*\.?\)|\s(SC|ST)\s*$|-\s*(SC|ST)\s*$', s, re.I)
    if not m:
        return None
    t = re.sub(r'[^A-Z]', '', (m.group(0)).upper())
    return {'SC': 'SC', 'ST': 'ST', 'BL': 'BL'}.get(t)


@lru_cache(maxsize=None)
def base(s):
    if not isinstance(s, str):
        return ''
    s = s.upper().replace('&', ' AND ')
    s = re.sub(r'\(\s*(S\.?\s*C|S\.?\s*T|B\.?\s*L)\s*\.?\)', ' ', s)
    s = re.sub(r'\s(SC|ST)\s*$', ' ', s)
    s = re.sub(r'-\s*(SC|ST)\s*$', ' ', s)
    s = re.sub(r'ASSEMBLY CONSTITUENCY|CONSTITUENCY', ' ', s)
    s = re.sub(r'[^A-Z0-9]+', ' ', s)
    toks = [DIR.get(t, t) for t in s.split()]
    return ' '.join(t for t in toks if t)


@lru_cache(maxsize=None)
def flat(s):
    return base(s).replace(' ', '')


# official city/place renames, applied only inside the phonetic key (so they never count as exact_name)
ALIAS = [('KALABURAGI', 'GULBARGA'), ('BELAGAVI', 'BELGAUM'), ('BALLARI', 'BELLARY'), ('MANGALURU', 'MANGALORE'),
         ('SHIVAMOGGA', 'SHIMOGA'), ('TUMAKURU', 'TUMKUR'), ('VIJAYAPURA', 'BIJAPUR'), ('BENGALURU', 'BANGALORE'),
         ('MYSURU', 'MYSORE'), ('HUBBALLI', 'HUBLI'), ('CHIKKAMAGALURU', 'CHIKMAGALUR'), ('BURDWAN', 'BARDHAMAN'),
         ('GURUGRAM', 'GURGAON'), ('PRAYAGRAJ', 'ALLAHABAD'), ('NAGAON', 'NOWGONG'), ('SIVASAGAR', 'SIBSAGAR')]


def alias(x):
    for a, b in ALIAS:
        x = x.replace(a, b)
    return x


def alias_used(name):
    f = flat(name)
    return ', '.join(f'{a}={b}' for a, b in ALIAS if a in f)


@lru_cache(maxsize=None)
def pkey(s):
    """phonetic key for transliteration variants"""
    x = alias(flat(s))
    for a, b in [('KSH', 'KS'), ('X', 'KS'), ('TH', 'T'), ('DH', 'D'), ('BH', 'B'), ('KH', 'K'), ('GH', 'G'),
                 ('PH', 'F'), ('SH', 'S'), ('CH', 'C'), ('JH', 'J'), ('RH', 'R'), ('W', 'V'), ('Z', 'J'),
                 ('Q', 'K'), ('Y', 'I'), ('EE', 'I'), ('OO', 'U'), ('OU', 'U'), ('AA', 'A'), ('H', '')]:
        x = x.replace(a, b)
    x = re.sub(r'(.)\1+', r'\1', x)
    return x


@lru_cache(maxsize=None)
def ckey(s):
    """consonant skeleton (vowels dropped after the first letter)"""
    x = pkey(s)
    return x[:1] + re.sub(r'[AEIOU]', '', x[1:]) if x else ''


@lru_cache(maxsize=None)
def sim(a, b):
    fa, fb = flat(a), flat(b)
    if not fa or not fb:
        return 0.0
    r1 = difflib.SequenceMatcher(None, fa, fb).ratio()
    r2 = difflib.SequenceMatcher(None, pkey(a), pkey(b)).ratio()
    ta, tb = sorted(base(a).split()), sorted(base(b).split())
    r3 = difflib.SequenceMatcher(None, ''.join(ta), ''.join(tb)).ratio()
    return round(max(r1, r2, r3), 3)


# ---------------------------------------------------------------- LGD master
def load_lgd():
    a = pd.read_csv(LGD + 'assembly_constituencies.29Sep2026.csv', dtype=str)
    a.columns = ['sno', 'st', 'stn', 'pc', 'pcn', 'ac', 'acn']
    a = a[a.st.notna()]
    c = pd.read_csv(LGD + 'constituency_coverage.29Sep2026.csv', dtype=str)
    c.columns = ['sno', 'pc', 'pcn', 'ac', 'acn', 'et', 'ec', 'en', 'cv', 'st', 'stn']
    u = pd.read_csv(LGD + 'constituencies_mapping_urban.29Sep2026.csv', dtype=str)
    u.columns = ['sno', 'pc', 'pceci', 'pcn', 'ac', 'aceci', 'acn', 'd', 'dn', 'sd', 'sdn', 'w', 'wn', 'ulb',
                 'ulbn', 'lbt', 'st']
    st = pd.read_csv(LGD + 'states.29Sep2026.csv', dtype=str)
    stname = dict(zip(st['State Code'], st['State Name (In English)']))
    rows = {}
    for df, src in [(a, 'AC_list'), (c, 'coverage'), (u, 'urban_mapping')]:
        for r in df[['st', 'pc', 'pcn', 'ac', 'acn']].drop_duplicates().itertuples(index=False):
            if pd.isna(r.ac) or r.ac in ('0', ''):
                continue
            if r.ac not in rows:
                rows[r.ac] = dict(lgd_state_code=r.st, lgd_ac_code=r.ac, lgd_ac_name=r.acn, lgd_pc_code=r.pc,
                                  lgd_pc_name=r.pcn, lgd_sources=src)
            else:
                d = rows[r.ac]
                if src not in d['lgd_sources']:
                    d['lgd_sources'] += ';' + src
                assert d['lgd_state_code'] == r.st and d['lgd_pc_code'] == r.pc, (r, d)
    m = pd.DataFrame(rows.values())
    e = u[u.ac != '0'][['ac', 'aceci', 'pceci']].drop_duplicates()
    assert e.ac.is_unique
    m = m.merge(e.rename(columns={'ac': 'lgd_ac_code', 'aceci': 'lgd_eci_ac_code', 'pceci': 'lgd_eci_pc_code'}),
                how='left')
    m['lgd_state_name'] = m.lgd_state_code.map(stname)
    m['lgd_pc_name'] = m.lgd_pc_name.str.replace('\ufffd', '', regex=False).str.strip()
    pcs = pd.read_csv(LGD + 'parliament_constituencies.29Sep2026.csv', dtype=str)
    pcs.columns = ['sno', 'st', 'stn', 'pc', 'pcn', 'ac', 'acn']
    pcs = pcs[pcs.st.notna()]
    allpc = pd.concat([a[['st', 'pc', 'pcn']], c[['st', 'pc', 'pcn']], u[['st', 'pc', 'pcn']], pcs[['st', 'pc', 'pcn']]])
    allpc = allpc[allpc.pc.notna()].drop_duplicates(['st', 'pc'])
    allpc['pcn'] = allpc.pcn.str.replace('\ufffd', '', regex=False).str.strip()
    pceci = u[['pc', 'pceci']].drop_duplicates()
    return m, allpc, pceci, stname


# ---------------------------------------------------------------- app frames
LGD2APP = {'Jammu And Kashmir': 'Jammu & Kashmir', 'Andaman And Nicobar Islands': 'Andaman & Nicobar Islands',
           'The Dadra And Nagar Haveli And Daman And Diu': 'Dadra & Nagar Haveli and Daman & Diu'}
DEFERRED = {'Arunachal Pradesh', 'Manipur', 'Nagaland', 'Jharkhand'}


def load_app():
    d = pd.DataFrame(json.load(open(APP + 'public/data/seats_ae.json', encoding='utf-8')))
    seg = pd.DataFrame(json.load(open(APP + 'public/data/segments.json', encoding='utf-8')))
    return d, seg


def build_frames(d, seg):
    """frame = (app state(s), years, delimitation label). Returns dict state_lgd_app_name -> list of frames."""
    frames = defaultdict(list)
    for s in sorted(d.s.unique()):
        ys = sorted(d[d.s == s].y.unique())
        if s in ('Jammu & Kashmir', 'Ladakh'):
            continue
        if s == 'Assam':
            frames[s].append(dict(id='1976-deferred', parts=[(s, [2011, 2016, 2021])], ge=[2009, 2014, 2019]))
            frames[s].append(dict(id='2023-Assam', parts=[(s, [2026])], ge=[2024]))
            continue
        lab = '1976-deferred' if s in DEFERRED else '2008'
        ge = [2019, 2024] if s == 'Andhra Pradesh' else [2009, 2014, 2019, 2024]
        frames[s].append(dict(id=lab, parts=[(s, ys)], ge=ge))
    frames['Jammu & Kashmir'].append(dict(id='1995-JK', parts=[('Jammu & Kashmir', [2014]), ('Ladakh', [2014])],
                                          ge=[2009, 2014, 2019]))
    frames['Jammu & Kashmir'].append(dict(id='2022-JK', parts=[('Jammu & Kashmir', [2024])], ge=[2024]))
    # materialise seat tables
    for s, fl in frames.items():
        for f in fl:
            recs = []
            for st, ys in f['parts']:
                x = d[(d.s == st) & (d.y.isin(ys))]
                latest = x.y.max()
                for j, g in x.groupby('j'):
                    g = g.sort_values('y')
                    last = g.iloc[-1]
                    recs.append(dict(app_state=st, app_j=int(j), eci_ac_no=int(last.n), app_name=last.c,
                                     app_r=last.r, app_year_matched=int(last.y),
                                     app_years=';'.join(str(v) for v in g.y.tolist()),
                                     names=sorted(set(g.c)), n_all=sorted(set(int(v) for v in g.n))))
            ft = pd.DataFrame(recs)
            # PC per seat from GE segments in the frame's GE years (by AC number n within app state)
            pcmap = {}
            for st, _ in f['parts']:
                sg = seg[(seg.s == st) & (seg.y.isin(f['ge']))]
                for r in sg.itertuples(index=False):
                    pcmap.setdefault((st, int(r.n)), {})[int(r.y)] = (int(r.pc), r.pcn)
            def pc_for(r):
                # the AC number in the latest GE year of the frame equals the latest AE number (eci_ac_no);
                # undivided-AP GE 2009/2014 used the old 1-294 numbering (= app j), so fall back to j only
                # when no GE year carries eci_ac_no.
                d1 = pcmap.get((r.app_state, r.eci_ac_no), {})
                if d1:
                    y = max(d1)
                    return (d1[y][0], d1[y][1], y)
                d2 = pcmap.get((r.app_state, r.app_j), {})
                if d2:
                    y = max(d2)
                    return (d2[y][0], d2[y][1], y)
                return (None, None, None)
            pcs = ft.apply(pc_for, axis=1, result_type='expand') if len(ft) else None
            ft['app_pc_no'], ft['app_pc_name'], ft['app_pc_year'] = pcs[0], pcs[1], pcs[2]
            f['seats'] = ft
    return frames


# ---------------------------------------------------------------- manual pairings
# (app_state_for_frame, lgd_ac_code) -> (app_j, reason). Filled after inspecting the review list.
MANUAL = {}


def match_state(lg, f, manual):
    """lg: LGD rows of one state. f: frame. returns list of dict rows."""
    seats = f['seats'].copy()
    seats['flat'] = seats.names.apply(lambda ns: {flat(n) for n in ns})
    seats['pk'] = seats.names.apply(lambda ns: {pkey(n) for n in ns})
    free = set(seats.app_j)
    byj = {r.app_j: r for r in seats.itertuples(index=False)}
    out = {}

    def best_name_sim(lname, r):
        return max(sim(lname, n) for n in r.names)

    def pc_ok(lr, r):
        if not isinstance(r.app_pc_name, str) or not isinstance(lr.lgd_pc_name, str):
            return False
        return sim(lr.lgd_pc_name, r.app_pc_name) >= 0.8

    lgr = {r.lgd_ac_code: r for r in lg.itertuples(index=False)}
    # 0. manual
    for code, (j, why) in manual.items():
        if code in lgr and j in free:
            r = byj[j]
            out[code] = dict(app_j=j, method='manual', similarity=best_name_sim(lgr[code].lgd_ac_name, r), note=why)
            free.discard(j)
    # 1. ECI code
    ecnt = Counter(lr.lgd_eci_ac_code for lr in lgr.values() if isinstance(lr.lgd_eci_ac_code, str))
    for code, lr in lgr.items():
        if code in out or not isinstance(lr.lgd_eci_ac_code, str) or lr.lgd_eci_ac_code in ('0', ''):
            continue
        e = int(lr.lgd_eci_ac_code)
        cands = [r for r in seats.itertuples(index=False) if e in r.n_all or e == r.app_j]
        # best name agreement anywhere in the frame: an ECI code is overruled when a DIFFERENT seat
        # carries this LGD name (LGD ECI codes are sometimes swapped/duplicated, e.g. Dabwali/Kalanwali)
        any_best = max(((best_name_sim(lr.lgd_ac_name, r), r.app_j) for r in seats.itertuples(index=False)),
                       default=(0, None))
        best = None
        for r in cands:
            s_ = best_name_sim(lr.lgd_ac_name, r)
            ok = s_ >= 0.6 or pkey(lr.lgd_ac_name) in r.pk or (pc_ok(lr, r) and s_ >= 0.45)
            if any_best[0] >= 0.85 and any_best[1] != r.app_j and s_ < any_best[0] - 0.05:
                ok = False
            if ecnt[lr.lgd_eci_ac_code] > 1 and s_ < 0.85:
                ok = False
            if ok and (best is None or s_ > best[1]):
                best = (r, s_)
        if best and best[0].app_j in free:
            out[code] = dict(app_j=best[0].app_j, method='eci_code', similarity=best[1],
                             note='' if flat(lr.lgd_ac_name) in best[0].flat else
                             ('eci code; official rename (' + alias_used(lr.lgd_ac_name) + ')' if pkey(lr.lgd_ac_name) in best[0].pk and
                              alias(flat(lr.lgd_ac_name)) != flat(lr.lgd_ac_name) else
                              'eci code; name spelled differently'))
            free.discard(best[0].app_j)
        elif cands:
            r0 = cands[0]
            out.setdefault('__conflict__', []).append(
                (code, e, r0.app_j, r0.app_name, best_name_sim(lr.lgd_ac_name, r0)))
    conflicts = out.pop('__conflict__', [])
    # 2. exact normalised name (unique both sides)
    fl_l = defaultdict(list)
    for code, lr in lgr.items():
        if code not in out:
            fl_l[flat(lr.lgd_ac_name)].append(code)
    for k, codes in fl_l.items():
        js = [j for j in free if k in byj[j].flat]
        if len(codes) == 1 and len(js) == 1:
            out[codes[0]] = dict(app_j=js[0], method='exact_name', similarity=1.0, note='')
            free.discard(js[0])
        elif len(codes) >= 1 and len(js) >= 1:
            # tie-break by PC
            for code in codes:
                lr = lgr[code]
                js2 = [j for j in js if j in free and pc_ok(lr, byj[j])]
                if len(js2) == 1:
                    out[code] = dict(app_j=js2[0], method='exact_name', similarity=1.0,
                                     note='duplicate name in state; PC tie-break')
                    free.discard(js2[0])
    # 3a. phonetic key equal (unique both sides)
    pk_l = defaultdict(list)
    for code, lr in lgr.items():
        if code not in out:
            pk_l[pkey(lr.lgd_ac_name)].append(code)
    for k, codes in pk_l.items():
        js = [j for j in free if k in byj[j].pk]
        if len(codes) == 1 and len(js) == 1:
            lr = lgr[codes[0]]
            out[codes[0]] = dict(app_j=js[0], method='fuzzy', similarity=best_name_sim(lr.lgd_ac_name, byj[js[0]]),
                                 note=('official rename (' + alias_used(lr.lgd_ac_name) + ')'
                                       if alias(flat(lr.lgd_ac_name)) != flat(lr.lgd_ac_name) else 'phonetic key equal')
                                 + ('' if pc_ok(lr, byj[js[0]]) else '; PC differs'))
            free.discard(js[0])
    # 3b. similarity with PC bonus, mutual best, iterate
    for _ in range(5):
        rem = [c for c in lgr if c not in out]
        if not rem or not free:
            break
        sc = {}
        for c in rem:
            lr = lgr[c]
            for j in free:
                r = byj[j]
                s_ = best_name_sim(lr.lgd_ac_name, r)
                pb = pc_ok(lr, r)
                ck = ckey(lr.lgd_ac_name) in {ckey(n) for n in r.names}
                score = s_ + (0.12 if pb else 0) + (0.08 if ck else 0)
                if s_ >= 0.72 or (s_ >= 0.55 and (pb or ck)):
                    sc[(c, j)] = (score, s_, pb, ck)
        if not sc:
            break
        bestL, bestR = {}, {}
        for (c, j), v in sc.items():
            if c not in bestL or v[0] > bestL[c][1][0]:
                bestL[c] = (j, v)
            if j not in bestR or v[0] > bestR[j][1][0]:
                bestR[j] = (c, v)
        took = 0
        for c, (j, v) in bestL.items():
            if bestR[j][0] == c:
                # margin vs runner-up for this LGD AC
                others = sorted([vv[0] for (cc, jj), vv in sc.items() if cc == c and jj != j], reverse=True)
                margin = v[0] - (others[0] if others else 0)
                out[c] = dict(app_j=j, method='fuzzy', similarity=v[1],
                              note=f"similarity; PC {'agrees' if v[2] else 'differs'}"
                                   + ('; consonant skeleton equal' if v[3] else '')
                                   + (f'; low margin {margin:.2f}' if margin < 0.1 else ''))
                free.discard(j)
                took += 1
        if not took:
            break
    rows = []
    for code, lr in lgr.items():
        o = out.get(code)
        row = dict(lr._asdict())
        if o:
            r = byj[o['app_j']]
            row.update(app_state=r.app_state, eci_ac_no=r.eci_ac_no, app_j=r.app_j, app_name=r.app_name,
                       app_r=r.app_r, app_year_matched=r.app_year_matched, app_years=r.app_years,
                       app_pc_no=r.app_pc_no, app_pc_name=r.app_pc_name, method=o['method'],
                       similarity=o['similarity'], note=o['note'])
        else:
            row.update(method='unmatched', note='')
        rows.append(row)
    unl = seats[seats.app_j.isin(free)]
    return rows, unl, conflicts


if __name__ == '__main__':
    pass
