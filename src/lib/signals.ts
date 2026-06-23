// Strategic signal engine — scans the constituency-level data we already have for the handful
// of patterns that actually change a decision, and flags each with the EXACT parameters plus the
// seats behind it (the "last mile" drill-down). No booth data needed; everything here derives
// from the seat-level + party-aggregate extracts. Every signal states its numbers and the
// decision it informs — the point is to surface the call, not just draw a chart.
import type { Seat, PartyAgg } from './data'
import { seatHistories } from './analysis'
import { linearTrend } from './projections'

export type Severity = 'critical' | 'watch' | 'note'
export type Signal = {
  id: string
  severity: Severity
  party: string | null
  a: string | null
  headline: string      // the pattern, with its parameters
  soWhat: string        // the decision it informs
  metric: string        // the one number to show big
  metricSub?: string
  seats: Seat[]         // the seats behind the flag — the drill-down
  score: number         // strategic leverage, for ranking
}

export type SignalCtx = {
  seats: Seat[]         // the active election in scope (one election per state, then scoped)
  allRows: Seat[]       // every seat in scope across elections (for history)
  partyRows: PartyAgg[] // party aggregates in scope, all years (v = vote share, may be null)
  vy: number            // the active election year
  isState: boolean
  arena: 'AE' | 'GE'
}

const SEV: Record<Severity, number> = { critical: 100, watch: 60, note: 30 }
const resCat = (r: string | null) => (!r ? 'GEN' : /\bST\b/i.test(r) ? 'ST' : /\bSC\b/i.test(r) ? 'SC' : 'GEN')

export function detectSignals(ctx: SignalCtx): Signal[] {
  return [
    efficiencyGap(ctx), thinBook(ctx), dividedField(ctx),
    erodingStrongholds(ctx), tippingPoint(ctx), momentum(ctx), reservationSkew(ctx),
  ].filter((s): s is Signal => !!s).sort((a, b) => b.score - a.score)
}

// ── 1. Concentration vs spread (vote efficiency) — the "wins on pockets, not popularity" read.
function efficiencyGap(ctx: SignalCtx): Signal | null {
  const { seats, partyRows, vy } = ctx
  const total = seats.length
  if (!total) return null
  const latest = partyRows.filter(r => r.y === vy && r.v != null && (r.v as number) >= 5)
  if (latest.length < 2) return null
  const rows = latest.map(r => {
    const wo = r.wo ?? seats.filter(s => s.p === r.p).length
    const seatShare = +((wo / total) * 100).toFixed(1)
    return { p: r.p, a: r.a, v: r.v as number, seatShare, gap: +(seatShare - (r.v as number)).toFixed(1) }
  })
  const over = [...rows].sort((a, b) => b.gap - a.gap)[0]
  const under = [...rows].sort((a, b) => a.gap - b.gap)[0]
  if (!over || !under || over.p === under.p || over.gap - under.gap < 8) return null
  const targets = seats.filter(s => s.q === under.p && s.m != null && (s.m as number) < 8).sort((a, b) => (a.m as number) - (b.m as number))
  return {
    id: 'efficiency', severity: 'watch', party: under.p, a: under.a,
    headline: `${over.p} wins ${over.seatShare}% of the seats on ${over.v}% of the vote — concentrated, efficient support; ${under.p}'s ${under.v}% of the vote yields only ${under.seatShare}% of seats — broad but spread thin.`,
    soWhat: `${under.p} doesn't have a popularity problem, it has a conversion problem — a vote that never peaks keeps losing under first-past-the-post. It needs a base or an alliance to concentrate that support somewhere, or it stays the runner-up. ${over.p}'s edge is geographic, not numerical — only as safe as those pockets.`,
    metric: `${under.p}: ${under.v}% vote → ${under.seatShare}% seats`, metricSub: 'broad vote, few seats',
    seats: targets,
    score: SEV.watch + Math.min(35, over.gap - under.gap),
  }
}

