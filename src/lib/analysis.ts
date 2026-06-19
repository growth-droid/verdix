// Cross-election analysis: seat histories, flips, retention, swing.
// All joins go through the normalized seat number `j` and the delimitation
// rules in joins.ts — never join on raw `n` across years.
import type { Seat, PartyAgg } from './data'
import { comparable } from './joins'

export const seatKey = (r: Seat) => `${r.s}|${r.j}`
export const allianceBase = (a: string | null) => (a ? a.replace(/ \(.*\)$/, '') : 'Unaligned')

/** Per-seat election history, sorted by year. */
export function seatHistories(rows: Seat[]): Map<string, Seat[]> {
  const m = new Map<string, Seat[]>()
  for (const r of rows) {
    const k = seatKey(r)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  for (const list of m.values()) list.sort((a, b) => a.y - b.y)
  return m
}

export type SeatChange = {
  cur: Seat; prev: Seat | null
  status: 'flipped' | 'held' | 'no-previous' | 'not-comparable'
}

/**
 * For one "election view" (each state's active election in `active`), resolve the
 * previous result of every seat. AE: a state's previous assembly election;
 * GE: the previous Lok Sabha election. Delimitation breaks → 'not-comparable'.
 */
export function seatChanges(active: Seat[], all: Seat[], arena: 'AE' | 'GE', hist: Map<string, Seat[]> = seatHistories(all)): SeatChange[] {
  return active.map(cur => {
    const past = (hist.get(seatKey(cur)) ?? []).filter(r => r.y < cur.y)
    const prev = past.length ? past[past.length - 1] : null
    if (!prev) {
      // seat may genuinely be new — but if the STATE had an earlier election the seat
      // didn't exist in (renumbering), the comparable() check below would catch it;
      // distinguish states with no earlier election at all.
      return { cur, prev: null, status: 'no-previous' as const }
    }
    if (!comparable(arena, cur.s, prev.y, cur.y)) return { cur, prev, status: 'not-comparable' as const }
    return { cur, prev, status: prev.p === cur.p ? 'held' as const : 'flipped' as const }
  })
}

/** prev-party × new-party seat counts over the flipped+held set. */
export function retentionMatrix(changes: SeatChange[], top = 9) {
  const usable = changes.filter(c => c.prev && c.status !== 'not-comparable')
  const prevCount = new Map<string, number>()
  usable.forEach(c => prevCount.set(c.prev!.p, (prevCount.get(c.prev!.p) || 0) + 1))
  const keep = new Set([...prevCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(e => e[0]))
  const lab = (p: string) => (keep.has(p) ? p : 'Other')
  const parties = [...keep, 'Other']
  const cell = new Map<string, number>()
  usable.forEach(c => {
    const k = lab(c.prev!.p) + '→' + lab(c.cur.p)
    cell.set(k, (cell.get(k) || 0) + 1)
  })
  return { parties, get: (a: string, b: string) => cell.get(a + '→' + b) || 0 }
}

/** Net seats now vs previous, per party. */
export function netChange(changes: SeatChange[]) {
  const d = new Map<string, { now: number; before: number; a: string | null }>()
  for (const c of changes) {
    if (c.status === 'not-comparable' || !c.prev) continue
    const e1 = d.get(c.cur.p) ?? { now: 0, before: 0, a: c.cur.a }; e1.now++; d.set(c.cur.p, e1)
    const e2 = d.get(c.prev.p) ?? { now: 0, before: 0, a: c.prev.a }; e2.before++; d.set(c.prev.p, e2)
  }
  return [...d.entries()]
    .map(([p, e]) => ({ p, a: e.a, now: e.now, before: e.before, net: e.now - e.before }))
    .sort((x, y) => y.net - x.net)
}

/** Vote-share swing per party between a state's two consecutive elections (party aggregates). */
export function swing(party: PartyAgg[], state: string, y: number, prevY: number, minShare = 1) {
  const cur = new Map(party.filter(r => r.s === state && r.y === y).map(r => [r.p, r]))
  const prev = new Map(party.filter(r => r.s === state && r.y === prevY).map(r => [r.p, r]))
  const ps = new Set([...cur.keys(), ...prev.keys()])
  const out: { p: string; a: string | null; from: number | null; to: number | null; d: number }[] = []
  for (const p of ps) {
    const c = cur.get(p), pr = prev.get(p)
    const to = c?.v ?? null, from = pr?.v ?? null
    // a swing is undefined unless BOTH elections have a vote share — never treat a
    // missing (winners-only) share as 0, which would invent a huge phantom swing.
    if (to == null || from == null) continue
    if (to < minShare && from < minShare) continue
    out.push({ p, a: c?.a ?? pr?.a ?? null, from, to, d: to - from })
  }
  return out.sort((x, y2) => y2.d - x.d)
}

export type SeatClass = { cur: Seat; status: 'safe' | 'lean' | 'swing'; party: string | null; a: string | null; wins: number; total: number; seq: { y: number; p: string; a: string | null }[] }
/**
 * Classify every seat in a state as a party's stronghold (safe/lean) or a swing seat,
 * over the comparable election window ending at the state's latest election in `arena`.
 * (TN-deck targeting logic, generalized to any state/party.)
 */
export function classifyState(rows: Seat[], state: string, arena: 'AE' | 'GE'): { window: number[]; seats: SeatClass[] } {
  const mine = rows.filter(r => r.s === state)
  const years = [...new Set(mine.map(r => r.y))].sort((a, b) => a - b)
  if (!years.length) return { window: [], seats: [] }
  const latest = years[years.length - 1]
  const window = years.filter(y => comparable(arena, state, y, latest))
  const byJ = new Map<number, Seat[]>()
  mine.filter(r => window.includes(r.y)).forEach(r => {
    if (!byJ.has(r.j)) byJ.set(r.j, [])
    byJ.get(r.j)!.push(r)
  })
  const seats: SeatClass[] = []
  for (const list of byJ.values()) {
    list.sort((a, b) => a.y - b.y)
    const cur = list[list.length - 1]
    const counts = new Map<string, number>()
    list.forEach(r => counts.set(r.p, (counts.get(r.p) || 0) + 1))
    const [topParty, wins] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    const total = list.length
    const frac = wins / total
    const status: SeatClass['status'] = total >= 2 && frac === 1 ? 'safe' : frac >= 0.6 ? 'lean' : 'swing'
    seats.push({
      cur, status, party: status === 'swing' ? null : topParty, a: list.find(r => r.p === topParty)?.a ?? null, wins, total,
      seq: list.map(r => ({ y: r.y, p: r.p, a: r.a })),
    })
  }
  seats.sort((a, b) => a.cur.n - b.cur.n)
  return { window, seats }
}

/** "Latest election ≤ year" per state — the AE map/view semantics. */
export function activeByState(rows: Seat[], arena: 'AE' | 'GE', year: number): Map<string, Seat[]> {
  const m = new Map<string, Seat[]>()
  for (const r of rows) {
    if (!m.has(r.s)) m.set(r.s, [])
    m.get(r.s)!.push(r)
  }
  for (const [k, list] of m) {
    const yrs = [...new Set(list.map(r => r.y))].filter(yy => yy <= year)
    if (!yrs.length) { m.delete(k); continue }
    // latest election at or before `year`. (Was `arena==='GE' ? year` — that demanded an
    // election in exactly `year`, so callers passing a non-election year, e.g. Battleground's
    // 2026 for Lok Sabha, got an empty map. Math.max(yrs≤year) is identical for the snapped
    // years MapPage/ChangePage pass, and correct everywhere else.)
    const latest = Math.max(...yrs)
    const sel = list.filter(r => r.y === latest)
    if (!sel.length) m.delete(k)
    else m.set(k, sel)
  }
  return m
}
