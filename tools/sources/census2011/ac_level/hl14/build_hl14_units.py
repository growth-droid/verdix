"""Village / town / ward-level household amenity rates, Census of India 2011, all 640 districts.

RATES: official ORGI table HL-14 "Percentage of households to total households by amenities and assets"
(printed in the sheet as TABLE HH-14), one xlsx per district, NADA idno PC11_HL14-SS-DDD, downloaded unmodified
by fetch_hl14_nada.py. Rows go down to every village, every town part (statutory + census towns, per
sub-district) and every ward. HL-14 publishes PERCENTAGES ONLY (1 decimal) - it has no household counts.

HOUSEHOLD COUNTS (needed to weight/aggregate the rates to ACs). total_households is on the HL-14 basis
(households EXCLUDING institutional households; India 246,740,228):
  TOWN    exact official count - the HL-07 (DDW-HH2507-SS00.xls) row of that town part.
  VILLAGE the official HL-07 sub-district RURAL total, split across the sub-district's HL-14 villages.
  WARD    the official HL-07 town-part total, split across the town part's HL-14 wards.
  The split: start from each unit's share of the official PCA-2011 No_HH (PCA-TV district files) = hh_prior,
  then CALIBRATE the shares (bounded chi-square/GREG calibration with a ridge penalty, ratio to prior kept
  within [0.2, 5]) so that the household-weighted mean of the units' published HL-14 % columns reproduces
  the published HL-14 sub-district-rural (or town) row on all 134 % columns. Only official ORGI numbers go
  in. Out-of-sample proof: calibrating on the 72 housing columns alone (roof/wall/floor, rooms, household
  size, ownership, bathing, drainage, kitchen, structure) and testing on the 11 core amenity indicators it
  never saw lifts the share of sub-district/town rebuilds within 0.1 from ~78-80% (PCA prior) to ~92-98%
  (see hl14_rebuild_accuracy.csv, weights = holdout_housing_only).
  pca_no_hh = the unit's PCA No_HH (includes institutional households; India 249,501,663), for reference.
Every unit total therefore sums exactly to the official HLO sub-district, town and district totals.

Run:  python build_hl14_units.py            (parses cached in <scratch>/hl14/work; --refresh to re-parse)
"""
import csv
import glob
import hashlib
import json
import os
import re
import sys
from multiprocessing import Pool

import numpy as np
import pandas as pd
import xlrd
from python_calamine import CalamineWorkbook

HERE = os.path.dirname(os.path.abspath(__file__))
CEN = os.path.abspath(os.path.join(HERE, "..", ".."))            # tools/sources/census2011
HLO = os.path.join(CEN, "hlo")
SCR = os.environ.get("CENSUS_SCRATCH", os.path.join(
    os.environ["LOCALAPPDATA"], "Temp", "claude", "C--Users-minds-OneDrive-Desktop-Data-Project",
    "b4ee2c9a-d22a-44f3-9d75-56cb29e4f656", "scratchpad", "census", "option2"))
RAW14, META14, WORK = (os.path.join(SCR, "hl14", x) for x in ("raw", "meta", "work"))
PCATV = os.path.join(SCR, "pca", "tv")

# 0-based HL-14 column positions (identical header in all 640 files, asserted below) -> output column.
# Same names / definitions as ../../hlo/hlo_district_2011.csv. The first 11 are the core set.
IND = {
    "pct_electricity_lighting": [84],
    "pct_lpg_png_cooking": [113],
    "pct_latrine_within_premises": [90],
    "pct_tap_water": [71, 72],                     # tap water from treated + un-treated source
    "pct_banking_services": [126],
    "pct_tv": [128],
    "pct_telephone_any": [131, 132, 133],          # landline only + mobile only + both
    "pct_computer_laptop": [129, 130],             # with + without internet
    "pct_two_wheeler": [135],
    "pct_car_jeep_van": [136],
    "pct_none_of_assets": [138],
    # extras, same definitions as hlo_district_2011.csv
    "pct_kerosene_lighting": [85],
    "pct_firewood_cooking": [108],
    "pct_open_defecation": [101],
    "pct_tap_water_treated": [71],
    "pct_drinking_water_within_premises": [81],
    "pct_mobile_any": [132, 133],
    "pct_computer_with_internet": [129],
    "pct_bicycle": [134],
    "pct_radio": [127],
    "pct_house_good": [11],
    "pct_house_dilapidated": [13],
}
CORE = list(IND)[:11]
COLS = list(range(10, 145))                    # all 135 value columns (cols 11-145 of the printed table)
# (header row, label) expected at each used column - checked in every file
LABELS = {10: (4, "Total"), 11: (5, "Good"), 13: (5, "Dilapidated"), 71: (4, "Tapwater from treated source"),
          72: (4, "Tapwater from un-treated source"), 81: (4, "Within premises"), 84: (4, "Electricity"),
          85: (4, "Kerosene"), 90: (3, "Number of households having latrine facility within the premises"),
          101: (4, "Open"), 108: (4, "Fire-wood"), 113: (4, "LPG/PNG"),
          126: (3, "Total number of households availing banking services"), 127: (4, "Radio/ Transistor"),
          128: (4, "Television"), 129: (5, "With Internet"), 130: (5, "Without Internet"),
          131: (5, "Landline only"), 132: (5, "Mobile only"), 133: (5, "Both"), 134: (4, "Bicycle"),
          135: (4, "Scooter/ Motorcycle/Moped"), 136: (4, "Car/ Jeep/Van"),
          138: (4, "None of the assets specified in col. 10 to 19")}
GROUPS = {71: (3, "Main Source of Drinking Water"), 84: (3, "Main Source of lighting"),
          108: (3, "Type of Fuel used for Cooking"), 127: (3, "Availability of assets"),
          10: (3, "Number of households with condition of Census House as")}
NORM = lambda s: re.sub(r"[^a-z0-9]", "", str(s).lower())
INDIA_PCA_HH, INDIA_HLO_HH = 249501663, 246740228


