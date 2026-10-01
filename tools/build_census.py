#!/usr/bin/env python3
"""Build per-state Census 2011 profiles for every assembly and parliament seat.

STEP 1 — DISTRICT level (this file). Every seat is placed in its 2011 census district(s); the app shows that
district's profile (lib/census.ts blends when a seat spans several). Output, lazy-loaded one state at a time:

  public/data/census/<slug>.json
    { "d":  { "<census district code>": { n, p, m, f, u, hh, c6, c6m, c6f, sc, st, l, lm, lf, w, cl, al, hi, ot,
                                          r: {religion: persons}, a: {amenity: % of households} } },
      "st": { ...same, the state as the app draws it... },
      "AE": { "<j>": { c: seat name, w: [[code, share], ...] } },     <- the seat's continuity number
      "GE": { "<j>": { ... } },
      "AEy"/"GEy": { "<year>": { "<n>": {...} } },                     <- years fought on NEW boundaries
      "src": "..." }

Sources (all official, all validated to the national totals — see each folder's validation file):
  census2011/pca        Primary Census Abstract, district level (ORGI, NADA catalogue 6191)
  census2011/religion   Table C-01, population by religion, district level (ORGI)
  census2011/hlo        Houselisting tables HL-01/06/07/08/10/12, household counts, district level (ORGI)
Licence basis: Government Open Data License – India (data.gov.in publishes the same ORGI tables), attribution to the
Office of the Registrar General & Census Commissioner, India.

Placement:
  · seat_district_overlay.csv (build_census_overlay.py) — area shares of each AC / UT-PC polygon by 2011 district.
  · VETO by the official delimitation list (census2011/ac_district_2008/): an AC lies wholly inside the district it was
    delimited in, so a share in any 2011 district that is neither that district nor one carved out of it is a drawing
    error between two independent maps (e.g. WB 116 Bidhannagar landing in South 24 Parganas) and is removed.
  · J&K 2024 and Assam 2026 assembly seats, and the Ahmedabad / Surat / Indore ACs that have no polygon, come straight
    from the official orders (census2011/ac_district_lists/).
  · Parliament seats = their assembly segments' districts, weighted by each segment's ELECTORATE. Seats with no
    assembly segments (the UTs without a legislature, Ladakh) are whole districts, weighted by population.

Run from product/app:  python tools/build_census.py
"""
import csv, difflib, glob, io, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
DATA = os.path.join(APP, 'public', 'data')
SRC = os.path.join(HERE, 'sources', 'census2011')
OUT = os.path.join(DATA, 'census')

sys.path.insert(0, HERE)
from build_candidates import norm_seat, slug  # noqa: E402

BREAK = {'Jammu & Kashmir': 2020, 'Assam': 2023}          # mirrors joins.ts DELIM_BREAK_AE
GEO_ALIAS = {'ODISHA': 'ORISSA', 'UTTARAKHAND': 'UTTARKHAND', 'TELANGANA': 'ANDHRA PRADESH', 'LADAKH': 'JAMMU & KASHMIR'}
MIN_PC_SHARE = 0.03                                         # a district under 3% of a parliament seat is noise


def U(s):
    return re.sub(r'\s+', ' ', re.sub(r'\bAND\b', '&', (s or '').upper())).strip()


def same(a, b):
    a, b = norm_seat(a), norm_seat(b)
    return bool(a) and bool(b) and (a == b or a in b or b in a)


def read(path):
    return list(csv.DictReader(io.open(path, encoding='utf-8-sig')))


