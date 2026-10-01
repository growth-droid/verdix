"""Build tidy district-level Census 2011 religion tables from the official C-01 files.

Input  (unmodified downloads, see sources_manifest.csv):
  raw_nada/DDW{SS}C-01 MDDS.XLS      - ORGI Census Digital Library (NADA), primary source
  raw_datagov/DDW{SS}C_01_MDDS-2011.xls - same table as linked from data.gov.in (GODL-India), cross-check
Output:
  religion_district_2011.csv       - persons, 640 districts x Total/Rural/Urban (spec'd tidy file)
  religion_district_2011_full.csv  - persons/males/females for every category
  religion_state_2011.csv          - India + 35 state/UT rows (persons/males/females)
  validation_report.json           - every check, expected vs got

Run: python build_religion_district_2011.py   (no network; pandas + xlrd)
"""
import glob
import json
import os
import re

import pandas as pd
import xlrd

HERE = os.path.dirname(os.path.abspath(__file__))

CATS = [
    ("total", "Total"),
    ("hindu", "Hindu"),
    ("muslim", "Muslim"),
    ("christian", "Christian"),
    ("sikh", "Sikh"),
    ("buddhist", "Buddhist"),
    ("jain", "Jain"),
    ("other_religions", "Other religions and persuasions (incl. Unclassified Sect.)"),
    ("religion_not_stated", "Religion not stated"),
]
RELIGIONS = [c for c, _ in CATS[1:]]
# C-01 layout: cols 0-6 = Table, State, Distt, Tehsil, Town, Area Name, TRU; then 9 x (P, M, F)
NUM_COLS = [f"{c}_{s}" for c, _ in CATS for s in ("p", "m", "f")]

REF = {  # reference India totals given in the task (Census 2011)
    "total_p": 1210854977, "total_m": 623270258, "total_f": 587584719,
    "hindu_p": 966257353, "muslim_p": 172245158, "christian_p": 27819588,
    "sikh_p": 20833116, "buddhist_p": 8442972, "jain_p": 4451753,
    "other_religions_p": 7937734, "religion_not_stated_p": 2867303,
    "rural_total_p": 833748852, "urban_total_p": 377106125, "districts": 640,
}


def read_c01(path):
    """Return every data row of a C-01 sheet as a DataFrame (codes kept as zero-padded strings)."""
    sh = xlrd.open_workbook(path, ignore_workbook_corruption=True).sheet_by_index(0)
    assert sh.ncols == 34, (path, sh.ncols)
    # Verify column order semantically. Category names in file order:
    names = ["Total", "Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain",
             "Other religions and persuasions (incl.Unclassified Sect.)", "Religion not stated"]
    sexes = ["Persons", "Males", "Females"]
    if str(sh.cell_value(0, 0)).strip() == "Table Name":
        # data.gov.in layout: one flattened header row, e.g. "Religious communities - Hindu - Males"
        hdr = [str(x).strip() for x in sh.row_values(0)[7:]]
        want = [f"{n} - {s}" for n in names for s in sexes]
        assert all(h.endswith(w) for h, w in zip(hdr, want)) and len(hdr) == 27, (path, hdr)
    else:
        # NADA layout: category names on row 2 (every 3rd col), sexes on row 3, col numbers 1..27 on row 4
        cat_row = [str(x).strip() for x in sh.row_values(2)[7::3]]
        sex_row = [str(x).strip() for x in sh.row_values(3)[7:]]
        # (DDW13 Nagaland labels one header "... Sect.) - 2011", hence startswith)
        assert len(cat_row) == 9 and all(c.startswith(n) for c, n in zip(cat_row, names)), (path, cat_row)
        assert sex_row == sexes * 9, (path, sex_row)
        assert sh.row_values(4)[7:] == [float(i) for i in range(1, 28)], (path, "column numbers")
    out = []
    for i in range(sh.nrows):
        r = sh.row_values(i)
        if not str(r[0]).startswith("C01"):
            continue
        codes = [str(x).strip() for x in r[1:5]]
        for x in codes:
            assert re.fullmatch(r"\d+", x), (path, i, codes)
        vals = []
        for x in r[7:34]:
            if isinstance(x, str):
                x = x.strip()
                x = 0 if x in ("", "-") else float(x)
            assert float(x) == int(x), (path, i, x)
            vals.append(int(x))
        out.append([str(r[0]).strip(), *codes, str(r[5]), str(r[6]).strip(), *vals])
    return pd.DataFrame(out, columns=["table", "state_code", "district_code", "subdistrict_code",
                                      "town_code", "area_name_raw", "tru", *NUM_COLS])