def code(v, w):
    if isinstance(v, float):
        v = str(int(v))
    return str(v).strip().zfill(w)


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s in ("", "-", "--", "NA", "N.A."):
        return np.nan
    return float(s)


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# ------------------------------------------------------------------ parsers
def parse_hl14(fn):
    rows = CalamineWorkbook.from_path(fn).get_sheet_by_index(0).to_python()
    # signature of the 145 table columns (59 files carry 9 extra trailing columns: blank, except a stray
    # helper label in the header area - counted in `extra_cells` on data rows, must be 0)
    sig = hashlib.md5("|".join(NORM(rows[i][j]) for i in (3, 4, 5) for j in range(145)).encode()).hexdigest()
    bad = [j for j, (i, lab) in {**LABELS, **GROUPS}.items() if NORM(rows[i][j]) != NORM(lab)]
    title_ok = "HH-14" in str(rows[1][0]) and "AMENITIES AND ASSETS" in str(rows[1][0]).upper()
    out, nonnum, extra = [], 0, 0
    for r in rows[7:]:
        if str(r[9]).strip() not in ("Total", "Rural", "Urban"):
            continue
        extra += sum(1 for c in r[145:] if str(c).strip() not in ("", "None"))
        vals = []
        for j in COLS:
            try:
                vals.append(num(r[j]))
            except ValueError:
                vals.append(np.nan); nonnum += 1
        out.append([code(r[0], 2), code(r[2], 3), code(r[4], 5), code(r[6], 6), code(r[7], 4),
                    str(r[1]).strip(), str(r[3]).strip(), str(r[5]).strip(), " ".join(str(r[8]).split()),
                    str(r[9]).strip()] + vals)
    return os.path.basename(fn), sig, bad, title_ok, len(rows[3]), nonnum, out, extra


def parse_pcatv(fn):
    rows = CalamineWorkbook.from_path(fn).get_sheet_by_index(0).to_python()
    h = rows[0]
    assert list(h[:11]) == ["State", "District", "Subdistt", "Town/Village", "Ward", "EB", "Level", "Name", "TRU",
                            "No_HH", "TOT_P"], (fn, h[:11])
    out = []
    for r in rows[1:]:
        if code(r[5], 6) != "000000":
            continue
        out.append([code(r[0], 2), code(r[1], 3), code(r[2], 5), code(r[3], 6), code(r[4], 4), str(r[6]).strip(),
                    " ".join(str(r[7]).split()), str(r[8]).strip(), float(r[9]), float(r[10]), os.path.basename(fn)])
    return out


def parse_hl07():
    """HL-07 (HH-7, main source of lighting) state files: col 8 = total households (excl. institutional),
    col 9 = electricity; rows for state, district, sub-district (T/R/U) and every town part."""
    recs = []
    for f in sorted(glob.glob(os.path.join(HLO, "raw", "DDW-HH2507-*.xls"))):
        if f.endswith("-0000.xls"):
            continue
        sh = xlrd.open_workbook(f, ignore_workbook_corruption=True).sheet_by_index(0)
        hdr = " ".join(str(x) for x in sh.row_values(2)[7:9]) + " " + str(sh.row_values(3)[8])
        assert "Total number of households" in hdr and "Electricity" in hdr, (f, hdr)
        for i in range(sh.nrows):
            r = sh.row_values(i)
            if str(r[0]).strip() != "HH2507":
                continue
            recs.append([code(r[1], 2), code(r[2], 3), code(r[3], 5), code(r[4], 6), str(r[5]).strip(),
                         str(r[6]).strip(), float(r[7]), float(r[8]), os.path.basename(f)])
    return pd.DataFrame(recs, columns=["state", "district", "subdistt", "town_village", "name", "tru", "hlo_hh",
                                       "hlo_elec", "src"])


def load(refresh=False):
    os.makedirs(WORK, exist_ok=True)
    p14, ppc = os.path.join(WORK, "hl14_rows.parquet"), os.path.join(WORK, "pcatv_rows.parquet")
    pfi = os.path.join(WORK, "hl14_files.json")
    f14 = sorted(glob.glob(os.path.join(RAW14, "*.xlsx")))
    if refresh or not os.path.exists(p14):
        with Pool(4) as pool:
            res = pool.map(parse_hl14, f14, chunksize=4)
        cols = ["state", "district", "subdistt", "town_village", "ward", "state_name", "district_name",
                "subdistt_name", "name", "tru"] + [f"c{j}" for j in COLS]
        df = pd.concat([pd.DataFrame(r[6], columns=cols).assign(src_file=r[0]) for r in res], ignore_index=True)
        df = df.astype({f"c{j}": "float32" for j in COLS})
        df.to_parquet(p14)
        json.dump([dict(file=r[0], sig=r[1], bad_labels=r[2], title_ok=r[3], ncols=r[4], nonnum=r[5], nrows=len(r[6]),
                        extra_cells=r[7]) for r in res], open(pfi, "w"), indent=0)
    if refresh or not os.path.exists(ppc):
        srcs = []
        for f in glob.glob(os.path.join(PCATV, "SOURCES*.csv")):
            srcs += list(csv.DictReader(open(f, encoding="utf8")))
        fp = sorted(os.path.join(PCATV, s["idno"] + ".xlsx") for s in srcs)
        with Pool(4) as pool:
            res = pool.map(parse_pcatv, fp, chunksize=4)
        pd.DataFrame([x for r in res for x in r],
                     columns=["state", "district", "subdistt", "town_village", "ward", "level", "name", "tru",
                              "no_hh", "tot_p", "src_file"]).to_parquet(ppc)
    return pd.read_parquet(p14), json.load(open(pfi)), pd.read_parquet(ppc)




# ------------------------------------------------------------------ calibration
CAL_ALL = [f"c{j}" for j in range(11, 145)]          # every published % column except col 11 ('Total' = 100)
CAL_HOUSING = [f"c{j}" for j in list(range(11, 71)) + list(range(102, 108)) + list(range(118, 126))
               + list(range(139, 145))]               # house condition/materials/rooms/size/ownership/couples,
#                                                       bathing, drainage, kitchen, structure: NO amenity column
MU, LB, UB = 1e-3, 0.2, 5.0                           # ridge on the % fit (fractions), ratio-to-prior bounds


