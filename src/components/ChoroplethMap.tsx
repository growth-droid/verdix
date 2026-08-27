import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadACGeo, loadPCGeo, loadStateBorders, type Seat } from '../lib/data'
import { colorFor, ALLIANCE_COLORS, readable } from '../lib/colors'
import { DELIM_BREAK_AE } from '../lib/joins'
import { useTheme } from '../store'

type Arena = 'AE' | 'GE'
export type MapMode = 'winner' | 'margin' | 'turnout' | 'alliance'
const allianceBase = (a: string | null) => (a ? a.replace(/ \(.*\)$/, '') : 'Unaligned')
const allianceColor = (a: string | null) => ALLIANCE_COLORS[allianceBase(a)] ?? '#64748b'
type Info = { title: string; sub: string; dataState: string; seat?: Seat }

const MAP_PAL = {
  dark: { bg: '#040d0e', noData: '#0c2a2c', line: '#040d0e', hover: '#eafaf8', stateLine: 'rgba(180,220,218,0.5)', stateText: '#eafaf8', seatText: '#d3ebe8', halo: 'rgba(4,13,14,0.9)' },
  light: { bg: '#e9ede7', noData: '#dbe4dc', line: '#f5f6f1', hover: '#0f3a34', stateLine: 'rgba(15,58,52,0.5)', stateText: '#0f3a34', seatText: '#26463f', halo: 'rgba(245,246,241,0.95)' },
} as const
const norm = (s: string) => s.toUpperCase().replace(/\bAND\b/g, '&').replace(/\s+/g, ' ').trim()

// data-state → geo-state names per layer. AC shapes are 2008-era: undivided AP carries TG 1-119 + AP 120-294,
// Ladakh's ACs live inside J&K, and the shapefile spells ORISSA / UTTARKHAND.
const ALIAS: Record<Arena, Record<string, string>> = {
  AE: { ODISHA: 'ORISSA', UTTARAKHAND: 'UTTARKHAND', TELANGANA: 'ANDHRA PRADESH', LADAKH: 'JAMMU & KASHMIR' },
  GE: { ODISHA: 'ORISSA', 'ANDAMAN & NICOBAR ISLANDS': 'ANDAMAN & NICOBAR', LADAKH: 'JAMMU & KASHMIR' },
}

const geoStateOf = (arena: Arena, s: string) => { const ns = norm(s); return ALIAS[arena][ns] ?? ns }

function geoKey(r: Seat, arena: Arena): string {
  const ns = norm(r.s)
  if (arena === 'AE') {
    // post-split AP (2014+) is renumbered 1-175; shapes keep undivided numbering → +119
    const no = ns === 'ANDHRA PRADESH' && r.y >= 2014 ? r.n + 119 : r.n
    return `${geoStateOf('AE', r.s)}|${no}`
  }
  if (ns === 'DADRA & NAGAR HAVELI & DAMAN & DIU')
    return `${r.c.toUpperCase().includes('DAMAN') ? 'DAMAN & DIU' : 'DADRA & NAGAR HAVELI'}|1` // merged UT on pre-merger shapes
  if (ns === 'LADAKH') return 'JAMMU & KASHMIR|4' // Ladakh PC is pc_no 4 inside the J&K shapes
  if (ns === 'JAMMU & KASHMIR' && r.y >= 2024 && r.n >= 4) return `JAMMU & KASHMIR|${r.n + 1}` // 2024 numbering skips Ladakh: Udhampur 4→5, Jammu 5→6
  if (ns === 'ANDHRA PRADESH' && r.y <= 2014) return `ANDHRA PRADESH|${r.n - 17}` // undivided PC numbering: TG block 1-17, residual AP 18-42 → 2019 shapes 1-25
  return `${geoStateOf('GE', r.s)}|${r.n}`
}

const keyExprFor = (a: Arena): unknown[] => a === 'AE'
  ? ['concat', ['get', 'ST_NAME'], '|', ['to-string', ['get', 'AC_NO']]]
  : ['concat', ['upcase', ['get', 'st_name']], '|', ['to-string', ['get', 'pc_no']]]