def clean_state(s):
    return re.sub(r"^State\s*-\s*", "", s).strip()


def clean_district(s):
    s = re.sub(r"^District\s*-\s*", "", s.strip())
    return re.sub(r"\s+", " ", s).strip()


def load(folder, pattern):
    frames = []
    for p in sorted(glob.glob(os.path.join(HERE, folder, pattern))):
        df = read_c01(p)
        df["source_file"] = f"{folder}/{os.path.basename(p)}"
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def district_rows(df):
    m = (df.district_code != "000") & (df.subdistrict_code == "00000") & (df.town_code == "000000")
    return df[m].copy()


def state_rows(df):
    m = (df.district_code == "000") & (df.subdistrict_code == "00000") & (df.town_code == "000000")
    return df[m].copy()


def main():
    checks = []

    def check(name, ok, expected=None, got=None):
        checks.append({"check": name, "ok": bool(ok),
                       "expected": None if expected is None else str(expected),
                       "got": None if got is None else str(got)})

    nada_all = load("raw_nada", "DDW[0-3][0-9]C-01 MDDS.XLS")
    india_file = nada_all[nada_all.source_file.str.contains("DDW00C-01")]
    state_files = nada_all[~nada_all.source_file.str.contains("DDW00C-01")]

    # ---- district rows (only the 35 state files carry them) ----
    d = district_rows(state_files)
    st = state_rows(state_files)
    st_names = st.drop_duplicates("state_code").set_index("state_code").area_name_raw.map(clean_state)
    d["state_name"] = d.state_code.map(st_names)
    d["district_name"] = d.area_name_raw.map(clean_district)
    d["tru"] = d.tru.str.title()

    n_d = d.district_code.nunique()
    check("distinct district codes", n_d == REF["districts"], REF["districts"], n_d)
    check("district rows = districts x 3 (Total/Rural/Urban)", len(d) == 3 * n_d, 3 * n_d, len(d))
    check("each district has exactly one Total, Rural, Urban row",
          (d.groupby("district_code").tru.apply(lambda s: sorted(s) == ["Rural", "Total", "Urban"])).all())
    codes = sorted(int(c) for c in d.district_code.unique())
    check("district codes are contiguous 001-640", codes == list(range(1, 641)), "1..640",
          f"{codes[0]}..{codes[-1]} ({len(codes)})")
    check("district code unique to one state",
          d.groupby("district_code").state_code.nunique().max() == 1)
    check("one name per district code", d.groupby("district_code").district_name.nunique().max() == 1)
    n_states = d.state_code.nunique()
    check("states/UTs with districts", n_states == 35, 35, n_states)

    # religions sum to district total, per sex, per TRU
    for s in ("p", "m", "f"):
        diff = d[[f"{r}_{s}" for r in RELIGIONS]].sum(axis=1) - d[f"total_{s}"]
        check(f"per-district religions sum to total ({s.upper()}), all 1,920 rows",
              (diff == 0).all(), 0, f"max abs diff {diff.abs().max()} in {int((diff != 0).sum())} rows")
    # males + females = persons
    for c, _ in CATS:
        diff = d[f"{c}_m"] + d[f"{c}_f"] - d[f"{c}_p"]
        check(f"males+females=persons for {c}", (diff == 0).all(), 0, int(diff.abs().max()))
    # Rural + Urban = Total
    piv = d.set_index(["district_code", "tru"])[NUM_COLS]
    ru = piv.xs("Rural", level="tru") + piv.xs("Urban", level="tru")
    diff = (ru - piv.xs("Total", level="tru")).abs().to_numpy().max()
    check("Rural + Urban = Total for every district and column", diff == 0, 0, int(diff))

    # districts roll up to each state's own row (state file) and to the India file's state rows
    dsum = d.groupby(["state_code", "tru"])[NUM_COLS].sum().sort_index()
    st_own = st.drop_duplicates(["state_code", "tru"]).set_index(["state_code", "tru"])[NUM_COLS]
    st_own.index = st_own.index.set_levels(st_own.index.levels[1].str.title(), level=1)
    st_own = st_own.sort_index()
    diff = (dsum - st_own).abs().to_numpy().max()
    check("sum of districts = state row in each state file (all 35 x 3 x 27 cells)", diff == 0, 0, int(diff))
    ist = state_rows(india_file)
    ist = ist[ist.state_code != "00"].set_index(["state_code", "tru"])[NUM_COLS]
    ist.index = ist.index.set_levels(ist.index.levels[1].str.title(), level=1)
    ist = ist.sort_index()
    diff = (dsum - ist).abs().to_numpy().max()
    check("sum of districts = state row in the India file DDW00C-01", diff == 0, 0, int(diff))

    # India totals vs reference
    tot = d[d.tru == "Total"][NUM_COLS].sum()
    for k in ["total_p", "total_m", "total_f", *[f"{r}_p" for r in RELIGIONS]]:
        check(f"India {k} (sum of 640 districts) = reference", int(tot[k]) == REF[k], REF[k], int(tot[k]))
    for tr, k in (("Rural", "rural_total_p"), ("Urban", "urban_total_p")):
        g = int(d[d.tru == tr].total_p.sum())
        check(f"India {tr.lower()} population = reference", g == REF[k], REF[k], g)
    india_row = india_file[(india_file.state_code == "00") & (india_file.tru == "Total")].iloc[0]
    diff = (tot - india_row[NUM_COLS].astype("int64")).abs().max()
    check("sum of districts = INDIA row of DDW00C-01 (all 27 columns)", diff == 0, 0, int(diff))

    # ---- cross-check against the data.gov.in (GODL) copies ----
    dg_all = load("raw_datagov", "DDW[0-3][0-9]C_01_MDDS-2011.xls")
    key = ["state_code", "district_code", "subdistrict_code", "town_code", "tru"]
    a = nada_all.assign(tru=nada_all.tru.str.title()).set_index(key)[NUM_COLS].sort_index()
    b = dg_all.assign(tru=dg_all.tru.str.title()).set_index(key)[NUM_COLS].sort_index()
    check("data.gov.in copies: same row keys as NADA files (all levels)", a.index.equals(b.index),
          len(a), len(b))
    if a.index.equals(b.index):
        diff = (a - b).abs().to_numpy().max()
        check("data.gov.in copies: identical numbers to NADA files (all levels, all columns)", diff == 0, 0,
              int(diff))
    dd = district_rows(dg_all)
    nm_a = d.drop_duplicates("district_code").set_index("district_code").district_name
    nm_b = dd.drop_duplicates("district_code").set_index("district_code").area_name_raw.map(clean_district)
    mism = [(c, nm_a[c], nm_b.get(c)) for c in nm_a.index if nm_a[c] != nm_b.get(c)]
    check("data.gov.in copies: identical district names", not mism, 0, f"{len(mism)} differ: {mism[:5]}")

    # ---- write outputs ----
    d = d.sort_values(["district_code", "tru"], key=lambda s: s.map({"Total": 0, "Rural": 1, "Urban": 2})
                      if s.name == "tru" else s)
    base = ["state_code", "state_name", "district_code", "district_name", "tru"]
    persons = d[base + [f"{c}_p" for c, _ in CATS]].rename(columns={f"{c}_p": c for c, _ in CATS})
    persons.to_csv(os.path.join(HERE, "religion_district_2011.csv"), index=False, encoding="utf-8")
    d[base + NUM_COLS + ["source_file"]].to_csv(os.path.join(HERE, "religion_district_2011_full.csv"),
                                                 index=False, encoding="utf-8")
    s_all = state_rows(india_file).copy()
    s_all["state_name"] = s_all.area_name_raw.map(clean_state)
    s_all["tru"] = s_all.tru.str.title()
    s_all[["state_code", "state_name", "tru"] + NUM_COLS].to_csv(
        os.path.join(HERE, "religion_state_2011.csv"), index=False, encoding="utf-8")

    report = {
        "rows_written": {"religion_district_2011.csv": len(persons),
                         "religion_district_2011_full.csv": len(d),
                         "religion_state_2011.csv": len(s_all)},
        "all_ok": all(c["ok"] for c in checks),
        "checks": checks,
    }
    with open(os.path.join(HERE, "validation_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    for c in checks:
        print(("OK  " if c["ok"] else "FAIL"), c["check"], "|", c["expected"], "|", c["got"])
    print("ALL OK" if report["all_ok"] else "SOME CHECKS FAILED", report["rows_written"])


if __name__ == "__main__":
    main()