def calib_group(P, T, s0, mu=MU, lo=LB, hi=UB, iters=25):
    """shares s (sum 1) near the prior s0 whose weighted mean of the unit % rows P (n x k, fractions) fits the
    published group row T (k): min sum (s-s0)^2/s0 + |P's - T|^2/mu  s.t. sum s = 1 and lo <= s/s0 <= hi
    (linear calibration, closed form per pass; units hitting a bound are fixed there and the rest re-solved)."""
    n, k = P.shape
    X = np.hstack([np.ones((n, 1)), P])
    Tt = np.concatenate([[1.0], T])
    ridge = np.diag(np.concatenate([[1e-12], np.full(k, mu)]))
    free = np.ones(n, bool)
    s = s0.copy()
    for _ in range(iters):
        Xf, s0f = X[free], s0[free]
        rhs = Tt - X[~free].T @ s[~free] - Xf.T @ s0f
        lam = np.linalg.solve((Xf * s0f[:, None]).T @ Xf + ridge, rhs)
        g = 1.0 + Xf @ lam
        s[free] = s0f * np.clip(g, lo, hi)
        out = (g < lo) | (g > hi)
        if not out.any():
            break
        free[np.flatnonzero(free)[out]] = False
        if not free.any():
            break
    for _ in range(200):                     # restore sum = 1 without leaving the bounds (s0 itself is feasible)
        s = np.clip(s, lo * s0, hi * s0)
        tot = s.sum()
        if abs(tot - 1.0) < 1e-12:
            break
        m = s < hi * s0 * (1 - 1e-12) if tot < 1 else s > lo * s0 * (1 + 1e-12)
        s[m] *= (1.0 - s[~m].sum()) / s[m].sum()
    return s


def calibrate(u, gk, tgt, cols):
    """u: units (column 'prior' > 0, the c-columns); tgt: published group rows indexed by gk.
    -> (share, status) Series aligned to u.index"""
    us = u.sort_values(gk)
    keys = list(zip(*[us[c] for c in gk]))
    codes = pd.factorize(pd.Series(keys))[0]
    starts = np.r_[0, np.flatnonzero(np.diff(codes)) + 1, len(us)]
    P_all = us[cols].to_numpy(np.float64) / 100.0
    pr = us["prior"].to_numpy(np.float64)
    tg = tgt[cols]
    tdict = dict(zip(tg.index, tg.to_numpy(np.float64) / 100.0))
    share, status = np.empty(len(us)), np.empty(len(us), dtype=object)
    for a, b in zip(starts[:-1], starts[1:]):
        s0 = pr[a:b] / pr[a:b].sum()
        T = tdict.get(keys[a])
        if b - a == 1:
            share[a:b], status[a:b] = 1.0, "single_unit"
            continue
        if T is None:
            share[a:b], status[a:b] = s0, "prior_only_no_group_row"
            continue
        P = P_all[a:b]
        ok = ~np.isnan(P).any(axis=0) & ~np.isnan(T)
        if not ok.any():
            share[a:b], status[a:b] = s0, "prior_only_no_values"
            continue
        share[a:b], status[a:b] = calib_group(P[:, ok], T[ok], s0), "calibrated"
    return pd.Series(share, index=us.index).reindex(u.index), pd.Series(status, index=us.index).reindex(u.index)


# ------------------------------------------------------------------ helpers
def lr_round(values, groups, totals):
    """largest-remainder integerisation of float `values` within `groups` so each group sums to its total.
    Every unit HL-14 lists had >= 1 household (its % are defined), so a unit rounded to 0 takes 1 household
    from the largest unit of its group (only when the group total allows it)."""
    d = pd.DataFrame(dict(v=np.asarray(values, float), g=np.asarray(groups), t=np.asarray(totals, float)))
    d["fl"] = np.floor(d.v)
    d["rem"] = d.v - d.fl
    short = (d.groupby("g").t.transform("first") - d.groupby("g").fl.transform("sum")).round()
    rank = d.groupby("g").rem.rank(method="first", ascending=False)
    out = (d.fl + (rank <= short)).astype("int64").to_numpy()
    n = d.groupby("g").g.transform("size").to_numpy()
    for g in np.unique(d.g.to_numpy()[(out == 0) & (d.t.to_numpy() >= n)]):
        idx = np.flatnonzero(d.g.to_numpy() == g)
        for i in idx[out[idx] == 0]:
            big = idx[np.argmax(out[idx])]
            out[big] -= 1
            out[i] = 1
    return out


def wmean(df, keys, w, inds=None):
    """household-weighted mean of indicators, ignoring NaN cells (weight renormalised)"""
    out = {}
    wv = df[w].astype(float)
    grp = [df[c] for c in keys]
    for k in (inds or list(IND)):
        x = df[k].astype(float)
        m = x.notna() & (wv > 0)
        num_ = (x.where(m, 0) * wv.where(m, 0)).groupby(grp).sum()
        den = wv.where(m, 0).groupby(grp).sum()
        out[k] = num_ / den.replace(0, np.nan)
    return pd.DataFrame(out)


