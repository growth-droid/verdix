"""
Build Census-2011 boundary GeoJSONs for Verdix from the raw files in this folder.

Inputs (all downloaded by plain HTTP GET; see SOURCES.json for URLs + licences):
  datameet_2011_dist/2011_Dist.{shp,shx,dbf,prj}          datameet/maps, CC BY 2.5 IN
  subdistricts/SubDistricts_2011.parquet                   ramSeraph/indian_admin_boundaries (mirror of
                                                           NIC BharatMaps layer), CC0 by the mirror author
  subdistricts/2011-IndiaStateDistSbDist-0000.xlsx         Census of India (ORGI) official PCA sub-district list
  ../pca/DDW_PCA0000_2011_Indiastatedist.xlsx (optional)   Census of India official PCA district list (read only)
  optional QA reference: a BharatMaps-derived Districts_2011.parquet (path via env BHARATMAPS_DIST_PARQUET)

Outputs:
  districts_2011.geojson            640 census districts + 1 'no census data' polygon, EPSG:4326
  districts_2011_qa.csv             per-district code/name checks (+ IoU, largest-overlap code and a
                                    geometry_flag ok/check/unreliable vs the BharatMaps mirror if supplied)
  subdistricts/subdistricts_2011.geojson   one feature per 2011 sub-district code, EPSG:4326
  subdistricts/subdistricts_2011_match.csv official PCA sub-district rows vs polygon availability

Run:  python build_boundaries.py      (needs pyshp, shapely>=2.1 w/ GEOS>=3.12, pandas, openpyxl, pyarrow)
"""
import json, os, re, sys, difflib
import numpy as np
import pandas as pd
import shapefile
import shapely
from shapely.geometry import shape, mapping
from shapely import wkb

HERE = os.path.dirname(os.path.abspath(__file__))
PCA_DIST = os.path.join(HERE, "..", "pca", "DDW_PCA0000_2011_Indiastatedist.xlsx")
SUB_XLSX = os.path.join(HERE, "subdistricts", "2011-IndiaStateDistSbDist-0000.xlsx")
SUB_PARQ = os.path.join(HERE, "subdistricts", "SubDistricts_2011.parquet")
BM_DIST = os.environ.get("BHARATMAPS_DIST_PARQUET")  # optional QA only
DIST_TOL = 0.001    # coverage-preserving simplification tolerance, degrees
SUB_TOL = 0.0025    # per-polygon simplification tolerance for sub-districts, degrees
PREC = 5            # decimal places in output coordinates (~1 m)


def polygonal(g):
    """make_valid and keep only polygon parts."""
    if g.is_valid:
        return g
    g = shapely.make_valid(g)
    parts = [p for p in getattr(g, "geoms", [g]) if p.geom_type in ("Polygon", "MultiPolygon")]
    return shapely.union_all(parts)


def dump(features, path):
    fc = {"type": "FeatureCollection",
          "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
          "features": features}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(path)


def feat(geom, props):
    g = shapely.set_precision(geom, 10 ** -PREC)  # rounds + keeps validity
    return {"type": "Feature", "properties": props, "geometry": mapping(g)}


def norm(s):
    return re.sub(r"[^a-z]", "", str(s).lower())


