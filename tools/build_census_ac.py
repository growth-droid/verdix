#!/usr/bin/env python3
"""STEP 2 — true SEAT-LEVEL Census 2011 profiles, built from villages, towns and wards.

Every Census 2011 unit (640,949 villages + 82,256 urban wards — tools/census_pcatv_units.py) is assigned to the assembly
constituency (AC) the Local Government Directory (LGD, lgdirectory.gov.in) places it in; an AC's profile is the SUM of
its units. Parliament seats are the sum of their assembly segments. The district-level profile written by
tools/build_census.py stays on every record (`w`) and remains the fallback wherever no seat-level figure passes.

Assignment, most precise first (the method is kept per unit in unit_to_ac.parquet):
  village            census village code -> LGD village(s) -> AC via LGD constituency coverage (direct village rows,
                     or a sub-district / district marked 'Fully Covered')
  census town (CT)   a CT's code is village-style; LGD carries most CTs as villages -> same route
  outgrowth ward     the ward row names its village ('Rural MDDS CODE:nnnnnn') -> same route
  statutory town     town code (8xxxxx) -> LGD urban local body -> its wards' ACs (constituencies_mapping_urban),
                     else the body's coverage rows; then by town NAME within the state; then ac_level/town_aliases.csv;
                     then a merged town that gave its name to exactly one AC (Ambattur, Kulti ...). A town whose wards sit
                     in SEVERAL ACs is APPORTIONED by its share of today's LGD wards in each AC and carries the town's own
                     average — counted in `q.a` (census-2011 ward numbers don't line up with today's wards).
  sub-district       leftovers follow where the rest of their sub-district went (>= 95% one AC), or — villages only —
                     split by the sub-district's shares; a town is never smeared across a sub-district.
Religion (published only to sub-district and town): villages take their sub-district's RURAL shares, urban units their
town's shares (sub-district URBAN shares when the town has no row). Amenities: HL-14 unit % x unit households.

Gate — a seat keeps its district profile unless ALL hold: it is on the delimitation LGD maps; its assigned population is
> 0; and electors / population lies within RATIO_BAND x the state's median (a seat that got a city it doesn't own, or
lost one, shows up there). Parliament seats get a seat-level profile only if every segment passed.

Run from product/app AFTER build_census.py:  python tools/build_census_ac.py
"""
import glob, io, json, os, re, sys
from collections import defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
DATA = os.path.join(APP, 'public', 'data')
SRC = os.path.join(HERE, 'sources', 'census2011')
ACL = os.path.join(SRC, 'ac_level')
LGD = os.path.join(ACL, 'lgd')
OUT = os.path.join(DATA, 'census')

sys.path.insert(0, HERE)
from build_candidates import slug  # noqa: E402

COUNTS = ['TOT_P', 'TOT_M', 'TOT_F', 'No_HH', 'P_06', 'M_06', 'F_06', 'P_SC', 'P_ST', 'P_LIT', 'M_LIT', 'F_LIT',
          'TOT_WORK_P', 'CL', 'AL', 'HI', 'OT', 'URB']
RELS = ['hindu', 'muslim', 'christian', 'sikh', 'buddhist', 'jain', 'other', 'none']
RELCOL = {'other': 'other_religions', 'none': 'religion_not_stated'}
AMENS = ['elec', 'lpg', 'latrine', 'tap', 'bank', 'tv', 'phone', 'computer', 'twowheeler', 'car', 'noasset']
RATIO_BAND = (0.6, 1.6)          # electors/population vs the state's median — outside = not trusted
BREAK = {'Jammu & Kashmir': 2020, 'Assam': 2023}


def lgd(name):
    p = glob.glob(os.path.join(LGD, f'{name}.*.csv'))
    if not p:
        sys.exit(f'missing LGD table {name} in {LGD}')
    return pd.read_csv(p[0], dtype=str, keep_default_na=False)


def z(s, n):
    return s.astype(str).str.strip().str.split('.').str[0].str.zfill(n)


def norm_town(s):
    s = re.sub(r'\(.*?\)', ' ', str(s).lower())
    s = re.sub(r'\b(municipal|corporation|council|committee|nagar panchayat|nagar palika|parishad|nagar nigam|mahanagar|'
               r'palike|palika|town|area|notified|cantonment|board|m corp|cb|nac|np|mc|m cl)\b', ' ', s)
    return re.sub(r'[^a-z]', '', s)


def nseat(s):
    return re.sub(r'[^A-Z]', '', re.sub(r'\((SC|ST|S\.C\.|S\.T\.)\)', '', str(s).upper()))


