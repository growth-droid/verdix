"""Build tidy district-level Census 2011 Houselisting & Housing (HLO) amenity/asset table.

Inputs  : raw/DDW-HH*.xls  (official ORGI HL-series tables, downloaded unmodified from the
          censusindia.gov.in NADA catalogue; see SOURCES.csv for exact URLs + sha256)
Outputs : hlo_district_2011.csv         -- % of households, district x Total/Rural/Urban (640 x 3 rows)
          hlo_district_2011_counts.csv  -- the underlying household counts (numerators), same keys
          hlo_state_india_2011.csv      -- same % columns for India + 35 States/UTs (as published)
          hlo_validation.csv            -- checks (India published figures, sum-of-districts, R+U=T,
                                           cross-table household totals)

Tables used (NADA idno -> file stem):
  HL-01 -> DDW-HH0101  condition of census house (households)
  HL-06 -> DDW-HH2206  main source of drinking water x location
  HL-07 -> DDW-HH2507  main source of lighting
  HL-08 -> DDW-HH2808  type of latrine facility
  HL-10 -> DDW-HH3410  separate kitchen x type of cooking fuel
  HL-12 -> DDW-HH4012  banking services and assets
All universes: households excluding institutional households.

Run: python build_hlo_district.py   (needs xlrd, pandas)
"""
import glob
import os

import pandas as pd
import xlrd

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")

# 0-based column positions of the value fields in each table (verified identical in all 36 files)
TABLES = {
    "HH0101": {"has_cat": False, "cols": {"total": 7, "house_good": 8, "house_livable": 9, "house_dilapidated": 10}},
    "HH2206": {"has_cat": True, "cols": {"total": 8, "tap_treated": 9, "tap_untreated": 10, "covered_well": 11,
                                          "uncovered_well": 12, "handpump": 13, "tubewell": 14, "spring": 15,
                                          "river_canal": 16, "tank_pond": 17, "water_other": 18}},
    "HH2507": {"has_cat": False, "cols": {"total": 7, "light_electricity": 8, "light_kerosene": 9, "light_solar": 10,
                                           "light_other_oil": 11, "light_any_other": 12, "light_none": 13}},
    "HH2808": {"has_cat": False, "cols": {"total": 7, "latrine_within": 8, "flush_piped_sewer": 9, "flush_septic": 10,
                                           "flush_other": 11, "pit_slab": 12, "pit_open": 13, "nightsoil_drain": 14,
                                           "service_human": 15, "service_animal": 16, "latrine_none_within": 17,
                                           "public_latrine": 18, "open_defecation": 19}},
    "HH3410": {"has_cat": True, "cols": {"total": 8, "fuel_firewood": 9, "fuel_crop_residue": 10, "fuel_cowdung": 11,
                                          "fuel_coal": 12, "fuel_kerosene": 13, "fuel_lpg_png": 14, "fuel_electricity": 15,
                                          "fuel_biogas": 16, "fuel_any_other": 17, "fuel_no_cooking": 18}},
    "HH4012": {"has_cat": False, "cols": {"total": 7, "banking": 8, "radio": 9, "tv": 10, "computer_internet": 11,
                                           "computer_no_internet": 12, "phone_landline_only": 13, "phone_mobile_only": 14,
                                           "phone_both": 15, "bicycle": 16, "two_wheeler": 17, "car_jeep_van": 18,
                                           "tv_computer_phone_all": 19, "no_assets": 20}},
}


def code(v, width):
    if isinstance(v, float):
        v = str(int(v))
    return str(v).strip().zfill(width)


