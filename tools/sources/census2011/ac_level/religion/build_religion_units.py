"""Census 2011 religion (Table C-01) at SUB-DISTRICT and TOWN grain, for the AC-level seat build.

Census 2011 published religion only down to sub-district and town (no village, no ward rows).
The seat build applies sub-district RURAL shares to villages and TOWN shares to town parts, so
this script emits one additive row per (state, district, subdistt, town, tru):

  level=SUBDISTRICT  town='000000'  tru in {Total, Rural, Urban}   5,988 sub-districts x 3
  level=TOWN         town=<6-digit> tru='Urban'                    8,067 town parts

A "town part" is a town's slice inside one sub-district. 63 towns span sub-districts (C-01 then
also prints a district-level whole-town row) and 14 of those span districts (state-level
whole-town row, e.g. Greater Mumbai, Siliguri, Srinagar, DMC). Those whole-town rows are NOT in
religion_units.parquet (they would double count); they are checked against the sum of their
parts and kept in religion_town_whole.parquet, which has one row per town code (7,933).

Input  ../../religion/raw_nada/DDW{01..35}C-01 MDDS.XLS  (+ DDW00 for the India row), read with
       the column-asserting reader of ../../religion/build_religion_district_2011.py
       ../../religion/religion_district_2011.csv       (district tidy file, cross-check)
       Optional cross-checks against the official PCA (if present; path via env CENSUS_PCA_DIR):
         2011-IndiaStateDistSbDistTwn-0000.xlsx  (PCA India, town level)   NADA catalog 42559
         india_ward_level.parquet / india_village_level.parquet (slim parses of NADA 42560 / 42554)
Output religion_units.parquet, religion_town_whole.parquet, validation_report.json

Run: python build_religion_units.py   (offline; pandas, pyarrow, xlrd, openpyxl)
"""
import json
import os
import re
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REL = os.path.normpath(os.path.join(HERE, "..", "..", "religion"))
sys.path.insert(0, REL)
import build_religion_district_2011 as C01  # noqa: E402  (read_c01 asserts the 34-col layout)

PCA_DIR = os.environ.get("CENSUS_PCA_DIR", os.path.join(
    os.environ.get("LOCALAPPDATA", ""), "Temp", "claude",
    "C--Users-minds-OneDrive-Desktop-Data-Project", "b4ee2c9a-d22a-44f3-9d75-56cb29e4f656",
    "scratchpad", "census", "option2"))
PCA_TOWN_XLSX = os.path.join(PCA_DIR, "bpf", "2011-IndiaStateDistSbDistTwn-0000.xlsx")
PCA_WARD_PQ = os.path.join(PCA_DIR, "work", "india_ward_level.parquet")
PCA_VILL_PQ = os.path.join(PCA_DIR, "work", "india_village_level.parquet")

CATS = ["total", "hindu", "muslim", "christian", "sikh", "buddhist", "jain",
        "other_religions", "religion_not_stated"]
RELIGIONS = CATS[1:]
K = ["state", "district", "subdistt", "town"]
REF = {"india_total": 1210854977, "india_rural": 833748852, "india_urban": 377106125,
       "districts": 640, "subdistricts": 5988}


def clean(s, prefix):
    s = re.sub(rf"^\s*{prefix}\s*-\s*", "", str(s))
    return re.sub(r"\s+", " ", s).strip()


PART_RE = re.compile(r"\s*\(\s*(?:Part|Major part|Minor part)\s*\)\s*$", re.I)


def town_name(s, multi_part):
    s = re.sub(r"\s+", " ", str(s)).strip()
    return PART_RE.sub("", s) if multi_part else s


