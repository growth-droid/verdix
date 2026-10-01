"""Run the LGD -> ECI crosswalk for every state, validate, and write the outputs."""
import json, os, re, shutil
from collections import Counter
import pandas as pd
from build_crosswalk import (load_lgd, load_app, build_frames, match_state, LGD2APP, sim, flat, pkey, res_tag,
                             OUT, OPT2, APP)

os.makedirs(OUT, exist_ok=True)
pd.set_option('display.width', 250)

# ------------------------------------------------------------------ manual pairings (lgd_ac_code -> app_j)
# Each is an LGD AC that carries a NEWER map's name on an OLD-map slot, so no name/ECI rule can pair it.
MANUAL = {
    # Assam: LGD is the old (1976-order, 126-seat) map; six ACs were relabelled with 2023-delimitation names.
    '1800': (42, 'Assam: LGD "Bajali" (2023 name) sits on the old Patacharkuchi slot - coverage = Patacharkuchi '
                 'town + part of Tihu; old Patacharkuchi is otherwise absent from LGD; LGD ECI code 26 is Bajali\'s '
                 '2023 number, not an old one'),
    '1726': (34, 'Assam: LGD "Srijangram" (2023 name) carries LGD ECI code 34 = old Abhayapuri North; coverage '
                 'includes Abhayapuri town'),
    '1727': (35, 'Assam: LGD "Abhayapuri" is the remaining Abhayapuri slot = old Abhayapuri South (SC) once '
                 'Srijangram takes 34; old Abhayapuri North/South are otherwise absent'),
    '1794': (41, 'Assam: LGD "Bhowanipur Sorbhog" (2023 name) = old Bhabanipur slot (absent otherwise)'),
    '1744': (21, 'Assam: LGD "Birsing Jarua" (2023 name) covers South Salmara-Mankachar district; old Mankachar '
                 'slot is otherwise absent'),
    '1773': (107, 'Assam: LGD "Demow" (2023 name) = old Thowra slot (Sivasagar dist.; absent otherwise); LGD ECI '
                  'code 95 is Demow\'s 2023 number'),
    # J&K: LGD is the old (1995, 87-seat incl. Ladakh) map; three Jammu-city ACs relabelled with 2022 names.
    '36': (71, 'J&K: LGD "Bahu" (2022 name) carries LGD ECI code 71 = old Gandhi Nagar; coverage = Jammu South '
               'tehsil + part of Jammu MC'),
    '45': (78, 'J&K: LGD "Jammu North" (2022 name) carries LGD ECI code 78 = old Raipur Domana; coverage = Jammu '
               'North tehsil'),
}
# matched ACs whose LGD label comes from a NEWER delimitation than the slot they sit on
NEWER_NAME = {'1800', '1726', '1727', '1794', '1744', '1773', '36', '45', '47'}

m, allpc, pceci, stname = load_lgd()
d, seg = load_app()
frames = build_frames(d, seg)

rows, unl_all, conf_all, fstats = [], [], [], []
for lst, lg in m.groupby('lgd_state_name'):
    s = LGD2APP.get(lst, lst)
    if s not in frames:
        for r in lg.itertuples(index=False):
            x = r._asdict(); x.update(method='no_assembly', delimitation='n/a', frame='n/a',
                                      note='LGD placeholder AC for a UT without a legislative assembly')
            rows.append(x)
        fstats.append(dict(state=lst, frame='n/a', score=0))
        continue
    res = []
    for f in frames[s]:
        rr, unl, conf = match_state(lg, f, MANUAL)
        c = Counter(r['method'] for r in rr)
        res.append((c['eci_code'] + c['exact_name'], f, rr, unl, conf, c))
    res.sort(key=lambda t: -t[0])
    for sc, f, rr, unl, conf, c in res:
        fstats.append(dict(state=lst, frame=f['id'], score=sc, n_app=len(f['seats']), **c))
    sc, f, rr, unl, conf, c = res[0]
    for r in rr:
        r['frame'] = f['id']
        r['delimitation'] = 'unknown' if r['lgd_ac_code'] in NEWER_NAME else f['id']
    rows += rr
    unl_all.append(unl.assign(lgd_state=lst, frame=f['id']))
    conf_all += [dict(state=lst, lgd_ac_code=a, lgd_eci_ac_code=b, eci_points_to_app_j=cc, eci_points_to_app_name=dd,
                      similarity=ee) for a, b, cc, dd, ee in conf]

