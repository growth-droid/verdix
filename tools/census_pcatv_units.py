#!/usr/bin/env python3
"""Consolidate the 640 official Census 2011 PCA town/village/ward district files (PC11_PCA-TV-SSDD, ORGI NADA) into
ONE table of census units — every village and every urban ward — with the PCA fields the seat build needs.

Input : a folder of the district .xlsx files (downloaded with plain public GETs; URLs + checks in its SOURCES_w*.csv)
Output: tools/sources/census2011/ac_level/pca_units.parquet  (gitignored — re-derivable) and a validation summary.

A unit is a VILLAGE row or a WARD row. Town rows are totals of their wards (a census town / outgrowth has a single
'WARD NO.-0001' row), so villages + wards = the district total exactly — checked per district below.

Run from product/app:  python tools/census_pcatv_units.py <folder with PC11_PCA-TV-*.xlsx>
"""
import glob, os, sys
from concurrent.futures import ProcessPoolExecutor
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'sources', 'census2011', 'ac_level', 'pca_units.parquet')
KEYS = ['State', 'District', 'Subdistt', 'Town/Village', 'Ward', 'Level', 'Name', 'TRU']
NUM = ['No_HH', 'TOT_P', 'TOT_M', 'TOT_F', 'P_06', 'M_06', 'F_06', 'P_SC', 'P_ST', 'P_LIT', 'M_LIT', 'F_LIT',
       'TOT_WORK_P', 'MAIN_CL_P', 'MARG_CL_P', 'MAIN_AL_P', 'MARG_AL_P', 'MAIN_HH_P', 'MARG_HH_P', 'MAIN_OT_P', 'MARG_OT_P']
PAD = {'State': 2, 'District': 3, 'Subdistt': 5, 'Town/Village': 6, 'Ward': 4}


def one(path):
    df = pd.read_excel(path, dtype=str, engine='calamine')
    df.columns = [c.strip() for c in df.columns]
    for k, n in PAD.items():
        df[k] = df[k].astype(str).str.strip().str.split('.').str[0].str.zfill(n)
    for c in NUM:
        df[c] = pd.to_numeric(df[c], errors='coerce').fillna(0).astype('int64')
    df['Level'] = df['Level'].str.strip().str.upper()
    df['TRU'] = df['TRU'].str.strip().str.title()
    dist = df[(df.Level == 'DISTRICT') & (df.TRU == 'Total')]
    units = df[df.Level.isin(['VILLAGE', 'WARD'])][KEYS + NUM]
    gap = {c: int(dist[c].iloc[0] - units[c].sum()) for c in ('TOT_P', 'P_SC', 'P_ST', 'P_LIT', 'TOT_WORK_P', 'No_HH')}
    return units, os.path.basename(path), dist['District'].iloc[0], gap


def main():
    files = sorted(glob.glob(os.path.join(sys.argv[1], 'PC11_PCA-TV-*.xlsx')))
    assert len(files) == 640, len(files)
    with ProcessPoolExecutor(max_workers=7) as ex:
        res = list(ex.map(one, files, chunksize=4))
    units = pd.concat([r[0] for r in res], ignore_index=True)
    bad = [(f, d, g) for _, f, d, g in res if any(v != 0 for v in g.values())]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    units.to_parquet(OUT, index=False)
    print(f'{len(files)} district files -> {len(units):,} units ({(units.Level == "VILLAGE").sum():,} villages, '
          f'{(units.Level == "WARD").sum():,} wards) · population {units.TOT_P.sum():,} (India 1,210,854,977)')
    print(f'districts where villages + wards != district total: {len(bad)}')
    for b in bad[:20]:
        print('   ', b)


if __name__ == '__main__':
    main()
