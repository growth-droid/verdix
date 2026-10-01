"""Rebuild city/towns_to_ac.csv from towns_to_ac_decisions.D (one row per census unit x AC).
Run: python tools/sources/census2011/ac_level/city/build_towns_to_ac.py  (from product/app)"""
import os, sys
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from towns_to_ac_decisions import D

ACL = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
OUT = ACL + 'city/towns_to_ac.csv'

u = pd.read_parquet(ACL + 'pca_units.parquet', columns=['State', 'District', 'Subdistt', 'Town/Village', 'Ward', 'Level', 'Name', 'TOT_P'])
w = u[(u.Level == 'WARD') & u['Town/Village'].isin(D)]
og_mask = w.Name.str.contains('Rural MDDS', na=False)
og_codes = set(w[og_mask]['Town/Village'])
w = w[~og_mask]

rows = []
for code, (state, pl, basis) in D.items():
    g = w[w['Town/Village'] == code]
    assert len(g), code
    one_sd = g[['State', 'District', 'Subdistt']].drop_duplicates().shape[0] == 1
    if isinstance(pl, (int, list)) and one_sd and code not in og_codes:
        r = g.iloc[0]
        for ac, wt in ([(pl, 1.0)] if isinstance(pl, int) else pl):
            rows.append(dict(census_state=r.State, census_district=r.District, census_subdistt=r.Subdistt, census_town=code,
                             census_ward='', app_state=state, eci_ac_no=ac, weight=wt, basis=basis + ' [whole town]', _p=g.TOT_P.sum() * wt))
        continue
    assert not isinstance(pl, list), code
    for r in g.itertuples():
        wn = int(r.Ward)
        if isinstance(pl, int):
            parts = [(pl, 1.0)]
            b = basis + (' [ward rows: town spans 2 subdistricts]' if not one_sd else ' [ward rows: code also carries OG wards]')
        else:
            v = pl[wn]
            parts = v if isinstance(v, list) else [(v, 1.0)]
            b = basis
        for ac, wt in parts:
            rows.append(dict(census_state=r.State, census_district=r.District, census_subdistt=r.Subdistt, census_town=code,
                             census_ward=r.Ward, app_state=state, eci_ac_no=ac, weight=wt, basis=b, _p=r.TOT_P * wt))
out = pd.DataFrame(rows)
# weights per unit sum to 1
chk = out.groupby(['census_state', 'census_district', 'census_subdistt', 'census_town', 'census_ward']).weight.sum()
assert (abs(chk - 1) < 1e-9).all()
out.drop(columns=['_p']).to_csv(OUT, index=False)
print('rows', len(out), 'towns', out.census_town.nunique(), 'population placed', round(out._p.sum()))