R = pd.DataFrame(rows)
R['state'] = R.lgd_state_name.map(lambda x: LGD2APP.get(x, x))
R.loc[R.app_state.notna(), 'state'] = R.app_state  # app spelling
R['lgd_res_tag'] = R.lgd_ac_name.map(res_tag)
R.loc[R.lgd_ac_code == '1809', 'lgd_res_tag'] = 'ST'  # "Majuli ST"
for col in ['eci_ac_no', 'app_j', 'app_year_matched', 'app_pc_no']:
    R[col] = pd.to_numeric(R[col]).astype('Int64')
R['lgd_eci_ac_code'] = R.lgd_eci_ac_code.where(R.lgd_eci_ac_code != '0')


def eci_agree(r):
    if pd.isna(r.lgd_eci_ac_code) or pd.isna(r.app_j):
        return ''
    e = int(r.lgd_eci_ac_code)
    if e == r.eci_ac_no:
        return 'yes'
    if e == r.app_j:
        return 'yes (undivided-AP number)' if r.state == 'Andhra Pradesh' else 'yes (j)'
    return 'no'


R['lgd_eci_code_agrees'] = R.apply(eci_agree, axis=1)

# ------------------------------------------------------------------ PC crosswalk (AC majority, then name)
ge = pd.DataFrame(json.load(open(APP + 'public/data/seats_ge.json', encoding='utf-8')))
# Assam/J&K: LGD keeps the OLD AC units but has re-grouped some of them under the NEWER map's PCs
# (see hybrid_pc_grouping_assam_jk.csv), so their LGD PCs follow neither map exactly -> 'unknown'.
PC_FRAME = {'Assam': ('unknown', 2019), 'Jammu & Kashmir': ('unknown', 2019)}
PC_ALIAS = {'GAUHATI': 'GUWAHATI', 'AUTONOMOUSDISTRICT': 'DIPHU', 'MANGALDOI': 'DARRANGUDALGURI',
            'ANANTNAG': 'ANANTNAGRAJOURI'}
DEF_PC = {'Arunachal Pradesh', 'Manipur', 'Nagaland', 'Jharkhand'}
pcrows = []
for p in allpc.itertuples(index=False):
    lst = stname.get(p.st)
    s = LGD2APP.get(lst, lst)
    lab, yr = PC_FRAME.get(s, ('1976-deferred' if s in DEF_PC else '2008', 2024))
    g = ge[(ge.s == s) & (ge.y == yr)]
    acs = R[(R.lgd_pc_code == p.pc) & R.app_pc_no.notna()]
    rec = dict(state=s, lgd_state_code=p.st, lgd_pc_code=p.pc, lgd_pc_name=p.pcn, n_lgd_acs=int((R.lgd_pc_code == p.pc).sum()))
    e = pceci[pceci.pc == p.pc].pceci
    rec['lgd_eci_pc_code'] = e.iloc[0] if len(e) and e.iloc[0] != '0' else None
    best = None
    if len(acs):
        vc = acs.app_pc_no.value_counts()
        pcno = int(vc.index[0]); share = vc.iloc[0] / len(acs)
        # app PC numbering for the frame year
        hit = g[g.n == pcno]
        # the AC's PC number comes from the latest GE year in the AC frame; for AP that is 2024 numbering
        if len(hit):
            best = (pcno, hit.iloc[0].c, 'ac_majority', round(share, 3))
    if best is None and len(g):
        sc = sorted(((sim(p.pcn, c), int(n), c) for n, c in zip(g.n, g.c)), reverse=True)
        if sc and sc[0][0] >= 0.6:
            best = (sc[0][1], sc[0][2], 'exact_name' if flat(p.pcn) == flat(sc[0][2]) else 'fuzzy', None)
    if s == 'Ladakh':
        g = ge[(ge.s == 'Ladakh') & (ge.y == 2024)]
        best = (1, g.iloc[0].c, 'exact_name', None); lab, yr = '2008', 2024
    if s in PC_FRAME:
        g24 = ge[(ge.s == s) & (ge.y == 2024)]
        key = PC_ALIAS.get(flat(p.pcn), flat(p.pcn))
        hit = [(int(n), c) for n, c in zip(g24.n, g24.c) if re.sub('[^A-Z]', '', c.upper()) == key]
        if hit:
            rec['eci_pc_no_2024_by_name'] = hit[0][0]; rec['app_pc_name_2024'] = hit[0][1]
        rec['note'] = ('LGD keeps old-map AC units but groups some under the newer map PCs; eci_pc_no = majority '
                       'of member ACs on the old map (GE 2009-2019 numbering); eci_pc_no_2024_by_name = same-named '
                       'PC on the ' + ('2023-Assam' if s == 'Assam' else '2022-JK') + ' map (membership differs)')
    if best:
        rec.update(eci_pc_no=best[0], app_pc_name=best[1], app_year_matched=yr, method=best[2], ac_share=best[3],
                   similarity=sim(p.pcn, best[1]), delimitation=lab)
    else:
        rec.update(method='unmatched', delimitation=lab)
    pcrows.append(rec)
