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

export const loadSeats = (arena: 'AE' | 'GE') => getJSON<Seat[]>(`/data/seats_${arena.toLowerCase()}.json`)
export const loadPartyAE = () => getJSON<PartyAgg[]>('/data/party_ae.json')
export const loadPartyGEState = () => getJSON<PartyAgg[]>('/data/party_ge_state.json')
export const loadPartyGENat = () => getJSON<PartyAgg[]>('/data/party_ge_nat.json')
export const loadBypolls = () => getJSON<Bypoll[]>('/data/bypolls.json')
export const loadSegments = () => getJSON<Segment[]>('/data/segments.json')
export const loadAEIndex = () => getJSON<IndexRow[]>('/data/ae_index.json')
export const loadAllianceCF = () => getJSON<CFRow[]>('/data/alliance_cf.json')
export type StateTurnout = { AE: Record<string, number>; GE: Record<string, number> }
export const loadStateTurnout = () => getJSON<StateTurnout>('/data/state_turnout.json')
export const loadSplitIndex = () => getJSON<Record<string, string[]>>('/data/split/index.json')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
export const loadSplit = (geYear: number, state: string) => getJSON<SplitFile>(`/data/split/${geYear}_${slug(state)}.json`)
// per-state AE segment-share baselines, keyed { ae_year: { "segDom|party": share } } — lets the
// Compare deep-dive follow the assembly-year picker instead of the split file's fixed nearest-AE.
export const loadAESegShares = (state: string) => getJSON<Record<string, Record<string, number>>>(`/data/split/ae_${slug(state)}.json`)
export const loadACGeo = () => getJSON<GeoJSON.FeatureCollection>('/geo/india_ac_simplified.geojson')
export const loadPCGeo = () => getJSON<GeoJSON.FeatureCollection>('/geo/india_pc_2019_simplified.geojson')
export const loadStateBorders = () => getJSON<GeoJSON.FeatureCollection>('/geo/india_states_borders.geojson')