def main():
    refresh = "--refresh" in sys.argv
    V = []

    def chk(name, expected, got, ok, detail=""):
        V.append(dict(check=name, expected=str(expected), got=str(got), ok=bool(ok), detail=detail))
        print(("OK  " if ok else "FAIL"), name, "| expected", expected, "| got", got, ("| " + detail if detail else ""),
              flush=True)

    h, finfo, pca = load(refresh)
    cat = json.load(open(os.path.join(META14, "hl14_catalog.json")))
    man = [json.loads(l) for f in sorted(glob.glob(os.path.join(META14, "manifest_w*.jsonl"))) for l in open(f) if l.strip()]
    man = list({m["idno"]: m for m in man}.values())

    # ================= (c) coverage + file integrity
    chk("NADA catalogue: district-level HL-14 entries (PC11_HL14-SS-DDD)", 640, cat["n"], cat["n"] == 640)
    chk("downloaded files with manifest line", 640, len(man), len(man) == 640)
    offname = [m["idno"] for m in man if m["filename"] != "HLPCA-%s%s-2011_H14_census.xlsx" % tuple(m["idno"].split("-")[1:])]
    chk("file name (HLPCA-SSDDD) matches catalogue idno (PC11_HL14-SS-DDD)", 0, len(offname), not offname,
        ";".join(offname[:5]))
    badsha = [m["filename"] for m in man if sha(os.path.join(RAW14, m["filename"])) != m["sha256"]]
    chk("raw files sha256 == manifest", "0 mismatches", f"{len(badsha)} mismatches", not badsha, ";".join(badsha[:5]))
    sigs = {f["sig"] for f in finfo}
    chk("identical HL-14 header (3 header rows x 145 table columns) in every file", "1 signature",
        f"{len(sigs)} signature(s) over {len(finfo)} files", len(sigs) == 1 and len(finfo) == 640)
    badl = [f["file"] for f in finfo if f["bad_labels"] or not f["title_ok"]]
    chk("used columns carry the expected labels (e.g. col 85 'Electricity', 114 'LPG/PNG') + title 'HH-14'",
        "0 files off", f"{len(badl)} files off", not badl, ";".join(badl[:5]))
    wide = [f for f in finfo if f["ncols"] != 145]
    chk("files with extra trailing columns hold no data in them", "0 non-blank cells",
        f"{len(wide)} files x {sorted({f['ncols'] for f in wide})} cols, {sum(f['extra_cells'] for f in finfo)} non-blank cells",
        sum(f["extra_cells"] for f in finfo) == 0)
    nonnum = sum(f["nonnum"] for f in finfo)
    chk("non-numeric value cells (all 135 % columns, all rows)", 0, nonnum, nonnum == 0)
    smp = {os.path.basename(p): sha(p) for p in glob.glob(os.path.join(HLO, "raw", "hl14_sample", "*.xlsx"))}
    same = sum(1 for m in man if m["filename"] in smp and smp[m["filename"]] == m["sha256"])
    chk("re-downloaded files byte-identical to the 15 earlier samples (hlo/raw/hl14_sample)", len(smp), same,
        same == len(smp))

    # ================= classify HL-14 rows
    for k, cols in IND.items():
        h[k] = sum(h[f"c{j}"].astype(np.float64).round(1) for j in cols)    # cells are 1-decimal values
    fcode = h.src_file.str.extract(r"HLPCA-(\d\d)(\d\d\d)-")
    mm = (fcode[0] != h.state) | (fcode[1] != h.district)
    # a published cell can be corrupted (Jabalpur ward 77 carries state code '0<diamond>'): repair a NON-NUMERIC
    # code from the file name; a numeric mismatch would be a real problem and stays a failure
    rep = mm & ~(h.state.str.fullmatch(r"\d\d") & h.district.str.fullmatch(r"\d\d\d"))
    repaired = h.loc[rep, ["src_file", "state", "district", "subdistt", "town_village", "ward", "name"]].to_dict("records")
    h.loc[rep, "state"], h.loc[rep, "district"] = fcode.loc[rep, 0], fcode.loc[rep, 1]
    mism = int(((fcode[0] != h.state) | (fcode[1] != h.district)).sum())
    chk("every row's state+district code == the code in its file name", 0, mism, mism == 0,
        f"{len(repaired)} non-numeric code cell(s) repaired from the file name: " + json.dumps(repaired, ensure_ascii=True))
    dist_ = (h.subdistt == "00000") & (h.town_village == "000000")
    sd_ = (h.subdistt != "00000") & (h.town_village == "000000")
    oth = (h.subdistt == "00000") & (h.town_village != "000000")
    ward_ = ~dist_ & ~sd_ & (h.ward != "0000")
    h["level"] = np.select([dist_, sd_, ward_, ~dist_ & ~sd_ & (h.tru == "Rural"), ~dist_ & ~sd_ & (h.tru == "Urban")],
                           ["DISTRICT", "SUB-DISTRICT", "WARD", "VILLAGE", "TOWN"], "OTHER")
    chk("HL-14 rows not classifiable (district-level town rows / Total-unit rows)", 0,
        int((h.level == "OTHER").sum() + oth.sum()), (h.level == "OTHER").sum() + oth.sum() == 0)
    nd = h[h.level == "DISTRICT"].drop_duplicates(["state", "district"]).shape[0]
    chk("coverage: districts with a DISTRICT row in their own file", 640, nd, nd == 640)
    key5 = ["state", "district", "subdistt", "town_village", "ward"]
    k4, sdk = key5[:4], key5[:3]
    units = h[h.level.isin(["VILLAGE", "TOWN", "WARD"])].copy().reset_index(drop=True)
    dup = int(units.duplicated(key5).sum())
    chk("unit key (state,district,subdistt,town_village,ward) unique", 0, dup, dup == 0)
    nud = units.drop_duplicates(["state", "district"]).shape[0]
    chk("coverage: districts with village/town/ward rows", 640, nud, nud == 640)
    units["town_type"] = np.where(units.level == "VILLAGE", "",
                                  np.where(units.town_village >= "800000", "statutory", "census_town"))
    tww = set(map(tuple, units.loc[units.level == "WARD", k4].drop_duplicates().values))
    units["has_wards"] = [(tuple(x) in tww) if lv == "TOWN" else False for x, lv in zip(units[k4].values, units.level)]
    orphan = units[units.level == "WARD"].merge(units[units.level == "TOWN"][k4], on=k4, how="left", indicator=True)
    chk("every WARD row has its TOWN row in the same sub-district", 0, int((orphan._merge != "both").sum()),
        (orphan._merge != "both").sum() == 0)
    nval = int(units[CAL_ALL].isna().any(axis=1).sum())
    chk("units with a blank % cell", 0, nval, nval == 0)

    # ================= PCA-TV No_HH join (prior weights)
    pu = pca[pca.level.isin(["VILLAGE", "TOWN", "WARD"])].copy()
    # PCA-TV lists a town that has outgrowths twice under one code: "X (M Cl + OG)" (= all its wards, the OGs
    # being extra 'wards') and "X (M Cl)". HL-14 has one row = the "+ OG" whole -> keep that one
    pu["_og"] = pu.name.str.contains(r"\+\s*OG", regex=True)
    dups = int(pu.duplicated(key5, keep=False).sum())
    pu = pu.sort_values(key5 + ["_og", "no_hh"]).drop_duplicates(key5, keep="last")
    pw = pu[pu.level == "WARD"].groupby(k4).no_hh.sum()
    pt = pu[pu.level == "TOWN"].set_index(k4).no_hh
    pbadw = int((pw - pt.reindex(pw.index)).abs().gt(0).sum())
    chk("PCA-TV unit key unique after keeping the '+ OG' row of a duplicated town; that row == sum of its wards",
        "0 / 0", f"{int(pu.duplicated(key5).sum())} / {pbadw}", pu.duplicated(key5).sum() == 0 and pbadw == 0,
        f"{dups} duplicated town rows resolved")
    units = units.merge(pu[key5 + ["level", "no_hh", "tot_p", "name"]].rename(
        columns={"level": "pca_level", "no_hh": "pca_no_hh", "tot_p": "pca_tot_p", "name": "pca_name"}),
        on=key5, how="left")
    nomatch = units[units.pca_no_hh.isna()]
    chk("HL-14 units without a PCA-TV unit of the same 5-part code (prior imputed, then calibrated)",
        "a handful", f"{len(nomatch):,} of {len(units):,}", len(nomatch) < 0.001 * len(units),
        "by level: " + json.dumps(nomatch.level.value_counts().to_dict()) + "; e.g. towns whose ward list was "
        "redrawn between houselisting (2010) and the PCA (2011): " + "; ".join(
            nomatch[nomatch.level == "WARD"].groupby(k4).size().sort_values().tail(3).index.map(
                lambda k: units.loc[(units[k4] == pd.Series(k, index=k4)).all(axis=1) & (units.level == "TOWN"),
                                    "name"].iloc[0])))
    lvbad = units[units.pca_level.notna() & (units.pca_level != units.level)]
    chk("matched units have the same level in PCA-TV", 0, len(lvbad), len(lvbad) == 0)
    pmiss = pu.merge(units[key5], on=key5, how="left", indicator=True)
    pmiss = pmiss[pmiss._merge == "left_only"].drop(columns=["_merge", "_og"])
    pm = pmiss.groupby("level").no_hh.agg(["size", "sum"]).astype(int)
    chk("PCA-TV units absent from HL-14 (no houselisting row; mostly villages with no/few households)",
        "small", f"{len(pmiss):,} units / {int(pmiss.no_hh.sum()):,} PCA HH", pmiss.no_hh.sum() < 0.01 * INDIA_PCA_HH,
        json.dumps(pm.to_dict("index")))
    pmiss.to_parquet(os.path.join(HERE, "pca_units_absent_from_hl14.parquet"), index=False, compression="zstd")

    # ================= HLO household totals (HL-07)
    hl07 = parse_hl07()
    hl07 = hl07[hl07.district != "000"]            # state-level rows (state totals, whole-town rows)
    t07 = hl07[(hl07.subdistt != "00000") & (hl07.town_village != "000000")]
    chk("HL-07 town-part key unique", 0, int(t07.duplicated(k4).sum()), t07.duplicated(k4).sum() == 0)
    sd07 = hl07[(hl07.subdistt != "00000") & (hl07.town_village == "000000")].pivot_table(
        index=sdk, columns="tru", values="hlo_hh", aggfunc="first").fillna(0)
    d07 = hl07[(hl07.subdistt == "00000") & (hl07.town_village == "000000")].pivot_table(
        index=["state", "district"], columns="tru", values="hlo_hh", aggfunc="first").fillna(0)
    units = units.merge(t07[k4 + ["hlo_hh", "hlo_elec"]].rename(columns={"hlo_hh": "hlo_town_hh", "hlo_elec": "hlo_town_elec"}),
                        on=k4, how="left")
    units.loc[units.level == "VILLAGE", ["hlo_town_hh", "hlo_town_elec"]] = np.nan
    v, t, w = (units.level == x for x in ("VILLAGE", "TOWN", "WARD"))
    tmiss = units[t & units.hlo_town_hh.isna()]
    chk("HL-14 TOWN rows found among HL-07 town rows (exact HLO households)", f"{int(t.sum()):,}",
        f"{int(t.sum()) - len(tmiss):,}", len(tmiss) == 0, ";".join(tmiss.name.head(5)))
    u07 = units[t].merge(t07, on=k4, how="right", indicator=True)
    chk("HL-07 town rows present in HL-14", f"{len(t07):,}", f"{int((u07._merge == 'both').sum()):,}",
        (u07._merge == "both").all())
    # independent consistency: HL-14 % electricity vs HL-07's own electricity / households counts
    tt = units[t & (units.hlo_town_hh > 0)]
    d = (tt.pct_electricity_lighting - 100 * tt.hlo_town_elec / tt.hlo_town_hh).abs()
    chk("HL-14 town % electricity == HL-07 town electricity count / households (independent table)",
        "within 1-dec rounding (0.05)", f"{(d <= 0.05 + 1e-9).mean():.2%} within, max {d.max():.4f} (n={len(d):,})",
        (d <= 0.05 + 1e-9).all())
    s07 = hl07[(hl07.subdistt != "00000") & (hl07.town_village == "000000") & (hl07.hlo_hh > 0)].set_index(sdk + ["tru"])
    hsd = h[h.level == "SUB-DISTRICT"].set_index(sdk + ["tru"])
    j = hsd[["pct_electricity_lighting"]].join(s07[["hlo_hh", "hlo_elec"]], how="inner")
    d = (j.pct_electricity_lighting - 100 * j.hlo_elec / j.hlo_hh).abs()
    chk("HL-14 sub-district % electricity (T/R/U) == HL-07 counts", "within 0.05",
        f"{(d <= 0.05 + 1e-9).mean():.2%} within, max {d.max():.4f} (n={len(d):,})", (d <= 0.05 + 1e-9).all())

    # ================= household counts: exact towns; villages / wards = official total x calibrated share
    units["pca_no_hh"] = units.pca_no_hh.fillna(0.0)
    units["prior"] = units.pca_no_hh.astype(float)
    units["prior_imputed"] = units.prior <= 0
    med = units[w & ~units.prior_imputed].groupby(k4).prior.median()
    m = w & units.prior_imputed
    units.loc[m, "prior"] = units.loc[m, k4].merge(med.rename("m").reset_index(), on=k4, how="left")["m"].fillna(1.0).values
    units.loc[v & units.prior_imputed, "prior"] = 1.0          # HLO found >=1 household there; calibration may raise it
    units["total_households"] = np.nan
    units.loc[t, "total_households"] = units.loc[t, "hlo_town_hh"]
    fb = t & units.hlo_town_hh.isna()
    units.loc[fb, "total_households"] = units.loc[fb, "pca_no_hh"]
    vv = units.loc[v, sdk].merge(sd07["Rural"].rename("W").reset_index(), on=sdk, how="left")
    chk("every sub-district with HL-14 villages has an HL-07 sub-district Rural total", 0, int(vv.W.isna().sum()),
        vv.W.isna().sum() == 0)
    units.loc[v, "grp_total"] = vv.W.fillna(0).values
    ww = units.loc[w, k4].merge(units.loc[t, k4 + ["total_households"]], on=k4, how="left")
    units.loc[w, "grp_total"] = ww.total_households.values
    units["grp"] = np.where(v, "S|" + units.state + units.district + units.subdistt,
                            np.where(w, "T|" + units.state + units.district + units.subdistt + units.town_village,
                                     "U|" + units.index.astype(str)))
    units["share_prior"] = units.prior / units.groupby("grp").prior.transform("sum")
    tgt_sd = h[(h.level == "SUB-DISTRICT") & (h.tru == "Rural")].set_index(sdk)
    tgt_tw = h[h.level == "TOWN"].set_index(k4)
    for variant, cols in (("final", CAL_ALL), ("holdout", CAL_HOUSING)):
        sv, stv = calibrate(units[v], sdk, tgt_sd, cols)
        sw, stw = calibrate(units[w], k4, tgt_tw, cols)
        units.loc[v, "share_" + variant], units.loc[w, "share_" + variant] = sv, sw
        if variant == "final":
            units.loc[v, "calib_status"], units.loc[w, "calib_status"] = stv, stw
    vw = v | w
    gcode = pd.factorize(units.loc[vw, "grp"])[0]
    for variant, col in (("final", "total_households"), ("holdout", "hh_holdout"), ("prior", "hh_prior")):
        if col != "total_households":
            units[col] = units.total_households
        units.loc[vw, col] = lr_round(units.loc[vw, "grp_total"] * units.loc[vw, "share_" + variant], gcode,
                                      units.loc[vw, "grp_total"])
    for col in ("total_households", "hh_holdout", "hh_prior", "pca_no_hh"):
        units[col] = units[col].astype("int64")
    units["hh_method"] = np.select(
        [t & ~fb, fb, v, w],
        ["hl07_town_exact", "pca_no_hh_fallback", "hl07_subdistrict_rural_split:" + units.calib_status.astype(str),
         "hl07_town_split:" + units.calib_status.astype(str)], "")
    st = units.loc[vw].groupby("level").calib_status.value_counts().unstack(fill_value=0)
    chk("calibration status of village / ward groups (units)", "calibrated", json.dumps(st.to_dict("index")), True)
    rat = (units.loc[vw, "share_final"] / units.loc[vw, "share_prior"])
    chk("calibrated share / PCA-prior share (village + ward units)", f"within [{LB}, {UB}]",
        f"min {rat.min():.3f} p1 {rat.quantile(.01):.2f} median {rat.median():.2f} p99 {rat.quantile(.99):.2f} "
        f"max {rat.max():.3f}; {(rat.between(0.8, 1.25)).mean():.1%} within 0.8-1.25",
        rat.between(LB * (1 - 1e-6), UB * (1 + 1e-6)).all())

    # ================= (b) household totals
    leaf = units[v | t]
    for col, name in (("total_households", "total_households"), ("hh_prior", "hh_prior")):
        s = leaf.groupby(["state", "district", "tru"])[col].sum().unstack().fillna(0)
        hc = pd.read_csv(os.path.join(HLO, "hlo_district_2011_counts.csv"), dtype={"state_code": str, "district_code": str})
        hc = hc.pivot_table(index=["state_code", "district_code"], columns="tru", values="total_households").fillna(0)
        hc.index.names = ["state", "district"]
        cmp = s.reindex(hc.index).fillna(0)
        br, bu = int((cmp.Rural != hc.Rural).sum()), int((cmp.Urban != hc.Urban).sum())
        bt = int(((cmp.Rural + cmp.Urban) != hc.Total).sum())
        chk(f"(b) sum of unit {name} (villages+towns) == hlo_district_2011_counts per district, Total/Rural/Urban",
            "0/0/0 mismatches of 640", f"{bt}/{br}/{bu}", bt == 0 and br == 0 and bu == 0)
    chk("(b) India: sum of unit total_households", f"{INDIA_HLO_HH:,}", f"{int(leaf.total_households.sum()):,}",
        int(leaf.total_households.sum()) == INDIA_HLO_HH)
    sdu = leaf.groupby(sdk + ["tru"]).total_households.sum().unstack().fillna(0)
    sdc = sd07.reindex(sdu.index).fillna(0)
    sdbad = int(((sdu.get("Rural", 0) != sdc.Rural) | (sdu.get("Urban", 0) != sdc.Urban)).sum())
    chk("(b) sum of unit total_households == HL-07 sub-district Rural / Urban totals", f"0 of {len(sdu):,}", sdbad,
        sdbad == 0)
    wsum = units[w].groupby(k4).total_households.sum()
    tsum = units[t & units.has_wards].set_index(k4).total_households
    wbad = int((wsum.reindex(tsum.index) != tsum).sum())
    chk("(b) sum of WARD total_households == its TOWN row", f"0 of {len(tsum):,} towns", wbad, wbad == 0)
    pdist = pca[pca.level == "DISTRICT"].pivot_table(index=["state", "district"], columns="tru", values="no_hh")
    pm_vt = pmiss[pmiss.level.isin(["VILLAGE", "TOWN"])].groupby(["state", "district"]).no_hh.sum()
    recon = leaf.groupby(["state", "district"]).pca_no_hh.sum().add(pm_vt, fill_value=0)
    pbad = int((recon.reindex(pdist.index).fillna(0) != pdist.Total).sum())
    chk("(b) PCA reconciliation: unit pca_no_hh + PCA units absent from HL-14 == PCA-TV district No_HH",
        "0 of 640", pbad, pbad == 0, f"India {int(recon.sum()):,} vs {INDIA_PCA_HH:,}")

    # ================= (a) rebuild district / sub-district / town % from the units
    pub = h[h.level == "DISTRICT"].set_index(["state", "district", "tru"])
    hd = pd.read_csv(os.path.join(HLO, "hlo_district_2011.csv"), dtype={"state_code": str, "district_code": str})
    hd = hd.rename(columns={"state_code": "state", "district_code": "district"}).set_index(["state", "district", "tru"])
    K = {k: len(c) for k, c in IND.items()}
    WEIGHTS = [("total_households", "shipped: calibrated on all 134 % columns"),
               ("hh_holdout", "holdout: calibrated on the 72 housing columns only (core amenities unseen)"),
               ("hh_prior", "PCA No_HH share, uncalibrated"), ("pca_no_hh", "raw PCA No_HH")]
    acc = []

    def score(est, ref, wcol, refname, lvl, keys_tru):
        jn = est.join(ref[list(IND)], rsuffix="_ref", how="inner")
        for k in IND:
            dd = (jn[k] - jn[k + "_ref"]).abs().dropna()
            groups_ = [(None, dd)] if keys_tru is None else [(tr, dd[dd.index.get_level_values("tru") == tr])
                                                             for tr in ("Total", "Rural", "Urban")]
            for tr, x in groups_:
                bound = (0.1 if refname.startswith("HL-14") else 0.055) * K[k]
                acc.append(dict(weights=wcol, level=lvl, reference=refname, tru=tr or "", indicator=k,
                                core=k in CORE, n=len(x), rounding_bound=round(bound, 3),
                                share_within_rounding=round((x <= bound + 1e-9).mean(), 4) if len(x) else np.nan,
                                share_within_0_2=round((x <= 0.2 + 1e-9).mean(), 4) if len(x) else np.nan,
                                mean_abs=round(x.mean(), 4) if len(x) else np.nan,
                                p99_abs=round(x.quantile(.99), 3) if len(x) else np.nan,
                                max_abs=round(x.max(), 3) if len(x) else np.nan,
                                worst=str(x.idxmax()) if len(x) else ""))

    for wcol, _ in WEIGHTS:
        rb = wmean(pd.concat([leaf.assign(tru="Total"), leaf]), ["state", "district", "tru"], wcol)
        score(rb, pub, wcol, "HL-14 district row", "district", True)
        score(rb, hd, wcol, "hlo_district_2011.csv", "district", True)
        rs = wmean(pd.concat([leaf.assign(tru="Total"), leaf]), sdk + ["tru"], wcol)
        score(rs, h[h.level == "SUB-DISTRICT"].set_index(sdk + ["tru"]), wcol, "HL-14 sub-district row", "sub-district", True)
        rt = wmean(units[w], k4, wcol)
        score(rt, tgt_tw, wcol, "HL-14 town row", "town (from its wards)", None)
    acc = pd.DataFrame(acc)
    acc.to_csv(os.path.join(HERE, "hl14_rebuild_accuracy.csv"), index=False)

    def summ(wcol, ref, lvl, tru=None):
        a = acc[(acc.weights == wcol) & (acc.reference == ref) & (acc.level == lvl) & acc.core]
        if tru:
            a = a[a.tru == tru]
        n = a.n.sum()
        return ((a.share_within_rounding * a.n).sum() / n, (a.share_within_0_2 * a.n).sum() / n, a.max_abs.max(),
                a.p99_abs.max(), int(n), a.sort_values("max_abs").iloc[-1][["indicator", "worst"]].str.cat(sep=" "))

    for ref, crit in (("HL-14 district row", "rounding"), ("hlo_district_2011.csv", "0.2")):
        for tru in ("Total", "Rural", "Urban"):
            r, r2, mx, p99, n, worst = summ("total_households", ref, "district", tru)
            share = r if crit == "rounding" else r2
            chk(f"(a) district % rebuilt from units vs {ref}, {tru}, 11 core indicators",
                f">=99% within {'rounding (0.1 per summed component)' if crit == 'rounding' else '0.2'}",
                f"{r:.2%} within rounding, {r2:.2%} within 0.2, p99 {p99:.2f}, max {mx:.2f} (n={n})",
                share >= 0.99, "worst: " + worst)
    for lvl, ref in (("district", "HL-14 district row"), ("sub-district", "HL-14 sub-district row"),
                     ("town (from its wards)", "HL-14 town row")):
        trs = ("Rural",) if lvl != "town (from its wards)" else (None,)
        for tru in trs:
            p = summ("hh_prior", ref, lvl, tru)
            o = summ("hh_holdout", ref, lvl, tru)
            chk(f"(a') OUT-OF-SAMPLE {lvl} {tru or ''} rebuild of the 11 core indicators, housing-only calibration "
                f"vs uncalibrated PCA prior", "holdout beats prior",
                f"holdout {o[0]:.1%} within rounding (p99 {o[3]:.2f}, max {o[2]:.2f}) vs prior {p[0]:.1%} "
                f"(p99 {p[3]:.2f}, max {p[2]:.2f})", o[0] > p[0] and o[3] <= p[3])
    for lvl, ref, tru in (("sub-district", "HL-14 sub-district row", "Total"), ("sub-district", "HL-14 sub-district row", "Rural"),
                          ("sub-district", "HL-14 sub-district row", "Urban"), ("town (from its wards)", "HL-14 town row", None)):
        r, r2, mx, p99, n, worst = summ("total_households", ref, lvl, tru)
        chk(f"(a) {lvl} {tru or ''} % rebuilt from units (shipped weights) vs {ref}, 11 core",
            ">=97% within rounding", f"{r:.2%} within rounding, {r2:.2%} within 0.2, p99 {p99:.2f}, max {mx:.2f} (n={n:,})",
            r >= 0.97, "worst: " + worst)

    # per-group fit after calibration (max over the 11 core indicators of |rebuilt - published| per component)
    fit = []
    for gkeys, tg, mask in ((sdk, tgt_sd, v), (k4, tgt_tw, w)):
        rb = wmean(units[mask], gkeys, "total_households", CORE)
        jn = rb.join(tg[CORE], rsuffix="_ref", how="inner")
        f = pd.concat([(jn[k] - jn[k + "_ref"]).abs() / K[k] for k in CORE], axis=1).max(axis=1)
        fit.append(units.loc[mask, gkeys].merge(f.rename("g").reset_index(), on=gkeys, how="left").g.set_axis(units.index[mask]))
    units["group_fit_max"] = pd.concat(fit).reindex(units.index).round(2)

    # ================= unit-level sanity
    hhpos = units.total_households > 0
    nanpos = int((units[CORE].isna().any(axis=1) & hhpos).sum())
    chk("units with households > 0 but a missing core %", 0, nanpos, nanpos == 0)
    rng = int(((units[CORE] < 0) | (units[CORE] > 100.0 + 0.3)).any(axis=1).sum())
    chk("core % outside [0, 100 (+ rounding of summed parts)]", 0, rng, rng == 0)
    c10 = units["c10"].round(1)
    chk("HL-14 col 11 'Total' == 100 on every unit row", "all", f"{int((c10 == 100).sum()):,} of {len(c10):,}",
        (c10 == 100).all())
    z = units[(units.total_households == 0)]
    chk("units with published % but 0 households after integer rounding (only possible where a group's "
        "official total < its number of units)", 0, f"{len(z):,}", len(z) == 0, json.dumps(z.level.value_counts().to_dict()))

    # ================= outputs
    units["is_leaf"] = v | w | (t & ~units.has_wards)
    units["og_rural_code"] = units.pca_name.fillna("").str.extract(r"Rural MDDS CODE\s*:\s*(\d+)")[0].str.zfill(6)
    # Verifier fix (2026-10-01): 48 Ganganagar/Hanumangarh villages (e.g. "2 P", "3 AM") are stored in HL-14 as Excel
    # TIME cells, so the reader returns "14:00:00". Take the PCA-TV name for those rows (same code, same unit).
    _tm = units.name.astype(str).str.fullmatch(r"\d\d:\d\d:\d\d") & units.pca_name.notna()
    units.loc[_tm, "name"] = units.loc[_tm, "pca_name"]
    out_cols =["state", "district", "subdistt", "town_village", "ward", "level", "tru", "name", "town_type",
                "has_wards", "is_leaf", "total_households", "hh_method", "hh_prior", "prior_imputed", "group_fit_max",
                "pca_no_hh", "pca_tot_p"] + list(IND) + \
               ["pca_name", "og_rural_code", "state_name", "district_name", "subdistt_name", "src_file"]
    lv_order = {"VILLAGE": 0, "TOWN": 1, "WARD": 2}
    out = units.assign(_o=units.level.map(lv_order)).sort_values(
        ["state", "district", "subdistt", "_o", "town_village", "ward"])[out_cols].reset_index(drop=True)
    for k in IND:
        out[k] = out[k].round(1).astype("float32")
    out["group_fit_max"] = out.group_fit_max.astype("float32")
    out["pca_tot_p"] = out.pca_tot_p.round().astype("Int64")
    out.to_parquet(os.path.join(HERE, "hl14_units.parquet"), index=False, compression="zstd")
    chk("hl14_units.parquet rows == HL-14 village + town + ward rows", f"{len(units):,}",
        f"{len(out):,} (" + ", ".join(f"{k} {n:,}" for k, n in out.level.value_counts().items()) + ")",
        len(out) == int(h.level.isin(["VILLAGE", "TOWN", "WARD"]).sum()))
    area = h[h.level.isin(["DISTRICT", "SUB-DISTRICT"])][["state", "district", "subdistt", "level", "tru", "name"] +
                                                        list(IND) + ["state_name", "district_name", "src_file"]].copy()
    area = area.merge(pd.concat([
        d07.stack().rename("hlo_households").reset_index().assign(subdistt="00000"),
        sd07.stack().rename("hlo_households").reset_index()]), on=["state", "district", "subdistt", "tru"], how="left")
    for k in IND:
        area[k] = area[k].round(1).astype("float32")
    area["hlo_households"] = area.hlo_households.round().astype("Int64")
    area.to_parquet(os.path.join(HERE, "hl14_district_subdistrict_rows.parquet"), index=False, compression="zstd")

    # ================= manifest: every source URL + sha256
    M = []
    for m in sorted(man, key=lambda m: m["idno"]):
        M.append(dict(role="HL-14 village/town/ward % (the rates)", idno=m["idno"], title=m["title"],
                      catalog_url=m["catalog_url"], download_url=m["download_url"], filename=m["filename"],
                      bytes=m["bytes"], sha256=m["sha256"], fetched_utc=m["fetched_utc"],
                      local_copy="<scratch>/census/option2/hl14/raw/" + m["filename"]))
    s07 = {r["local_path"]: r for r in csv.DictReader(open(os.path.join(HLO, "SOURCES.csv"), encoding="utf8"))}
    for f in sorted(glob.glob(os.path.join(HLO, "raw", "DDW-HH2507-*.xls"))):
        if f.endswith("-0000.xls"):
            continue
        r = s07["raw/" + os.path.basename(f)]
        hsh = sha(f)
        assert hsh == r["sha256"], f
        M.append(dict(role="HL-07 sub-district / town household totals (HLO basis)", idno=r["idno"], title=r["title"],
                      catalog_url=r["catalog_url"], download_url=r["download_url"], filename=os.path.basename(f),
                      bytes=os.path.getsize(f), sha256=hsh, fetched_utc=r["fetched_utc"],
                      local_copy="tools/sources/census2011/hlo/raw/" + os.path.basename(f)))
    for f in glob.glob(os.path.join(PCATV, "SOURCES*.csv")):
        for r in csv.DictReader(open(f, encoding="utf8")):
            p = os.path.join(PCATV, r["idno"] + ".xlsx")
            cid = re.search(r"catalog/(\d+)/", r["source_url"]).group(1)
            M.append(dict(role="PCA-TV unit No_HH (prior weights)", idno=r["idno"], title=r["title"],
                          catalog_url="https://censusindia.gov.in/nada/index.php/catalog/" + cid,
                          download_url=r["source_url"], filename=r["idno"] + ".xlsx", bytes=os.path.getsize(p),
                          sha256=sha(p), fetched_utc="", local_copy="<scratch>/census/option2/pca/tv/" + r["idno"] + ".xlsx"))
    sp = os.path.join(META14, "search_amenities.json")
    M.append(dict(role="NADA search API response used to enumerate the 640 HL-14 district entries", idno="",
                  title="", catalog_url="", download_url=cat["search_url"], filename="search_amenities.json",
                  bytes=os.path.getsize(sp), sha256=sha(sp), fetched_utc=cat["fetched_utc"],
                  local_copy="<scratch>/census/option2/hl14/meta/search_amenities.json"))
    M = pd.DataFrame(M).sort_values(["role", "idno"])
    M.to_csv(os.path.join(HERE, "hl14_sources_manifest.csv"), index=False)
    chk("manifest rows (640 HL-14 + 35 HL-07 + 640 PCA-TV + 1 search)", 1316, len(M),
        len(M) == 1316 and M.sha256.str.fullmatch(r"[0-9a-f]{64}").all())

    pd.DataFrame(V).to_csv(os.path.join(HERE, "hl14_validation.csv"), index=False)
    print("FAILED:", sum(not r["ok"] for r in V), "of", len(V))


if __name__ == "__main__":
    main()