# ───────────────────────── LGD: which AC(s) each census unit belongs to ─────────────────────────
def lgd_maps():
    cc = lgd('constituency_coverage')
    cc = cc[~cc['Assembly Constituency Code'].str.strip().isin(['', '0'])]
    v = lgd('villages')
    v['c11'] = z(v['Census 2011 Code'].replace('', '0'), 6)
    # Priority: a village's OWN coverage row beats a sub-district marked 'Fully Covered', which beats a whole
    # district. LGD sometimes marks a whole district as covered by an AC that also lists villages there, and
    # mixing the levels split those villages between two seats (Punjab's rural seats came out at 3-5x electors/pop).
    parts = [cc[cc['Entity Type'] == 'Village'][['Assembly Constituency Code', 'Entity Code']].rename(columns={'Entity Code': 'Village Code'}).assign(lvl=0)]
    # three 'whole district covered by one AC' rows are wrong (mirror PROVENANCE 3b/V07): SBS Nagar is 3 ACs,
    # Mumbai City 10, Kolkata 11 — never use them
    bad = cc['Entity Name'].str.strip().str.lower().isin(['shahid bhagat singh nagar', 'mumbai', 'kolkata']) & (cc['Entity Type'] == 'District')
    cc = cc[~bad]
    for lvl, (etype, col) in enumerate((('SubDistrict', 'Sub-District Code'), ('District', 'District Code')), start=1):
        full = cc[(cc['Entity Type'] == etype) & (cc['Coverage Type'] == 'Fully Covered')][['Assembly Constituency Code', 'Entity Code']]
        parts.append(full.merge(v[[col, 'Village Code']], left_on='Entity Code', right_on=col)[['Assembly Constituency Code', 'Village Code']].assign(lvl=lvl))
    av = pd.concat(parts).drop_duplicates(['Assembly Constituency Code', 'Village Code'])
    av = av[av.lvl == av.groupby('Village Code').lvl.transform('min')]
    av = av.merge(v[['Village Code', 'c11']], on='Village Code')
    av = av[av.c11 != '000000']
    g = av.groupby(['c11', 'Assembly Constituency Code']).size().rename('n').reset_index()
    g['w'] = g.n / g.groupby('c11').n.transform('sum')
    village = {c: list(zip(sub['Assembly Constituency Code'], sub.w)) for c, sub in g.groupby('c11')}

    ulb = lgd('urban_local_bodies')
    ulb['c11'] = z(ulb['Census 2011 Code'].replace('', '0'), 6)
    mu = lgd('constituencies_mapping_urban')
    mu = mu[~mu['Assembly Constituency Code'].str.strip().isin(['', '0'])]
    wc = mu.groupby(['Urban Localbody Code', 'Assembly Constituency Code'])['Ward Code'].nunique().rename('n').reset_index()
    wc['w'] = wc.n / wc.groupby('Urban Localbody Code').n.transform('sum')
    by_ulb = {u: list(zip(sub['Assembly Constituency Code'], sub.w)) for u, sub in wc.groupby('Urban Localbody Code')}
    for u, sub in cc[cc['Entity Type'] == 'Localbody'].groupby('Entity Code'):
        if u in by_ulb:
            continue
        full = sub[sub['Coverage Type'] == 'Fully Covered']['Assembly Constituency Code'].unique()
        acs = full if len(full) else sub['Assembly Constituency Code'].unique()
        by_ulb[u] = [(a, 1 / len(acs)) for a in acs]
    town, names = {}, {}
    for code, body, stc, nm in zip(ulb.c11, ulb['Local Body Code'], ulb['State Code'], ulb['Local Body Name (In English)']):
        if body not in by_ulb:
            continue
        if code != '000000':
            town.setdefault(code, by_ulb[body])
        names.setdefault((stc, norm_town(nm)), by_ulb[body])
    return village, town, names, by_ulb


def lgd_ac_allowed_districts():
    """LGD AC code -> the 2011 census district codes its official delimitation allows (continuing + carved + the
    order's own cross-district extents), via the crosswalk and build_census.py's parse of the orders."""
    import build_census as bc
    prof, _ = bc.district_profiles()
    allowed, _ = bc.official_2008(prof)
    cw = pd.read_csv(os.path.join(ACL, 'crosswalk', 'lgd_ac_to_eci.csv'), dtype=str, keep_default_na=False)
    out = {}
    for code, st, no, dl in zip(cw.lgd_ac_code, cw.state, cw.eci_ac_no, cw.delimitation):
        if not no.strip() or '2022' in dl or '2023' in dl:
            continue
        n = int(float(no))
        key = (st, n + 119) if st == 'Andhra Pradesh' else (st, n)        # the order numbers undivided AP
        hit = allowed.get(key)
        if hit:
            out[code.strip()] = hit[1]
    return out


def lgd_states():
    st = lgd('states')
    m = defaultdict(set)
    for code, c11 in zip(st['State Code'], st['Census 2011 Code']):
        if c11.strip() not in ('', '0'):
            m[c11.strip().zfill(2)].add(code.strip())
    m['28'].add('36')                       # undivided Andhra Pradesh -> Telangana
    m['25'].add('38'); m['26'].add('38')     # Daman & Diu, Dadra & Nagar Haveli -> merged UT
    m['01'].add('37')                       # J&K -> Ladakh
    return m


