// Census 2011 demographics for a seat.
//
// STEP 1 (live): DISTRICT-level. Each seat is placed in its 2011 census district(s) by overlaying the
// seat's polygon on the 2011 district map (tools/build_census.py), so every seat in a district shows
// that district's profile. Parliament seats are a BLEND of their assembly segments' districts,
// weighted by each segment's electorate. The weights (`w`) are shares of the seat, summing to 1.
// STEP 2 (planned): true seat-level estimates. The file shape is the same, so this module and the
// briefing will not change when it lands — only the weights will point at finer units.
//
// Everything is stored as raw COUNTS per district and turned into rates here, because rates can be
// blended (weighted mean) but cannot be summed, and counts can be summed but not blended.
import type { Seat } from './data'

export type CensusDistrict = {
  n: string                                  // district name, Census 2011 spelling
  p: number; m: number; f: number            // population: total / men / women
  u?: number                                 // urban population
  hh?: number                                // households
  c6?: number; c6m?: number; c6f?: number    // population aged 0–6
  sc?: number; st?: number                   // Scheduled Castes / Tribes
  l?: number; lm?: number; lf?: number       // literates (census counts literacy over age 7+)
  w?: number                                 // workers, main + marginal
  cl?: number; al?: number; hi?: number; ot?: number   // workers: cultivators / farm labour / household industry / other
  r?: Partial<Record<Religion, number>>      // population by religion
  a?: Partial<Record<Amenity, number>>       // % of households (HLO 2011) — already a rate
}
export type Religion = 'hindu' | 'muslim' | 'christian' | 'sikh' | 'buddhist' | 'jain' | 'other' | 'none'
export type Amenity = 'elec' | 'lpg' | 'latrine' | 'tap' | 'bank' | 'tv' | 'phone' | 'computer' | 'twowheeler' | 'car' | 'noasset'

export type CensusSeat = { c: string; w: [string, number][] }   // seat name (for audit) + [district code, share]
export type CensusFile = {
  d: Record<string, CensusDistrict>          // the 2011 districts this state's seats touch
  st: CensusDistrict                         // the state as the app draws it (Telangana = its 10 districts, etc.)
  AE: Record<string, CensusSeat>             // keyed by the seat's continuity number `j`
  GE: Record<string, CensusSeat>
  // Years fought on NEW boundaries (J&K 2024, Assam 2026 / 2024 PCs) — keyed by that year's seat number
  AEy?: Record<string, Record<string, CensusSeat>>
  GEy?: Record<string, Record<string, CensusSeat>>
  src?: string
}

export type Rates = {
  sc: number | null; st: number | null; urban: number | null
  lit: number | null; litM: number | null; litF: number | null
  sexRatio: number | null; childSexRatio: number | null
  workRate: number | null
  work: { cl: number; al: number; hi: number; ot: number } | null     // % of workers
  rel: Partial<Record<Religion, number>> | null                      // % of population
  amen: Partial<Record<Amenity, number>> | null                      // % of households
}

const pct = (a: number | undefined, b: number | undefined) => (a != null && b ? (a / b) * 100 : null)

export function ratesOf(d: CensusDistrict): Rates {
  // Literacy is measured over people aged 7+, exactly as the census publishes it.
  const lit = (l?: number, p?: number, c6?: number) => (l != null && p != null && c6 != null && p - c6 > 0 ? (l / (p - c6)) * 100 : null)
  const work = d.w && d.cl != null && d.al != null && d.hi != null && d.ot != null
    ? { cl: (d.cl / d.w) * 100, al: (d.al / d.w) * 100, hi: (d.hi / d.w) * 100, ot: (d.ot / d.w) * 100 } : null
  const rel = d.r ? Object.fromEntries(Object.entries(d.r).map(([k, v]) => [k, ((v ?? 0) / d.p) * 100])) as Rates['rel'] : null
  return {
    sc: pct(d.sc, d.p), st: pct(d.st, d.p), urban: pct(d.u, d.p),
    lit: lit(d.l, d.p, d.c6), litM: lit(d.lm, d.m, d.c6m), litF: lit(d.lf, d.f, d.c6f),
    sexRatio: d.m ? (d.f / d.m) * 1000 : null,
    childSexRatio: d.c6m && d.c6f != null ? (d.c6f / d.c6m) * 1000 : null,
    workRate: pct(d.w, d.p),
    work, rel, amen: d.a ?? null,
  }
}

// Weighted mean of rates. A field missing in one district is averaged over the districts that have it.
function blend(parts: { r: Rates; w: number }[]): Rates {
  const num = (get: (r: Rates) => number | null | undefined) => {
    let s = 0, ws = 0
    for (const { r, w } of parts) { const v = get(r); if (v != null) { s += v * w; ws += w } }
    return ws > 0 ? s / ws : null
  }
  const group = <K extends string>(get: (r: Rates) => Partial<Record<K, number>> | null) => {
    const keys = new Set(parts.flatMap(p => Object.keys(get(p.r) ?? {}))) as Set<K>
    if (!keys.size) return null
    return Object.fromEntries([...keys].map(k => [k, num(r => get(r)?.[k]) ?? 0])) as Partial<Record<K, number>>
  }
  const w = group<'cl' | 'al' | 'hi' | 'ot'>(r => r.work)
  return {
    sc: num(r => r.sc), st: num(r => r.st), urban: num(r => r.urban),
    lit: num(r => r.lit), litM: num(r => r.litM), litF: num(r => r.litF),
    sexRatio: num(r => r.sexRatio), childSexRatio: num(r => r.childSexRatio), workRate: num(r => r.workRate),
    work: w ? { cl: w.cl ?? 0, al: w.al ?? 0, hi: w.hi ?? 0, ot: w.ot ?? 0 } : null,
    rel: group<Religion>(r => r.rel), amen: group<Amenity>(r => r.amen),
  }
}