# ---------------------------------------------------------------- districts
def build_districts():
    r = shapefile.Reader(os.path.join(HERE, "datameet_2011_dist", "2011_Dist"), encoding="latin-1")
    recs = [x.as_dict() for x in r.records()]
    geoms = np.array([polygonal(shape(s.__geo_interface__)) for s in r.shapes()])
    simp = shapely.coverage_simplify(geoms, DIST_TOL, simplify_boundary=True)

    pca = None
    if os.path.exists(PCA_DIST):
        p = pd.read_excel(PCA_DIST, sheet_name="Sheet1")
        st = p[(p.Level == "STATE") & (p.TRU == "Total")].set_index("State").Name.to_dict()
        d = p[(p.Level == "DISTRICT") & (p.TRU == "Total")]
        pca = {int(c): (n, st.get(s), int(tp)) for c, n, s, tp in zip(d.District, d.Name, d.State, d.TOT_P)}

    iou, gq = {}, {}
    if BM_DIST and os.path.exists(BM_DIST):
        import pyarrow.parquet as pq
        t = pq.read_table(BM_DIST, columns=["dtcode11", "geometry"]).to_pandas()
        bm = {}
        for c, g in zip(t.dtcode11, t.geometry):
            if c and c.strip().isdigit():
                c, g = int(c), polygonal(wkb.loads(g))
                bm[c] = g if c not in bm else bm[c].union(g)
        bm_codes = np.array(list(bm))
        bm_geoms = np.array([bm[c] for c in bm_codes])
        tree = shapely.STRtree(bm_geoms)
        for rec, g in zip(recs, geoms):
            c = rec["censuscode"]
            if c not in bm:
                continue
            u = g.union(bm[c]).area
            inter = g.intersection(bm[c]).area
            iou[c] = round(inter / u, 4) if u else 0.0
            # Which NIC/BharatMaps district does this datameet polygon mostly fall in? A different code
            # = a mislabelled / mis-drawn polygon (found: Imphal West, Imphal East, Srinagar).
            ov = {int(bm_codes[i]): g.intersection(bm_geoms[i]).area for i in tree.query(g, predicate="intersects")}
            best = max(ov, key=ov.get) if ov else None
            flag = ("unreliable" if (best != c or iou[c] < 0.5) else "check" if iou[c] < 0.8 else "ok")
            gq[c] = {"share_inside_same_code_bharatmaps": round(inter / g.area, 4) if g.area else None,
                     "share_of_bharatmaps_covered": round(inter / bm[c].area, 4) if bm[c].area else None,
                     "largest_overlap_bharatmaps_code": best,
                     "geometry_flag": flag}

    feats, qa = [], []
    for rec, g0, g in zip(recs, geoms, simp):
        code = int(rec["censuscode"])
        has = code != 0
        props = {
            "censuscode": code if has else None,
            "district_code": f"{code:03d}" if has else None,          # = PCA 'District' column, zero-padded
            "district": rec["DISTRICT"].strip(),
            "state_code": f"{int(rec['ST_CEN_CD']):02d}" if has else None,  # = PCA 'State' column
            "st_cen_cd": int(rec["ST_CEN_CD"]) if has else None,
            "dt_cen_cd": int(rec["DT_CEN_CD"]) if has else None,   # district serial within state
            "state": rec["ST_NM"].strip(),
            "census_2011": has,
        }
        if pca and has:
            n, sn, tp = pca[code]
            props["pca_name"] = n
            props["pca_state"] = sn
        if not has:
            props["note"] = ("No Census 2011 enumeration (area administered by Pakistan/China; datameet label "
                             "'Data Not Available'). Keep for the national outline, exclude from joins.")
        feats.append(feat(g, props))
        row = dict(props)
        row["area_km2_approx"] = round(g0.area * 111.32 ** 2 * np.cos(np.radians(g0.centroid.y)), 1)
        row["pca_tot_p"] = pca[code][2] if (pca and has) else None
        row["name_similarity_vs_pca"] = (round(difflib.SequenceMatcher(None, norm(rec["DISTRICT"]), norm(pca[code][0])).ratio(), 3)
                                         if (pca and has) else None)
        row["iou_vs_bharatmaps"] = iou.get(code)
        row.update(gq.get(code, {}))
        row["valid_in_source"] = bool(shape(r.shape(len(qa)).__geo_interface__).is_valid)
        qa.append(row)
    size = dump(feats, os.path.join(HERE, "districts_2011.geojson"))
    # convert_dtypes: integer codes stay integers (532, not 532.0) even with the one null row
    pd.DataFrame(qa).drop(columns=["note"], errors="ignore").convert_dtypes().to_csv(
        os.path.join(HERE, "districts_2011_qa.csv"), index=False)
    if gq:
        print("geometry_flag vs BharatMaps:", pd.Series([v["geometry_flag"] for v in gq.values()]).value_counts().to_dict())
    print(f"districts_2011.geojson: {len(feats)} features, {size/1e6:.2f} MB, "
          f"{int(sum(shapely.get_num_coordinates(simp)))} coords (from {int(sum(shapely.get_num_coordinates(geoms)))})")