# ───────────────────────── assignment ─────────────────────────
def assign(units):
    village, town, town_names, by_ulb = lgd_maps()
    c2l = lgd_states()
    acs_tab = lgd('assembly_constituencies')
    namesake = defaultdict(list)
    for code, stc, nm in zip(acs_tab['Assembly Constituency Code'], acs_tab['State Code'], acs_tab['Assembly Constituency Name']):
        namesake[(stc, norm_town(nm))].append(code)

    tv = units['Town/Village']
    is_ward = units.Level == 'WARD'
    og = units.Name.str.extract(r'Rural MDDS CODE:\s*(\d+)', expand=False)
    units['route'] = np.where(~is_ward, 'village', np.where(og.notna(), 'og', np.where(tv.str.startswith('8'), 'town', 'ct')))
    units['key'] = np.where(units.route == 'og', og.fillna('').str.zfill(6), tv)
    units['town_name'] = units.Name.str.replace(r'\s*WARD NO\..*$', '', regex=True).str.strip()
    acs, method = [], []
    for rt, k in zip(units.route, units.key):
        hit = town.get(k) if rt == 'town' else village.get(k)
        acs.append(hit)
        method.append(('town-code' if rt == 'town' else rt + '-code') if hit else None)
    units['acs'], units['method'] = acs, method

    alias = {}
    ap = os.path.join(ACL, 'town_aliases.csv')
    if os.path.exists(ap):
        for r in pd.read_csv(ap, dtype=str, keep_default_na=False).itertuples():
            parts = [(a, w) for b in r.lgd_ulb_codes.split(';') for a, w in by_ulb.get(b.strip(), [])]
            if parts:
                agg = defaultdict(float)
                for a, w in parts:
                    agg[a] += w
                t = sum(agg.values())
                alias[r.census_town_code.zfill(6)] = [(a, w / t) for a, w in agg.items()]
    miss = units.acs.isna() & (units.route == 'town')
    for (stc, k, nm), idx in units[miss].groupby(['State', 'key', 'town_name']).groups.items():
        hit, how = alias.get(k), 'town-alias'
        if hit is None:
            for ls in c2l.get(stc, ()):
                hit = town_names.get((ls, norm_town(nm)))
                if hit:
                    how = 'town-name'
                    break
        if hit is None:
            cands = [a for ls in c2l.get(stc, ()) for a in namesake.get((ls, norm_town(nm)), [])]
            if len(cands) == 1:
                hit, how = [(cands[0], 1.0)], 'town-namesake'
        if hit:
            units.loc[idx, 'acs'] = pd.Series([hit] * len(idx), index=idx, dtype=object)
            units.loc[idx, 'method'] = how

    # ── district guard: a unit can only sit in an AC whose OFFICIAL district list includes the unit's district ──
    # LGD's confirmed errors are homonyms and PC-for-AC slips that cross districts (Fatehabad tehsil filed under
    # Fatehpur, Bishnupur-I of South 24 Parganas under Bankura's Bishnupur, Kozhenchery under Elathur ...).
    allowed = lgd_ac_allowed_districts()
    dropped = 0
    for i, (lst, d) in enumerate(zip(units.acs, units.District)):
        if not lst:
            continue
        keep = [(a, w) for a, w in lst if a not in allowed or int(d) in allowed[a]]
        if len(keep) < len(lst):
            dropped += units.TOT_P.iat[i] * (1 - sum(w for _, w in keep) / max(1e-9, sum(w for _, w in lst)))
            t = sum(w for _, w in keep)
            units.iat[i, units.columns.get_loc('acs')] = [(a, w / t) for a, w in keep] if keep else None
            if not keep:
                units.iat[i, units.columns.get_loc('method')] = None
    print(f'district guard: {dropped:,.0f} people pulled out of ACs in districts the delimitation order never gave them')

    units['sd'] = units.State + units.District + units.Subdistt
    rows = [(s_, a, p * w) for lst, p, s_ in zip(units.acs, units.TOT_P, units.sd) if lst for a, w in lst]
    sdp = pd.DataFrame(rows, columns=['sd', 'ac', 'p']).groupby(['sd', 'ac']).p.sum().reset_index()
    sdp['share'] = sdp.p / sdp.groupby('sd').p.transform('sum')
    sd_map = {k: list(zip(g.ac, g.share)) for k, g in sdp.groupby('sd')}
    for idx in units[units.acs.isna() & (units.Subdistt != '99999')].index:
        opts = sd_map.get(units.at[idx, 'sd'])
        if not opts:
            continue
        top = max(opts, key=lambda x: x[1])
        if top[1] >= 0.95:
            units.at[idx, 'acs'] = [(top[0], 1.0)]
            units.at[idx, 'method'] = 'subdistrict'
        elif units.at[idx, 'route'] != 'town':
            o = [(a, w) for a, w in opts if w >= 0.02]
            t = sum(w for _, w in o)
            units.at[idx, 'acs'] = [(a, w / t) for a, w in o]
            units.at[idx, 'method'] = 'subdistrict-split'
    return units


# ───────────────────────── religion + amenities per unit ─────────────────────────
def attach_religion(units):
    p = os.path.join(ACL, 'religion', 'religion_units.parquet')
    if not os.path.exists(p):
        print('religion: input missing — seat profiles will carry no religion')
        return units
    rel = pd.read_parquet(p)
    whole = pd.read_parquet(os.path.join(ACL, 'religion', 'religion_town_whole.parquet'))

    def shares(df):
        t = df['total'].astype(float).replace(0, np.nan)
        return np.column_stack([df[RELCOL.get(k, k)].astype(float) / t for k in RELS])
    sub = rel[rel.level == 'SUBDISTRICT']
    SR = dict(zip(zip(sub[sub.tru == 'Rural'].state, sub[sub.tru == 'Rural'].district, sub[sub.tru == 'Rural'].subdistt), shares(sub[sub.tru == 'Rural'])))
    SU = dict(zip(zip(sub[sub.tru == 'Urban'].state, sub[sub.tru == 'Urban'].district, sub[sub.tru == 'Urban'].subdistt), shares(sub[sub.tru == 'Urban'])))
    TW = dict(zip(whole.town_code, shares(whole)))
    out = np.full((len(units), len(RELS)), np.nan)
    for i, (rt, s, d, sd, t) in enumerate(zip(units.route, units.State, units.District, units.Subdistt, units['Town/Village'])):
        k = (s, d, sd)
        v = SR.get(k) if rt == 'village' else TW.get(t)
        if v is None or np.isnan(v).any():
            v = SU.get(k) if rt != 'village' else SR.get(k)
        if v is not None and not np.isnan(v).any():
            out[i] = v
    for j, k in enumerate(RELS):
        units['r_' + k] = np.nan_to_num(out[:, j]) * units.TOT_P
    units['r_base'] = np.where(np.isnan(out[:, 0]), 0, units.TOT_P)
    print(f'religion attached to {(~np.isnan(out[:, 0])).mean():.2%} of units')
    return units


