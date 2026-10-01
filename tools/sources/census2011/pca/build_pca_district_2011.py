"""Build pca_district_2011.csv from the official ORGI Census 2011 PCA (Table PCA SD) and validate it.

Source (official, unmodified in this folder):
  DDW_PCA0000_2011_Indiastatedist.xlsx
  https://censusindia.gov.in/nada/index.php/catalog/6191/download/9268/DDW_PCA0000_2011_Indiastatedist.xlsx
  (NADA catalog entry PC11_PCA-SD, https://censusindia.gov.in/nada/index.php/catalog/6191)

Cross-check files (official, unmodified, in ./crosscheck):
  pca_state_distt_st.xls                 NADA PC11_PCA-ST  https://censusindia.gov.in/nada/index.php/catalog/5049/download/8126
  DDW_PCA1401_2011_MDDS with UI.xlsx     NADA PC11_PCA-TV-1401 (Senapati, Manipur) https://censusindia.gov.in/nada/index.php/catalog/6463/download/9540

Run:  python build_pca_district_2011.py   (writes pca_district_2011.csv + pca_district_2011.validation.json next to it)
"""
import json
import os
import re
import sys

import pandas as pd
import xlrd

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "DDW_PCA0000_2011_Indiastatedist.xlsx")
ST_SRC = os.path.join(HERE, "crosscheck", "pca_state_distt_st.xls")
SENAPATI_SRC = os.path.join(HERE, "crosscheck", "DDW_PCA1401_2011_MDDS with UI.xlsx")
OUT = os.path.join(HERE, "pca_district_2011.csv")
VAL = os.path.join(HERE, "pca_district_2011.validation.json")

ID_COLS = ["State", "District", "Subdistt", "Town/Village", "Ward", "EB", "Level", "Name", "TRU"]

# Reference India totals given in the task brief (Census 2011).
REF = {
    "TOT_P": 1210854977, "TOT_M": 623270258, "TOT_F": 587584719,
    "P_SC": 201378372, "P_ST": 104281034, "P_LIT": 763498517,
    "RURAL_TOT_P": 833748852, "URBAN_TOT_P": 377106125,
}

raw = pd.read_excel(SRC, sheet_name="Sheet1", dtype=str)
num_cols = [c for c in raw.columns if c not in ID_COLS]
for c in num_cols:
    raw[c] = pd.to_numeric(raw[c], errors="raise").astype("int64")
raw["Name"] = raw["Name"].str.strip().str.replace(r"\s+", " ", regex=True)

checks = []


def check(name, ok, expected=None, got=None):
    checks.append({"check": name, "ok": bool(ok), "expected": None if expected is None else str(expected),
                   "got": None if got is None else str(got)})


india = raw[raw.Level == "India"].set_index("TRU")
states = raw[raw.Level == "STATE"].copy()
dist = raw[raw.Level == "DISTRICT"].copy()

# ---- structure ---------------------------------------------------------------------------
check("row levels only India/STATE/DISTRICT", set(raw.Level) == {"India", "STATE", "DISTRICT"}, None, sorted(set(raw.Level)))
check("district count (unique codes)", dist.District.nunique() == 640, 640, dist.District.nunique())
check("district rows = 640 x Total/Rural/Urban", len(dist) == 1920 and (dist.groupby("District").TRU.apply(lambda s: sorted(s) == ["Rural", "Total", "Urban"])).all(), 1920, len(dist))
codes = sorted(dist.District.astype(int).unique())
check("district codes contiguous 001..640", codes == list(range(1, 641)), "1..640", f"{codes[0]}..{codes[-1]}")
check("state rows = 35 x 3", len(states) == 105 and states.State.nunique() == 35, 105, len(states))
check("each district code belongs to exactly one state", dist.groupby("District").State.nunique().max() == 1, 1, dist.groupby("District").State.nunique().max())

# ---- arithmetic consistency ---------------------------------------------------------------
def tru_mismatch(df, keys):
    t = df[df.TRU == "Total"].set_index(keys)[num_cols]
    r = df[df.TRU == "Rural"].set_index(keys)[num_cols]
    u = df[df.TRU == "Urban"].set_index(keys)[num_cols]
    return int(((r + u) != t).sum().sum())

