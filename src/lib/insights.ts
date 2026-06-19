// Strategist-grade derived reads. Every insight is computed, never asserted —
// formulas follow the metrics catalog; swing approximations are flagged in copy.
import type { Seat } from './data'
import { allianceBase, type SeatChange } from './analysis'

export type Insight = { tone: 'risk' | 'edge' | 'note'; text: string }

const fmt = (n: number) => n.toLocaleString()

/**
 * Majority cushion: for the leading alliance, how many of its seats sit beyond the
 * majority line, and what uniform pairwise swing (≈ pivot margin / 2) costs the majority.
 */
export function majorityCushion(active: Seat[]): Insight | null {
  if (!active.length) return null
  const total = active.length
  const half = Math.floor(total / 2) + 1
  const byAll = new Map<string, Seat[]>()
  active.forEach(r => {
    const k = allianceBase(r.a)
    if (!byAll.has(k)) byAll.set(k, [])
    byAll.get(k)!.push(r)
  })
  const [lead, seats] = [...byAll.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (lead === 'Unaligned') return null
  if (seats.length < half) {
    return { tone: 'note', text: `${lead} leads with ${fmt(seats.length)}/${fmt(total)} — short of the ${fmt(half)} majority line (hung house arithmetic).` }
  }
  const cushionSeats = seats.length - half
  const withM = seats.filter(s => s.m != null).sort((a, b) => (a.m ?? 99) - (b.m ?? 99))
  const pivot = withM[Math.min(cushionSeats, withM.length - 1)]
  const swingPP = pivot?.m != null ? (pivot.m / 2).toFixed(1) : null
  return {
    tone: cushionSeats <= Math.max(5, total * 0.02) ? 'risk' : 'note',
    text: `${lead}: ${fmt(seats.length)}/${fmt(total)} — majority survives losing ${fmt(cushionSeats)} seats; pivot seat margin ${pivot?.m?.toFixed(1) ?? '–'}%` +
      (swingPP ? ` (≈${swingPP}% uniform swing to the direct rival costs the majority).` : '.'),
  }
}

/** Shallow wins: seats each top party holds under 3% — wave-vulnerability. */
export function shallowWins(active: Seat[], top = 3): Insight[] {
  const byP = new Map<string, { n: number; close: number }>()
  active.forEach(r => {
    const e = byP.get(r.p) ?? { n: 0, close: 0 }
    e.n++
    if (r.m != null && r.m < 3) e.close++
    byP.set(r.p, e)
  })
  return [...byP.entries()]
    .filter(([, e]) => e.n >= 10 && e.close / e.n >= 0.12)
    .sort((a, b) => b[1].close - a[1].close).slice(0, top)
    .map(([p, e]) => ({
      tone: 'risk' as const,
      text: `${p} holds ${fmt(e.close)} of its ${fmt(e.n)} seats by <3% (${Math.round((e.close / e.n) * 100)}%) — a thin-margin book that a small adverse swing wipes out.`,
    }))
}

/** Minority-share wins: winner under 40% = opposition-division seats — consolidation targets. */
export function minorityWins(active: Seat[]): Insight | null {
  const v = active.filter(r => r.v != null)
  if (v.length < 50) return null
  const under = v.filter(r => (r.v ?? 100) < 40)
  if (!under.length) return null
  const byP = new Map<string, number>()
  under.forEach(r => byP.set(r.p, (byP.get(r.p) || 0) + 1))
  const [topP, topN] = [...byP.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    tone: 'edge',
    text: `${fmt(under.length)} seats (${Math.round((under.length / v.length) * 100)}%) were won with <40% vote share — divided-opposition seats; ${topP} benefits most (${fmt(topN)}). Index-of-opposition-unity plays live here.`,
  }
}

/** Where the churn concentrated. */
export function flipConcentration(changes: SeatChange[]): Insight | null {
  const flips = changes.filter(c => c.status === 'flipped')
  if (flips.length < 10) return null
  const byS = new Map<string, number>()
  flips.forEach(c => byS.set(c.cur.s, (byS.get(c.cur.s) || 0) + 1))
  const top = [...byS.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return {
    tone: 'note',
    text: `${fmt(flips.length)} seats changed hands; churn concentrated in ${top.map(([s, n]) => `${s} (${n})`).join(', ')}.`,
  }
}

/** Retention read: which party defended its base worst. */
export function worstDefence(changes: SeatChange[]): Insight | null {
  const def = new Map<string, { had: number; kept: number }>()
  for (const c of changes) {
    if (!c.prev || c.status === 'not-comparable') continue
    const e = def.get(c.prev.p) ?? { had: 0, kept: 0 }
    e.had++
    if (c.status === 'held') e.kept++
    def.set(c.prev.p, e)
  }
  const worst = [...def.entries()].filter(([, e]) => e.had >= 15)
    .map(([p, e]) => ({ p, rate: e.kept / e.had, had: e.had }))
    .sort((a, b) => a.rate - b.rate)[0]
  if (!worst || worst.rate > 0.6) return null
  return {
    tone: 'risk',
    text: `${worst.p} retained only ${Math.round(worst.rate * 100)}% of the ${fmt(worst.had)} seats it was defending — incumbency is working against it.`,
  }
}

/**
 * Classic two-party swingometer: uniform transfer of `pp` from party A to B flips
 * every A-held seat where B is runner-up and margin% < 2·pp.
 */
export function swingometer(active: Seat[], from: string, to: string, pp: number) {
  const flips = active.filter(r => r.p === from && r.q === to && r.m != null && (r.m ?? 99) < 2 * pp)
    .sort((a, b) => (a.m ?? 0) - (b.m ?? 0))
  const fromSeats = active.filter(r => r.p === from).length
  const toSeats = active.filter(r => r.p === to).length
  return { flips, fromAfter: fromSeats - flips.length, toAfter: toSeats + flips.length, fromBefore: fromSeats, toBefore: toSeats }
}
