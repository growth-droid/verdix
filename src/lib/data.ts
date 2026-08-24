// Data layer: standalone JSON mode now; swap to Cloud Run/BigQuery API later.
// Extracts come from tools/build_extracts.py (bq_export → public/data). Short keys:
// s=state(current) y=year n=seat-no j=normalized-seat-no(continuity domain) c=seat-name
// r=reservation p=party a=alliance w=winner v=winner-share q/qn=runner-up m=margin% t=turnout%

export type Seat = {
  s: string; y: number; n: number; j: number; c: string; r: string | null
  p: string; a: string | null; w: string | null; v: number | null
  q: string | null; qn: string | null; m: number | null; t: number | null
}
export type PartyAgg = { s?: string; y: number; p: string; a: string | null; f: number | null; wo: number | null; v: number | null }
export type Bypoll = {
  arena: 'AE' | 'GE'; s: string; y: number; mo: number | null; n: number | null; c: string
  r: string | null; p: string; a: string | null; w: string | null; v: number | null; m: number | null
  prev: string | null; ret: string | null; cause: string | null
}
export type Segment = {
  s: string; y: number; pc: number; pcn: string; n: number; c: string
  p: string; a: string | null; v: number | null; tp: string | null; mg: number | null; sv: number | null
}
export type SplitRow = { n: number; c: string; pc: number | null; pcn: string; p: string; a: string | null; gv: number; av: number | null }
export type SplitFile = { ay: number; rows: SplitRow[] }
export type IndexRow = { State_AsThen: string; Election_Year: number; Seats: number; Turnout_Pct: number | null; Leading_Party: string; Leading_Party_Seats: number }
export type CFRow = {
  arena: 'AE' | 'GE'; s: string; y: number; al: string
  actual: number; pooled: number; ff: number; flips: { n: number; c: string; from: string }[]
}

// Cache the in-flight PROMISE (not just the resolved value) so concurrent callers of the same
// loader (e.g. FilterBar + a page both calling loadSeats on first paint) share ONE fetch+parse
// of the large JSON, instead of each firing a duplicate request. Failed fetches are evicted so
// they can be retried.
const cache: Record<string, Promise<unknown>> = {}
function getJSON<T>(path: string): Promise<T> {
  if (!cache[path]) {
    cache[path] = fetch(path)
      .then(r => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json() })
      .catch(e => { delete cache[path]; throw e })
  }
  return cache[path] as Promise<T>
}

// ── 2004 overlay ────────────────────────────────────────────────────────────
// The 2004 General Election + the six 2004-cycle assembly elections live in an ADDITIVE
// overlay extract (public/data/overlay_2004.json, built by tools/build_2004_overlay.mjs from
// ECI-derived candidate CSVs) merged here at load — so a Cowork regeneration of the main
// extracts can never wipe them. 2004 is the pre-2008 delimitation: its seats carry j ≥ 1000
// (a separate continuity domain — no seat chains 2004↔2009) and joins.ts declares the breaks.
type Overlay = {
  seats_ge: Seat[]; seats_ae: Seat[]
  party_ge_state: PartyAgg[]; party_ge_nat: PartyAgg[]; party_ae: PartyAgg[]
  ge_turnout: Record<string, number>; ae_index: IndexRow[]; bypolls: Bypoll[]
}
const loadOverlay = () => getJSON<Overlay>('/data/overlay.json').catch(() => null)

export const loadSeats = (arena: 'AE' | 'GE') =>
  Promise.all([getJSON<Seat[]>(`/data/seats_${arena.toLowerCase()}.json`), loadOverlay()])
    .then(([base, ov]) => (ov ? [...(arena === 'AE' ? ov.seats_ae : ov.seats_ge), ...base] : base))
export const loadPartyAE = () =>
  Promise.all([getJSON<PartyAgg[]>('/data/party_ae.json'), loadOverlay()])
    .then(([base, ov]) => (ov ? [...ov.party_ae, ...base] : base))
export const loadPartyGEState = () =>
  Promise.all([getJSON<PartyAgg[]>('/data/party_ge_state.json'), loadOverlay()])
    .then(([base, ov]) => (ov ? [...ov.party_ge_state, ...base] : base))
export const loadPartyGENat = () =>
  Promise.all([getJSON<PartyAgg[]>('/data/party_ge_nat.json'), loadOverlay()])
    .then(([base, ov]) => (ov ? [...ov.party_ge_nat, ...base] : base))
export const loadBypolls = () =>
  Promise.all([getJSON<Bypoll[]>('/data/bypolls.json'), loadOverlay()])
    .then(([base, ov]) => {
      if (!ov?.bypolls?.length) return base
      // dedupe insurance: if a future Cowork refresh adds the same bypolls, base wins
      const seen = new Set(base.map(b => `${b.s}|${b.y}|${b.c}`))
      return [...base, ...ov.bypolls.filter(b => !seen.has(`${b.s}|${b.y}|${b.c}`))]
    })
export const loadSegments = () => getJSON<Segment[]>('/data/segments.json')
export const loadAEIndex = () =>
  Promise.all([getJSON<IndexRow[]>('/data/ae_index.json'), loadOverlay()])
    .then(([base, ov]) => (ov ? [...ov.ae_index, ...base] : base))
export const loadAllianceCF = () => getJSON<CFRow[]>('/data/alliance_cf.json')
export type StateTurnout = { AE: Record<string, number>; GE: Record<string, number> }
export const loadStateTurnout = () =>
  Promise.all([getJSON<StateTurnout>('/data/state_turnout.json'), loadOverlay()])
    .then(([base, ov]) => (ov ? { AE: base.AE, GE: { ...base.GE, ...ov.ge_turnout } } : base))
export const loadSplitIndex = () => getJSON<Record<string, string[]>>('/data/split/index.json')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
export const loadSplit = (geYear: number, state: string) => getJSON<SplitFile>(`/data/split/${geYear}_${slug(state)}.json`)
// per-state AE segment-share baselines, keyed { ae_year: { "segDom|party": share } } — lets the
// Compare deep-dive follow the assembly-year picker instead of the split file's fixed nearest-AE.
export const loadAESegShares = (state: string) => getJSON<Record<string, Record<string, number>>>(`/data/split/ae_${slug(state)}.json`)
// ── Top-5 candidates per seat (built by tools/build_candidates.py, one file per state) ──
// Lazy: only the state being viewed is fetched. [candidate, party, votes, share%]
export type CandRow = [string, string, number | null, number | null]
export type CandSeat = { n: string; r: string | null; t: number | null; vv: number | null; c: CandRow[] }
export type CandFile = { AE: Record<string, Record<string, CandSeat>>; GE: Record<string, Record<string, CandSeat>> }
const candSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
export const loadCandidates = (state: string) =>
  getJSON<CandFile>(`/data/cand/${candSlug(state)}.json`).catch(() => null)

export const loadACGeo = () => getJSON<GeoJSON.FeatureCollection>('/geo/india_ac_simplified.geojson')
export const loadPCGeo = () => getJSON<GeoJSON.FeatureCollection>('/geo/india_pc_2019_simplified.geojson')
export const loadStateBorders = () => getJSON<GeoJSON.FeatureCollection>('/geo/india_states_borders.geojson')