check("district Total = Rural + Urban (all 85 fields)", tru_mismatch(dist, ["District"]) == 0, 0, tru_mismatch(dist, ["District"]))
check("state Total = Rural + Urban (all fields)", tru_mismatch(states, ["State"]) == 0, 0, tru_mismatch(states, ["State"]))
check("India Total = Rural + Urban (all fields)", tru_mismatch(raw[raw.Level == "India"], ["State"]) == 0, 0, tru_mismatch(raw[raw.Level == "India"], ["State"]))

dsum = dist.groupby(["State", "TRU"])[num_cols].sum()
srow = states.set_index(["State", "TRU"])[num_cols]
bad = (dsum.sort_index() != srow.sort_index())
check("every state row = sum of its districts (35 states x 3 TRU x 85 fields)", int(bad.sum().sum()) == 0, 0,
      f"{int(bad.sum().sum())} mismatching cells")
isum_d = dist.groupby("TRU")[num_cols].sum().sort_index()
isum_s = states.groupby("TRU")[num_cols].sum().sort_index()
india = india.sort_index()
check("India row = sum of 640 districts (3 TRU x 85 fields)", int((isum_d != india[num_cols]).sum().sum()) == 0, 0,
      f"{int((isum_d != india[num_cols]).sum().sum())} mismatching cells")
check("India row = sum of 35 states", int((isum_s != india[num_cols]).sum().sum()) == 0, 0,
      f"{int((isum_s != india[num_cols]).sum().sum())} mismatching cells")

# identities inside each district row
d = dist
ident = {
    "TOT_P = TOT_M + TOT_F": (d.TOT_P != d.TOT_M + d.TOT_F),
    "P_06 = M_06 + F_06": (d.P_06 != d.M_06 + d.F_06),
    "P_SC = M_SC + F_SC": (d.P_SC != d.M_SC + d.F_SC),
    "P_ST = M_ST + F_ST": (d.P_ST != d.M_ST + d.F_ST),
    "P_LIT + P_ILL = TOT_P": (d.P_LIT + d.P_ILL != d.TOT_P),
    "TOT_WORK_P = MAINWORK_P + MARGWORK_P": (d.TOT_WORK_P != d.MAINWORK_P + d.MARGWORK_P),
    "MAINWORK_P = MAIN_CL+AL+HH+OT": (d.MAINWORK_P != d.MAIN_CL_P + d.MAIN_AL_P + d.MAIN_HH_P + d.MAIN_OT_P),
    "MARGWORK_P = MARG_CL+AL+HH+OT": (d.MARGWORK_P != d.MARG_CL_P + d.MARG_AL_P + d.MARG_HH_P + d.MARG_OT_P),
    "MARGWORK_P = MARGWORK_3_6_P + MARGWORK_0_3_P": (d.MARGWORK_P != d.MARGWORK_3_6_P + d.MARGWORK_0_3_P),
    "TOT_WORK_P + NON_WORK_P = TOT_P": (d.TOT_WORK_P + d.NON_WORK_P != d.TOT_P),
}
for k, v in ident.items():
    check(f"district identity {k}", int(v.sum()) == 0, 0, int(v.sum()))

# ---- India totals vs reference ------------------------------------------------------------
it = india.loc["Total"]
for k in ["TOT_P", "TOT_M", "TOT_F", "P_SC"]:
    check(f"India {k} vs reference", int(it[k]) == REF[k], REF[k], int(it[k]))
check("India Rural TOT_P vs reference", int(india.loc["Rural", "TOT_P"]) == REF["RURAL_TOT_P"], REF["RURAL_TOT_P"], int(india.loc["Rural", "TOT_P"]))
check("India Urban TOT_P vs reference", int(india.loc["Urban", "TOT_P"]) == REF["URBAN_TOT_P"], REF["URBAN_TOT_P"], int(india.loc["Urban", "TOT_P"]))

# ST and literates: the PCA file includes the ESTIMATED population of the Mao-Maram, Paomata and Purul
# sub-districts of Senapati (Manipur). The widely quoted 104,281,034 ST / 763,498,517 literates EXCLUDE them.
sen = pd.read_excel(SENAPATI_SRC, dtype=str)
sen3 = sen[(sen.Level == "SUB-DISTRICT") & (sen.TRU == "Total") & (sen.Name.str.strip().isin(["Mao-Maram", "Paomata", "Purul"]))]
check("Senapati TV file has the 3 sub-districts", len(sen3) == 3, 3, len(sen3))
sub = {c: int(pd.to_numeric(sen3[c]).sum()) for c in ["TOT_P", "P_ST", "P_LIT", "P_06", "No_HH"]}
check("India P_ST as published in PCA SD file (incl. 3 Senapati sub-districts)", int(it["P_ST"]) == 104545716, 104545716, int(it["P_ST"]))
check("India P_ST minus Mao-Maram+Paomata+Purul = reference 104,281,034", int(it["P_ST"]) - sub["P_ST"] == REF["P_ST"], REF["P_ST"],
      f'{int(it["P_ST"])} - {sub["P_ST"]} = {int(it["P_ST"]) - sub["P_ST"]}')