export type SeatCensus = {
  rates: Rates
  state: Rates
  districts: { code: string; name: string; share: number; pop: number }[]   // biggest share first
}

/** The census profile for a seat, or null when it can't be placed (pre-2008 boundaries, no shape). */
export function censusFor(file: CensusFile | null, arena: 'AE' | 'GE', seat: Seat): SeatCensus | null {
  if (!file) return null
  const override = (arena === 'AE' ? file.AEy : file.GEy)?.[String(seat.y)]
  // `j` >= 1000 marks the pre-2008 delimitation (the 2004 overlay): different ground, no mapping.
  const rec = override ? override[String(seat.n)] : seat.j < 1000 ? (arena === 'AE' ? file.AE : file.GE)[String(seat.j)] : undefined
  if (!rec?.w?.length) return null
  const parts = rec.w.filter(([code]) => file.d[code]).map(([code, w]) => ({ code, w, d: file.d[code] }))
  if (!parts.length) return null
  const tot = parts.reduce((s, p) => s + p.w, 0)
  return {
    rates: blend(parts.map(p => ({ r: ratesOf(p.d), w: p.w / tot }))),
    state: ratesOf(file.st),
    districts: parts.map(p => ({ code: p.code, name: p.d.n, share: p.w / tot, pop: p.d.p })).sort((a, b) => b.share - a.share),
  }
}

// ── plain-English reads: what makes this seat's population DIFFERENT from its state ──
// Only claims a contrast when it is both relative (≥ 1.3× or ≤ 0.7× the state) and material in
// absolute terms, so a 0.4% → 0.8% Jain share never reads as "double the state". Wording states
// BOTH values instead of a difference (owner rule: no "points"). Every sentence NAMES the district:
// these are district figures, and a city seat inside a largely tribal district (Visakhapatnam) must
// not read as if the seat itself were tribal. A blend names every district it draws on (up to three).
export function censusReads(sc: SeatCensus, stateName: string): string[] {
  const { rates: r, state: s, districts: ds } = sc
  const nm = ds.map(d => d.name)
  const where = nm.length === 1 ? `${nm[0]} district`
    : nm.length === 2 ? `${nm[0]} and ${nm[1]} districts`
      : nm.length === 3 ? `${nm[0]}, ${nm[1]} and ${nm[2]} districts`
        : `${nm[0]}, ${nm[1]} and ${nm.length - 2} other districts`
  const out: { t: string; k: number }[] = []
  const f1 = (v: number) => v.toFixed(1) + '%'
  const cmp = (label: string, v: number | null | undefined, sv: number | null | undefined, min: number) => {
    if (v == null || sv == null || v < min || sv <= 0) return
    const k = v / sv
    if (k >= 1.3) out.push({ t: `${label} are ${f1(v)} of the population in ${where} — ${k >= 1.9 ? `${k.toFixed(1)}×` : 'well above'} the ${stateName} figure of ${f1(sv)}.`, k })
    else if (k <= 0.7 && sv >= min) out.push({ t: `${label} are ${f1(v)} of the population in ${where}, against ${f1(sv)} across ${stateName}.`, k: 1 / k })
  }
  cmp('Scheduled Castes', r.sc, s.sc, 8)
  cmp('Scheduled Tribes', r.st, s.st, 8)
  cmp('Muslims', r.rel?.muslim, s.rel?.muslim, 6)
  cmp('Christians', r.rel?.christian, s.rel?.christian, 6)
  cmp('Sikhs', r.rel?.sikh, s.rel?.sikh, 6)
  cmp('Buddhists', r.rel?.buddhist, s.rel?.buddhist, 5)
  if (r.urban != null && s.urban != null && s.urban > 0) {
    const k = r.urban / s.urban
    if (k >= 1.4 && r.urban >= 30) out.push({ t: `Urban: ${f1(r.urban)} of people in ${where} live in towns and cities, against ${f1(s.urban)} statewide.`, k })
    else if (k <= 0.6) out.push({ t: `Largely rural: only ${f1(r.urban)} of people in ${where} live in towns and cities, against ${f1(s.urban)} statewide.`, k: 1 / Math.max(k, 0.05) })
  }
  if (r.litM != null && r.litF != null && r.litM - r.litF >= 15)
    out.push({ t: `A wide literacy gap in ${where}: ${f1(r.litF)} of women can read and write, against ${f1(r.litM)} of men.`, k: 1.3 })
  if (r.work && r.work.cl + r.work.al >= 60)
    out.push({ t: `A farm economy: ${f1(r.work.cl + r.work.al)} of workers in ${where} are cultivators or agricultural labourers.`, k: 1.25 })
  if (r.childSexRatio != null && Math.round(r.childSexRatio) < 900)     // round first: 899.7 must not read "Only 900"
    out.push({ t: `Only ${Math.round(r.childSexRatio)} girls per 1,000 boys under seven in ${where}${s.childSexRatio != null ? ` (${stateName}: ${Math.round(s.childSexRatio)})` : ''}.`, k: 1.2 })
  return out.sort((a, b) => b.k - a.k).slice(0, 4).map(o => o.t)
}