const NO_HOVER = ['==', ['get', 'ST_NAME'], '__NONE__'] // PC layer lacks ST_NAME → null ≠ '__NONE__' → also matches nothing

const featKeyOf = (p: Record<string, unknown>) =>
  'ST_NAME' in p ? `${p.ST_NAME}|${p.AC_NO}` : `${norm(String(p.st_name))}|${p.pc_no}`

function bboxOf(fc: GeoJSON.FeatureCollection): [[number, number], [number, number]] | null {
  let mnx = 180, mny = 90, mxx = -180, mxy = -90, any = false
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') {
      const [x, y] = c as [number, number]
      any = true
      if (x < mnx) mnx = x; if (x > mxx) mxx = x
      if (y < mny) mny = y; if (y > mxy) mxy = y
    } else (c as unknown[]).forEach(walk)
  }
  fc.features.forEach(f => { const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon; if (g?.coordinates) walk(g.coordinates) })
  return any ? [[mnx, mny], [mxx, mxy]] : null
}


const tc = (s: string) => s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())

// band palettes per theme — the light variants avoid the near-white tones that wash out on a light map
const MARGIN_BANDS_D = [
  { lt: 2, color: '#f87171', label: '< 2% — knife-edge' },
  { lt: 5, color: '#fb923c', label: '2–5%' },
  { lt: 10, color: '#fbbf24', label: '5–10%' },
  { lt: 20, color: '#34d399', label: '10–20%' },
  { lt: Infinity, color: '#10b981', label: '≥ 20% — safe' },
]
const MARGIN_BANDS_L = [
  { lt: 2, color: '#dc2626', label: '< 2% — knife-edge' },
  { lt: 5, color: '#ea580c', label: '2–5%' },
  { lt: 10, color: '#d97706', label: '5–10%' },
  { lt: 20, color: '#16a34a', label: '10–20%' },
  { lt: Infinity, color: '#15803d', label: '≥ 20% — safe' },
]
const TURNOUT_BANDS_D = [
  { lt: 55, color: '#1e3a8a', label: '< 55%' },
  { lt: 62, color: '#1e40af', label: '55–62%' },
  { lt: 70, color: '#2563eb', label: '62–70%' },
  { lt: 78, color: '#38bdf8', label: '70–78%' },
  { lt: Infinity, color: '#7dd3fc', label: '≥ 78%' },
]
const TURNOUT_BANDS_L = [
  { lt: 55, color: '#bae6fd', label: '< 55%' },
  { lt: 62, color: '#7dd3fc', label: '55–62%' },
  { lt: 70, color: '#38bdf8', label: '62–70%' },
  { lt: 78, color: '#2563eb', label: '70–78%' },
  { lt: Infinity, color: '#1e3a8a', label: '≥ 78%' },
]
const band = (v: number | null, bands: typeof MARGIN_BANDS_D) =>
  v == null ? null : bands.find(b => v < b.lt)!