def load_c01():
    df = C01.load(os.path.relpath(os.path.join(REL, "raw_nada"), C01.HERE), "DDW[0-3][0-9]C-01 MDDS.XLS")
    df = df.rename(columns={"state_code": "state", "district_code": "district",
                            "subdistrict_code": "subdistt", "town_code": "town"})
    df["tru"] = df.tru.str.title()
    df = df.rename(columns={f"{c}_p": c for c in CATS})
    for c in CATS:
        df[c] = df[c].astype("int64")
    for col, w in (("state", 2), ("district", 3), ("subdistt", 5), ("town", 6)):
        assert df[col].str.fullmatch(rf"\d{{{w}}}").all(), col
    india = df[df.source_file.str.contains("DDW00")]
    states = df[~df.source_file.str.contains("DDW00")].copy()
    d0, s0, t0 = states.district == "000", states.subdistt == "00000", states.town == "000000"
    states["level"] = "?"
    states.loc[d0 & s0 & t0, "level"] = "STATE"
    states.loc[d0 & s0 & ~t0, "level"] = "TOWN_WHOLE"          # town spanning districts
    states.loc[~d0 & s0 & t0, "level"] = "DISTRICT"
    states.loc[~d0 & s0 & ~t0, "level"] = "TOWN_WHOLE"         # town spanning sub-districts
    states.loc[~d0 & ~s0 & t0, "level"] = "SUBDISTRICT"
    states.loc[~d0 & ~s0 & ~t0, "level"] = "TOWN"              # town (part) inside a sub-district
    assert (states.level != "?").all()
    return india, states