# ─────────────────────────────── district profiles ───────────────────────────────
def district_profiles():
    I = lambda r, k: int(float(r[k] or 0))
    prof, hlo = {}, {}
    for r in read(os.path.join(SRC, 'pca', 'pca_district_2011.csv')):
        code = int(r['district_code'])
        if r['tru'] == 'Urban':
            prof.setdefault(code, {})['u'] = I(r, 'TOT_P')
            continue
        if r['tru'] != 'Total':
            continue
        d = prof.setdefault(code, {})
        d.update({
            'n': r['district_name'].strip(), '_state': r['state_name'].strip(), '_sc': r['state_code'],
            'p': I(r, 'TOT_P'), 'm': I(r, 'TOT_M'), 'f': I(r, 'TOT_F'), 'hh': I(r, 'No_HH'),
            'c6': I(r, 'P_06'), 'c6m': I(r, 'M_06'), 'c6f': I(r, 'F_06'),
            'sc': I(r, 'P_SC'), 'st': I(r, 'P_ST'),
            'l': I(r, 'P_LIT'), 'lm': I(r, 'M_LIT'), 'lf': I(r, 'F_LIT'),
            'w': I(r, 'TOT_WORK_P'),
            'cl': I(r, 'MAIN_CL_P') + I(r, 'MARG_CL_P'), 'al': I(r, 'MAIN_AL_P') + I(r, 'MARG_AL_P'),
            'hi': I(r, 'MAIN_HH_P') + I(r, 'MARG_HH_P'), 'ot': I(r, 'MAIN_OT_P') + I(r, 'MARG_OT_P'),
        })
    REL = {'hindu': 'hindu', 'muslim': 'muslim', 'christian': 'christian', 'sikh': 'sikh', 'buddhist': 'buddhist',
           'jain': 'jain', 'other': 'other_religions', 'none': 'religion_not_stated'}
    for r in read(os.path.join(SRC, 'religion', 'religion_district_2011.csv')):
        if r['tru'] == 'Total':
            prof[int(r['district_code'])]['r'] = {k: int(r[c]) for k, c in REL.items()}
    # household amenities: keep COUNTS here (they sum to a state); % is computed at write time
    AMEN = {'elec': 'light_electricity', 'lpg': 'fuel_lpg_png', 'latrine': 'latrine_within', 'tap': 'tap_water',
            'bank': 'banking', 'tv': 'tv', 'phone': 'phone_any', 'computer': 'computer_any',
            'twowheeler': 'two_wheeler', 'car': 'car_jeep_van', 'noasset': 'no_assets'}
    for r in read(os.path.join(SRC, 'hlo', 'hlo_district_2011_counts.csv')):
        if r['tru'] == 'Total':
            hlo[int(r['district_code'])] = {'_hh': int(r['total_households']), **{k: int(r[c]) for k, c in AMEN.items()}}
    assert len(prof) == 640 and len(hlo) == 640, (len(prof), len(hlo))
    return prof, hlo


def public(d, hlo_counts):
    """A profile as shipped: counts as-is, amenities as % of households (1 decimal)."""
    out = {k: v for k, v in d.items() if not k.startswith('_')}
    if hlo_counts and hlo_counts.get('_hh'):
        hh = hlo_counts['_hh']
        out['a'] = {k: round(v / hh * 100, 1) for k, v in hlo_counts.items() if not k.startswith('_')}
    return out


def add(acc, d):
    for k, v in d.items():
        if k.startswith('_') or k == 'n':
            continue
        if isinstance(v, dict):
            sub = acc.setdefault(k, {})
            for kk, vv in v.items():
                sub[kk] = sub.get(kk, 0) + vv
        else:
            acc[k] = acc.get(k, 0) + v


# ─────────────────────────────── placement ───────────────────────────────
def overlay():
    ac, pc, d08 = defaultdict(list), defaultdict(list), {}
    for r in read(os.path.join(SRC, 'seat_district_overlay.csv')):
        k = (r['geo_state'], int(r['seat_no']))
        (ac if r['layer'] == 'AC' else pc)[k].append((int(r['district_code']), float(r['share'])))
        if r['layer'] == 'AC':
            d08[k] = (r['seat_name'], r['pc_name'], r['dist_2008'])
    return ac, pc, d08


