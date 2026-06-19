// Regenerates public/geo/india_states_borders.geojson — state outlines for the map's state-border
// layer. The simplified PC geojson isn't topology-preserved (adjacent constituencies don't share
// vertices), so edge-counting can't dissolve; we union each state's constituencies with
// polygon-clipping (a devDependency). Run:  node tools/build_state_borders.mjs
import fs from 'fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pcMod from 'polygon-clipping'
const union = (pcMod.default ?? pcMod).union

const GEO = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'geo')
const pc = JSON.parse(fs.readFileSync(path.join(GEO, 'india_pc_2019_simplified.geojson'), 'utf8'))

const byState = new Map()
for (const f of pc.features) {
  const st = f.properties.st_name
  if (!byState.has(st)) byState.set(st, [])
  const g = f.geometry
  if (g.type === 'Polygon') byState.get(st).push(g.coordinates)
  else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) byState.get(st).push(poly)
}
const rnd = c => c.map(ring => ring.map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]))
const ringArea = ring => { let a = 0; for (let i = 0, n = ring.length - 1; i < n; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return Math.abs(a) / 2 }
const features = []
let failed = 0, holes = 0, slivers = 0
for (const [st, polys] of byState) {
  let geom
  try { geom = union(polys[0], ...polys.slice(1)) } catch { failed++; geom = polys.map(p => p) }
  // KEEP ONLY THE OUTER OUTLINE of each part: the simplified constituencies don't share exact
  // borders, so the union leaves thin interior gap-holes and tiny sliver polygons that would
  // render as stray white lines inside the state. Drop holes (no Indian state is a donut) and
  // drop sliver parts (< ~0.12 km²) so only true state borders remain.
  const cleaned = geom
    .filter(poly => { const ok = ringArea(poly[0]) > 1e-5; if (!ok) slivers++; return ok })
    .map(poly => { holes += poly.length - 1; return [poly[0]] })
  features.push({ type: 'Feature', properties: { st_name: st }, geometry: { type: 'MultiPolygon', coordinates: cleaned.map(rnd) } })
}
fs.writeFileSync(path.join(GEO, 'india_states_borders.geojson'), JSON.stringify({ type: 'FeatureCollection', features }))
console.log(`wrote india_states_borders.geojson — ${features.length} states, ${failed} union failures, dropped ${holes} interior holes + ${slivers} sliver parts`)
