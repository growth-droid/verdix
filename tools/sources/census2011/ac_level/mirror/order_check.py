"""Check LGD-mirror AC coverage against the ECI Delimitation Order 2008 text.

For each state: re-extract every AC's extent straight from the raw order text (delim/eci_order_text.txt),
anchored on the (number, name) list of the earlier coordinate parse, and compare the two extractions.
Then sample 20 ACs (seeded) among ACs where LGD marks at least one SubDistrict 'Fully Covered' and test
whether each such sub-district is named in that AC's extent (by its LGD name or its Census 2011 name),
and whether it is named whole or only '(Part)'  (check A).
Check B (reverse): sample 20 ACs among those whose Order extent names at least one whole tehsil / CD block and
measure the share of that unit's Census-2011 population LGD assigns to the same AC.
Outputs (working files, written to $MIRROR_WORK, default <scratchpad>/mirror_verify):
  order_check_A.csv, order_check_B.csv, order_check_summary.csv  (3 states x 20 seeded-random ACs; reviewed by hand)
  order_check_*_all.csv  (`python order_check.py all`: every AC in 15 states; automated, not reviewed)
  order_extents_<state>.csv  (per-AC extent text re-extracted from the raw Order text)
validate_mirror.py turns these into rows of validation.csv.
"""
import pandas as pd, numpy as np, re, difflib, os, sys, json
OPT = r'C:/Users/minds/AppData/Local/Temp/claude/C--Users-minds-OneDrive-Desktop-Data-Project/b4ee2c9a-d22a-44f3-9d75-56cb29e4f656/scratchpad/census/option2'
OUT = os.environ.get('MIRROR_WORK', os.path.join(os.path.dirname(OPT), '..', 'mirror_verify'))   # working outputs stay in the scratchpad
os.makedirs(OUT, exist_ok=True)
L = OPT + '/lgd/'
SEED = 2011
N_SAMPLE = 20

# state -> (schedule roman numeral, order_parse file stem, LGD state code)
STATES = {
    'Maharashtra':    ('XVII', 'Maharashtra', '27'),
    'West Bengal':    ('XXX', 'West_Bengal', '19'),
    'Madhya Pradesh': ('XVI', 'Madhya_Pradesh', '23'),
}
if len(sys.argv) > 1 and sys.argv[1] == 'all':
    STATES.update({
        'Gujarat': ('IX', 'Gujarat', '24'), 'Bihar': ('VI', 'Bihar', '10'), 'Rajasthan': ('XXIV', 'Rajasthan', '8'),
        'Uttar Pradesh': ('XXVIII', 'Uttar_Pradesh', '9'), 'Karnataka': ('XIV', 'Karnataka', '29'),
        'Tamil Nadu': ('XXVI', 'Tamil_Nadu', '33'), 'Odisha': ('XXII', 'Odisha', '21'), 'Haryana': ('X', 'Haryana', '6'),
        'Punjab': ('XXIII', 'Punjab', '3'), 'Chhattisgarh': ('VII', 'Chhattisgarh', '22'), 'Jharkhand': ('XIII', 'Jharkhand', '20'),
        'Kerala': ('XV', 'Kerala', '32'),
    })