def official_2008(prof):
    """(app state, ac_no as numbered in its delimitation) -> (continuing 2011 code, allowed 2011 codes)."""
    allowed, problems = {}, []
    base = os.path.join(SRC, 'ac_district_2008')
    for f in sorted(glob.glob(os.path.join(base, '*_districts.csv'))):
        dmap = {}
        for r in read(f):
            cont = (r.get('continuing_2011_code') or '').strip()
            cont = int(cont) if cont.isdigit() and int(cont) in prof else None
            codes = {int(c) for c in (r.get('carved_2011_codes') or '').replace(',', ';').split(';')
                     if c.strip().isdigit() and int(c) in prof}
            if cont:
                codes.add(cont)
            dmap[U(r['district_2008'])] = (cont, codes)
        acs = f.replace('_districts.csv', '_acs.csv')
        if not os.path.exists(acs):
            problems.append(f'{os.path.basename(f)} has no matching _acs.csv')
            continue
        for r in read(acs):
            codes = dmap.get(U(r['district_2008']))
            if not codes or not codes[1]:
                problems.append(f'{r["state"]} AC {r["ac_no"]}: district "{r["district_2008"]}" has no 2011 mapping')
                continue
            extra = extra_codes(r.get('note') or '', dmap, prof)
            if extra:
                extras.append((r['state'], int(r['ac_no']), sorted(extra)))
            allowed[(r['state'].strip(), int(r['ac_no']))] = (codes[0], codes[1] | extra)
    # hand-verified second districts the parsed headings miss (see allow.csv for the evidence per row)
    p = os.path.join(base, 'allow.csv')
    if os.path.exists(p):
        for r in read(p):
            k = (r['state'], int(r['ac_no']))
            if k in allowed:
                add = {int(c) for c in r['also_2011_codes'].split(';') if c.strip().isdigit() and int(c) in prof}
                allowed[k] = (allowed[k][0], allowed[k][1] | add)
                extras.append((k[0], k[1], sorted(add)))
    return allowed, problems


def extra_codes(note, dmap, prof):
    """Second districts the OFFICIAL extent itself gives an AC, from the parsers' note tags:
         also_2011=NNN[;NNN]         a police station / mouza / circle of another district (Jharkhand, Assam)
         possible_2011=NNN[;NNN]     a 1976-era AC whose circles were split between 2011 districts (Assam)
         ALSO_DISTRICT=NAME(NNN)     villages the order places in another district (Mizoram)
         also_in_district_2008=NAME  blocks of another district (Sikkim)
         "2011 codes NNN + NNN"      Bihar 30 Belsand (Tariani Chowk block of Sheohar)
       Single-village SLIVERS (tagged '- a sliver') are deliberately NOT allowed: they are far below the 10%
       overlay floor anyway, and allowing them would only let a mis-drawn polygon through."""
    out = set()
    sliver = 'a sliver' in note
    for tag in ('also_2011', 'possible_2011'):
        for m in re.finditer(tag + r'=([\d;]+)', note):
            if tag == 'also_2011' and sliver:
                continue
            out |= {int(c) for c in m.group(1).split(';') if c}
    out |= {int(c) for c in re.findall(r'ALSO_DISTRICT=[^(]*\((\d+)\)', note)}
    for m in re.finditer(r'also_in_district_2008=([A-Za-z &.]+?)(?:;|$)', note):
        c = dmap.get(U(m.group(1)))
        if c:
            out |= c[1]
    m = re.search(r'2011 codes (\d+) \+ (\d+)', note)
    if m:
        out |= {int(m.group(1)), int(m.group(2))}
    return {c for c in out if c in prof}


extras = []    # (state, ac_no, codes) — reported by main()


def pins():
    """Hand-verified single-district fixes the district-level veto cannot express (parent vs carved child)."""
    # district_2011_code is one code, or a weighted split "358:0.6;346:0.4" (weights from census sub-districts)
    p = os.path.join(SRC, 'ac_district_2008', 'pins.csv')
    out = {}
    for r in (read(p) if os.path.exists(p) else []):
        v = r['district_2011_code'].strip()
        parts = [(int(x.split(':')[0]), float(x.split(':')[1]) if ':' in x else 1.0) for x in v.split(';') if x.strip()]
        t = sum(w for _, w in parts)
        out[(r['state'], int(r['ac_no']))] = [(c, w / t) for c, w in parts]
    return out