def attach_amenities(units):
    p = os.path.join(ACL, 'hl14', 'hl14_units.parquet')
    if not os.path.exists(p):
        print('amenities: HL-14 input missing — seat profiles will carry no amenities')
        return units
    hl = pd.read_parquet(p)
    cols = {c.lower(): c for c in hl.columns}
    def col(*keys):
        for c in hl.columns:
            lc = c.lower()
            if all(k in lc for k in keys):
                return c
        raise KeyError(keys)
    A = {'elec': col('electric'), 'lpg': col('lpg'), 'latrine': col('latrine'), 'tap': col('tap'), 'bank': col('bank'),
         'tv': next(c for c in hl.columns if c.lower() in ('pct_tv', 'tv', 'pct_television') or c.lower().endswith('_tv')),
         'phone': col('phone'), 'computer': col('computer'), 'twowheeler': col('two'), 'car': col('car'), 'noasset': col('none')}
    k5 = [cols.get('state'), cols.get('district'), cols.get('subdistt'), cols.get('town_village'), cols.get('ward')]
    lvl = hl[cols['level']].astype(str).str.upper()
    u = hl[lvl.isin(['VILLAGE', 'WARD'])]
    U = dict(zip(zip(*[u[c].astype(str) for c in k5]), u[[A[a] for a in AMENS]].to_numpy(float)))
    t = hl[lvl == 'TOWN']
    T = dict(zip(t[k5[3]].astype(str), t[[A[a] for a in AMENS]].to_numpy(float)))
    out = np.full((len(units), len(AMENS)), np.nan)
    for i, key in enumerate(zip(units.State, units.District, units.Subdistt, units['Town/Village'], units.Ward)):
        v = U.get(key)
        if v is None and key[4] != '0000':
            v = T.get(key[3])
        if v is not None and not np.isnan(v).any():
            out[i] = v
    for j, a in enumerate(AMENS):
        units['a_' + a] = np.nan_to_num(out[:, j]) / 100 * units.No_HH
    units['a_base'] = np.where(np.isnan(out[:, 0]), 0, units.No_HH)
    print(f'amenities attached to {(~np.isnan(out[:, 0])).mean():.2%} of units')
    return units


# ───────────────────────── seat profiles ─────────────────────────
def profile(row, name):
    I = lambda k: int(round(row[k]))
    x = {'n': name, 'p': I('TOT_P'), 'm': I('TOT_M'), 'f': I('TOT_F'), 'u': I('URB'), 'hh': I('No_HH'),
         'c6': I('P_06'), 'c6m': I('M_06'), 'c6f': I('F_06'), 'sc': I('P_SC'), 'st': I('P_ST'),
         'l': I('P_LIT'), 'lm': I('M_LIT'), 'lf': I('F_LIT'), 'w': I('TOT_WORK_P'),
         'cl': I('CL'), 'al': I('AL'), 'hi': I('HI'), 'ot': I('OT')}
    if row.get('r_base', 0) > 0.98 * row['TOT_P']:
        x['r'] = {k: int(round(row['r_' + k] * row['TOT_P'] / row['r_base'])) for k in RELS}
    if row.get('a_base', 0) > 0.9 * row['No_HH'] and row.get('a_base', 0) > 0:
        x['a'] = {k: round(row['a_' + k] / row['a_base'] * 100, 1) for k in AMENS}
    return x


def segments_composition(state, seats_ge, segments, latest_ae):
    """PC j -> list of AE j (default boundaries), as build_census.py composes them."""
    yrs = sorted({s['y'] for s in segments if s['s'] == state and not (state == 'Assam' and s['y'] >= 2024)}, reverse=True)
    comp = {}
    for yr in yrs:
        part = defaultdict(list)
        for s in segments:
            if s['s'] == state and s['y'] == yr:
                part[s['pc']].append(s['n'] + 119 if state == 'Andhra Pradesh' and yr >= 2019 else s['n'])
        for pcn, aes in part.items():
            row = next((r for r in seats_ge if r['s'] == state and r['y'] == yr and r['n'] == pcn), None)
            if row and row['j'] < 1000 and row['j'] not in comp:
                comp[row['j']] = aes
    return comp