// ── 2. Thin book — a comfortable-looking seat count built on knife-edge margins.
function thinBook(ctx: SignalCtx): Signal | null {
  const byP = new Map<string, Seat[]>()
  ctx.seats.forEach(s => { if (s.p) { if (!byP.has(s.p)) byP.set(s.p, []); byP.get(s.p)!.push(s) } })
  let best: { p: string; a: string | null; thin: Seat[]; won: number } | null = null
  for (const [p, won] of byP) {
    if (won.length < 10) continue
    const thin = won.filter(s => s.m != null && (s.m as number) < 5)
    if (thin.length / won.length < 0.12) continue
    if (!best || thin.length > best.thin.length) best = { p, a: won[0].a, thin, won: won.length }
  }
  if (!best) return null
  const pct = Math.round((best.thin.length / best.won) * 100)
  const avgM = best.thin.reduce((s, x) => s + (x.m as number), 0) / best.thin.length
  const sev: Severity = pct >= 30 ? 'critical' : 'watch'
  return {
    id: 'thinbook', severity: sev, party: best.p, a: best.a,
    headline: `${best.p} holds ${best.thin.length} of its ${best.won} seats by under 5% — ${pct}% of its book; an adverse swing of about ${(avgM / 2).toFixed(1)}% erases them.`,
    soWhat: `${best.p}'s seat count looks comfortable but it's resting on thin margins — a small wave undoes it. This is the defend-first list, ahead of chasing new ground.`,
    metric: `${best.thin.length} seats < 5%`, metricSub: `${pct}% of ${best.p}'s wins`,
    seats: [...best.thin].sort((a, b) => (a.m as number) - (b.m as number)),
    score: SEV[sev] + pct,
  }
}

// ── 3. Divided field — wins on under 40%, exposed to opposition consolidation.
function dividedField(ctx: SignalCtx): Signal | null {
  const v = ctx.seats.filter(s => s.v != null)
  if (v.length < 30) return null
  const under = v.filter(s => (s.v as number) < 40)
  if (under.length < Math.max(4, v.length * 0.08)) return null
  const byP = new Map<string, number>()
  under.forEach(s => byP.set(s.p, (byP.get(s.p) || 0) + 1))
  const [topP, topN] = [...byP.entries()].sort((a, b) => b[1] - a[1])[0]
  const pct = Math.round((under.length / v.length) * 100)
  return {
    id: 'divided', severity: 'watch', party: topP, a: under.find(s => s.p === topP)?.a ?? null,
    headline: `${under.length} seats (${pct}%) were won on under 40% of the vote — split-field wins; ${topP} took the most (${topN}).`,
    soWhat: `These flip for free if the trailing parties consolidate the anti-winner vote — no new voters needed, just an alliance or a straight fight. For ${topP} they're the soft underbelly to shore up; for everyone else, the cheapest targets on the board.`,
    metric: `${under.length} won < 40%`, metricSub: `${pct}% of decided seats`,
    seats: [...under].sort((a, b) => (a.v as number) - (b.v as number)),
    score: SEV.watch + pct,
  }
}