// default height: phones get a viewport-proportional block (100vh on mobile browsers is the LARGE
// viewport, and the 230px offset assumes the desktop header+FilterBar) — desktop keeps the old value.
export default function ChoroplethMap({ byState, arena, activeYear, mode = 'winner', onPick, height = 'h-[62vh] sm:h-[calc(100dvh-230px)]', colorOf, subOf, legendTitle, legendItems, focusState }: {
  byState: Map<string, Seat[]>; arena: Arena; activeYear: number
  mode?: MapMode; onPick?: (seat: Seat | null, state: string) => void; height?: string
  /** Custom analysis painting (e.g. flip status) — overrides `mode`. Memoize these. */
  colorOf?: (seat: Seat) => string
  subOf?: (seat: Seat) => string
  legendTitle?: string
  legendItems?: { label: string; color: string; n?: number | null }[]
  /** Show only this state's seats and fit the camera to them. */
  focusState?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const infoRef = useRef<Map<string, Info>>(new Map())
  const arenaRef = useRef<Arena>(arena); arenaRef.current = arena
  const onPickRef = useRef(onPick); onPickRef.current = onPick
  const themeMode = useTheme()
  const pal = MAP_PAL[themeMode]
  const palRef = useRef(pal); palRef.current = pal
  const MARGIN_BANDS = themeMode === 'light' ? MARGIN_BANDS_L : MARGIN_BANDS_D
  const TURNOUT_BANDS = themeMode === 'light' ? TURNOUT_BANDS_L : TURNOUT_BANDS_D
  const lastGoodRef = useRef<[number, number]>([80, 22.5]) // last camera centre that kept land on screen
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null)
  const [stateGeo, setStateGeo] = useState<GeoJSON.FeatureCollection | null>(null)

  // ── One label point per state ───────────────────────────────────────────────────────────────
  // A symbol layer over POLYGONS places a label on every part of a MultiPolygon. Andaman &
  // Nicobar is 142 islands, so the map asked for its name 142 times (269 placements across the
  // 36 states) and collision-hiding left a scattered handful visible — the owner saw the name
  // four times in open sea. Reducing each state to ONE point makes a duplicate impossible.
  //
  // The point must also be INSIDE the state: an area centroid of a multi-island or concave state
  // lands in water. So we take the largest part, and if its centroid falls outside the ring we
  // grid-search for the interior point furthest from any edge (a cheap pole-of-inaccessibility).
  const stateLabelGeo = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!stateGeo) return null
    type Ring = number[][]
    const areaOf = (r: Ring) => {
      let a = 0
      for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
      return Math.abs(a) / 2
    }
    const inside = (pt: number[], r: Ring) => {
      let hit = false
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j]
        if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit
      }
      return hit
    }
    const edgeDist = (pt: number[], r: Ring) => {
      let best = Infinity
      for (let i = 0; i < r.length - 1; i++) {
        const [x1, y1] = r[i], [x2, y2] = r[i + 1]
        const dx = x2 - x1, dy = y2 - y1
        const t = dx || dy ? Math.max(0, Math.min(1, ((pt[0] - x1) * dx + (pt[1] - y1) * dy) / (dx * dx + dy * dy))) : 0
        best = Math.min(best, Math.hypot(pt[0] - (x1 + t * dx), pt[1] - (y1 + t * dy)))
      }
      return best
    }
    const features = stateGeo.features.map(f => {
      const g = f.geometry as GeoJSON.Geometry
      const parts: Ring[] =
        g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]).map(poly => poly[0])
        : g.type === 'Polygon' ? [(g.coordinates as number[][][])[0]]
        : []
      if (!parts.length) return null
      const ring = parts.reduce((a, b) => (areaOf(b) > areaOf(a) ? b : a))
      // area-weighted centroid of the largest part
      let cx = 0, cy = 0, a2 = 0
      for (let i = 0; i < ring.length - 1; i++) {
        const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
        a2 += cross; cx += (ring[i][0] + ring[i + 1][0]) * cross; cy += (ring[i][1] + ring[i + 1][1]) * cross
      }
      let pt = a2 ? [cx / (3 * a2), cy / (3 * a2)] : ring[0]
      if (!inside(pt, ring)) {
        const xs = ring.map(c => c[0]), ys = ring.map(c => c[1])
        const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)]
        let best = -1
        for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
          const c = [x0 + ((x1 - x0) * i) / 24, y0 + ((y1 - y0) * j) / 24]
          if (!inside(c, ring)) continue
          const d = edgeDist(c, ring)
          if (d > best) { best = d; pt = c }
        }
      }
      return { type: 'Feature' as const, properties: { ...f.properties }, geometry: { type: 'Point' as const, coordinates: pt } }
    }).filter(Boolean) as GeoJSON.Feature[]
    return { type: 'FeatureCollection', features }
  }, [stateGeo])

  useEffect(() => {
    let live = true
    ;(arena === 'AE' ? loadACGeo() : loadPCGeo()).then(g => { if (live) setGeo(g) })
    return () => { live = false }
  }, [arena])
  useEffect(() => { let live = true; loadStateBorders().then(g => { if (live) setStateGeo(g) }); return () => { live = false } }, [])

  // distinct seat numbers per geo-state — drives the delimitation-fallback fills
  const geoIndex = useMemo(() => {
    const m = new Map<string, Set<string>>()
    geo?.features.forEach(f => {
      const p = f.properties as Record<string, unknown>
      const st = 'ST_NAME' in p ? String(p.ST_NAME) : norm(String(p.st_name))
      const no = String('AC_NO' in p ? p.AC_NO : p.pc_no)
      if (!m.has(st)) m.set(st, new Set())
      m.get(st)!.add(no)
    })
    return m
  }, [geo])

  const { colors, info, notes } = useMemo(() => {
    const colors = new Map<string, string>()
    const info = new Map<string, Info>()
    const notes: string[] = []
    const fallback: [string, Seat[]][] = []
    for (const [st, seats] of byState) {
      if (!seats.length) continue
      if (arena === 'AE' && seats[0].y >= (DELIM_BREAK_AE[st] ?? Infinity)) { fallback.push([st, seats]); continue }
      for (const r of seats) {
        const k = geoKey(r, arena)
        const fill = colorOf ? colorOf(r)
          : mode === 'winner' ? colorFor(r.p, r.a)
          : mode === 'alliance' ? allianceColor(r.a)
          : mode === 'margin' ? band(r.m, MARGIN_BANDS)?.color ?? pal.noData
          : band(r.t, TURNOUT_BANDS)?.color ?? pal.noData
        colors.set(k, fill)
        info.set(k, {
          title: `${tc(r.c)} · ${r.y}`,
          sub: subOf ? subOf(r)
            : `${r.p}${r.a ? ' · ' + r.a : ''}${r.m != null ? ' · margin ' + r.m.toFixed(1) + '%' : ''}${r.t != null ? ' · turnout ' + r.t.toFixed(0) + '%' : ''}`,
          dataState: r.s, seat: r,
        })
      }
    }
    for (const [st, seats] of fallback) {
      const y = seats[0].y
      if (colorOf) {
        // custom analysis: uniform state fill from the page's own colorOf (delim-broken seats can't join shapes)
        const fill = colorOf(seats[0])
        const gst = geoStateOf('AE', st)
        for (const no of geoIndex.get(gst) ?? []) {
          const k = `${gst}|${no}`
          if (colors.has(k)) continue
          colors.set(k, fill)
          info.set(k, { title: `${st} · ${y}`, sub: subOf ? subOf(seats[0]) : 'New delimitation', dataState: st })
        }
        notes.push(`${st} ${y}: new delimitation — uniform statewide treatment`)
      } else if (mode === 'winner' || mode === 'alliance') {
        const key = (r: Seat) => (mode === 'alliance' ? allianceBase(r.a) : r.p)
        const counts = new Map<string, number>()
        seats.forEach(r => counts.set(key(r), (counts.get(key(r)) || 0) + 1))
        const [lead, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
        const fill = mode === 'alliance' ? allianceColor(seats.find(r => allianceBase(r.a) === lead)!.a) : colorFor(lead, seats.find(r => r.p === lead)!.a)
        const gst = geoStateOf('AE', st)
        for (const no of geoIndex.get(gst) ?? []) {
          const k = `${gst}|${no}`
          if (colors.has(k)) continue // e.g. Ladakh 2014 ACs already claimed inside the J&K shapes
          colors.set(k, fill)
          info.set(k, { title: `${st} · ${y}`, sub: `New delimitation — seat shapes unavailable. Statewide: ${lead} ${n}/${seats.length}`, dataState: st })
        }
        notes.push(`${st} ${y}: new delimitation — statewide leader shown on old seat shapes`)
      } else {
        notes.push(`${st} ${y}: new delimitation — no seat shapes for this view`)
      }
    }
    if (arena === 'GE' && activeYear >= 2024)
      notes.push('J&K / Ladakh 2024 drawn on 2019-era shapes (Anantnag–Rajouri changed in the 2022 delimitation)')
    return { colors, info, notes }
    // themeMode is explicit: the margin/turnout fills read theme-derived MARGIN_BANDS/TURNOUT_BANDS
    // (recomputed per theme) — pal also changes on theme flip, but list themeMode so the intent is clear.
  }, [byState, arena, geoIndex, activeYear, mode, colorOf, subOf, pal, themeMode])
  infoRef.current = info
  const colorsRef = useRef(colors); colorsRef.current = colors

  const paint = () => {
    const map = mapRef.current
    if (!map || !map.getLayer('seats-fill')) return
    const c = colorsRef.current
    if (!c.size) { map.setPaintProperty('seats-fill', 'fill-color', palRef.current.noData); return }
    const expr: unknown[] = ['match', keyExprFor(arenaRef.current)]
    for (const [k, v] of c) expr.push(k, v)
    expr.push(palRef.current.noData)
    map.setPaintProperty('seats-fill', 'fill-color', expr as never)
  }

  useEffect(() => {
    if (!box.current) return
    const map = new maplibregl.Map({
      container: box.current,
      style: { version: 8, glyphs: '/glyphs/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': palRef.current.bg } }] },
      center: [80, 22.5], zoom: 3.8, minZoom: 3, maxZoom: 10, attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.dragRotate.disable(); map.touchZoomRotate.disableRotation()

    // pan/zoom fence: never let the geography fully leave the screen. After any move,
    // if the central third of the view holds no constituency, ease back to the last
    // centre that did — so at least ~a third of the map is always visible.
    //
    // GUARDED against recursion: easeTo fires its OWN moveend, and when the OS has
    // `prefers-reduced-motion` set MapLibre turns easeTo into an INSTANT jump whose moveend
    // fires synchronously — so an unguarded fence re-enters itself until the stack overflows
    // ("Maximum call stack size exceeded"). The re-entry flag + the already-at-centre early-out
    // break that cycle (and stop the thrash that made the map feel slow for those users).
    let fenceCorrecting = false
    map.on('moveend', () => {
      if (fenceCorrecting) { fenceCorrecting = false; return }   // this moveend is our own correction — don't re-fence
      if (!map.getLayer('seats-fill')) return
      const c = map.getContainer(); const w = c.clientWidth, h = c.clientHeight
      if (!w || !h) return
      const inCenter = map.queryRenderedFeatures(
        [[w * 0.3, h * 0.3], [w * 0.7, h * 0.7]] as never, { layers: ['seats-fill'] },
      ).length
      if (inCenter > 0) { const ll = map.getCenter(); lastGoodRef.current = [ll.lng, ll.lat]; return }
      const cur = map.getCenter(), [gx, gy] = lastGoodRef.current
      if (Math.abs(cur.lng - gx) < 1e-4 && Math.abs(cur.lat - gy) < 1e-4) return  // already at the good centre — nothing to correct
      fenceCorrecting = true
      map.easeTo({ center: lastGoodRef.current, duration: 350 })
    })
    // maxWidth is a raw CSS length: min() keeps the desktop 320px but caps the popup at ~56% of a
    // phone screen (a 320px card blankets a 390px map). Pure CSS, so it survives rotation.
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: 'min(320px, 56vw)', offset: 10 })
    popupRef.current = popup

    const featKey = featKeyOf

    map.on('mousemove', 'seats-fill', e => {
      const f = e.features?.[0]
      if (!f?.properties) return
      const k = featKey(f.properties)
      const i = infoRef.current.get(k)
      const geoName = (f.properties as Record<string, unknown>).AC_NAME ?? (f.properties as Record<string, unknown>).pc_name
      const html = i
        ? `<div class="font-semibold text-[13px]">${i.title}</div>
           <div class="text-slate-300 mt-0.5">${i.sub}</div>
           <div class="text-slate-300 mt-1">${i.dataState}${i.seat ? ' — click for seat detail' : ' — click for deep-dive'}</div>`
        : `<div class="font-semibold text-[13px]">${geoName || 'Unnamed'}</div>
           <div class="text-slate-400 mt-0.5">No data for this view</div>`
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map)
      map.getCanvas().style.cursor = i ? 'pointer' : ''
      if (map.getLayer('seats-hover')) map.setFilter('seats-hover', ['==', keyExprFor(arenaRef.current), k] as never)
    })
    map.on('mouseleave', 'seats-fill', () => {
      popup.remove()
      map.getCanvas().style.cursor = ''
      if (map.getLayer('seats-hover')) map.setFilter('seats-hover', NO_HOVER as never)
    })
    map.on('click', 'seats-fill', e => {
      const f = e.features?.[0]
      if (!f?.properties) return
      const i = infoRef.current.get(featKey(f.properties))
      if (i) onPickRef.current?.(i.seat ?? null, i.dataState)
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__map = map
    return () => { popup.remove(); map.remove(); mapRef.current = null }
  }, [])

  // (re)mount source + layers when the boundary set changes (AE↔GE)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !geo) return
    let cancelled = false
    const mount = () => {
      // isStyleLoaded() goes false whenever the style is dirty (e.g. a fresh paint); 'idle' fires
      // repeatedly so this self-retries — never gate on once('load'), it only fires once per map.
      if (cancelled) return
      if (!map.isStyleLoaded()) { map.once('idle', mount); return }
      popupRef.current?.remove() // hover popup from the previous boundary set is stale
      for (const id of ['seat-labels', 'state-labels', 'seats-hover', 'state-line', 'seats-line', 'seats-fill']) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource('seats')) map.removeSource('seats')
      if (map.getSource('states')) map.removeSource('states')
      if (map.getSource('state-points')) map.removeSource('state-points')
      map.addSource('seats', { type: 'geojson', data: geo as never })
      map.addLayer({ id: 'seats-fill', type: 'fill', source: 'seats', paint: { 'fill-color': palRef.current.noData, 'fill-opacity': 0.9 } })
      map.addLayer({ id: 'seats-line', type: 'line', source: 'seats', paint: { 'line-color': palRef.current.line, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.2, 7, 0.8] as never } })
      if (stateGeo) {   // dissolved state outlines, drawn on top of the constituency fills
        map.addSource('states', { type: 'geojson', data: stateGeo as never })
        map.addLayer({ id: 'state-line', type: 'line', source: 'states', layout: { 'line-join': 'round' }, paint: { 'line-color': palRef.current.stateLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.9, 7, 2.2] as never } })
      }
      // State names — ONE per state, from a dedicated point source. ⚠ Never drive this off the
      // polygon source: MapLibre labels every part of a MultiPolygon, which drew Andaman &
      // Nicobar's name once per island. Placed BEFORE seat labels so it wins collisions.
      // Fades back as you zoom in and the seat names take over.
      if (stateLabelGeo) {
        map.addSource('state-points', { type: 'geojson', data: stateLabelGeo as never })
        map.addLayer({
          id: 'state-labels', type: 'symbol', source: 'state-points', minzoom: 3.2,
          layout: {
            'text-field': ['get', 'st_name'] as never, 'text-font': ['OpenSans-Bold'],
            'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 7, 'text-padding': 6,
            'text-size': ['interpolate', ['linear'], ['zoom'], 3.5, 10.5, 6, 14.5, 9, 19] as never,
          },
          paint: {
            'text-color': palRef.current.stateText, 'text-halo-color': palRef.current.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.5,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 7, 1, 8.6, 0.5] as never,
          },
        })
      }
      map.addLayer({ id: 'seats-hover', type: 'line', source: 'seats', paint: { 'line-color': palRef.current.hover, 'line-width': 1.8 }, filter: NO_HOVER as never })
      // Constituency names (assembly AC_NAME or parliament pc_name, whichever the source carries),
      // revealed on zoom-in. text-allow-overlap defaults to false, so any name that would collide
      // with an already-placed one is simply not drawn — the map declutters itself.
      map.addLayer({
        id: 'seat-labels', type: 'symbol', source: 'seats', minzoom: 4.5,
        layout: {
          'text-field': ['coalesce', ['get', 'AC_NAME'], ['get', 'pc_name']] as never, 'text-font': ['OpenSans-Regular'],
          'text-max-width': 8, 'text-padding': 5,
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10.5, 8, 13, 10, 15.5] as never,
        },
        paint: { 'text-color': palRef.current.seatText, 'text-halo-color': palRef.current.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.4 },
      })
      paint()
    }
    mount()
    return () => { cancelled = true }
  }, [geo, stateGeo, stateLabelGeo])

  useEffect(() => { paint() }, [colors])

  // keep the canvas sized to its container — deck slides and flex layouts resize it,
  // and there's no other resize hook now that the manual fullscreen button is gone.
  useEffect(() => {
    const map = mapRef.current, el = box.current
    if (!map || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // theme switch: repaint background, borders, hover, and the no-data default
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const upd = () => {
      if (!map.isStyleLoaded()) { map.once('idle', upd); return }
      map.setPaintProperty('bg', 'background-color', pal.bg)
      if (map.getLayer('seats-line')) map.setPaintProperty('seats-line', 'line-color', pal.line)
      if (map.getLayer('state-line')) map.setPaintProperty('state-line', 'line-color', pal.stateLine)
      if (map.getLayer('seats-hover')) map.setPaintProperty('seats-hover', 'line-color', pal.hover)
      if (map.getLayer('state-labels')) { map.setPaintProperty('state-labels', 'text-color', pal.stateText); map.setPaintProperty('state-labels', 'text-halo-color', pal.halo) }
      if (map.getLayer('seat-labels')) { map.setPaintProperty('seat-labels', 'text-color', pal.seatText); map.setPaintProperty('seat-labels', 'text-halo-color', pal.halo) }
      paint()
    }
    upd()
  }, [themeMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // focus mode: swap the source down to one state's features and fit the camera
  useEffect(() => {
    const map = mapRef.current
    if (!map || !geo || !focusState) return
    let cancelled = false
    const apply = () => {
      if (cancelled) return
      const src = map.getSource('seats') as maplibregl.GeoJSONSource | undefined
      if (!src) { map.once('idle', apply); return }
      const seats = byState.get(focusState) ?? []
      const broken = arena === 'AE' && seats.length && seats[0].y >= (DELIM_BREAK_AE[focusState] ?? Infinity)
      let feats: GeoJSON.Feature[]
      if (broken) {
        const gst = geoStateOf('AE', focusState)
        feats = geo.features.filter(f => {
          const p = f.properties as Record<string, unknown>
          return ('ST_NAME' in p ? String(p.ST_NAME) : norm(String(p.st_name))) === gst
        })
      } else {
        const keys = new Set(seats.map(r => geoKey(r, arena)))
        feats = geo.features.filter(f => keys.has(featKeyOf(f.properties as Record<string, unknown>)))
      }
      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: feats }
      src.setData(fc as never)
      const bb = bboxOf(fc)
      if (bb) {
        // Pin the fence to the focused state's centre BEFORE fitBounds. fitBounds(duration:0) fires
        // its moveend SYNCHRONOUSLY, and the fence runs before the new fills have painted — so if
        // lastGoodRef still pointed at the all-India default [80,22.5] the fence would yank the camera
        // straight back to central India (the bug where picking e.g. Arunachal showed Madhya Pradesh).
        lastGoodRef.current = [(bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2]
        map.fitBounds(bb, { padding: 28, duration: 0 })
        const c = map.getCenter(); lastGoodRef.current = [c.lng, c.lat]
      }
      paint()
    }
    apply()
    return () => { cancelled = true }
    // stateGeo is a dep: when the border layer resolves AFTER geo, the mount effect re-adds the
    // full-geo 'seats' source; this effect must re-run to re-apply the focus filter, else the map
    // silently reverts from the focused state to all-India.
  }, [geo, stateGeo, byState, focusState, arena])

  const legend = useMemo(() => {
    if (legendItems) return { title: legendTitle ?? '', items: legendItems.map(it => ({ label: it.label, color: it.color, n: it.n ?? null })) }
    if (mode === 'margin') return { title: 'Victory margin', items: MARGIN_BANDS.map(b => ({ label: b.label, color: b.color, n: null as number | null })) }
    if (mode === 'turnout') return { title: 'Turnout', items: TURNOUT_BANDS.map(b => ({ label: b.label, color: b.color, n: null as number | null })) }
    if (mode === 'alliance') {
      const al = new Map<string, number>()
      for (const list of byState.values()) for (const r of list) al.set(allianceBase(r.a), (al.get(allianceBase(r.a)) || 0) + 1)
      return {
        title: arena === 'AE' ? 'Assembly · seats by alliance' : `Lok Sabha · alliances ${activeYear}`,
        items: [...al.entries()].sort((x, y) => y[1] - x[1]).slice(0, 7)
          .map(([a, n]) => ({ label: a, color: ALLIANCE_COLORS[a] ?? '#64748b', n: n as number | null })),
      }
    }
    const seats = new Map<string, { n: number; a: string | null }>()
    for (const list of byState.values()) for (const r of list) {
      const e = seats.get(r.p) ?? { n: 0, a: r.a }
      e.n++
      seats.set(r.p, e)
    }
    return {
      title: arena === 'AE' ? 'Assembly · seats held' : `Lok Sabha · ${activeYear}`,
      items: [...seats.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 7)
        .map(([p, { n, a }]) => ({ label: p, color: colorFor(p, a), n: n as number | null })),
    }
  }, [byState, mode, arena, activeYear, legendItems, legendTitle, themeMode])

  return (
    <div className={`relative ${height}`}>
      {/* the arbitrary variants size MapLibre's NavigationControl buttons (29px by default) up to a
          36px tap target on phones; sm: restores the native size so desktop is unchanged */}
      <div
        ref={box}
        className="absolute inset-0 rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-card
          [&_.maplibregl-ctrl-group_button]:w-9 [&_.maplibregl-ctrl-group_button]:h-9
          sm:[&_.maplibregl-ctrl-group_button]:w-[29px] sm:[&_.maplibregl-ctrl-group_button]:h-[29px]"
      />
      {/* Legend: on a phone the map IS the content, so show only the top 4 entries in a tight box
          (a 7-row legend covered a third of the map); desktop keeps the full list. */}
      <div className="absolute top-2 left-2 max-w-[48%] min-w-0 glass px-1.5 py-1 space-y-0.5 sm:top-3 sm:left-3 sm:max-w-none sm:min-w-[136px] sm:px-3.5 sm:py-2.5 sm:space-y-1.5">
        <div className="kicker text-[9px] sm:text-[10px]">{legend.title}</div>
        {legend.items.map((it, i) => (
          <div key={it.label} className={`items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs ${i >= 4 ? 'hidden sm:flex' : 'flex'}`}>
            <span className="inline-block w-2 h-2 sm:w-3 sm:h-3 rounded-[3px] sm:rounded-[4px] shrink-0 ring-1 ring-black/40" style={{ background: it.color }} />
            <span className="text-slate-200 truncate">{it.label}</span>
            {it.n != null && <span className="text-slate-300 tabular-nums ml-auto pl-1.5 sm:pl-3">{it.n}</span>}
          </div>
        ))}
        {legend.items.length > 4 && <div className="sm:hidden text-[9px] text-muted pl-3.5">+{legend.items.length - 4} more</div>}
      </div>
      {notes.length > 0 && (
        // Full-bleed (inset) on phones — max-w-md is 448px, wider than a 390px viewport, and the
        // parent isn't clipped, so it used to spill past the right edge and scroll the whole page.
        // Colour was text-amber-200/90 (~1.4:1 on the cream light glass); readable() keeps amber-200
        // as-is on dark (identical to before, minus the opacity) and darkens it to clear AA on light.
        // On a phone these caveats used to blanket the bottom third of the map, so they collapse to
        // a tap-to-open chip; desktop keeps the always-visible panel.
        <details
          className="absolute bottom-2 left-2 right-2 group glass !border-amber-400/20 px-2.5 py-1.5 text-[11px] open:max-h-28 open:overflow-y-auto
            sm:bottom-3 sm:left-3 sm:right-auto sm:max-w-md sm:px-3.5 sm:py-2.5 sm:open:max-h-none sm:open:overflow-visible"
          style={{ color: readable('#fde68a', themeMode) }}
          open={typeof window !== 'undefined' && window.innerWidth >= 640}
        >
          <summary className="cursor-pointer list-none marker:hidden select-none sm:hidden">
            ⚠ {notes.length} boundary note{notes.length > 1 ? 's' : ''} <span className="opacity-70 group-open:hidden">— tap</span>
          </summary>
          <div className="space-y-1 mt-1 sm:mt-0">
            {notes.map(n => <div key={n}>⚠ {n}</div>)}
          </div>
        </details>
      )}
    </div>
  )
}