def apply_overrides(units):
    """City / town placements built from official ward lists and the delimitation order (ac_level/city/*.csv) REPLACE
    the LGD route for the units they cover. They are keyed by the ECI seat: ('E|<app state>|def|<eci no>', weight)."""
    files = sorted(glob.glob(os.path.join(ACL, 'city', '*_to_ac.csv')))
    if not files:
        return units
    ov = pd.concat([pd.read_csv(f, dtype=str, keep_default_na=False).assign(_src=os.path.basename(f)) for f in files], ignore_index=True)
    for c, n in (('census_state', 2), ('census_district', 3), ('census_subdistt', 5), ('census_town', 6)):
        ov[c] = ov[c].str.strip().str.zfill(n)
    ov['census_ward'] = ov['census_ward'].str.strip().map(lambda s: s.zfill(4) if s else '')
    ov['eid'] = 'E|' + ov.app_state.str.strip() + '|def|' + ov.eci_ac_no.str.strip().str.split('.').str[0]
    ov['weight'] = ov.weight.astype(float)
    sd_rows = ov[(ov.census_ward == '') & (ov.census_town.isin(['', '000000'])) & (ov.census_subdistt.str.strip('0') != '')]
    ov = ov.drop(sd_rows.index)
    ward_rows = ov[ov.census_ward != '']
    town_rows = ov[ov.census_ward == '']
    SD = {k: list(zip(g.eid, g.weight)) for k, g in sd_rows.groupby(['census_state', 'census_district', 'census_subdistt'])}
    W = {k: list(zip(g.eid, g.weight)) for k, g in ward_rows.groupby(['census_state', 'census_district', 'census_town', 'census_ward'])}
    Tm = {k: list(zip(g.eid, g.weight)) for k, g in town_rows.groupby(['census_state', 'census_town'])}
    V = {}
    vill = town_rows[town_rows.census_town.str[0] != '8']          # villages / CTs placed by an override, by code
    n_ward = n_town = 0
    for i, (lvl, s, d, t, w) in enumerate(zip(units.Level, units.State, units.District, units['Town/Village'], units.Ward)):
        hit = W.get((s, d, t, w)) if lvl == 'WARD' else None
        if hit is None:
            hit = Tm.get((s, t))
        if hit is None and SD and not (lvl == 'WARD' and str(t).startswith('8')):
            hit = SD.get((s, d, units.Subdistt.iat[i]))     # a whole sub-district's villages / CTs (LGD error fixes)
        if hit is not None:
            units.iat[i, units.columns.get_loc('acs')] = hit
            units.iat[i, units.columns.get_loc('method')] = 'city-ward' if lvl == 'WARD' and (s, d, t, w) in W else 'order-town'
            n_ward += lvl == 'WARD'
            n_town += lvl != 'WARD'
    print(f'overrides from {len(files)} city files: {n_ward:,} wards and {n_town:,} villages placed by official ward / order lists')
    return units


ORDER_EXTENTS = os.path.join(ACL, 'order_extents')     # 2008 order, AC extents per state (ac_level/order_extents/*.csv)
TOWN_MARK = r'\s*\((?:M\.?\s*Corp|MCl|M\.?\s*Cl|M|CB|NP|NAC|TP|MB|NPP|NN|NPS|M\s*Cl)'


def seat_district_map():
    """(app state, ECI no on the default boundaries) -> 2011 census district codes the seat lies in (from build_census.py)."""
    seats = json.load(io.open(os.path.join(DATA, 'seats_ae.json'), encoding='utf-8'))
    out = {}
    for path in glob.glob(os.path.join(OUT, '*.json')):
        doc = json.load(io.open(path, encoding='utf-8'))
        st_slug = os.path.basename(path)[:-5]
        rows = [r for r in seats if slug(r['s']) == st_slug and r['j'] < 1000 and not (r['s'] in BREAK and r['y'] >= BREAK[r['s']])]
        if not rows:
            continue
        latest = max(r['y'] for r in rows)
        for r in rows:
            if r['y'] == latest and str(r['j']) in doc['AE']:
                out[(r['s'], r['n'])] = {c for c, _ in doc['AE'][str(r['j'])]['w']}
    return out


def order_expand(ex):
    """LGD sometimes puts a whole city in ONE seat (Ludhiana's 16 lakh people all in Ludhiana Central; also Amritsar,
    Jalandhar, Patiala, Indore, Bhopal, Vadodara ...). The 2008 delimitation order names every seat a city's wards
    fall in, so where the order spreads a town over several seats, the town is spread over those seats (equal prior;
    the electors share-out that follows sets the real weights)."""
    files = glob.glob(os.path.join(ORDER_EXTENTS, 'order_ac_extents_*.csv'))
    if not files:
        return ex
    seat_districts = seat_district_map()
    ext = []
    for f in files:
        st = os.path.basename(f)[len('order_ac_extents_'):-4].replace('_', ' ')
        d = pd.read_csv(f, dtype=str, keep_default_na=False)
        for n, txt in zip(d.n, d.extent):
            n = int(n)
            if st == 'Andhra Pradesh':                         # the order numbers undivided AP 1-294
                app, no = ('Telangana', n) if n <= 119 else ('Andhra Pradesh', n - 119)
            else:
                app, no = st, n
            ext.append((app, no, txt))
    one = ex[(ex.route == 'town') & ex.method.str.startswith('town')]
    single = one.groupby('Town/Village').eid.nunique()
    single = single[single == 1].index
    pop = one[one['Town/Village'].isin(single)].groupby('Town/Village').agg(p=('TOT_P', 'sum'), eid=('eid', 'first'))
    pop = pop[pop.p >= 150_000]
    names = ex[ex['Town/Village'].isin(pop.index)].groupby('Town/Village').town_name.first()
    add, changed = [], []
    for t, row in pop.iterrows():
        st = row.eid.split('|')[1]
        base = re.sub(r'\s*\(.*$', '', str(names.get(t, ''))).strip()
        if len(base) < 3:
            continue
        pat = re.compile(re.escape(base) + TOWN_MARK, re.I)
        hits = sorted({no for app, no, txt in ext if app == st and pat.search(txt)})
        # a seat can only hold part of a city that lies in its own 2011 district ("Jalgaon (M Cl)" is also the town of
        # Jalgaon Jamod, a different district)
        tdist = str(int(ex.loc[ex['Town/Village'] == t, 'District'].iloc[0]))
        hits = [no for no in hits if tdist in seat_districts.get((st, no), {tdist})]
        if len(hits) < 2:
            continue
        eids = [f'E|{st}|def|{no}' for no in hits]
        rows = ex[ex['Town/Village'] == t]
        for e in eids:
            add.append(rows.assign(eid=e, wt=rows.wt / len(eids), method='town-order-seats'))
        changed.append((st, t, base, int(row.p), hits))
    if not changed:
        return ex
    ex = pd.concat([ex[~ex['Town/Village'].isin([c[1] for c in changed])]] + add, ignore_index=True)
    print(f'cities LGD put in one seat, spread over the seats the 2008 order names: {len(changed)}')
    for c in sorted(changed, key=lambda c: -c[3])[:25]:
        print(f'   {c[0]:<16} {c[2]:<18} {c[3]:>10,} -> seats {c[4]}')
    return ex