// ── 4. Eroding strongholds — safe seats whose margin is shrinking, the early warning.
function erodingStrongholds(ctx: SignalCtx): Signal | null {
  const hist = seatHistories(ctx.allRows)
  const eroding: { seat: Seat; prevM: number; curM: number; p: string; a: string | null }[] = []
  for (const cur of ctx.seats) {
    const h = (hist.get(`${cur.s}|${cur.j}`) ?? []).filter(r => r.y <= cur.y)
    if (h.length < 3) continue
    const prev = h[h.length - 2], prev2 = h[h.length - 3]
    if (cur.p && prev?.p === cur.p && prev2?.p === cur.p && cur.m != null && prev.m != null && (cur.m as number) < (prev.m as number) - 5) {
      eroding.push({ seat: cur, prevM: prev.m as number, curM: cur.m as number, p: cur.p, a: cur.a })
    }
  }
  if (eroding.length < 3) return null
  const byP = new Map<string, typeof eroding>()
  eroding.forEach(e => { if (!byP.has(e.p)) byP.set(e.p, []); byP.get(e.p)!.push(e) })
  const [p, list] = [...byP.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (list.length < 3) return null
  const prevAvg = (list.reduce((s, e) => s + e.prevM, 0) / list.length).toFixed(0)
  const curAvg = (list.reduce((s, e) => s + e.curM, 0) / list.length).toFixed(0)
  return {
    id: 'eroding', severity: 'watch', party: p, a: list[0].a,
    headline: `${list.length} of ${p}'s strongholds are softening — average margin fell from ${prevAvg}% to ${curAvg}% over the last two elections.`,
    soWhat: `${p} still wins these, but the base is thinning. On this trajectory they become next cycle's battleground. Reinforce now, while they're still wins — by the time they're swing seats it's too late.`,
    metric: `${list.length} softening`, metricSub: `${prevAvg}% → ${curAvg}% margin`,
    seats: list.map(e => e.seat).sort((a, b) => (a.m as number) - (b.m as number)),
    score: SEV.watch + list.length * 2,
  }
}

// ── 5. Tipping point — how few seats decide control (single-state assembly, or all-India LS).
function tippingPoint(ctx: SignalCtx): Signal | null {
  const houseMode = ctx.arena === 'AE' ? ctx.isState : !ctx.isState
  if (!houseMode) return null
  const N = ctx.seats.length
  if (N < 30) return null
  const majority = Math.floor(N / 2) + 1
  const byP = new Map<string, number>()
  ctx.seats.forEach(s => byP.set(s.p, (byP.get(s.p) || 0) + 1))
  const [leadP, leadN] = [...byP.entries()].sort((a, b) => b[1] - a[1])[0]
  const a = ctx.seats.find(s => s.p === leadP)?.a ?? null
  if (leadN >= majority) {
    const cushion = leadN - majority
    const myThin = ctx.seats.filter(s => s.p === leadP && s.m != null).sort((x, y) => (x.m as number) - (y.m as number))
    const pivot = myThin[Math.min(cushion, myThin.length - 1)]
    const sev: Severity = cushion <= Math.max(3, N * 0.03) ? 'critical' : 'note'
    return {
      id: 'tipping', severity: sev, party: leadP, a,
      headline: `${leadP}'s majority (${leadN}/${N}) survives losing ${cushion} seats; its pivot seat is held by just ${pivot?.m?.toFixed(1)}%.`,
      soWhat: `The whole house turns on roughly ${cushion + 1} thin seats — a uniform swing of about ${pivot?.m != null ? ((pivot.m as number) / 2).toFixed(1) : '?'}% to the direct rival flips control. Both sides should pour everything into exactly these.`,
      metric: `${cushion}-seat cushion`, metricSub: `pivot held by ${pivot?.m?.toFixed(1)}%`,
      seats: myThin.slice(0, cushion + 4),
      score: SEV[sev] + 10,
    }
  }
  const gap = majority - leadN
  const targets = ctx.seats.filter(s => s.q === leadP && s.m != null).sort((x, y) => (x.m as number) - (y.m as number)).slice(0, gap + 4)
  return {
    id: 'tipping', severity: 'note', party: leadP, a,
    headline: `No majority — ${leadP} leads ${leadN}/${N}, ${gap} short; its ${gap} closest near-misses decide control.`,
    soWhat: `Hung-house arithmetic: ${leadP} reaches a majority by flipping its ${gap} nearest losses; the rest hold power by denying them. This short list is the election.`,
    metric: `${gap} seats from power`, metricSub: `${leadP} leads ${leadN}/${N}`,
    seats: targets,
    score: SEV.note + 20,
  }
}

// ── 6. Momentum — the party whose vote share is trending up, consistently.
function momentum(ctx: SignalCtx): Signal | null {
  const years = [...new Set(ctx.partyRows.map(r => r.y))].sort((a, b) => a - b)
  if (years.length < 3) return null
  let best: { p: string; a: string | null; slope: number; cur: number } | null = null
  for (const p of new Set(ctx.partyRows.map(r => r.p))) {
    const series = years.map(y => ctx.partyRows.find(r => r.p === p && r.y === y)?.v ?? null)
    const tr = linearTrend(series)
    if (!tr || tr.r2 < 0.5) continue
    const cur = [...series].reverse().find(v => v != null)
    if (cur == null || cur < 8) continue
    if (!best || tr.slope > best.slope) best = { p, a: ctx.partyRows.find(r => r.p === p)?.a ?? null, slope: +tr.slope.toFixed(1), cur: +cur.toFixed(1) }
  }
  if (!best || best.slope < 1) return null
  return {
    id: 'momentum', severity: 'note', party: best.p, a: best.a,
    headline: `${best.p} is the momentum party — vote share rising about +${best.slope}%/election (now ${best.cur}%) on a consistent trend.`,
    soWhat: `Direction is with ${best.p}: its targets get easier each cycle while rivals defend a flat or falling base. Its near-misses are the seats most likely to flip next — back them.`,
    metric: `+${best.slope}%/election`, metricSub: `${best.p} now ${best.cur}%`,
    seats: ctx.seats.filter(s => s.q === best!.p && s.m != null).sort((a, b) => (a.m as number) - (b.m as number)),
    score: SEV.note + Math.min(25, best.slope * 5),
  }
}

// ── 7. Reservation skew — a base anchored in one seat category, exposed in another.
function reservationSkew(ctx: SignalCtx): Signal | null {
  const byP = new Map<string, number>()
  ctx.seats.forEach(s => byP.set(s.p, (byP.get(s.p) || 0) + 1))
  const lead = [...byP.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!lead) return null
  const rate = (cat: string) => {
    const inCat = ctx.seats.filter(s => resCat(s.r) === cat)
    return inCat.length >= 8 ? { cat, n: inCat.length, won: inCat.filter(s => s.p === lead).length, pct: Math.round((inCat.filter(s => s.p === lead).length / inCat.length) * 100) } : null
  }
  const got = ['SC', 'ST', 'GEN'].map(rate).filter((x): x is { cat: string; n: number; won: number; pct: number } => !!x)
  if (got.length < 2) return null
  const hi = [...got].sort((a, b) => b.pct - a.pct)[0]
  const lo = [...got].sort((a, b) => a.pct - b.pct)[0]
  if (hi.cat === lo.cat || hi.pct - lo.pct < 25) return null
  const label = (c: string) => (c === 'GEN' ? 'general' : c)
  return {
    id: 'reservation', severity: 'note', party: lead, a: ctx.seats.find(s => s.p === lead)?.a ?? null,
    headline: `${lead} sweeps ${label(hi.cat)} seats (${hi.won}/${hi.n}, ${hi.pct}%) but wins only ${lo.pct}% of ${label(lo.cat)} ones — its base is ${label(hi.cat)}-anchored.`,
    soWhat: `${lead}'s coalition is uneven across communities. The ${label(lo.cat)} seats are where it's beatable — and where a rival builds the counter-bloc. Read this against the social arithmetic before allocating effort.`,
    metric: `${hi.pct}% of ${label(hi.cat)} vs ${lo.pct}% of ${label(lo.cat)}`,
    seats: ctx.seats.filter(s => resCat(s.r) === lo.cat && s.p !== lead).sort((a, b) => (a.m ?? 99) - (b.m ?? 99)),
    score: SEV.note + (hi.pct - lo.pct) / 4,
  }
}