ROMAN = {'i': '1', 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5', 'vi': '6'}
def toks(s):
    s = str(s).lower().replace('\u2013', ' ').replace('\u2014', ' ')
    s = re.sub(r'([a-z])-(i{1,3}|iv|v|vi)\b', r'\1 \2', s)          # Cooch Behar-II -> cooch behar ii
    s = re.sub(r'(?<![0-9/])(\d{1,2})([a-z]{3,})', r'\1 \2', s)   # 1CDB Dinhata -> 1 cdb dinhata
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return [ROMAN.get(t, t) for t in s.split() if t]
def nrm(s): return ''.join(toks(s))

# ---------- raw order text, per state section ----------
raw = open(OPT + '/delim/eci_order_text.txt', encoding='utf-8', errors='replace').read().split('\n')
sched_idx = [i for i, l in enumerate(raw) if re.search(r'SCHEDULE\s*[-\u2013]?\s*[IVXL]+\s*$', l.strip())]
def section(roman):
    for k, i in enumerate(sched_idx):
        if re.search(r'SCHEDULE\s*[-\u2013]?\s*%s\s*$' % roman, raw[i].strip()):
            end = sched_idx[k + 1] if k + 1 < len(sched_idx) else len(raw)
            lines = raw[i:end]
            for j, l in enumerate(lines):                       # stop at Part/Table B (PCs)
                if j > 5 and re.match(r'\s*(PART|TABLE)\s*[-\u2013]?\s*B\b', l.strip()):
                    return lines[:j]
            return lines
    raise KeyError(roman)

def extract(state, roman, stem):
    """Re-extract each AC's extent from the raw text. Anchors are '<n>. <Name>' / '<n> - <Name>' headers found in
    sequence (at a line start or mid-line), accepted only when the word after the number resembles the AC name."""
    o = pd.read_csv(f'{OPT}/order_parse/order_ac_extents_{stem}.csv')
    o['nm'] = o['name'].astype(str).str.replace(r'\((SC|ST)\)', '', regex=True).str.strip()
    text = '\n'.join(section(roman))
    text = re.sub(r'\d+\s*[\-–]\s*DISTRICT\s*:[^\n]*', ' ', text)        # district headers
    # (stand-alone page numbers are removed only inside extents: UP/TN print the AC number alone on its own line)
    anchors = []; pos = 0
    for n, nm in zip(o['n'], o['nm']):
        nt = toks(nm); found = None
        for m in re.finditer(r'(?<![\d/])0*%d(?:\s*[\.\-–:]+\s*|\s+)' % n, text[pos:]):
            rest = toks(text[pos + m.end(): pos + m.end() + 80])
            if rest and nt and difflib.SequenceMatcher(None, rest[0], nt[0]).ratio() >= 0.7:
                found = (pos + m.start(), pos + m.end()); break
        anchors.append(found)
        if found is not None: pos = found[1]
    ext = []
    for idx, (n, nm, a) in enumerate(zip(o['n'], o['nm'], anchors)):
        if a is None: ext.append(None); continue
        nxt = next((b[0] for b in anchors[idx + 1:] if b is not None), len(text))
        t = toks(re.sub(r'(?m)^\s*\d{1,4}\s*$', ' ', text[a[1]:nxt])); nt = toks(nm); i = 0
        for w in nt:                       # strip ONE copy of the AC's own name (+ SC/ST tag) from the front
            if i < len(t) and (t[i] == w or difflib.SequenceMatcher(None, t[i], w).ratio() >= 0.8): i += 1
        while i < len(t) and t[i] in ('sc', 'st'): i += 1
        ext.append(' '.join(t[i:]))
    o['extent_raw'] = ext
    o['extent_parse_tokens'] = o['extent'].fillna('').map(lambda s: ' '.join(toks(s)))
    def agree(a, b):
        if a is None: return np.nan
        return round(difflib.SequenceMatcher(None, a, b, autojunk=False).ratio(), 3)
    o['raw_vs_parse_similarity'] = [agree(a, b) for a, b in zip(o['extent_raw'], o['extent_parse_tokens'])]
    return o

# ---------- LGD side ----------
rd = lambda f: pd.read_csv(L + f + '.29Sep2026.csv', dtype=str, keep_default_na=False)
cc = rd('constituency_coverage'); cc = cc.drop_duplicates([c for c in cc.columns if c != 'S.No.'])
cc = cc[cc['Assembly Constituency Code'] != '0']
mu = rd('constituencies_mapping_urban'); sd = rd('subdistricts'); vil = rd('villages')
eci = mu[mu['Assembly Constituency Code'] != '0'].drop_duplicates('Assembly Constituency Code').set_index('Assembly Constituency Code')['Assembly Constituency ECI Code'].to_dict()
cen = pd.read_parquet(OPT + '/work/india_village_level.parquet', columns=['Subdistt', 'Town/Village', 'Level', 'Name', 'TRU'])
c11_sd_name = cen[(cen.Level == 'SUB-DISTRICT') & (cen.TRU == 'Total')].set_index('Subdistt')['Name'].to_dict()
cv = cen[cen.Level == 'VILLAGE'][['Subdistt', 'Town/Village']].rename(columns={'Town/Village': 'c11'})
vil['c11'] = np.where(vil['Census 2011 Code'].isin(['', '0']), '', vil['Census 2011 Code'].str.zfill(6))
vsd = vil[vil.c11 != ''].merge(cv, on='c11')
parent11 = vsd.groupby('Sub-District Code')['Subdistt'].agg(lambda s: list(s.value_counts().index[:3])).to_dict()
sd['c11'] = sd['Census 2011 Code'].str.zfill(5)
sd_c11 = dict(zip(sd['Sub-district Code'], sd['c11']))

sd_c01 = dict(zip(sd['Sub-district Code'], sd['Census 2001 Code']))
sd_dist = dict(zip(sd['Sub-district Code'], sd['District Code']))
cen_p = pd.read_parquet(OPT + '/work/india_village_level.parquet', columns=['Town/Village', 'Level', 'TOT_P'])
cen_p = cen_p[cen_p.Level == 'VILLAGE']; pop11 = dict(zip(cen_p['Town/Village'], pd.to_numeric(cen_p.TOT_P)))
vil['pop11'] = vil.c11.map(pop11).fillna(0)
STOP = {'tehsil', 'taluka', 'taluk', 'cdb', 'block', 'subdivision', 'circle', 'adc', 'hq'}
# keyword marking a whole sub-district in each state's Order text, and whether the name comes AFTER it
# ('CDB Habra-II', 'Tehsil Karanpur') or BEFORE it ('Akot Tehsil', 'Bargarh Block').
UNIT = {'Maharashtra': ('tehsil', False), 'Madhya Pradesh': ('tehsil', False), 'West Bengal': ('cdb', True),
        'Gujarat': ('taluka', False), 'Rajasthan': ('tehsil', True), 'Uttar Pradesh': ('tehsil', False),
        'Karnataka': ('taluk', False), 'Tamil Nadu': ('taluk', False), 'Haryana': ('tehsil', False),
        'Punjab': ('tehsil', False), 'Chhattisgarh': ('tehsil', False), 'Odisha': ('block', False),
        'Kerala': None, 'Bihar': None, 'Jharkhand': None}   # Kerala: villages; Bihar 'CD Blocks A, B'; Jharkhand police stations
PART_WORDS = ('part', 'partly', 'excluding', 'except')
ALIAS = {'bardhaman': 'burdwan'}   # Order spelling -> LGD spelling (known variant)


def name_toks(name):
    return [t for t in toks(re.sub(r'\(.*?\)', '', name)) if t not in STOP]


def find(name, et, thr_long=0.85):
    """locate a sub-district name in extent tokens et -> (how, part_flag) or (None, None)"""
    nt = name_toks(name)
    if not nt: return None, None
    k = len(nt); best = (0, -1); ndig = [x for x in nt if x.isdigit()]
    for i in range(0, max(1, len(et) - k + 1)):
        w = et[i:i + k]
        if w == nt: best = (1.0, i); break
        if [x for x in w if x.isdigit()] != ndig: continue        # Binpur-I must never fuzzy-match Binpur-II
        r = difflib.SequenceMatcher(None, ''.join(w), ''.join(nt)).ratio()
        if r > best[0]: best = (r, i)
    if best[0] < (thr_long if len(''.join(nt)) >= 6 else 0.99): return None, None
    i = best[1]; after = et[i + k:i + k + 4]; before = et[max(0, i - 3):i]
    part = any(p in after for p in PART_WORDS) or ('of' in before)
    return ('exact' if best[0] == 1.0 else f'fuzzy{best[0]:.2f}'), part


def whole_units(et, unit_spec):
    """sub-district units the Order names WHOLE: '<name> tehsil' (not followed by Part, not '... of <name> tehsil')
    or 'cdb <name>' / 'tehsil <name>' (not '... GPs of CDB <name>')."""
    unit, after = unit_spec
    out = []
    for i, t in enumerate(et):
        if t != unit: continue
        if after:
            j = i + 1; nm = []
            while j < len(et) and len(nm) < 3 and not et[j].isdigit() and et[j] not in ('and', unit, 'of', 'gps', 'gp', 'm', 'ct', 'part', 'partly', 'ilrc', 'ilrcs', 'patwar', 'excluding', 'except'):
                nm.append(et[j]); j += 1
            # a roman-numeral block suffix (Binpur-II -> 'binpur 2') directly after the name
            if j < len(et) and et[j] in ('1', '2', '3') and (j + 1 >= len(et) or et[j + 1] in ('and', 'cdb', '2', '3', '4', '5', '6', '7')):
                nm.append(et[j]); j += 1
            if 'of' in et[max(0, i - 1):i] or any(p in et[j:j + 2] for p in PART_WORDS): continue
        else:
            j = i - 1; nm = []
            while j >= 0 and len(nm) < 3 and not et[j].isdigit() and et[j] not in ('and', 'of', unit, 'part', 'circle', 'circles', 'm', 'mc'):
                nm.insert(0, et[j]); j -= 1
            if ((j >= 0 and et[j] == 'of') or (j >= 1 and et[j].isdigit() and et[j - 1] == 'of')   # UP: 'of 3-Nakur Tehsil'
                    or any(p in et[i + 1:i + 3] for p in PART_WORDS)): continue
        if nm: out.append(' '.join(nm))
    return list(dict.fromkeys(out))


def lgd_ac_of_villages(c):
    """LGD village -> AC rows for one state: Village rows, Fully Covered SubDistrict rows, Fully Covered District rows"""
    v = c[c['Entity Type'] == 'Village'][['Entity Code', 'Assembly Constituency Code']].rename(columns={'Entity Code': 'Village Code'})
    s = c[(c['Entity Type'] == 'SubDistrict') & (c['Coverage Type'] == 'Fully Covered')][['Entity Code', 'Assembly Constituency Code']].rename(columns={'Entity Code': 'Sub-District Code'})
    d = c[(c['Entity Type'] == 'District') & (c['Coverage Type'] == 'Fully Covered')][['Entity Code', 'Assembly Constituency Code']].rename(columns={'Entity Code': 'District Code'})
    return v, s, d


rowsA = []; rowsB = []; summ = []
ALL = len(sys.argv) > 1 and sys.argv[1] == 'all'
for state, (roman, stem, scode) in STATES.items():
    o = extract(state, roman, stem)
    o.drop(columns=['extent_parse_tokens']).to_csv(f'{OUT}/order_extents_{stem}.csv', index=False)
    c = cc[cc['State Code'] == scode]
    stv = vil[vil['State Code'] == scode]
    vrow, srow, drow = lgd_ac_of_villages(c)
    lgd_ac_names = c.drop_duplicates('Assembly Constituency Code').set_index('Assembly Constituency Code')['Assembly Constituency Name'].to_dict()

    def order_row(ac):
        acn = lgd_ac_names[ac]
        cand = difflib.get_close_matches(nrm(acn), [nrm(x) for x in o.nm], n=1, cutoff=0.75)
        r_name = o[o.nm.map(nrm) == cand[0]].iloc[0] if cand else None
        e = eci.get(ac)
        r_eci = o[o.n == int(e)].iloc[0] if e and e.isdigit() and int(e) in set(o.n) else None
        r = r_eci if r_eci is not None else r_name
        note = ('eci+name agree' if (r_eci is not None and r_name is not None and r_eci.n == r_name.n)
                else 'eci only' if r_eci is not None and r_name is None
                else 'ECI/name DISAGREE' if r_eci is not None else 'name only')
        return r, note

    # ---- A: LGD 'Fully Covered' sub-district -> named in the Order extent? ----
    full = c[(c['Entity Type'] == 'SubDistrict') & (c['Coverage Type'] == 'Fully Covered')]
    acs = sorted(full['Assembly Constituency Code'].unique())
    rng = np.random.default_rng(SEED)
    sampA = acs if ALL else sorted(rng.choice(acs, size=min(N_SAMPLE, len(acs)), replace=False))
    for ac in sampA:
        r, note = order_row(ac)
        if r is None or r.extent_raw is None:
            rowsA.append(dict(check='A', state=state, lgd_ac_code=ac, lgd_ac_name=lgd_ac_names[ac], ac_identity=note, verdict='no order extent')); continue
        et = r.extent_raw.split()
        for _, s in full[full['Assembly Constituency Code'] == ac].iterrows():
            sdc = s['Entity Code']; nm = s['Entity Name']
            alt = []
            if sd_c11.get(sdc, '00000') != '00000': alt.append(c11_sd_name.get(sd_c11[sdc], ''))
            alt += [c11_sd_name.get(x, '') for x in parent11.get(sdc, [])]
            alt = [a.strip() for a in dict.fromkeys(alt) if a and nrm(a) != nrm(nm)]
            how, part = find(nm, et); via = 'lgd name'
            if how is None:
                for a in alt:
                    how, part = find(a, et)
                    if how: via = f'census-2011 name {a}'; break
            if how is None:
                verdict = 'NOT NAMED' + (' (sub-district has no Census 2001 code: created after the 2001 frame the Order uses)' if sd_c01.get(sdc, '0') in ('0', '') else '')
            else:
                verdict = 'named (Part)' if part else 'named whole'
            rowsA.append(dict(check='A', state=state, lgd_ac_code=ac, lgd_ac_name=lgd_ac_names[ac], order_ac_no=int(r.n),
                              order_ac_name=r['name'], ac_identity=note, lgd_subdistrict_code=sdc, lgd_subdistrict=nm,
                              census2001_code=sd_c01.get(sdc, ''), census2011_names='; '.join(alt), match=how or '',
                              matched_via=via if how else '', verdict=verdict, order_extent=r.extent_raw[:700]))

    # ---- B: Order names a sub-district WHOLE -> does LGD put (nearly) all of its 2011 population in that AC? ----
    unit = UNIT.get(state)
    o['whole'] = [whole_units((e or '').split(), unit) if unit else [] for e in o.extent_raw]
    cand_n = o[o.whole.map(len) > 0].n.tolist()
    rngB = np.random.default_rng(SEED + 1)
    sampB = cand_n if ALL else sorted(rngB.choice(cand_n, size=min(N_SAMPLE, len(cand_n)), replace=False))
    lgd_by_n = {}
    for ac in lgd_ac_names:
        r, note = order_row(ac)
        if r is not None: lgd_by_n.setdefault(int(r.n), (ac, note))
    stsd = sd[sd['State Code'] == scode]
    sdname = {}
    for _, x in stsd.iterrows():
        for nm in [x['Sub-district Name']] + ([c11_sd_name.get(x['c11'], '').strip()] if x['c11'] != '00000' else []):
            if nm: sdname.setdefault(' '.join(name_toks(nm)), set()).add(x['Sub-district Code'])
    vv = stv[['Village Code', 'Sub-District Code', 'District Code', 'pop11']]
    a1 = vv.merge(vrow, on='Village Code', how='left')
    a2 = vv.merge(srow, on='Sub-District Code', how='left').rename(columns={'Assembly Constituency Code': 'ac_sd'})
    a3 = vv.merge(drow, on='District Code', how='left').rename(columns={'Assembly Constituency Code': 'ac_d'})
    acv = a1.drop_duplicates('Village Code').set_index('Village Code')['Assembly Constituency Code']
    acv = acv.fillna(a2.drop_duplicates('Village Code').set_index('Village Code')['ac_sd'])
    acv = acv.fillna(a3.drop_duplicates('Village Code').set_index('Village Code')['ac_d'])
    stv2 = stv.set_index('Village Code').assign(lgd_ac=acv)
    for n in sampB:
        r = o[o.n == n].iloc[0]
        lg = lgd_by_n.get(int(n))
        for u in r.whole:
            key = ' '.join(name_toks(u))
            for a_, b_ in ALIAS.items():
                if key not in sdname and a_ in key.split(): key = key.replace(a_, b_)
            codes = sdname.get(key, set())
            if not codes:
                close = difflib.get_close_matches(key, list(sdname), n=1, cutoff=0.85)
                codes = sdname.get(close[0], set()) if close else set()
            if not codes and len(key.split()) > 1 and len(key.split()[0]) >= 6:   # 'Khanapur (Vita)' -> 'Khanapur'
                codes = sdname.get(key.split()[0], set())
            acd = set(stv2.loc[stv2.lgd_ac == lg[0], 'District Code']) if lg is not None else set()
            if len(codes) > 1 and acd:                 # same name in two districts: keep the AC's own district(s)
                keep = {x for x in codes if sd_dist.get(x) in acd}
                if keep: codes = keep
            if codes and acd and not any(sd_dist.get(x) in acd for x in codes):
                rowsB.append(dict(check='B', state=state, order_ac_no=int(n), order_ac_name=r['name'], order_whole_unit=u,
                                  lgd_subdistrict_codes=';'.join(sorted(codes)),
                                  verdict='name resolves only to a sub-district outside the districts of this AC (homonym?) - not scored',
                                  order_extent=(r.extent_raw or '')[:700])); continue
            if not codes:
                rowsB.append(dict(check='B', state=state, order_ac_no=int(n), order_ac_name=r['name'], order_whole_unit=u,
                                  verdict='unit not found in LGD sub-district list', order_extent=(r.extent_raw or '')[:700])); continue
            vs = stv2[stv2['Sub-District Code'].isin(codes)]
            tot = vs.pop11.sum()
            if lg is None:
                rowsB.append(dict(check='B', state=state, order_ac_no=int(n), order_ac_name=r['name'], order_whole_unit=u,
                                  lgd_subdistrict_codes=';'.join(sorted(codes)), verdict='order AC not identified in LGD')); continue
            share = vs.loc[vs.lgd_ac == lg[0], 'pop11'].sum() / tot if tot else np.nan
            top = vs.groupby('lgd_ac').pop11.sum().sort_values(ascending=False)
            other = [f"{lgd_ac_names.get(k, k)}:{v / tot:.0%}" for k, v in top.items() if k != lg[0]][:3] if tot else []
            unm = vs.loc[vs.lgd_ac.isna(), 'pop11'].sum() / tot if tot else np.nan
            verdict = (('OK (>=95% of 2011 pop in this AC)' if share >= 0.95 else
                        'MOSTLY (80-95%)' if share >= 0.8 else 'MISMATCH (<80%)') if tot else 'no 2011 population to weigh')
            rowsB.append(dict(check='B', state=state, order_ac_no=int(n), order_ac_name=r['name'], lgd_ac_code=lg[0],
                              lgd_ac_name=lgd_ac_names[lg[0]], ac_identity=lg[1], order_whole_unit=u,
                              lgd_subdistrict_codes=';'.join(sorted(codes)), pop2011_in_unit=int(tot),
                              share_pop_lgd_same_ac=round(share, 4) if tot else None,
                              share_pop_unassigned=round(unm, 4) if tot else None,
                              lgd_other_acs='; '.join(other), verdict=verdict, order_extent=(r.extent_raw or '')[:700]))
    dA = pd.DataFrame([x for x in rowsA if x['state'] == state], columns=['verdict']+list(rowsA[0].keys() if rowsA else [])).loc[:, lambda d: ~d.columns.duplicated()]; dB = pd.DataFrame([x for x in rowsB if x['state'] == state], columns=['verdict']+list(rowsB[0].keys() if rowsB else [])).loc[:, lambda d: ~d.columns.duplicated()]
    summ.append(dict(state=state, order_acs=len(o), raw_extents_found=int(o.extent_raw.notna().sum()),
                     raw_vs_parse_median_similarity=float(o.raw_vs_parse_similarity.median()),
                     raw_vs_parse_below_0_8=int((o.raw_vs_parse_similarity < 0.8).sum()),
                     A_sampled_acs=len(sampA), A_rows=len(dA),
                     A_named_whole=int((dA.verdict == 'named whole').sum()), A_named_part=int((dA.verdict == 'named (Part)').sum()),
                     A_not_named=int(dA.verdict.str.startswith('NOT NAMED').sum()),
                     A_not_named_post2001=int(dA.verdict.str.contains('after the 2001').sum()),
                     B_sampled_acs=len(sampB), B_rows=len(dB),
                     B_ok=int(dB.verdict.str.startswith('OK').sum()) if len(dB) else 0,
                     B_mostly=int(dB.verdict.str.startswith('MOSTLY').sum()) if len(dB) else 0,
                     B_mismatch=int(dB.verdict.str.startswith('MISMATCH').sum()) if len(dB) else 0,
                     B_unresolved=int((~dB.verdict.str.match(r'(OK|MOSTLY|MISMATCH)')).sum()) if len(dB) else 0))
    print(summ[-1])
tag = '_all' if ALL else ''
pd.DataFrame(rowsA).to_csv(f'{OUT}/order_check_A{tag}.csv', index=False)
pd.DataFrame(rowsB).to_csv(f'{OUT}/order_check_B{tag}.csv', index=False)
pd.DataFrame(summ).to_csv(f'{OUT}/order_check_summary{tag}.csv', index=False)