def seat_frames(seats_ae):
    """Per (state, domain): the key each ECI number maps to in the census file, and the electors of every seat in the
    election CLOSEST TO 2011 on those boundaries (the gate and the city share-out compare against the 2011 census)."""
    frames = {}
    states = sorted({r['s'] for r in seats_ae})
    for state in states:
        el = defaultdict(dict)
        for sub in ('electors', 'electors_eci'):
            p = os.path.join(DATA, sub, slug(state) + '.json')
            if os.path.exists(p):
                for y, s in json.load(io.open(p, encoding='utf-8')).get('AE', {}).items():
                    for n, rec in s.items():
                        if rec.get('e'):
                            el[int(y)][int(n)] = rec['e']
        for domain in ('def', 'new'):
            if domain == 'def':
                rows = [r for r in seats_ae if r['s'] == state and r['j'] < 1000 and not (state in BREAK and r['y'] >= BREAK[state])]
                keyof = lambda r: str(r['j'])
            else:
                if state not in BREAK:
                    continue
                rows = [r for r in seats_ae if r['s'] == state and r['y'] >= BREAK[state]]
                keyof = lambda r: str(r['n'])
            years = sorted({r['y'] for r in rows})
            if not years:
                continue
            latest = years[-1] if domain == 'def' else years[0]
            n2key = {r['n']: keyof(r) for r in rows if r['y'] == latest}
            with_el = [y for y in years if el.get(y)]
            gy = min(with_el, key=lambda y: (abs(y - 2011), y)) if with_el else None
            e_by_key = {keyof(r): el[gy].get(r['n']) for r in rows if gy and r['y'] == gy and el[gy].get(r['n'])}
            frames[(state, domain)] = {'latest': latest, 'gate_year': gy, 'n2key': n2key, 'e_by_key': e_by_key}
    return frames