def main():
    checks = []

    def check(name, ok, expected=None, got=None, detail=None):
        c = {"check": name, "ok": bool(ok),
             "expected": None if expected is None else str(expected),
             "got": None if got is None else str(got)}
        if detail is not None:
            c["detail"] = detail
        checks.append(c)

    india, st = load_c01()
    check("C-01 state files read (DDW01..DDW35)", st.source_file.nunique() == 35, 35, st.source_file.nunique())
    lv = st.groupby(["level", "tru"]).size()
    check("only Urban rows at town grain", set(st[st.level.str.startswith("TOWN")].tru) == {"Urban"})

    # ---------------- names ----------------
    stn = st[st.level == "STATE"].drop_duplicates("state").set_index("state").area_name_raw.map(
        lambda s: clean(s, "State"))
    dn = st[st.level == "DISTRICT"].drop_duplicates("district").set_index("district").area_name_raw.map(
        lambda s: clean(s, "District"))
    sd = st[st.level == "SUBDISTRICT"].copy()
    sd["subdistt_name"] = sd.area_name_raw.map(lambda s: clean(s, "Sub-District"))
    sdn = sd.drop_duplicates(["state", "district", "subdistt"]).set_index(
        ["state", "district", "subdistt"]).subdistt_name

    # ---------------- sub-district grain ----------------
    n_sd = sd[["state", "district", "subdistt"]].drop_duplicates().shape[0]
    check("sub-districts (state, district, subdistt)", n_sd == REF["subdistricts"], REF["subdistricts"], n_sd)
    trus = sd.groupby(["state", "district", "subdistt"]).tru.apply(lambda s: tuple(sorted(s)))
    check("every sub-district has exactly one Total, Rural and Urban row",
          (trus == ("Rural", "Total", "Urban")).all(), n_sd, int((trus == ("Rural", "Total", "Urban")).sum()))
    reused = sd.drop_duplicates(["state", "district", "subdistt"]).groupby("subdistt").size()
    check("sub-district code alone is NOT unique (99999 = 'Area not under any Sub-district' recurs) -> "
          "key is (state, district, subdistt)", True, None,
          f"codes used in >1 district: {list(reused[reused > 1].index)}")
    piv = sd.set_index(["state", "district", "subdistt", "tru"])[CATS]
    diff = (piv.xs("Rural", level="tru") + piv.xs("Urban", level="tru") - piv.xs("Total", level="tru")).abs()
    check("sub-district Rural + Urban = Total (9 categories)", diff.to_numpy().max() == 0, 0, int(diff.to_numpy().max()))

    dist = st[st.level == "DISTRICT"].set_index(["state", "district", "tru"])[CATS].sort_index()
    sds = sd.groupby(["state", "district", "tru"])[CATS].sum().sort_index()
    check("districts covered by sub-districts", sds.index.equals(dist.index), len(dist), len(sds))
    diff = (sds - dist).abs()
    for tr in ("Total", "Rural", "Urban"):
        m = int(diff.xs(tr, level="tru").to_numpy().max())
        check(f"sum of sub-districts = district, {tr} (640 districts x 9 categories)", m == 0, 0, m)

    # ---------------- town grain ----------------
    tw = st[st.level == "TOWN"].copy()
    whole = st[st.level == "TOWN_WHOLE"].copy()
    check("town part keys unique", not tw.duplicated(K).any(), 0, int(tw.duplicated(K).sum()))
    parts = tw.groupby("town").agg(n_parts=("subdistt", "size"), n_districts=("district", "nunique"))
    multi = parts[parts.n_parts > 1]
    check("towns with >1 part == towns with a C-01 whole-town row",
          set(multi.index) == set(whole.town), len(whole), len(multi),
          {"only_parts": sorted(set(multi.index) - set(whole.town)),
           "only_whole": sorted(set(whole.town) - set(multi.index))})
    # Print convention: a town spanning districts gets a STATE-level whole row (district 000);
    # one spanning sub-districts of one district gets a DISTRICT-level whole row (subdistt 00000).
    # Single known exception: the Delhi file prints Delhi Cantonment (CB, 800443) at state level
    # although both its parts lie in district 097 (South West).
    st_whole, md = set(whole[whole.district == "000"].town), set(parts[parts.n_districts > 1].index)
    check("every town spanning districts has a state-level whole-town row; only extra = Delhi Cantonment",
          md <= st_whole and st_whole - md == {"800443"}, f"{len(md)} + 800443", len(st_whole),
          {"state_level_but_one_district": sorted(st_whole - md)})
    check("whole-town row at district level <=> town spans sub-districts within one district (except 800443)",
          set(whole[whole.district != "000"].town) == set(multi[multi.n_districts == 1].index) - {"800443"},
          int(((multi.n_districts == 1)).sum()) - 1, int((whole.district != "000").sum()))
    # a whole-town row's district (when not 000) must be the district of all its parts
    wd = whole[whole.district != "000"].set_index("town").district
    pdist = tw[tw.town.isin(wd.index)].groupby("town").district.agg(lambda s: set(s))
    check("district-level whole-town rows sit in their parts' district",
          all(pdist[t] == {wd[t]} for t in wd.index))
    psum = tw.groupby("town")[CATS].sum()
    diff = (psum.loc[whole.town].to_numpy() - whole[CATS].to_numpy())
    check(f"sum of parts = C-01 whole-town row for all {len(whole)} multi-part towns (9 categories)",
          abs(diff).max() == 0, 0, int(abs(diff).max()))
    for code, label in (("802794", "Greater Mumbai"), ("801638", "Siliguri"), ("800441", "DMC (U) Delhi"),
                        ("800013", "Srinagar"), ("802918", "GHMC Hyderabad")):
        p = tw[tw.town == code]
        w = whole[whole.town == code]
        check(f"{label} ({code}): parts across districts {sorted(p.district.unique())} sum to whole row",
              len(w) == 1 and (p[CATS].sum().to_numpy() == w[CATS].iloc[0].to_numpy()).all(),
              int(w.total.iloc[0]) if len(w) else None, int(p.total.sum()))
    # Names are NOT a reliable split marker; codes are. Manipur writes "(Major part)"/"(Minor part)",
    # and a few single-part CTs are named "X (Part) (CT)" because they were carved from part of village X.
    nm_part = tw.area_name_raw.str.contains(PART_RE.pattern.replace("$", ""), case=False, regex=True)
    is_multi = tw.town.isin(multi.index)
    check("every part row of a multi-part town carries a part marker ((Part)/(Major part)/(Minor part))",
          nm_part[is_multi].all(), int(is_multi.sum()), int(nm_part[is_multi].sum()))
    check("single-part towns whose NAME says '(Part)' (CTs carved from part of a village; not splits)",
          True, None, int((nm_part & ~is_multi).sum()),
          tw.loc[nm_part & ~is_multi, K + ["area_name_raw"]].to_dict("records"))

    sdu = sd[sd.tru == "Urban"].set_index(["state", "district", "subdistt"])[CATS].sort_index()
    tws = tw.groupby(["state", "district", "subdistt"])[CATS].sum()
    tws = tws.reindex(sdu.index, fill_value=0)
    diff = (tws - sdu).abs()
    bad = diff[diff.max(axis=1) > 0]
    check("town parts in each sub-district sum to the sub-district Urban row (5,988 x 9)",
          len(bad) == 0, 0, len(bad), bad.head(10).reset_index().to_dict("records"))
    du = dist.xs("Urban", level="tru")
    twd = tw.groupby(["state", "district"])[CATS].sum().reindex(du.index, fill_value=0)
    diff = (twd - du).abs()
    check("towns in each district sum to the district Urban row (640 x 9)",
          diff.to_numpy().max() == 0, 0, int(diff.to_numpy().max()))
    zero_urban = sdu[sdu.total == 0]
    check("sub-districts with zero urban population have no town rows",
          not tws.loc[zero_urban.index].total.gt(0).any())

    allrows = pd.concat([sd, tw])
    diff = (allrows[RELIGIONS].sum(axis=1) - allrows.total).abs()
    check("religions sum to total on every unit row", diff.max() == 0, 0, int(diff.max()))
    check("no negative counts", (allrows[CATS] >= 0).all().all())

    # ---------------- India totals ----------------
    irow = india[(india.state == "00") & (india.tru == "Total")].iloc[0]
    for tr, ref in (("Total", REF["india_total"]), ("Rural", REF["india_rural"]), ("Urban", REF["india_urban"])):
        g = int(sd[sd.tru == tr].total.sum())
        check(f"India {tr} population = sum of sub-districts", g == ref, ref, g)
    g = int(tw.total.sum())
    check("India urban population = sum of town parts", g == REF["india_urban"], REF["india_urban"], g)
    for c in CATS:
        a, b = int(sd[sd.tru == "Total"][c].sum()), int(irow[c])
        check(f"India {c}: sum of sub-districts = DDW00C-01 India row", a == b, b, a)
        ir = india[(india.state == "00") & (india.tru == "Urban")].iloc[0]
        a, b = int(tw[c].sum()), int(ir[c])
        check(f"India urban {c}: sum of town parts = DDW00C-01 India Urban row", a == b, b, a)

    # cross-check with the existing district tidy file
    dt = pd.read_csv(os.path.join(REL, "religion_district_2011.csv"), dtype={"state_code": str, "district_code": str})
    dt = dt.rename(columns={"state_code": "state", "district_code": "district"}).set_index(
        ["state", "district", "tru"])[CATS].sort_index()
    check("sum of sub-districts = religion_district_2011.csv (1,920 rows x 9)",
          sds.index.equals(dt.index) and (sds - dt).abs().to_numpy().max() == 0)

    # ---------------- assemble outputs ----------------
    span = parts.apply(lambda r: "multi_district" if r.n_districts > 1 else
                       ("multi_subdistrict" if r.n_parts > 1 else "single"), axis=1)
    sd_out = sd.assign(town_name="", level="SUBDISTRICT", town_span="", town_n_parts=0, is_ct=False)
    tw_out = tw.assign(level="TOWN", town_name=[town_name(s, m) for s, m in zip(tw.area_name_raw, is_multi)],
                       town_span=tw.town.map(span), town_n_parts=tw.town.map(parts.n_parts),
                       is_ct=tw.area_name_raw.str.contains(r"\(CT\)"))
    tw_out["subdistt_name"] = [sdn.get((a, b, c), "") for a, b, c in zip(tw_out.state, tw_out.district, tw_out.subdistt)]
    units = pd.concat([sd_out, tw_out], ignore_index=True)
    units["state_name"] = units.state.map(stn)
    units["district_name"] = units.district.map(dn)
    units["area_name_raw"] = units.area_name_raw.str.strip()
    units["source_file"] = units.source_file.str.replace("raw_nada/", "religion/raw_nada/", regex=False)
    units["town_n_parts"] = units.town_n_parts.astype("int16")
    order = {"Total": 0, "Rural": 1, "Urban": 2}
    units = units.assign(_l=(units.level == "TOWN").astype(int), _t=units.tru.map(order)).sort_values(
        ["state", "district", "subdistt", "_l", "town", "_t"]).drop(columns=["_l", "_t"])
    cols = ["state", "state_name", "district", "district_name", "subdistt", "subdistt_name", "town",
            "town_name", "level", "tru", "is_ct", "town_span", "town_n_parts", *CATS, "area_name_raw",
            "source_file"]
    units = units[cols].reset_index(drop=True)
    key = ["state", "district", "subdistt", "town", "tru"]
    check("religion_units: (state, district, subdistt, town, tru) unique", not units.duplicated(key).any(),
          0, int(units.duplicated(key).sum()))
    check("religion_units rows = 3 x sub-districts + town parts", len(units) == 3 * n_sd + len(tw),
          3 * n_sd + len(tw), len(units))

    # one row per town code: sum of parts; for multi-part towns equals C-01's own whole-town row
    tw_whole = tw_out.groupby("town").agg(
        state=("state", "first"), state_name=("state", lambda s: stn[s.iloc[0]]),
        town_name=("town_name", "first"), is_ct=("is_ct", "first"),
        town_span=("town_span", "first"), town_n_parts=("town_n_parts", "first"),
        districts=("district", lambda s: ",".join(sorted(set(s)))),
        subdistts=("subdistt", lambda s: ",".join(f"{d}/{x}" for d, x in sorted(
            set(zip(tw_out.loc[s.index, "district"], s)))))).join(psum)
    tw_whole.insert(0, "town_code", tw_whole.index)
    tw_whole = tw_whole.reset_index(drop=True)
    wn = whole.set_index("town").area_name_raw.map(lambda s: re.sub(r"\s+", " ", s).strip())
    tw_whole["c01_whole_row_name"] = tw_whole.town_code.map(wn).fillna("")
    # for split towns prefer C-01's own whole-town name (part names can disagree, e.g. Samurou NP)
    tw_whole["town_name"] = tw_whole.c01_whole_row_name.where(tw_whole.c01_whole_row_name != "",
                                                              tw_whole.town_name)
    check("town codes unique within India (one state each)", tw.groupby("town").state.nunique().max() == 1)

    # ---------------- PCA cross-checks (official PCA files, if available) ----------------
    pca_note = {}
    if os.path.exists(PCA_TOWN_XLSX):
        p = pd.read_excel(PCA_TOWN_XLSX, sheet_name="Data", dtype=str,
                          usecols=["State", "District", "Subdistt", "Town/Village", "Level", "Name", "TRU", "TOT_P"])
        p = p.rename(columns={"State": "state", "District": "district", "Subdistt": "subdistt",
                              "Town/Village": "town", "TRU": "tru"})
        p["TOT_P"] = p.TOT_P.astype("int64")
        ps = p[p.Level == "SUB-DISTRICT"].set_index(["state", "district", "subdistt", "tru"]).TOT_P.sort_index()
        cs = sd.set_index(["state", "district", "subdistt", "tru"]).total.sort_index()
        check("PCA sub-district keys (x T/R/U) == C-01 sub-district keys", ps.index.equals(cs.index), len(ps), len(cs))
        dd = (cs - ps)
        mism = dd[dd != 0].reset_index().rename(columns={0: "c01_minus_pca"})
        if len(mism):
            mism["name"] = [sdn[(a, b, c)] for a, b, c in zip(mism.state, mism.district, mism.subdistt)]
            mism["district_name"] = mism.district.map(dn)
        pr = ps.xs("Rural", level="tru")
        check("every sub-district with PCA rural population has a C-01 Rural row with population",
              bool((cs.xs("Rural", level="tru")[pr > 0] > 0).all()), int((pr > 0).sum()),
              int((cs.xs("Rural", level="tru")[pr > 0] > 0).sum()))
        known = {("135", "00717"), ("135", "00718"), ("179", "00915"), ("179", "00916")}
        offset = mism.groupby(["district", "tru"]).c01_minus_pca.sum() if len(mism) else pd.Series(dtype=int)
        check("sub-district population C-01 = PCA (T/R/U) except 4 known UP sub-districts, offsetting within district",
              set(zip(mism.district, mism.subdistt)) <= known and set(mism.tru) <= {"Total", "Rural"}
              and (offset == 0).all(), 0, len(mism),
              {"note": "Two Uttar Pradesh sub-district pairs: C-01 and PCA place a few villages in "
                       "different sub-districts of the same district (offsetting; district totals "
                       "identical). Urban rows match everywhere.",
               "rows": mism.to_dict("records")})
        pdist = p[p.Level == "DISTRICT"].set_index(["state", "district", "tru"]).TOT_P.sort_index()
        check("district population C-01 = PCA (640 x T/R/U)", pdist.equals(dist.total.rename("TOT_P")),
              0, int((dist.total - pdist).abs().max()))
        # PCA prints statutory towns twice ('X (M + OG)' and core 'X (M)'); the +OG row is the unit
        pt = p[p.Level == "TOWN"].sort_values("TOT_P", ascending=False)
        n_dup = int(pt.duplicated(K).sum())
        pt = pt.drop_duplicates(K)
        m = pt.merge(tw[K + ["total"]], on=K, how="outer", indicator=True)
        check("every PCA town key (state, district, subdistt, town) has a C-01 town row, and vice versa",
              (m._merge == "both").all(), len(pt), int((m._merge == "both").sum()),
              {"pca_only": m[m._merge == "left_only"][K].to_dict("records")[:20],
               "c01_only": m[m._merge == "right_only"][K].to_dict("records")[:20],
               "pca_core_duplicates_dropped": n_dup})
        b = m[m._merge == "both"]
        check("town population C-01 = PCA (+OG unit) for every town part", (b.TOT_P == b.total).all(), 0,
              int((b.TOT_P != b.total).sum()))
        pca_note["town_file"] = PCA_TOWN_XLSX
    else:  # optional: the C-01 checks above stand alone; record that the PCA cross-checks did not run
        pca_note["skipped"] = f"PCA town file not found at {PCA_TOWN_XLSX}; set CENSUS_PCA_DIR to re-run cross-checks"
        print("NOTE PCA cross-checks skipped:", pca_note["skipped"])
    if os.path.exists(PCA_WARD_PQ):
        w = pd.read_parquet(PCA_WARD_PQ, columns=["State", "District", "Subdistt", "Town/Village", "Level", "TOT_P"])
        w = w[w.Level == "WARD"].rename(columns={"State": "state", "District": "district", "Subdistt": "subdistt",
                                                 "Town/Village": "town"})
        w["TOT_P"] = w.TOT_P.astype("int64")
        ws = w.groupby(K).TOT_P.sum()
        t = tw.set_index(K).total
        check("every PCA ward's town part has a C-01 town row", ws.index.isin(t.index).all(), len(ws),
              int(ws.index.isin(t.index).sum()))
        check("PCA wards sum to the C-01 town-part total (all parts)",
              t.index.isin(ws.index).all() and (ws.reindex(t.index) == t).all(), len(t),
              int((ws.reindex(t.index) == t).sum()))
        pca_note["ward_rows"] = int(len(w))
    if os.path.exists(PCA_VILL_PQ):
        v = pd.read_parquet(PCA_VILL_PQ, columns=["State", "District", "Subdistt", "Level", "TOT_P"])
        v = v[v.Level == "VILLAGE"]
        v["TOT_P"] = v.TOT_P.astype("int64")
        vk = v.groupby(["State", "District", "Subdistt"]).TOT_P.sum()
        rr = sd[sd.tru == "Rural"].set_index(["state", "district", "subdistt"]).total
        vk.index.names = rr.index.names
        has = vk.index.isin(rr[rr > 0].index)
        pop = vk > 0  # uninhabited villages (TOT_P 0) also sit in fully urban sub-districts
        check("every populated PCA village's sub-district has a C-01 Rural row with population",
              has[pop.to_numpy()].all(), int(pop.sum()), int(has[pop.to_numpy()].sum()),
              {"subdistricts_with_only_uninhabited_villages": vk[~has].reset_index().to_dict("records")})
        dv = (rr.reindex(vk.index) - vk)
        check("PCA village sums = C-01 sub-district Rural (same 4 UP exceptions as above)",
              int((dv != 0).sum()) <= 4, 0, int((dv != 0).sum()),
              dv[dv != 0].reset_index().rename(columns={0: "c01_minus_villages"}).to_dict("records"))
        pca_note["village_rows"] = int(len(v))

    # ---------------- write ----------------
    units.to_parquet(os.path.join(HERE, "religion_units.parquet"), index=False)
    tw_whole.to_parquet(os.path.join(HERE, "religion_town_whole.parquet"), index=False)
    report = {
        "rows_written": {"religion_units.parquet": len(units),
                         "religion_units.parquet SUBDISTRICT": int((units.level == "SUBDISTRICT").sum()),
                         "religion_units.parquet TOWN": int((units.level == "TOWN").sum()),
                         "religion_town_whole.parquet": len(tw_whole)},
        "c01_level_counts": {f"{a}/{b}": int(n) for (a, b), n in lv.items()},
        "pca_crosscheck_inputs": pca_note,
        "all_ok": all(c["ok"] for c in checks),
        "checks": checks,
    }
    with open(os.path.join(HERE, "validation_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, default=str)
    for c in checks:
        print("OK  " if c["ok"] else "FAIL", c["check"], "|", c["expected"], "|", c["got"])
    print("ALL OK" if report["all_ok"] else "SOME CHECKS FAILED", report["rows_written"])


if __name__ == "__main__":
    main()