def official_lists(prof):
    """J&K 2022, Assam 2023, and the no-polygon Gujarat/MP ACs: (state, ac_no) -> (code, pc_no, ac_name)."""
    by_name = defaultdict(dict)
    for c, d in prof.items():
        by_name[U(d['_state'])][U(d['n'])] = c
    codes = {}
    for r in read(os.path.join(SRC, 'ac_district_lists', 'census2011_district_codes.csv')):
        codes[(U(r['state_2011']), U(r['district_2011']))] = int(r['census2011_district_code'])
    out = {}
    for fn, st11 in (('jk_2022_ac_district.csv', 'JAMMU & KASHMIR'), ('assam_2023_ac_district.csv', 'ASSAM'),
                     ('gj_mp_noshape_ac_district.csv', None)):
        for r in read(os.path.join(SRC, 'ac_district_lists', fn)):
            s11 = st11 or U(r['state'])
            c = codes.get((s11, U(r['district_2011']))) or by_name[s11].get(U(r['district_2011']))
            assert c, (fn, r['ac_no'], r['district_2011'])
            out[(r['state'], int(r['ac_no']))] = (c, int(r['pc_no']) if r.get('pc_no') else None, r['ac_name'])
    return out


def geo_to_app_state(geo_state, no, app_states):
    """The official 2008 list is filed under the APP's state names; map a polygon key back to one."""
    if geo_state == 'ANDHRA PRADESH':
        return 'Telangana' if no <= 119 else 'Andhra Pradesh'
    if geo_state == 'JAMMU & KASHMIR':
        return 'Jammu & Kashmir'
    inv = {v: k for k, v in GEO_ALIAS.items() if k not in ('TELANGANA', 'LADAKH')}
    key = inv.get(geo_state, geo_state)
    return next((s for s in app_states if U(s) == key), None)