def main():
    units = pd.read_parquet(os.path.join(ACL, 'pca_units.parquet'))
    units['CL'] = units.MAIN_CL_P + units.MARG_CL_P
    units['AL'] = units.MAIN_AL_P + units.MARG_AL_P
    units['HI'] = units.MAIN_HH_P + units.MARG_HH_P
    units['OT'] = units.MAIN_OT_P + units.MARG_OT_P
    units['URB'] = np.where(units.Level == 'WARD', units.TOT_P, 0)
    units = assign(units)
    units = apply_overrides(units)
    units = attach_religion(units)
    units = attach_amenities(units)

    seats_ae = json.load(io.open(os.path.join(DATA, 'seats_ae.json'), encoding='utf-8'))
    seats_ge = json.load(io.open(os.path.join(DATA, 'seats_ge.json'), encoding='utf-8'))
    segments = json.load(io.open(os.path.join(DATA, 'segments.json'), encoding='utf-8'))
    frames = seat_frames(seats_ae)

    # LGD AC code -> ECI seat id. Seats on the boundaries the app calls NEW (J&K 2022, Assam 2023) are a separate domain.
    cw = pd.read_csv(os.path.join(ACL, 'crosswalk', 'lgd_ac_to_eci.csv'), dtype=str, keep_default_na=False)
    cw = cw[cw.eci_ac_no.str.strip() != '']
    dom = np.where(cw.delimitation.str.contains('2022-JK|2023-Assam'), 'new', 'def')
    emap = dict(zip(cw.lgd_ac_code.str.strip(), 'E|' + cw.state.str.strip() + '|' + dom + '|' + cw.eci_ac_no.str.strip().str.split('.').str[0]))

    num = COUNTS + [c for c in units.columns if c.startswith(('r_', 'a_'))]
    ex = units[units.acs.notna()][['acs', 'method', 'route', 'Town/Village', 'town_name', 'Level', 'State', 'District', 'Subdistt', 'Ward'] + num].explode('acs')
    ex['ac'] = ex.acs.str[0]
    ex['wt'] = ex.acs.str[1].astype(float)
    ex['eid'] = np.where(ex.ac.str.startswith('E|'), ex.ac, ex.ac.map(emap))
    lost = ex[ex.eid.isna()]
    ex = ex[ex.eid.notna()].copy()

    ex = order_expand(ex)

    def eid_electors(eid):
        _, st_, dm, no = eid.split('|')
        f = frames.get((st_, dm))
        if not f:
            return None
        k = f['n2key'].get(int(no))
        return f['e_by_key'].get(k) if k else None
    E = {e: eid_electors(e) for e in ex.eid.unique()}

    # ── a city shared out across several seats: by each seat's ELECTORS in its city part, not by ward counts ──
    # (today's LGD wards were redrawn after 2011, so ward counts misplace whole neighbourhoods — Ludhiana Central came
    # out with 8x its population). City-part electors = seat electors - its other people x the state's electors/person.
    ex['split'] = (ex.route == 'town') & ex.method.str.startswith('town') & (ex.groupby('Town/Village').eid.transform('nunique') > 1)
    ex['st_'] = ex.eid.str.split('|').str[1]
    other = ex[~ex.split].assign(p=lambda d: d.TOT_P * d.wt).groupby('eid').p.sum()
    pure = [e for e in other.index if E.get(e) and e not in set(ex[ex.split].eid)]
    r_state = pd.Series({e: E[e] / other[e] for e in pure if other[e] > 0}).groupby(lambda e: e.split('|')[1]).median()
    sp = ex[ex.split].drop_duplicates(['Town/Village', 'eid'])[['Town/Village', 'eid', 'wt', 'st_']]
    sp['resid'] = [max(0.0, (E.get(e) or 0) - r_state.get(s, 0.65) * other.get(e, 0.0)) for e, s in zip(sp.eid, sp.st_)]
    sp['wc_in_seat'] = sp.wt / sp.groupby('eid').wt.transform('sum')
    sp['share'] = sp.resid * sp.wc_in_seat
    tot = sp.groupby('Town/Village').share.transform('sum')
    sp['new_wt'] = np.where(tot > 0, sp.share / tot.replace(0, np.nan), sp.wt)
    nw = dict(zip(zip(sp['Town/Village'], sp.eid), sp.new_wt))
    m = ex.split
    ex.loc[m, 'wt'] = [nw[(t, e)] for t, e in zip(ex.loc[m, 'Town/Village'], ex.loc[m, 'eid'])]
    # Each WARD must still sum to 1 over the seats it may sit in. A city spanning two districts (GHMC: Hyderabad +
    # Rangareddy) has its wards restricted to their own district's seats by the district guard, so the city-level
    # shares only cover part of each ward — without this every core Hyderabad seat lost half its people.
    ukey = ['State', 'District', 'Subdistt', 'Town/Village', 'Ward', 'Level']
    ex.loc[m, 'wt'] = ex.loc[m, 'wt'] / ex[m].groupby(ukey).wt.transform('sum').replace(0, np.nan)
    ex.loc[m, 'wt'] = ex.loc[m, 'wt'].fillna(0)
    print(f'split cities re-apportioned by electors: {sp["Town/Village"].nunique()} towns over {sp.eid.nunique()} seats')

    ex[num] = ex[num].astype(float).mul(ex.wt, axis=0)
    ex['split_p'] = np.where(ex.split | (ex.method == 'subdistrict-split'), ex.TOT_P, 0)
    agg = ex.groupby('eid')[num + ['split_p']].sum()
    agg['n_v'] = ex[ex.Level == 'VILLAGE'].groupby('eid').size()
    agg['n_t'] = ex[ex.Level == 'WARD'].groupby('eid')['Town/Village'].nunique()
    agg = agg.fillna({'n_v': 0, 'n_t': 0})

    total = units.TOT_P.sum()
    placed = units[units.acs.notna()].TOT_P.sum()
    report = {'placed_share': round(placed / total, 5),
              'lost_to_unmatched_lgd_acs': int((lost.TOT_P * lost.wt).sum()),
              'unmatched_lgd_acs': sorted(lost.ac.unique().tolist())[:200],
              'by_method': units[units.acs.notna()].groupby('method').TOT_P.sum().div(total).round(4).to_dict()}
    un = units[units.acs.isna()]
    st_tot = units.groupby('State').TOT_P.sum()
    report['unplaced_by_census_state'] = {k: round(v / st_tot[k], 4) for k, v in un.groupby('State').TOT_P.sum().items()}
    report['largest_unplaced_towns'] = [[stc, k, nm, int(p)] for (stc, k, nm), p in
                                        un[un.route == 'town'].groupby(['State', 'key', 'town_name']).TOT_P.sum().sort_values(ascending=False).head(60).items()]
    print(f'placed {placed / total:.2%} of India; {report["lost_to_unmatched_lgd_acs"]:,} people sit in LGD ACs with no ECI match')
    for k, v in report['by_method'].items():
        print(f'   {k:<20} {v:.2%}')
    ex[['State', 'District', 'Subdistt', 'Town/Village', 'Ward', 'Level', 'eid', 'wt', 'method']].to_parquet(
        os.path.join(ACL, 'unit_to_ac.parquet'), index=False)

    dcount = units[units.Level == 'VILLAGE'].groupby('District').size()
    tcount = units[units.Level == 'WARD'].groupby('District')['Town/Village'].nunique()

    stats, gated = {}, []
    for path in sorted(glob.glob(os.path.join(OUT, '*.json'))):
        doc = json.load(io.open(path, encoding='utf-8'))
        st_slug = os.path.basename(path)[:-5]
        state = next((r['s'] for r in seats_ae if slug(r['s']) == st_slug), None) or \
            next((r['s'] for r in seats_ge if slug(r['s']) == st_slug), None)
        for sec in ('AE', 'GE'):
            for rec in doc.get(sec, {}).values():
                rec.pop('x', None); rec.pop('q', None)
        for sec in ('AEy', 'GEy'):
            for yr in doc.get(sec, {}).values():
                for rec in yr.values():
                    rec.pop('x', None); rec.pop('q', None)
        if not state:
            continue
        ok = 0
        for domain in ('def', 'new'):
            f = frames.get((state, domain))
            if not f:
                continue
            pool = doc['AE'] if domain == 'def' else doc.get('AEy', {}).get(str(f['latest']), {})
            cand = {}
            for eid in agg.index:
                _, st_, dm, no = eid.split('|')
                k = f['n2key'].get(int(no))
                if st_ == state and dm == domain and k in pool and agg.at[eid, 'TOT_P'] > 0:
                    cand[k] = agg.loc[eid]
            ratios = {k: f['e_by_key'][k] / a.TOT_P for k, a in cand.items() if f['e_by_key'].get(k)}
            med = float(np.median(list(ratios.values()))) if ratios else None
            for k, a in cand.items():
                r_ = ratios.get(k)
                if not med or r_ is None or not (RATIO_BAND[0] <= r_ / med <= RATIO_BAND[1]):
                    gated.append([state, domain, k, pool[k]['c'], round(r_ / med, 2) if med and r_ else None, int(a.TOT_P)])
                    continue
                rec = pool[k]
                rec['x'] = profile(a, rec['c'])
                rec['q'] = {'v': int(a.n_v), 't': int(a.n_t), 'a': round(float(a.split_p / a.TOT_P), 3)}
                ok += 1

        pc_ok = 0
        has_ae = any(r['s'] == state for r in seats_ae) and state != 'Ladakh'
        if not has_ae:
            # UTs without a legislature (and Ladakh): each PC is whole census districts — sum them
            for j, rec in doc['GE'].items():
                codes = [c for c, _ in rec['w']]
                ds = [doc['d'][c] for c in codes if c in doc['d']]
                if not ds:
                    continue
                x = {'n': rec['c']}
                for kk in ('p', 'm', 'f', 'u', 'hh', 'c6', 'c6m', 'c6f', 'sc', 'st', 'l', 'lm', 'lf', 'w', 'cl', 'al', 'hi', 'ot'):
                    x[kk] = sum(d.get(kk, 0) for d in ds)
                x['r'] = {kk: sum(d['r'][kk] for d in ds) for kk in RELS}
                hh = sum(d['hh'] for d in ds)
                x['a'] = {kk: round(sum(d['a'][kk] * d['hh'] for d in ds) / hh, 1) for kk in AMENS}
                rec['x'] = x
                rec['q'] = {'v': int(sum(dcount.get(c.zfill(3), 0) for c in codes)), 't': int(sum(tcount.get(c.zfill(3), 0) for c in codes)), 'a': 0}
                pc_ok += 1
        else:
            comp = segments_composition(state, seats_ge, segments, None)
            for j, aes in comp.items():
                rec = doc['GE'].get(str(j))
                segs = [doc['AE'].get(str(a)) for a in aes]
                if not rec or not segs or any(s is None or 'x' not in s for s in segs):
                    continue
                rec['x'], rec['q'] = sum_segments(rec['c'], segs)
                pc_ok += 1
        stats[state] = {'ae_seat_level': ok, 'ae_total': len(doc['AE']) + sum(len(v) for v in doc.get('AEy', {}).values()),
                        'pc_seat_level': pc_ok, 'pc_total': len(doc['GE'])}
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(doc, fh, separators=(',', ':'), ensure_ascii=False)

    report['states'] = stats
    report['gated'] = gated
    report['gate_years'] = {f'{s}|{d}': f['gate_year'] for (s, d), f in frames.items()}
    with open(os.path.join(ACL, 'ac_build_report.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=1, ensure_ascii=False, default=str)
    ta = sum(s['ae_seat_level'] for s in stats.values()); tt = sum(s['ae_total'] for s in stats.values())
    pa = sum(s['pc_seat_level'] for s in stats.values()); pt = sum(s['pc_total'] for s in stats.values())
    print(f'seat level: {ta:,} / {tt:,} assembly seat records · {pa} / {pt} parliament seats · {len(gated)} gated out by electors/population')
    for st, s in sorted(stats.items()):
        print(f'   {st:<36} AE {s["ae_seat_level"]:>4}/{s["ae_total"]:<4} PC {s["pc_seat_level"]:>3}/{s["pc_total"]:<3}')


def sum_segments(name, segs):
    x = {'n': name}
    for k in ('p', 'm', 'f', 'u', 'hh', 'c6', 'c6m', 'c6f', 'sc', 'st', 'l', 'lm', 'lf', 'w', 'cl', 'al', 'hi', 'ot'):
        x[k] = sum(s['x'][k] for s in segs)
    if all('r' in s['x'] for s in segs):
        x['r'] = {k: sum(s['x']['r'][k] for s in segs) for k in RELS}
    if all('a' in s['x'] for s in segs):
        hh = sum(s['x']['hh'] for s in segs) or 1
        x['a'] = {k: round(sum(s['x']['a'][k] * s['x']['hh'] for s in segs) / hh, 1) for k in AMENS}
    q = {'v': sum(s['q']['v'] for s in segs), 't': sum(s['q']['t'] for s in segs),
         'a': round(sum(s['q']['a'] * s['x']['p'] for s in segs) / max(1, x['p']), 3)}
    return x, q


if __name__ == '__main__':
    main()