P = pd.DataFrame(pcrows)
P['lgd_eci_pc_code_agrees'] = P.apply(lambda r: '' if pd.isna(r.lgd_eci_pc_code) or pd.isna(r.get('eci_pc_no'))
                                      else ('yes' if int(r.lgd_eci_pc_code) == int(r.eci_pc_no) else 'no'), axis=1)

# AC-level PC consistency: LGD PC (-> ECI PC) vs the app seat's PC
pcmap = P.set_index('lgd_pc_code').eci_pc_no.to_dict()
R['lgd_pc_as_eci'] = R.lgd_pc_code.map(pcmap)
R['pc_check'] = R.apply(lambda r: '' if pd.isna(r.app_pc_no) or pd.isna(r.lgd_pc_as_eci) else
                        ('agrees' if int(r.app_pc_no) == int(r.lgd_pc_as_eci) else 'differs'), axis=1)

# ------------------------------------------------------------------ reservation checks
# (1) statutory SC/ST totals vs the app's r field, per state frame. Source: Delimitation Order 2008 Schedule II
#     (parsed from the ECI gazette text); J&K/Assam from the 1995 J&K order, the 2022 J&K and 2023 Assam orders;
#     UP updated for the 2017 ST re-reservation of Obra and Duddhi (Sonbhadra).
sch = pd.read_csv(OPT2 + 'crosswalk/schedule2_assembly_seats.csv')
sch.loc[sch.state.str.contains('Tamil Nadu'), 'state'] = 'Tamil Nadu'
sch['state'] = sch.state.replace({'Orissa': 'Odisha'})
SCH = {r.state: (int(r.sc2008), int(r.st2008)) for r in sch.itertuples() if not r.state.startswith('Jammu')}
SCH['Uttar Pradesh'] = (84, 2)  # 2017 amendment: Duddhi SC->ST, Obra GEN->ST
SCH['Sikkim'] = (2, 0)          # + 12 Bhutia-Lepcha (BL) + 1 Sangha
STAT = {('Assam', '1976-deferred'): (8, 16, 'Delimitation Order 1976 (Schedule II, 1976 columns)'),
        ('Assam', '2023-Assam'): (9, 19, 'ECI Assam delimitation order 2023'),
        ('Jammu & Kashmir', '1995-JK'): (7, 0, 'J&K Delimitation Order 1995 (no ST seats)'),
        ('Jammu & Kashmir', '2022-JK'): (7, 9, 'J&K Delimitation Commission final order 2022')}