def read_table(stem):
    spec = TABLES[stem]
    recs = []
    for f in sorted(glob.glob(os.path.join(RAW, f"DDW-{stem}-*.xls"))):
        sh = xlrd.open_workbook(f, ignore_workbook_corruption=True).sheet_by_index(0)
        for i in range(sh.nrows):
            r = sh.row_values(i)
            if str(r[0]).strip() != stem:
                continue
            st, di, te, tw = code(r[1], 2), code(r[2], 3), code(r[3], 5), code(r[4], 6)
            if te != "00000" or tw != "000000":
                continue  # skip sub-district / town rows
            if spec["has_cat"] and str(r[7]).strip() not in ("Total",):
                continue  # keep only the 'Total' location / kitchen category
            level = "india" if st == "00" else ("state" if di == "000" else "district")
            if level == "india" and not f.endswith("-0000.xls"):
                continue
            if level == "state" and f.endswith("-0000.xls"):
                continue  # use state rows from each state's own file (identical; checked separately)
            rec = {"level": level, "state_code": st, "district_code": di, "area_name": str(r[5]).strip(),
                   "tru": str(r[6]).strip(), "src_file": os.path.basename(f)}
            for k, j in spec["cols"].items():
                rec[k] = int(round(float(r[j])))
            recs.append(rec)
    df = pd.DataFrame(recs)
    key = ["level", "state_code", "district_code", "tru"]
    assert not df.duplicated(key).any(), f"duplicate keys in {stem}"
    return df