check("India P_LIT as published in PCA SD file (incl. 3 Senapati sub-districts)", int(it["P_LIT"]) == 763638812, 763638812, int(it["P_LIT"]))
check("India P_LIT minus Mao-Maram+Paomata+Purul = reference 763,498,517", int(it["P_LIT"]) - sub["P_LIT"] == REF["P_LIT"], REF["P_LIT"],
      f'{int(it["P_LIT"])} - {sub["P_LIT"]} = {int(it["P_LIT"]) - sub["P_LIT"]}')
check("3 Senapati sub-districts TOT_P (1,210,854,977 - 1,210,569,573)", sub["TOT_P"] == 285404, 285404, sub["TOT_P"])
sen_d = dist[(dist.District == "272") & (dist.TRU == "Total")].iloc[0]
sen_t = sen[(sen.Level == "DISTRICT") & (sen.TRU == "Total")].iloc[0]
check("Senapati district row identical in PCA SD and PCA TV-1401 (all fields)",
      all(int(sen_d[c]) == int(sen_t[c]) for c in num_cols if c in sen.columns), "identical", "identical" if all(int(sen_d[c]) == int(sen_t[c]) for c in num_cols if c in sen.columns) else "differs")

# ---- independent official file: PCA (ST) district table ----------------------------------------
b = xlrd.open_workbook(ST_SRC, ignore_workbook_corruption=True)
sh = b.sheet_by_index(0)
hdr = sh.row_values(0)
st = pd.DataFrame([sh.row_values(r) for r in range(1, sh.nrows)], columns=hdr)
st = st[st.Level.astype(str).str.upper() == "DISTRICT"].copy()
st["District"] = st.District.astype(str).str.zfill(3)
st["TOT_P"] = st.TOT_P.astype(float).astype("int64")
m = dist.merge(st[["District", "TRU", "TOT_P"]].rename(columns={"TOT_P": "ST_FILE_TOT_P"}), on=["District", "TRU"], how="left")
m["ST_FILE_TOT_P"] = m.ST_FILE_TOT_P.fillna(0).astype("int64")  # districts with no ST are absent in the ST file
check("P_ST equals TOT_P of separate official PCA(ST) district file for every district x TRU",
      int((m.P_ST != m.ST_FILE_TOT_P).sum()) == 0, 0, f"{int((m.P_ST != m.ST_FILE_TOT_P).sum())} mismatches; ST file covers {st.District.nunique()} districts")

# ---- tidy output ---------------------------------------------------------------------------
state_name = states[states.TRU == "Total"].set_index("State").Name.to_dict()
out = dist.copy()
out.insert(0, "state_code", out.State)
out.insert(1, "state_name", out.State.map(state_name))
out.insert(2, "district_code", out.District)
out.insert(3, "district_name", out.Name)
out.insert(4, "tru", out.TRU)
out = out.drop(columns=ID_COLS)
out["note"] = ""
out.loc[out.district_code == "272", "note"] = (
    "Includes ORGI estimated figures for Mao-Maram, Paomata and Purul sub-districts "
    "(TOT_P 285404, P_ST 264682, P_LIT 140295 in Total/Rural)")
tru_order = {"Total": 0, "Rural": 1, "Urban": 2}
out = out.sort_values(["district_code", "tru"], key=lambda s: s.map(tru_order) if s.name == "tru" else s)
out.to_csv(OUT, index=False, encoding="utf-8")

check("tidy CSV rows", len(out) == 1920, 1920, len(out))
json.dump({"source": SRC.replace(HERE, "."), "checks": checks,
           "senapati_3_subdistricts": sub}, open(VAL, "w"), indent=1)
failed = [c for c in checks if not c["ok"]]
for c in checks:
    print(("OK  " if c["ok"] else "FAIL"), c["check"], "|", c["expected"], "|", c["got"])
print(f"{len(checks) - len(failed)}/{len(checks)} checks passed; wrote {OUT}")
sys.exit(1 if failed else 0)