tot_rows = []
for s_, fl in frames.items():
    for f in fl:
        st_ = f['seats']
        if s_ == 'Andhra Pradesh':  # Schedule II is for undivided AP: compare AP+Telangana together
            st_ = pd.concat([st_, frames['Telangana'][0]['seats']])
        if s_ == 'Telangana':
            continue
        have = st_.app_r.value_counts().to_dict()
        if (s_, f['id']) in STAT:
            sc_, stt_, src = STAT[(s_, f['id'])]
        elif s_ in SCH:
            sc_, stt_ = SCH[s_]
            src = 'Delimitation Order 2008 Schedule II' + (' + 2017 UP amendment' if s_ == 'Uttar Pradesh' else '')
        else:
            continue
        tot_rows.append(dict(state=s_ + (' + Telangana' if s_ == 'Andhra Pradesh' else ''), frame=f['id'],
                             seats=len(st_), statutory_SC=sc_, statutory_ST=stt_, app_SC=have.get('SC', 0),
                             app_ST=have.get('ST', 0), app_BL=have.get('BL', 0),
                             app_r_ok=(have.get('SC', 0) == sc_ and have.get('ST', 0) == stt_), source=src))
TOT = pd.DataFrame(tot_rows)
BAD_FRAMES = {(r.state.replace(' + Telangana', ''), r.frame) for r in TOT[~TOT.app_r_ok].itertuples()}
if ('Andhra Pradesh', '2008') in BAD_FRAMES:  # the AP+TG gap is the single Husnabad seat (seat-level flag below)
    BAD_FRAMES.discard(('Andhra Pradesh', '2008'))
if ('Madhya Pradesh', '2008') in BAD_FRAMES:  # the MP gap is the single Dindori seat (seat-level flag below)
    BAD_FRAMES.discard(('Madhya Pradesh', '2008'))

# (2) seat-level: Delimitation Order 2008 (parsed, 15 states) vs app r; verdicts set after reading the order text
VERDICT = {('Telangana', 32): 'app_r_wrong: order lists "32-Husnabad" unreserved; app marks SC (TG app SC=20 vs 19)',
           ('Madhya Pradesh', 104): 'app_r_wrong: order "104-Dindori (ST)"; app marks SC (MP app SC 36/ST 46 vs 35/47)',
           ('Uttar Pradesh', 402): 'app_right: Obra became ST by the 2017 amendment (order 2008 had it unreserved)',
           ('Uttar Pradesh', 403): 'app_right: Duddhi became ST by the 2017 amendment (order 2008 had it SC)'}
APP_R_WRONG = {('Telangana', 32), ('Madhya Pradesh', 104)}
order_states = {'Andhra Pradesh': 'Andhra_Pradesh', 'Bihar': 'Bihar', 'Chhattisgarh': 'Chhattisgarh',
                'Gujarat': 'Gujarat', 'Haryana': 'Haryana', 'Karnataka': 'Karnataka', 'Kerala': 'Kerala',
                'Madhya Pradesh': 'Madhya_Pradesh', 'Maharashtra': 'Maharashtra', 'Odisha': 'Odisha',
                'Punjab': 'Punjab', 'Rajasthan': 'Rajasthan', 'Tamil Nadu': 'Tamil_Nadu',
                'Uttar Pradesh': 'Uttar_Pradesh', 'West Bengal': 'West_Bengal'}
order_cmp = []
for s_, fn in order_states.items():
    o = pd.read_csv(OPT2 + f'order_parse/order_ac_extents_{fn}.csv')
    for q in o.itertuples(index=False):
        sts = [s_] + (['Telangana'] if s_ == 'Andhra Pradesh' else [])
        x = d[(d.s.isin(sts)) & (d.j == int(q.n))].sort_values('y')
        if not len(x):
            continue
        st2 = x.iloc[-1].s
        order_cmp.append(dict(state=st2, order_no=int(q.n), order_name=q.name, order_res=res_tag(q.name) or 'GEN',
                              app_n=int(x.iloc[-1].n), app_name=x.iloc[-1].c, app_r=x.iloc[-1].r,
                              name_similarity=sim(q.name, x.iloc[-1].c)))