def main():
    key = ["level", "state_code", "district_code", "tru"]
    frames = {s: read_table(s) for s in TABLES}
    base = frames["HH2507"][key + ["area_name"]].copy()
    counts = base.copy()
    hh_totals = {}
    for s, df in frames.items():
        hh_totals[s] = df.set_index(key)["total"]
        cols = [c for c in TABLES[s]["cols"] if c != "total"]
        counts = counts.merge(df[key + cols], on=key, how="left", validate="1:1")
    counts["total_households"] = frames["HH2507"].set_index(key).loc[
        list(map(tuple, counts[key].values)), "total"].values

    # names
    st_names = (counts[counts.level == "state"].drop_duplicates("state_code")
                .set_index("state_code")["area_name"].str.replace(r"^STATE\s*-\s*", "", regex=True).str.strip())
    counts["state_name"] = counts["state_code"].map(st_names)
    counts.loc[counts.level == "india", "state_name"] = "INDIA"
    counts["district_name"] = counts["area_name"].where(counts.level == "district", "")
    counts["district_name"] = (counts["district_name"].str.replace(r"^District\s*-\s*", "", regex=True).str.strip()
                               .str.replace(r"\s+", " ", regex=True))  # 'North  District' -> 'North District'

    # derived numerators
    c = counts
    c["tap_water"] = c.tap_treated + c.tap_untreated
    c["phone_any"] = c.phone_landline_only + c.phone_mobile_only + c.phone_both
    c["mobile_any"] = c.phone_mobile_only + c.phone_both
    c["computer_any"] = c.computer_internet + c.computer_no_internet

    # within-premises drinking water (HL-06 location row) -- separate pass
    wp = []
    for f in sorted(glob.glob(os.path.join(RAW, "DDW-HH2206-*.xls"))):
        sh = xlrd.open_workbook(f, ignore_workbook_corruption=True).sheet_by_index(0)
        for i in range(sh.nrows):
            r = sh.row_values(i)
            if str(r[0]).strip() != "HH2206" or str(r[7]).strip() != "Within the premises":
                continue
            st, di, te, tw = code(r[1], 2), code(r[2], 3), code(r[3], 5), code(r[4], 6)
            if te != "00000" or tw != "000000":
                continue
            level = "india" if st == "00" else ("state" if di == "000" else "district")
            if (level == "india") != f.endswith("-0000.xls"):
                continue
            wp.append({"level": level, "state_code": st, "district_code": di, "tru": str(r[6]).strip(),
                       "water_within_premises": int(round(float(r[8])))})
    c = c.merge(pd.DataFrame(wp), on=key, how="left", validate="1:1")

    pct_map = {
        "pct_electricity_lighting": "light_electricity",
        "pct_kerosene_lighting": "light_kerosene",
        "pct_lpg_png_cooking": "fuel_lpg_png",
        "pct_firewood_cooking": "fuel_firewood",
        "pct_latrine_within_premises": "latrine_within",
        "pct_open_defecation": "open_defecation",
        "pct_tap_water": "tap_water",
        "pct_tap_water_treated": "tap_treated",
        "pct_drinking_water_within_premises": "water_within_premises",
        "pct_banking_services": "banking",
        "pct_tv": "tv",
        "pct_telephone_any": "phone_any",
        "pct_mobile_any": "mobile_any",
        "pct_computer_laptop": "computer_any",
        "pct_computer_with_internet": "computer_internet",
        "pct_two_wheeler": "two_wheeler",
        "pct_car_jeep_van": "car_jeep_van",
        "pct_bicycle": "bicycle",
        "pct_radio": "radio",
        "pct_none_of_assets": "no_assets",
        "pct_house_good": "house_good",
        "pct_house_dilapidated": "house_dilapidated",
    }
    tru_order = {"Total": 0, "Rural": 1, "Urban": 2}
    c["_o"] = c.tru.map(tru_order)
    c = c.sort_values(["state_code", "district_code", "_o"]).drop(columns="_o")
    id_cols = ["state_code", "state_name", "district_code", "district_name", "tru", "total_households"]

    pct = c[["level"] + id_cols].copy()
    for p, n in pct_map.items():
        pct[p] = (100.0 * c[n] / c["total_households"]).where(c["total_households"] > 0).round(2)

    dist = pct[pct.level == "district"].drop(columns="level")
    dist.to_csv(os.path.join(HERE, "hlo_district_2011.csv"), index=False)
    pct[pct.level != "district"].drop(columns=["district_code", "district_name"]).rename(
        columns={"level": "level"}).to_csv(os.path.join(HERE, "hlo_state_india_2011.csv"), index=False)

    count_cols = ["light_electricity", "light_kerosene", "light_solar", "light_none", "fuel_lpg_png", "fuel_firewood",
                  "fuel_kerosene", "fuel_cowdung", "fuel_crop_residue", "latrine_within", "public_latrine",
                  "open_defecation", "tap_water", "tap_treated", "tap_untreated", "handpump", "tubewell",
                  "water_within_premises", "banking", "radio", "tv", "computer_any", "computer_internet",
                  "phone_any", "phone_landline_only", "phone_mobile_only", "phone_both", "mobile_any", "bicycle",
                  "two_wheeler", "car_jeep_van", "tv_computer_phone_all", "no_assets", "house_good",
                  "house_livable", "house_dilapidated"]
    cnt = c[c.level == "district"][id_cols + count_cols]
    cnt.to_csv(os.path.join(HERE, "hlo_district_2011_counts.csv"), index=False)

    # ---------------- validation ----------------
    V = []

    def chk(name, expected, got, ok):
        V.append({"check": name, "expected": expected, "got": got, "ok": bool(ok)})

    d = c[c.level == "district"]
    india = c[(c.level == "india")].set_index("tru")
    chk("district rows (Total)", 640, int((d.tru == "Total").sum()), (d.tru == "Total").sum() == 640)
    chk("district rows (Rural/Urban)", "640/640", f"{(d.tru=='Rural').sum()}/{(d.tru=='Urban').sum()}",
        (d.tru == "Rural").sum() == 640 and (d.tru == "Urban").sum() == 640)
    chk("unique district codes 001-640", "640", str(d.district_code.nunique()),
        sorted(d.district_code.unique()) == [f"{i:03d}" for i in range(1, 641)])
    # cross-table household totals
    for s in TABLES:
        diff = (hh_totals[s].reindex(pd.MultiIndex.from_frame(c[key])).values != c.total_households.values).sum()
        chk(f"{s} total households == HL-07 total households (all rows)", 0, int(diff), diff == 0)
    # sum of districts == India table, per TRU, every numerator
    num_cols = [x for x in count_cols] + ["total_households"]
    bad = []
    for t in ("Total", "Rural", "Urban"):
        s = d[d.tru == t][num_cols].sum()
        for col in num_cols:
            if int(s[col]) != int(india.loc[t, col]):
                bad.append(f"{t}:{col} {int(s[col])} vs {int(india.loc[t, col])}")
    chk("sum of 640 districts == India row, all count columns x T/R/U", "0 mismatches",
        f"{len(bad)} mismatches" + (": " + "; ".join(bad[:5]) if bad else ""), not bad)
    # sum of districts == state rows
    st = c[c.level == "state"].set_index(["state_code", "tru"])
    g = d.groupby(["state_code", "tru"])[num_cols].sum()
    nbad = int((g != st.loc[g.index, num_cols]).sum().sum())
    chk("sum of districts == each State/UT row, all count columns x T/R/U", "0 mismatches", f"{nbad} mismatches", nbad == 0)
    # Rural + Urban == Total at district level
    dd = d.set_index(["district_code", "tru"])[num_cols]
    ru = dd.xs("Rural", level=1) + dd.xs("Urban", level=1)
    nbad = int((ru != dd.xs("Total", level=1)).sum().sum())
    chk("district Rural + Urban == Total, all count columns", "0 mismatches", f"{nbad} mismatches", nbad == 0)
    # published India figures (Census 2011 HLO highlights)
    pub = {"pct_electricity_lighting": 67.2, "pct_lpg_png_cooking": 28.5, "pct_latrine_within_premises": 46.9,
           "pct_banking_services": 58.7, "pct_tv": 47.2, "pct_telephone_any": 63.2, "pct_none_of_assets": 17.8,
           "pct_tap_water": 43.5, "pct_computer_laptop": 9.5, "pct_two_wheeler": 21.0, "pct_car_jeep_van": 4.7}
    ip = pct[(pct.level == "india") & (pct.tru == "Total")].iloc[0]
    tot_hh = int(d[d.tru == "Total"].total_households.sum())
    chk("India households (sum of districts)", "246,740,228", f"{tot_hh:,}", tot_hh == 246740228)
    for k, v in pub.items():
        n = pct_map[k]
        got = 100.0 * d[d.tru == "Total"][n].sum() / tot_hh
        # ORGI highlights print 1 decimal (electricity 67.251% is printed as 67.2), so allow 0.06
        chk(f"India {k} (from districts) vs published", f"{v}", f"{got:.3f}", abs(got - v) <= 0.06)

    # independent ORGI product: HL-14 (HLPCA) district % files, 1-decimal, for a 15-district sample
    hl14 = {"pct_electricity_lighting": [84], "pct_lpg_png_cooking": [113], "pct_firewood_cooking": [108],
            "pct_latrine_within_premises": [90], "pct_open_defecation": [101], "pct_tap_water": [71, 72],
            "pct_drinking_water_within_premises": [81], "pct_banking_services": [126], "pct_tv": [128],
            "pct_telephone_any": [131, 132, 133], "pct_computer_laptop": [129, 130], "pct_two_wheeler": [135],
            "pct_car_jeep_van": [136], "pct_bicycle": [134], "pct_radio": [127], "pct_none_of_assets": [138],
            "pct_house_good": [11], "pct_house_dilapidated": [13]}
    import openpyxl
    dk = dist.set_index(["district_code", "tru"])
    ncmp, worst, nfiles = 0, (0.0, ""), 0
    for f in sorted(glob.glob(os.path.join(RAW, "hl14_sample", "*.xlsx"))):
        nfiles += 1
        ws = openpyxl.load_workbook(f, read_only=True, data_only=True).active
        for row in ws.iter_rows(min_row=8, values_only=True):
            if row[0] is None or str(row[4]).strip() != "00000" or str(row[6]).strip() != "000000":
                continue
            k2 = (str(row[2]).strip().zfill(3), str(row[9]).strip())
            for k, cols in hl14.items():
                v = sum(float(row[j]) for j in cols)
                diff = abs(v - dk.loc[k2, k])
                ncmp += 1
                if diff > worst[0]:
                    worst = (diff, f"{k2[0]} {k2[1]} {k}: HL-14 {v:.1f} vs ours {dk.loc[k2, k]:.2f}")
    chk(f"HL-14 (HLPCA) district % vs ours, {nfiles} sample districts, {ncmp} values; tolerance = 1-dec rounding "
        f"(0.05 per summed component)", "max diff <= 0.15", f"max diff {worst[0]:.2f} ({worst[1]})",
        nfiles > 0 and worst[0] <= 0.15 + 1e-9)
    pd.DataFrame(V).to_csv(os.path.join(HERE, "hlo_validation.csv"), index=False)
    for r in V:
        print(("OK  " if r["ok"] else "FAIL"), r["check"], "| expected", r["expected"], "| got", r["got"])


if __name__ == "__main__":
    main()