# ------------------------------------------------------------- subdistricts
def build_subdistricts():
    import pyarrow.parquet as pq
    x = pd.read_excel(SUB_XLSX, sheet_name="Data", dtype={"State": str, "District": str, "Subdistt": str})
    sd = x[(x.TRU == "Total") & (x.Level == "SUB-DISTRICT")][["State", "District", "Subdistt", "Name", "TOT_P"]]
    real = sd[sd.Subdistt != "99999"]
    by_code = real.groupby("Subdistt").agg(state=("State", "first"), districts=("District", lambda s: sorted(set(s))),
                                           name=("Name", "first"), tot_p=("TOT_P", "sum")).to_dict("index")
    rem = sd[sd.Subdistt == "99999"]  # 'Area not under any Sub-district' remainders, keyed by district
    rem_by_pop = {int(tp): (s, d, n) for s, d, n, tp in zip(rem.State, rem.District, rem.Name, rem.TOT_P)}

    t = pq.read_table(SUB_PARQ).to_pandas()
    t = t[t.sdtcode11.str.strip() != ""].copy()
    t["g"] = [polygonal(wkb.loads(b)) for b in t.geometry]

    # --- inferred fix for miscoded parts -------------------------------------------------------
    # The source sometimes stamps a neighbour's code on a whole sub-district polygon (e.g. the
    # Aligarh-district part coded 00749 'Debai', whose only official district is Bulandshahr),
    # while the true sub-district of that district (00754 Atrauli) has no polygon at all.
    # Reassign a part ONLY when: its district is a 2011 code outside its code's official district,
    # the code keeps another part inside its official district, the part is >= 50 km2, and exactly
    # ONE official sub-district of that district has no polygon. Flagged in the output.
    t["pub_code"] = t.sdtcode11
    present = set(t.sdtcode11)
    missing = real[~real.Subdistt.isin(present)]
    miss_by_d = missing.groupby("District").Subdistt.apply(list).to_dict()
    for i, r in t.iterrows():
        s, d = r.sdtcode11, r.dtcode11
        if s not in by_code or not d.isdigit() or int(d) > 640:
            continue
        off = by_code[s]["districts"]
        if d in off or len(off) != 1 or r.POLY_AREA < 50:
            continue
        if not ((t.sdtcode11 == s) & (t.dtcode11.isin(off))).any():
            continue
        cand = miss_by_d.get(d, [])
        if len(cand) == 1:
            t.at[i, "sdtcode11"] = cand[0]

    feats, seen = [], set()
    for code, grp in t.groupby("sdtcode11", sort=True):
        g = shapely.union_all(grp.g.values) if len(grp) > 1 else grp.g.iloc[0]
        g = polygonal(g).simplify(SUB_TOL, preserve_topology=True)
        src_name = grp.sdtname.iloc[0]
        src_pop = int(grp.Tot_pop.iloc[0])
        props = {"subdistrict_code": code, "src_name": src_name, "src_state_code_current": grp.stcode11.iloc[0],
                 "src_district_codes_current": sorted(set(grp.dtcode11)), "src_parts": int(len(grp))}
        if code in by_code:
            o = by_code[code]
            props.update({"state_code": o["state"], "district_codes_2011": o["districts"], "pca_name": o["name"],
                          "pca_tot_p": int(o["tot_p"]), "status": "matched" if len(o["districts"]) == 1 else "matched_multi_district"})
            if (grp.pub_code != code).all():
                props["status"] = "matched_inferred_from_miscoded_part"
                props["src_code_as_published"] = grp.pub_code.iloc[0]
                props["src_name"] = f"{src_name} (published under code {grp.pub_code.iloc[0]})"
            seen.add(code)
        elif src_pop in rem_by_pop and src_pop > 0:
            s, d, n = rem_by_pop[src_pop]
            props.update({"state_code": s, "district_codes_2011": [d], "pca_name": n, "pca_tot_p": src_pop,
                          "status": "matched_99999_remainder"})
            seen.add(("99999", d))
        else:
            props.update({"state_code": None, "district_codes_2011": [], "pca_name": None, "pca_tot_p": None,
                          "status": "not_in_census_2011_list"})
        feats.append(feat(g, props))
    size = dump(feats, os.path.join(HERE, "subdistricts", "subdistricts_2011.geojson"))
    m = sd.copy()
    m["has_polygon"] = [(c in seen) if c != "99999" else (("99999", d) in seen) for c, d in zip(m.Subdistt, m.District)]
    m.to_csv(os.path.join(HERE, "subdistricts", "subdistricts_2011_match.csv"), index=False)
    miss = m[~m.has_polygon]
    print(f"subdistricts_2011.geojson: {len(feats)} features, {size/1e6:.2f} MB; "
          f"PCA rows without polygon: {len(miss)} (pop {int(miss.TOT_P.sum()):,}); "
          f"statuses: {pd.Series([f['properties']['status'] for f in feats]).value_counts().to_dict()}")


if __name__ == "__main__":
    which = sys.argv[1:] or ["districts", "subdistricts"]
    if "districts" in which:
        build_districts()
    if "subdistricts" in which:
        build_subdistricts()