OC = pd.DataFrame(order_cmp)
OC['res_agrees'] = OC.order_res == OC.app_r
chk = []
for r in OC[~OC.res_agrees].itertuples(index=False):
    v = VERDICT.get((r.state, r.app_n)) or \
        'order_parse_artifact: two AC names merged in the parsed order row; the tag belongs to the other AC'
    chk.append(dict(check='delimitation_order_2008', state=r.state, eci_ac_no=r.app_n, app_name=r.app_name,
                    reference_name=r.order_name, reference_r=r.order_res, app_r=r.app_r, agrees=False, verdict=v))
# (3) LGD-name tags ((st)/(sc)) vs app r
for r in R[R.lgd_res_tag.notna() & R.app_r.notna()].itertuples(index=False):
    ok = r.lgd_res_tag == r.app_r
    if ok:
        v = 'agree' + ('' if (r.state, r.frame) not in BAD_FRAMES else ' (but app r unreliable for this map)')
    elif r.state == 'Manipur':
        v = ('lgd_tag_wrong: Manipur has 19 ST seats (Schedule II) and the app has exactly 19; '
             'Kangpokpi is the unreserved hill seat')
    else:
        v = 'disagree'
    chk.append(dict(check='lgd_name_tag', state=r.state, eci_ac_no=r.eci_ac_no, app_name=r.app_name,
                    reference_name=r.lgd_ac_name, reference_r=r.lgd_res_tag, app_r=r.app_r, agrees=ok, verdict=v))
CHK = pd.DataFrame(chk)


def r_reliable(r):
    if pd.isna(r.app_r):
        return ''
    if (r.state, r.frame) in BAD_FRAMES:
        return 'no: app r totals for this map do not match the statutory SC/ST counts'
    if (r.state, r.eci_ac_no) in APP_R_WRONG:
        return 'no: contradicted by the Delimitation Order 2008'
    return 'yes'


R['app_r_reliable'] = R.apply(r_reliable, axis=1)

# ------------------------------------------------------------------ state summary
U = pd.concat(unl_all) if unl_all else pd.DataFrame()
FS = pd.DataFrame(fstats)
APP_LATEST = {'Assam': '2023-Assam', 'Jammu & Kashmir': '2022-JK'}
summ = []
for lst, g in R.groupby('lgd_state_name'):
    s = LGD2APP.get(lst, lst)
    fid = g.frame.iloc[0]
    matched = g[g.eci_ac_no.notna()]
    n_app = int(FS[(FS.state == lst) & (FS.frame == fid)].n_app.iloc[0]) if fid != 'n/a' else 0
    dup = matched.groupby(['state', 'eci_ac_no']).size()
    dup = int((dup > 1).sum())
    uu = U[U.lgd_state == lst] if len(U) else U
    other = FS[(FS.state == lst) & (FS.frame != fid)]
    latest = APP_LATEST.get(s, fid)
    summ.append(dict(
        state=s, lgd_acs=len(g), matched=len(matched), app_seats_in_frame=n_app,
        unmatched_lgd=int((g.method == 'unmatched').sum()),
        unmatched_app=len(uu), unmatched_app_seats='; '.join(f"{r.app_state} {r.eci_ac_no} {r.app_name}" for r in uu.itertuples()),
        delimitation=fid, app_latest_map=latest, lgd_is_app_latest_map=('' if fid == 'n/a' else fid == latest),
        eci_code=int((g.method == 'eci_code').sum()), exact_name=int((g.method == 'exact_name').sum()),
        fuzzy=int((g.method == 'fuzzy').sum()), manual=int((g.method == 'manual').sum()),
        lgd_eci_codes=int(g.lgd_eci_ac_code.notna().sum()),
        lgd_eci_codes_wrong=int((g.lgd_eci_code_agrees == 'no').sum()),
        duplicate_eci_no=dup, pc_check_differs=int((g.pc_check == 'differs').sum()),
        alt_frame=('; '.join(f"{r.frame}: {int(r.eci_code)} eci + {int(r.exact_name)} exact of {int(r.n_app)}"
                             for r in other.itertuples()) if len(other) else '')))
