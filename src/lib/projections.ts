// Forward-looking projections (kept pure + framework-free so they can be unit-reasoned and
// reused). Every function is an explicit model with stated assumptions — uniform-swing seat
// curves and least-squares extrapolation are first-order what-ifs, NOT forecasts, and the UI
// copy says so. No fabricated data: a projection needs real margins / real vote-share points.
import type { Seat, PartyAgg } from './data'

// ── Uniform-swing seat projection ────────────────────────────────────────────
// "Field" model: a swing of magnitude s (vote-share points) toward party P, applied evenly,
// flips a seat when the winner's margin is under 2·s. Rising swing (s>0) hands P every seat
// where it is the runner-up within reach; falling swing (s<0) costs P every seat it holds by
// that thin a margin. One monotone curve that unifies offence (right) and defence (left).
export function projSeatsAt(scoped: Seat[], P: string, s: number): number {
  const base = scoped.filter(r => r.p === P).length
  if (s > 0) return base + scoped.filter(r => r.q === P && r.m != null && (r.m as number) < 2 * s).length
  if (s < 0) return base - scoped.filter(r => r.p === P && r.m != null && (r.m as number) < 2 * -s).length
  return base
}

export function seatCurve(scoped: Seat[], P: string, range = 12, step = 0.5): { base: number; pts: { s: number; seats: number }[] } {
  const base = scoped.filter(r => r.p === P).length
  const pts: { s: number; seats: number }[] = []
  for (let s = -range; s <= range + 1e-9; s += step) pts.push({ s: +s.toFixed(2), seats: projSeatsAt(scoped, P, s) })
  return { base, pts }
}

/** Smallest forward swing to REACH the majority line, or — if already there — the adverse
 *  swing the majority can absorb before it breaks (the "buffer"). `capped` = exceeds range. */
export function swingToMajority(scoped: Seat[], P: string, majorityN: number, range = 12, step = 0.25):
  { kind: 'reach' | 'buffer'; s: number; capped: boolean } {
  const base = scoped.filter(r => r.p === P).length
  if (base >= majorityN) {
    for (let s = step; s <= range + 1e-9; s += step) if (projSeatsAt(scoped, P, -s) < majorityN) return { kind: 'buffer', s: +s.toFixed(2), capped: false }
    return { kind: 'buffer', s: range, capped: true }
  }
  for (let s = step; s <= range + 1e-9; s += step) if (projSeatsAt(scoped, P, s) >= majorityN) return { kind: 'reach', s: +s.toFixed(2), capped: false }
  return { kind: 'reach', s: range, capped: true }
}

/** The decisive seat: ordering P's reachable near-misses by margin, the one whose capture first
 *  crosses the majority line (null if P already holds the majority or can't reach it). */
export function tippingSeat(scoped: Seat[], P: string, majorityN: number): Seat | null {
  const base = scoped.filter(r => r.p === P).length
  if (base >= majorityN) return null
  const need = majorityN - base
  const gains = scoped.filter(r => r.q === P && r.m != null).sort((a, b) => (a.m as number) - (b.m as number))
  return gains[need - 1] ?? null
}

// ── Trend extrapolation ──────────────────────────────────────────────────────
export type Trend = { slope: number; intercept: number; r2: number; project: (x: number) => number; n: number }
/** Least-squares line over a series indexed 0..len-1 (nulls skipped). slope = change per step.
 *  r2 = fit quality (0..1). null if fewer than 3 real points. */
export function linearTrend(ys: (number | null)[]): Trend | null {
  const pts = ys.map((y, x) => ({ x, y })).filter((p): p is { x: number; y: number } => p.y != null)
  const n = pts.length
  if (n < 3) return null
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  let num = 0, den = 0
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2 }
  const slope = den ? num / den : 0
  const intercept = my - slope * mx
  let sst = 0, ssr = 0
  for (const p of pts) { sst += (p.y - my) ** 2; ssr += (p.y - (intercept + slope * p.x)) ** 2 }
  const r2 = sst ? Math.max(0, 1 - ssr / sst) : 0
  return { slope, intercept, r2, project: (x: number) => intercept + slope * x, n }
}

// ── Electoral volatility (Pedersen index) ────────────────────────────────────
/** Pedersen index per adjacent election pair = ½·Σ|share_p(t) − share_p(t−1)| over listed
 *  parties. Higher = more vote churning between parties (a dealigning, in-play electorate). */
export function pedersen(rows: PartyAgg[], years: number[]): { y: number; v: number }[] {
  const byYear = new Map<number, Map<string, number>>()
  rows.forEach(r => { if (r.v == null) return; if (!byYear.has(r.y)) byYear.set(r.y, new Map()); byYear.get(r.y)!.set(r.p, r.v) })
  const out: { y: number; v: number }[] = []
  for (let i = 1; i < years.length; i++) {
    const a = byYear.get(years[i - 1]), b = byYear.get(years[i])
    if (!a || !b) continue
    let sum = 0
    new Set([...a.keys(), ...b.keys()]).forEach(p => { sum += Math.abs((b.get(p) ?? 0) - (a.get(p) ?? 0)) })
    out.push({ y: years[i], v: +(sum / 2).toFixed(1) })
  }
  return out
}
