#!/usr/bin/env python3
"""Place every constituency polygon in its Census 2011 district(s) — the geometric half of the census build.

Output: tools/sources/census2011/seat_district_overlay.csv, COMMITTED, so build_census.py never needs the
heavy geometry (and gives identical results on a machine without it). Re-run only if a boundary file changes.

  layer,geo_state,seat_no,seat_name,pc_name,district_code,share,dist_2008
    layer      AC (assembly polygons) or PC (parliament polygons — used only for PCs with no assembly
               segments: the UTs without a legislature, and Ladakh)
    share      fraction of the seat's AREA inside that district, over census-coded land only
    dist_2008  the AC shapefile's own district label (the 2008 delimitation's district), when the full
               shapefile is available — an independent cross-check on the overlay

Geometry:
  · ACs — product/geo/India_AC.shp (datameet, full resolution) when present, else the app's own
    public/geo/india_ac_simplified.geojson. Measured: the two agree on the main district for 4,094 of
    4,095 ACs; the full file is preferred because small urban seats lose detail when simplified.
  · PCs — public/geo/india_pc_2019_simplified.geojson.
  · Districts — tools/sources/census2011/boundaries/districts_2011.geojson (datameet Census 2011
    districts, CC BY 2.5 India; code 0 'Data Not Available' = PoK / Aksai Chin, excluded).

Area is not population, so area shares are only used where they are safe: an AC almost always sits
inside one district (93% are >= 90% in one), and where it straddles two, area is the best open proxy.
Shares under 10% are boundary slivers between two independently-drawn maps and are dropped.

Run from product/app:  python tools/build_census_overlay.py
"""
import csv, io, json, os, sys
from collections import defaultdict

from shapely import STRtree, make_valid
from shapely.geometry import shape
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'sources', 'census2011')
FULL_AC = os.path.join(APP, '..', 'geo', 'India_AC.shp')
SIMPLE_AC = os.path.join(APP, 'public', 'geo', 'india_ac_simplified.geojson')
PC_GEO = os.path.join(APP, 'public', 'geo', 'india_pc_2019_simplified.geojson')
DIST_GEO = os.path.join(SRC, 'boundaries', 'districts_2011.geojson')
OUT = os.path.join(SRC, 'seat_district_overlay.csv')
MIN_SHARE = 0.10


def poly(geom):
    """Polygonal part of a GeoJSON geometry. A few PC features carry stray line/point members, which
    make GEOS refuse the whole shape ('mixed-dimension'); only the area matters here."""
    g = shape(geom)
    if g.geom_type == 'GeometryCollection':
        g = unary_union([x for x in g.geoms if x.geom_type in ('Polygon', 'MultiPolygon')])
    try:
        return make_valid(g)
    except Exception:
        return g.buffer(0)


def load_ac():
    """(GEO_STATE, AC_NO) -> (geometry, ac_name, pc_name, dist_2008). Multi-part ACs are unioned."""
    parts, meta = defaultdict(list), {}
    if os.path.exists(FULL_AC):
        import shapefile                                    # pyshp
        sf = shapefile.Reader(FULL_AC, encoding='latin1')
        fl = [f[0] for f in sf.fields[1:]]
        for sr in sf.iterShapeRecords():
            r = dict(zip(fl, sr.record))
            if not sr.shape.points:
                continue
            k = (r['ST_NAME'].strip().upper(), int(r['AC_NO']))
            parts[k].append(make_valid(shape(sr.shape.__geo_interface__)))
            meta[k] = (r['AC_NAME'].strip(), (r['PC_NAME'] or '').strip(), (r['DIST_NAME'] or '').strip())
        src = 'full shapefile'
    else:
        for f in json.load(io.open(SIMPLE_AC, encoding='utf-8'))['features']:
            p = f['properties']
            if not f['geometry']:
                continue
            k = (p['ST_NAME'].strip().upper(), int(p['AC_NO']))
            parts[k].append(make_valid(shape(f['geometry'])))
            meta[k] = (p['AC_NAME'].strip(), (p.get('PC_NAME') or '').strip(), '')
        src = 'simplified geojson'
    print(f'AC geometry: {src} — {len(parts):,} seats')
    return {k: (unary_union(v), *meta[k]) for k, v in parts.items()}


def main():
    D = json.load(io.open(DIST_GEO, encoding='utf-8'))['features']
    dgeom = [make_valid(shape(f['geometry'])) for f in D]
    dcode = [int(f['properties']['censuscode'] or 0) for f in D]   # None = 'Data Not Available'
    tree = STRtree(dgeom)

    def shares(g):
        acc = defaultdict(float)
        for i in tree.query(g):
            if dcode[i] == 0:                    # PoK / Aksai Chin — no census
                continue
            a = g.intersection(dgeom[i]).area
            if a > 0:
                acc[dcode[i]] += a
        tot = sum(acc.values())
        if not tot:
            return []
        s = sorted(((c, a / tot) for c, a in acc.items()), key=lambda x: -x[1])
        kept = [(c, v) for c, v in s if v >= MIN_SHARE] or s[:1]
        kt = sum(v for _, v in kept)
        return [(c, v / kt) for c, v in kept]

    rows, hist = [], defaultdict(int)
    for (st, no), (g, name, pc, d08) in sorted(load_ac().items()):
        if no == 0 or g.is_empty:                # unnamed AC_NO=0 slivers (Ahmedabad / Surat / Indore gaps)
            continue
        sh = shares(g)
        top = sh[0][1] if sh else 0
        hist['>=0.9' if top >= 0.9 else '0.75-0.9' if top >= 0.75 else '<0.75'] += 1
        for c, v in sh:
            rows.append(['AC', st, no, name, pc, c, round(v, 4), d08])

    for f in json.load(io.open(PC_GEO, encoding='utf-8'))['features']:
        p = f['properties']
        g = poly(f['geometry'])
        for c, v in shares(g):
            rows.append(['PC', p['st_name'].strip().upper(), int(p['pc_no']), p['pc_name'].strip(), p['pc_name'].strip(), c, round(v, 4), ''])

    with open(OUT, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(['layer', 'geo_state', 'seat_no', 'seat_name', 'pc_name', 'district_code', 'share', 'dist_2008'])
        w.writerows(rows)
    print(f'ACs by share of their main district: {dict(hist)}')
    print(f'wrote {len(rows):,} rows -> {os.path.relpath(OUT, APP)}')


if __name__ == '__main__':
    sys.exit(main())