SUM = pd.DataFrame(summ).sort_values('state')

# ------------------------------------------------------------------ write
cols = ['state', 'lgd_ac_code', 'lgd_ac_name', 'lgd_pc_code', 'lgd_pc_name', 'eci_ac_no', 'app_j', 'app_name',
        'app_year_matched', 'method', 'similarity', 'delimitation',
        # extras
        'lgd_state_code', 'app_years', 'app_r', 'lgd_res_tag', 'lgd_eci_ac_code', 'lgd_eci_code_agrees',
        'app_r_reliable', 'app_pc_no', 'app_pc_name', 'lgd_pc_as_eci', 'pc_check', 'note', 'lgd_sources']
R = R.sort_values(['state', 'eci_ac_no', 'lgd_ac_code'])
R[cols].to_csv(OUT + 'lgd_ac_to_eci.csv', index=False, encoding='utf-8')
pcols = ['state', 'lgd_pc_code', 'lgd_pc_name', 'eci_pc_no', 'app_pc_name', 'app_year_matched', 'method',
         'ac_share', 'similarity', 'delimitation', 'n_lgd_acs', 'lgd_eci_pc_code', 'lgd_eci_pc_code_agrees',
         'eci_pc_no_2024_by_name', 'app_pc_name_2024', 'note', 'lgd_state_code']
for c_ in ['eci_pc_no_2024_by_name', 'app_pc_name_2024', 'note']:
    if c_ not in P: P[c_] = None
P['eci_pc_no_2024_by_name'] = pd.to_numeric(P.eci_pc_no_2024_by_name).astype('Int64')
P['eci_pc_no'] = pd.to_numeric(P.eci_pc_no).astype('Int64')
P.sort_values(['state', 'eci_pc_no'])[pcols].to_csv(OUT + 'lgd_pc_to_eci.csv', index=False, encoding='utf-8')
rev = R[~R.method.isin(['exact_name', 'no_assembly']) &
        ~((R.method == 'eci_code') & (R.note.fillna('') == ''))]
rev = pd.concat([rev, R[(R.pc_check == 'differs') & ~R.index.isin(rev.index)]])
rev[['state', 'lgd_ac_code', 'lgd_ac_name', 'lgd_pc_name', 'lgd_eci_ac_code', 'method', 'similarity', 'eci_ac_no',
     'app_name', 'app_pc_name', 'pc_check', 'delimitation', 'note']].to_csv(OUT + 'review_non_exact.csv', index=False)
if len(U):
    U[['lgd_state', 'frame', 'app_state', 'eci_ac_no', 'app_j', 'app_name', 'app_r', 'app_years']].to_csv(
        OUT + 'unmatched_app_seats.csv', index=False)
pd.DataFrame(conf_all).to_csv(OUT + 'lgd_eci_code_conflicts.csv', index=False)
SUM.to_csv(OUT + 'state_summary.csv', index=False)
CHK.to_csv(OUT + 'reservation_check.csv', index=False)
TOT.to_csv(OUT + 'reservation_totals_vs_statute.csv', index=False)
OC.to_csv(OPT2 + 'crosswalk/order2008_vs_app.csv', index=False)  # internal (scratchpad only)
FS.to_csv(OPT2 + 'crosswalk/frame_scores.csv', index=False)

print(SUM.drop(columns=['unmatched_app_seats']).to_string())
print(R.method.value_counts())
print(P.method.value_counts(), len(P))
print('order2008 compare rows', len(OC), 'res disagree', int((~OC.res_agrees).sum()), 'name sim<0.75', int((OC.name_similarity < 0.75).sum()))
print(TOT.to_string())
print(CHK[['check', 'state', 'eci_ac_no', 'app_name', 'reference_r', 'app_r', 'verdict']].to_string())