def main():
    prof, hlo = district_profiles()
    ac_ov, pc_ov, d08 = overlay()
    allowed, off_problems = official_2008(prof)
    lists = official_lists(prof)

    seats_ae = json.load(io.open(os.path.join(DATA, 'seats_ae.json'), encoding='utf-8'))
    seats_ge = json.load(io.open(os.path.join(DATA, 'seats_ge.json'), encoding='utf-8'))
    segments = json.load(io.open(os.path.join(DATA, 'segments.json'), encoding='utf-8'))
    app_states = sorted({r['s'] for r in seats_ae} | {r['s'] for r in seats_ge})

    # ── 1. veto impossible placements with the official delimitation list ──
    vetoed, overridden, checked = [], [], 0
    pinned = pins()
    for k, sh in list(ac_ov.items()):
        st = geo_to_app_state(k[0], k[1], app_states)
        if (st, k[1]) in pinned:
            pin = pinned[(st, k[1])]
            overridden.append((k, d08.get(k, ('',))[0], [prof[x]['n'] for x, _ in sh],
                               ' + '.join(f'{prof[c]["n"]} {w:.0%}' for c, w in pin) + ' (pinned)'))
            ac_ov[k] = pin
            continue
        hit = allowed.get((st, k[1]))
        if not hit:
            continue
        cont, ok = hit
        checked += 1
        kept = [(c, s) for c, s in sh if c in ok]
        if len(kept) == len(sh):
            continue
        if kept:
            t = sum(s for _, s in kept)
            ac_ov[k] = [(c, s / t) for c, s in kept]
            vetoed.append((k, d08.get(k, ('',))[0], [(prof[c]['n'], round(s, 2)) for c, s in sh if c not in ok]))
        else:
            # nothing on the map is possible: the seat goes wholly to the district it was delimited in
            c = cont or max(ok, key=lambda x: prof[x]['p'])
            ac_ov[k] = [(c, 1.0)]
            overridden.append((k, d08.get(k, ('',))[0], [prof[x]['n'] for x, _ in sh], prof[c]['n']))

    # ── 2. a seat never holds another STATE's district ──
    # Delhi has no district headings in the 2008 order, so the veto never runs there, and Gokalpur kept a 13%
    # sliver of Ghaziabad (UP) across the border. Each polygon state's census state is the one that holds most of
    # its area; any slice in a different census state is map misalignment and goes.
    home = defaultdict(lambda: defaultdict(float))
    for k, sh in ac_ov.items():
        for c, w in sh:
            home[k[0]][prof[c]['_sc']] += w
    home = {g: max(v, key=v.get) for g, v in home.items()}
    crossed = []
    for k, sh in list(ac_ov.items()):
        kept = [(c, w) for c, w in sh if prof[c]['_sc'] == home[k[0]]]
        if len(kept) < len(sh) and kept:
            t = sum(w for _, w in kept)
            ac_ov[k] = [(c, w / t) for c, w in kept]
            crossed.append((k, d08.get(k, ('',))[0], [(prof[c]['n'], round(w, 2)) for c, w in sh if prof[c]['_sc'] != home[k[0]]]))

    # ── electorate per AC, for weighting parliament seats ──
    def electors(state):
        out = defaultdict(dict)
        for sub in ('electors', 'electors_eci'):          # ECI second, so it overwrites the baseline
            p = os.path.join(DATA, sub, slug(state) + '.json')
            if os.path.exists(p):
                for y, seats in json.load(io.open(p, encoding='utf-8')).get('AE', {}).items():
                    for n, rec in seats.items():
                        if rec.get('e'):
                            out[int(y)][int(n)] = rec['e']
        return out

    files, report = {}, defaultdict(list)
    for state in app_states:
        doc = {'AE': {}, 'GE': {}, 'AEy': defaultdict(dict), 'GEy': defaultdict(dict)}
        geo_st = GEO_ALIAS.get(U(state), U(state))
        ae_rows = [r for r in seats_ae if r['s'] == state]
        ge_rows = [r for r in seats_ge if r['s'] == state]
        el = electors(state)

        # ── assembly seats ──
        latest_default = max([r['y'] for r in ae_rows if r['j'] < 1000 and not (state in BREAK and r['y'] >= BREAK[state])], default=None)
        j2w = {}                                                  # j -> weights, for the default domain
        for r in sorted(ae_rows, key=lambda r: r['y']):
            if r['j'] >= 1000:
                continue                                          # 2004: pre-2008 boundaries, no mapping
            if state in BREAK and r['y'] >= BREAK[state]:
                hit = lists.get((state, r['n']))
                if hit:
                    if not same(hit[2], r['c']):
                        report['name'].append(f'{state} {r["y"]} AC {r["n"]}: app "{r["c"]}" vs order "{hit[2]}"')
                    doc['AEy'][str(r['y'])][str(r['n'])] = {'c': r['c'], 'w': [[str(hit[0]), 1.0]]}
                else:
                    report['missing'].append(f'{state} {r["y"]} AC {r["n"]} {r["c"]}: not in the delimitation list')
                continue
            k = (geo_st, r['j'])
            if k in ac_ov:
                w = ac_ov[k]
            elif (state, r['j']) in lists:
                w = [(lists[(state, r['j'])][0], 1.0)]
            else:
                report['missing'].append(f'{state} {r["y"]} AC {r["n"]} {r["c"]}: no polygon and no official list')
                continue
            j2w[r['j']] = w
            doc['AE'][str(r['j'])] = {'c': r['c'], 'w': [[str(c), round(s, 3)] for c, s in w]}

        # AC weight = its electorate in the latest election of the domain (j -> n in that year)
        def ac_weight(j):
            if latest_default is None:
                return 1.0
            n = next((r['n'] for r in ae_rows if r['y'] == latest_default and r['j'] == j), None)
            return el.get(latest_default, {}).get(n) or 1.0

        def blend(parts):
            acc = defaultdict(float)
            for w, shares in parts:
                for c, s in shares:
                    acc[c] += w * s
            t = sum(acc.values())
            out = sorted(((c, v / t) for c, v in acc.items()), key=lambda x: -x[1])
            kept = [(c, v) for c, v in out if v >= MIN_PC_SHARE] or out[:1]
            kt = sum(v for _, v in kept)
            return [[str(c), round(v / kt, 3)] for c, v in kept]

        # ── parliament seats ──
        has_acs = any(k[0] == geo_st for k in ac_ov) and state != 'Ladakh'
        latest_ge = {}
        for r in ge_rows:
            if r['j'] < 1000:
                latest_ge[r['j']] = r                             # keep the latest name per j
        if not has_acs:
            # UTs without a legislature (+ Ladakh): whole districts, weighted by population
            geo_pc = {'LADAKH': ('JAMMU & KASHMIR', 4)}.get(U(state))
            for j, r in latest_ge.items():
                if geo_pc:
                    key = geo_pc
                elif U(state) == 'DADRA & NAGAR HAVELI & DAMAN & DIU':
                    key = ('DAMAN & DIU', 1) if 'DAMAN' in U(r['c']) else ('DADRA & NAGAR HAVELI', 1)
                else:
                    key = next((k for k in pc_ov if k[1] == r['n'] and k[0].startswith(U(state)[:9])), None)
                sh = pc_ov.get(key) if key else None
                if not sh:
                    report['missing'].append(f'{state} PC {j} {r["c"]}: no parliament polygon')
                    continue
                doc['GE'][str(j)] = {'c': r['c'], 'w': blend([(prof[c]['p'], [(c, 1.0)]) for c, s in sh if s >= 0.10])}
        elif state == 'Jammu & Kashmir':
            # pre-2022 PCs from the polygons' own PC names (the app's J&K segment rows are numbered 1-90 even before
            # 2022, so they can't be used for the old map)
            groups = defaultdict(list)
            for k, (nm, pcn, _) in d08.items():
                if k[0] == geo_st and k in ac_ov and not 47 <= k[1] <= 50:
                    groups[norm_seat(pcn)].append(k)
            for j, r in latest_ge.items():
                if r['y'] >= 2024:
                    r = next((x for x in ge_rows if x['j'] == j and x['y'] == 2019), r)
                # the polygons spell it ANANTANAG — closest name, not exact
                pk = max(groups, key=lambda x: difflib.SequenceMatcher(None, x, norm_seat(r['c'])).ratio())
                g = groups[pk] if difflib.SequenceMatcher(None, pk, norm_seat(r['c'])).ratio() >= 0.8 else None
                if not g:
                    report['missing'].append(f'{state} PC {j} {r["c"]}: no old-map segments')
                    continue
                doc['GE'][str(j)] = {'c': r['c'], 'w': blend([(ac_weight(k[1]), ac_ov[k]) for k in g])}
        else:
            # from the app's own segment table, in the latest election on the default boundaries
            # Newest year first; an older year only fills a PC the newer one lacks (Surat 2024 was won unopposed,
            # so it has no 2024 segment rows). All years here share the 2008 boundaries.
            ge_years = sorted({r['y'] for r in segments if r['s'] == state and not (state == 'Assam' and r['y'] >= 2024)}, reverse=True)
            for yr in ge_years:
                comp = defaultdict(list)
                for s in segments:
                    if s['s'] != state or s['y'] != yr:
                        continue
                    aj = s['n'] + 119 if state == 'Andhra Pradesh' and yr >= 2019 else s['n']
                    if aj not in j2w:
                        report['seg'].append(f'{state} {yr} PC {s["pc"]} segment {s["n"]} {s["c"]}: no assembly placement')
                        continue
                    if not same(doc['AE'][str(aj)]['c'], s['c']):
                        report['segname'].append(f'{state} {yr} seg {s["n"]}: "{s["c"]}" vs AC "{doc["AE"][str(aj)]["c"]}"')
                    comp[s['pc']].append((ac_weight(aj), j2w[aj]))
                for pcn, parts in comp.items():
                    row = next((r for r in ge_rows if r['y'] == yr and r['n'] == pcn), None)
                    if not row:
                        report['missing'].append(f'{state} {yr} PC {pcn}: not in seats_ge')
                        continue
                    if str(row['j']) not in doc['GE']:
                        doc['GE'][str(row['j'])] = {'c': row['c'], 'w': blend(parts)}

        # ── parliament seats on NEW boundaries (J&K 2024, Assam 2024): from the official AC lists ──
        if state in BREAK:
            new_year = {'Jammu & Kashmir': 2024, 'Assam': 2026}[state]
            comp = defaultdict(list)
            for (st, no), (c, pcno, nm) in lists.items():
                if st == state and pcno:
                    comp[pcno].append((el.get(new_year, {}).get(no) or 1.0, [(c, 1.0)]))
            for r in ge_rows:
                if r['y'] >= 2024 and r['n'] in comp:
                    doc['GEy'][str(r['y'])][str(r['n'])] = {'c': r['c'], 'w': blend(comp[r['n']])}

        files[state] = doc

    # ── which app state each district belongs to (for the state comparison) ──
    weight_by = defaultdict(lambda: defaultdict(float))
    for state, doc in files.items():
        for sec in ('AE', 'GE'):
            for rec in doc[sec].values():
                for c, w in rec['w']:
                    weight_by[int(c)][state] += w * (1 if sec == 'AE' else 0.01)
        for sec in ('AEy',):
            for yr in doc[sec].values():
                for rec in yr.values():
                    for c, w in rec['w']:
                        weight_by[int(c)][state] += w
    owner = {c: max(by, key=by.get) for c, by in weight_by.items()}
    unowned = sorted(set(prof) - set(owner))

    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, '*.json')):
        os.remove(f)
    total_pop, size = 0, 0
    for state, doc in files.items():
        used = set()
        for sec in ('AE', 'GE'):
            for rec in doc[sec].values():
                used |= {int(c) for c, _ in rec['w']}
        for sec in ('AEy', 'GEy'):
            for yr in doc[sec].values():
                for rec in yr.values():
                    used |= {int(c) for c, _ in rec['w']}
        if not used:
            continue
        st_acc, st_hlo = {}, {}
        for c in [c for c, s in owner.items() if s == state]:
            add(st_acc, prof[c])
            add(st_hlo, hlo[c])
            st_hlo['_hh'] = st_hlo.get('_hh', 0) + hlo[c]['_hh']
        st_acc['n'] = state
        total_pop += st_acc.get('p', 0)
        payload = {
            'd': {str(c): public(prof[c], hlo[c]) for c in sorted(used)},
            'st': public(st_acc, st_hlo),
            'AE': doc['AE'], 'GE': doc['GE'],
            'src': 'Census of India 2011 (ORGI): PCA, C-01, HLO district tables. District level.',
        }
        if doc['AEy']:
            payload['AEy'] = doc['AEy']
        if doc['GEy']:
            payload['GEy'] = doc['GEy']
        path = os.path.join(OUT, slug(state) + '.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, separators=(',', ':'), ensure_ascii=False)
        size += os.path.getsize(path)

    # ── report (full detail kept in census2011/census_build_report.json for audit) ──
    with open(os.path.join(SRC, 'census_build_report.json'), 'w', encoding='utf-8') as fh:
        json.dump({'cross_district_allowed': [[st, no, cs] for st, no, cs in extras],
                   'cross_state_removed': [[list(k), nm, gone] for k, nm, gone in crossed],
                   'vetoed': [[list(k), nm, gone] for k, nm, gone in vetoed],
                   'moved': [[list(k), nm, was, now] for k, nm, was, now in overridden],
                   'official_list_problems': off_problems, **report}, fh, indent=1, ensure_ascii=False)
    print(f'official delimitation check: {checked:,} ACs checked · {len(extras)} allowed a second district by the order '
          f'itself · {len(vetoed)} had an impossible slice removed · {len(overridden)} moved wholly to their delimited district')
    for k, nm, gone in vetoed[:40]:
        print(f'   trimmed  {k[0]} {k[1]} {nm}: dropped {gone}')
    for k, nm, was, now in overridden[:40]:
        print(f'   MOVED    {k[0]} {k[1]} {nm}: {was} -> {now}')
    print(f'cross-state slivers removed: {len(crossed)}')
    for k, nm, gone in crossed:
        print(f'   {k[0]} {k[1]} {nm}: dropped {gone}')
    print(f'official-list problems: {len(off_problems)} (expected 71: the 70 Delhi seats have no district headings in the 2008 schedule, and Sikkim 32 Sangha is non-territorial)')
    for cat, items in report.items():
        print(f'{cat}: {len(items)}')
        for i in items[:12]:
            print('   ' + i)
    print(f'districts owned by a state: {len(owner)} / 640 · unowned: {[prof[c]["n"] for c in unowned]}')
    print(f'state totals sum to {total_pop:,} (India 1,210,854,977)')
    ae_n = sum(len(d['AE']) + sum(len(v) for v in d['AEy'].values()) for d in files.values())
    ge_n = sum(len(d['GE']) + sum(len(v) for v in d['GEy'].values()) for d in files.values())
    print(f'wrote {len(files)} states · {ae_n:,} assembly + {ge_n:,} parliament placements · {size/1024:.0f} KB -> public/data/census/')


if __name__ == '__main__':
    main()
