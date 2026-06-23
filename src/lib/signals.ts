// Strategic signal engine — scans the constituency-level data we already have for the handful
// of patterns that actually change a decision, and flags each with the EXACT parameters plus the
// seats behind it (the "last mile" drill-down). No booth data needed; everything here derives
// from the seat-level + party-aggregate extracts.
//
// Each signal now carries a per-party BREAKDOWN (`rows`) so the whole field is visible at a glance
// — not just the one or two parties at the extremes — rendered as a compact mini-bar list. The
// long prose headline is gone: a short `title` + `caption` says what the pattern is, the breakdown
// shows every party, and a one-line `soWhat` states the decision.
import type { Seat, PartyAgg } from './data'
import { seatHistories } from './analysis'
import { linearTrend } from './projections'

export type Severity = 'critical' | 'watch' | 'note'
export type Tone = 'pos' | 'neg' | 'neutral'

/** One party (or category) line in a signal's breakdown. */
export type SignalRow = {
  label: string         // party code (or a seat-category name)
  a: string | null      // alliance, for the colour dot
  value: string         // the primary figure, e.g. "21% → 27%" or "36 of 59 · 61%"
  delta?: string         // an optional secondary figure shown at the right (tone-coloured)
  bar: number           // 0..1 magnitude for the mini-bar
  tone: Tone            // colours the bar + delta: pos = strength, neg = exposure, neutral
  badge?: string         // optional one-word tag, e.g. "efficient" / "wasted" / "rising"
  color?: string         // explicit dot colour (for non-party rows); else derived from label/a
}

export type Signal = {
  id: string
  severity: Severity
  title: string         // short, scannable — the pattern in a few words
  caption: string       // what this measures, one short line
  party: string | null  // the lead party (accent colour for the metric)
  a: string | null
  metric: string        // the one punchy figure, top-right
  metricSub?: string
  rows: SignalRow[]     // per-party breakdown — the whole field
  rowsNote?: string      // small note under the breakdown (e.g. "+3 more parties")
  soWhat: string        // the decision it informs, one line
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
const ROWCAP = 8
function cap<T>(a: T[], n: number) { return a.slice(0, n) }
function moreNote(total: number) { return total > ROWCAP ? `+${total - ROWCAP} more part${total - ROWCAP === 1 ? 'y' : 'ies'}` : undefined }
function byParty(seats: Seat[]) { const m = new Map<string, Seat[]>(); seats.forEach(s => { if (s.p) { if (!m.has(s.p)) m.set(s.p, []); m.get(s.p)!.push(s) } }); return m }

export function detectSignals(ctx: SignalCtx): Signal[] {
  return [
    efficiencyGap(ctx), thinBook(ctx), dividedField(ctx),
    erodingStrongholds(ctx), tippingPoint(ctx), momentum(ctx), reservationSkew(ctx),
  ].filter((s): s is Signal => !!s).sort((a, b) => b.score - a.score)
}

// ── 1. Vote efficiency — every party's vote share → seat share, who over-converts vs wastes.
function efficiencyGap(ctx: SignalCtx): Signal | null {
  const { seats, partyRows, vy } = ctx
  const total = seats.length
  if (!total) return null
  const latest = partyRows.filter(r => r.y === vy && r.v != null && (r.v as number) >= 2)
  if (latest.length < 2) return null
  const data = latest.map(r => {
    const wo = r.wo ?? seats.filter(s => s.p === r.p).length
    const seatShare = (wo / total) * 100, v = r.v as number
    return { p: r.p, a: r.a, v, seatShare, gap: seatShare - v }
  }).sort((a, b) => b.gap - a.gap)
  const over = data[0], under = data[data.length - 1]
  if (over.p === under.p || over.gap - under.gap < 8) return null
  const maxAbs = Math.max(...data.map(d => Math.abs(d.gap)), 1)
  const rows: SignalRow[] = cap(data, ROWCAP).map(d => ({
    label: d.p, a: d.a,
    value: `${d.v.toFixed(0)}% → ${d.seatShare.toFixed(0)}%`,
    delta: `${d.gap >= 0 ? '+' : '−'}${Math.abs(d.gap).toFixed(0)}`,
    bar: Math.abs(d.gap) / maxAbs,
    tone: d.gap >= 4 ? 'pos' : d.gap <= -4 ? 'neg' : 'neutral',
    badge: d.gap >= 10 ? 'efficient' : d.gap <= -10 ? 'wasted' : undefined,
  }))
  const targets = seats.filter(s => s.q === under.p && s.m != null && (s.m as number) < 8).sort((a, b) => (a.m as number) - (b.m as number))
  return {
    id: 'efficiency', severity: 'watch', party: under.p, a: under.a,
    title: 'Vote efficiency', caption: 'vote share → seat share — who converts, whose vote is wasted',
    metric: `${under.p} ${under.v.toFixed(0)}%→${under.seatShare.toFixed(0)}%`, metricSub: 'broad vote, few seats',
    rows, rowsNote: moreNote(data.length),
    soWhat: `${under.p} has a conversion problem, not a popularity one — its vote is too evenly spread to win seats; it needs a base or an alliance to concentrate it. ${over.p}'s edge is geographic, not numerical — only as safe as its pockets.`,
    seats: targets,
    score: SEV.watch + Math.min(35, over.gap - under.gap),
  }
}

// ── 2. Thin margins — every party's knife-edge book (seats held under 5%).
function thinBook(ctx: SignalCtx): Signal | null {
  const data = [...byParty(ctx.seats).entries()].map(([p, won]) => {
    const thin = won.filter(s => s.m != null && (s.m as number) < 5)
    return { p, a: won[0].a, won: won.length, thin, pct: thin.length / won.length }
  }).filter(d => d.won >= 5 && d.thin.length > 0).sort((a, b) => b.thin.length - a.thin.length)
  if (!data.length) return null
  const best = data[0]
  if (best.won < 10 || best.pct < 0.12) return null
  const maxThin = Math.max(...data.map(d => d.thin.length), 1)
  const rows: SignalRow[] = cap(data, ROWCAP).map(d => ({
    label: d.p, a: d.a,
    value: `${d.thin.length} of ${d.won} · ${Math.round(d.pct * 100)}%`,
    bar: d.thin.length / maxThin, tone: 'neg',
    badge: d === best ? 'most exposed' : undefined,
  }))
  const pct = Math.round(best.pct * 100)
  const avgM = best.thin.reduce((s, x) => s + (x.m as number), 0) / best.thin.length
  const sev: Severity = pct >= 30 ? 'critical' : 'watch'
  return {
    id: 'thinbook', severity: sev, party: best.p, a: best.a,
    title: 'Thin margins', caption: 'seats held under 5% — the first to fall on a swing',
    metric: `${best.thin.length} seats < 5%`, metricSub: `${pct}% of ${best.p}'s wins`,
    rows, rowsNote: moreNote(data.length),
    soWhat: `${best.p}'s seat count looks comfortable but rests on thin margins — an adverse swing of about ${(avgM / 2).toFixed(1)}% erases ${best.thin.length} of them. This is the defend-first list, ahead of chasing new ground.`,
    seats: data.flatMap(d => d.thin).sort((a, b) => (a.m as number) - (b.m as number)),
    score: SEV[sev] + pct,
  }
}

// ── 3. Split-field wins — wins under 40%, by party, exposed to consolidation.
function dividedField(ctx: SignalCtx): Signal | null {
  const decided = ctx.seats.filter(s => s.v != null)
  if (decided.length < 30) return null
  const under = decided.filter(s => (s.v as number) < 40)
  if (under.length < Math.max(4, decided.length * 0.08)) return null
  const m = new Map<string, Seat[]>()
  under.forEach(s => { if (!m.has(s.p)) m.set(s.p, []); m.get(s.p)!.push(s) })
  const data = [...m.entries()].map(([p, list]) => ({ p, a: list[0].a, n: list.length })).sort((a, b) => b.n - a.n)
  const max = Math.max(...data.map(d => d.n), 1)
  const rows: SignalRow[] = cap(data, ROWCAP).map(d => ({
    label: d.p, a: d.a, value: `${d.n} seat${d.n !== 1 ? 's' : ''} < 40%`, bar: d.n / max, tone: 'neutral',
  }))
  const top = data[0], pct = Math.round((under.length / decided.length) * 100)
  return {
    id: 'divided', severity: 'watch', party: top.p, a: rows[0]?.a ?? null,
    title: 'Split-field wins', caption: 'won on under 40% of the vote — flip if the field consolidates',
    metric: `${under.length} won < 40%`, metricSub: `${pct}% of decided seats`,
    rows, rowsNote: moreNote(data.length),
    soWhat: `These need no new voters — they flip if the trailing parties consolidate the anti-winner vote (an alliance, or a straight fight). ${top.p} has the most to shore up; for everyone else they're the cheapest targets on the board.`,
    seats: [...under].sort((a, b) => (a.v as number) - (b.v as number)),
    score: SEV.watch + pct,
  }
}

// ── 4. Softening strongholds — safe seats whose margin is shrinking, by party.
function erodingStrongholds(ctx: SignalCtx): Signal | null {
  const hist = seatHistories(ctx.allRows)
  const eroding: { seat: Seat; prevM: number; curM: number; p: string; a: string | null }[] = []
  for (const cur of ctx.seats) {
    const h = (hist.get(`${cur.s}|${cur.j}`) ?? []).filter(r => r.y <= cur.y)
    if (h.length < 3) continue
    const prev = h[h.length - 2], prev2 = h[h.length - 3]
    if (cur.p && prev?.p === cur.p && prev2?.p === cur.p && cur.m != null && prev.m != null && (cur.m as number) < (prev.m as number) - 5)
      eroding.push({ seat: cur, prevM: prev.m as number, curM: cur.m as number, p: cur.p, a: cur.a })
  }
  if (eroding.length < 3) return null
  const m = new Map<string, typeof eroding>()
  eroding.forEach(e => { if (!m.has(e.p)) m.set(e.p, []); m.get(e.p)!.push(e) })
  const data = [...m.entries()].map(([p, list]) => ({ p, a: list[0].a, list, n: list.length, drop: list.reduce((s, e) => s + (e.prevM - e.curM), 0) / list.length })).sort((a, b) => b.n - a.n)
  const lead = data[0]
  if (lead.n < 3) return null
  const max = Math.max(...data.map(d => d.n), 1)
  const rows: SignalRow[] = cap(data, ROWCAP).map(d => ({
    label: d.p, a: d.a, value: `${d.n} softening`, delta: `−${d.drop.toFixed(0)}%`, bar: d.n / max, tone: 'neg',
  }))
  const prevAvg = (lead.list.reduce((s, e) => s + e.prevM, 0) / lead.list.length).toFixed(0)
  const curAvg = (lead.list.reduce((s, e) => s + e.curM, 0) / lead.list.length).toFixed(0)
  return {
    id: 'eroding', severity: 'watch', party: lead.p, a: lead.a,
    title: 'Softening strongholds', caption: 'safe seats whose margin is shrinking — the early warning',
    metric: `${lead.n} softening`, metricSub: `${prevAvg}% → ${curAvg}% margin`,
    rows, rowsNote: moreNote(data.length),
    soWhat: `${lead.p} still wins these, but the base is thinning — on this trajectory they're next cycle's battleground. Reinforce now, while they're still wins, not once they're swing seats.`,
    seats: lead.list.map(e => e.seat).sort((a, b) => (a.m as number) - (b.m as number)),
    score: SEV.watch + lead.n * 2,
  }
}

// ── 5. Margin of control — the seat tally vs the majority line; how few seats decide the house.
function tippingPoint(ctx: SignalCtx): Signal | null {
  const houseMode = ctx.arena === 'AE' ? ctx.isState : !ctx.isState
  if (!houseMode) return null
  const N = ctx.seats.length
  if (N < 30) return null
  const majority = Math.floor(N / 2) + 1
  const m = new Map<string, { n: number; a: string | null }>()
  ctx.seats.forEach(s => { const e = m.get(s.p) ?? { n: 0, a: s.a }; e.n++; m.set(s.p, e) })
  const ranked = [...m.entries()].map(([p, e]) => ({ p, a: e.a, n: e.n })).sort((a, b) => b.n - a.n)
  const lead = ranked[0]
  const maxN = ranked[0].n
  const rows: SignalRow[] = cap(ranked, ROWCAP).map(d => ({
    label: d.p, a: d.a, value: `${d.n} seat${d.n !== 1 ? 's' : ''}`, bar: d.n / maxN,
    tone: d.n >= majority ? 'pos' : 'neutral',
    badge: d === lead ? (lead.n >= majority ? 'majority' : 'largest') : undefined,
  }))
  if (lead.n >= majority) {
    const cushion = lead.n - majority
    const myThin = ctx.seats.filter(s => s.p === lead.p && s.m != null).sort((x, y) => (x.m as number) - (y.m as number))
    const pivot = myThin[Math.min(cushion, myThin.length - 1)]
    const sev: Severity = cushion <= Math.max(3, N * 0.03) ? 'critical' : 'note'
    return {
      id: 'tipping', severity: sev, party: lead.p, a: lead.a,
      title: 'Margin of control', caption: `seat tally vs the ${majority}-seat majority line`,
      metric: `${cushion}-seat cushion`, metricSub: `pivot held by ${pivot?.m?.toFixed(1)}%`,
      rows, rowsNote: `majority = ${majority} of ${N}`,
      soWhat: `The house turns on roughly ${cushion + 1} thin seats — a uniform swing of about ${pivot?.m != null ? ((pivot.m as number) / 2).toFixed(1) : '?'}% to the direct rival flips control. Both sides should pour everything into exactly these.`,
      seats: myThin.slice(0, cushion + 4),
      score: SEV[sev] + 10,
    }
  }
  const gap = majority - lead.n
  return {
    id: 'tipping', severity: 'note', party: lead.p, a: lead.a,
    title: 'Margin of control', caption: `no majority — seat tally vs the ${majority}-seat line`,
    metric: `${gap} seats from power`, metricSub: `${lead.p} leads ${lead.n}/${N}`,
    rows, rowsNote: `majority = ${majority} of ${N}`,
    soWhat: `Hung house: ${lead.p} reaches a majority by flipping its ${gap} nearest losses; everyone else holds power by denying them. This short list is the election.`,
    seats: ctx.seats.filter(s => s.q === lead.p && s.m != null).sort((x, y) => (x.m as number) - (y.m as number)).slice(0, gap + 4),
    score: SEV.note + 20,
  }
}

// ── 6. Momentum — every party's vote-share trend, who's rising and who's fading.
function momentum(ctx: SignalCtx): Signal | null {
  const years = [...new Set(ctx.partyRows.map(r => r.y))].sort((a, b) => a - b)
  if (years.length < 3) return null
  const data = [...new Set(ctx.partyRows.map(r => r.p))].map(p => {
    const series = years.map(y => ctx.partyRows.find(r => r.p === p && r.y === y)?.v ?? null)
    const tr = linearTrend(series)
    const cur = [...series].reverse().find(v => v != null) ?? null
    return tr && cur != null && cur >= 3 ? { p, a: ctx.partyRows.find(r => r.p === p)?.a ?? null, slope: tr.slope, r2: tr.r2, cur } : null
  }).filter((x): x is { p: string; a: string | null; slope: number; r2: number; cur: number } => !!x).sort((a, b) => b.slope - a.slope)
  if (data.length < 2) return null
  const riser = data[0], faller = data[data.length - 1]
  if (riser.slope < 1 || riser.r2 < 0.5) return null
  const maxAbs = Math.max(...data.map(d => Math.abs(d.slope)), 1)
  const rows: SignalRow[] = cap(data, ROWCAP).map(d => ({
    label: d.p, a: d.a,
    value: `${d.slope >= 0 ? '+' : '−'}${Math.abs(d.slope).toFixed(1)}%/election`,
    delta: `now ${d.cur.toFixed(0)}%`,
    bar: Math.abs(d.slope) / maxAbs,
    tone: d.slope >= 0.8 ? 'pos' : d.slope <= -0.8 ? 'neg' : 'neutral',
    badge: d === riser ? 'rising' : (d === faller && faller.slope <= -0.8 ? 'falling' : undefined),
  }))
  return {
    id: 'momentum', severity: 'note', party: riser.p, a: riser.a,
    title: 'Momentum', caption: 'vote-share trend per election — who\'s rising, who\'s fading',
    metric: `${riser.p} +${riser.slope.toFixed(1)}%/elec`, metricSub: `now ${riser.cur.toFixed(0)}%`,
    rows, rowsNote: moreNote(data.length),
    soWhat: `Direction is with ${riser.p} — its targets get easier each cycle while ${faller.slope < 0 ? `${faller.p} defends a falling base` : 'rivals stay flat'}. Its near-misses are the seats most likely to flip next.`,
    seats: ctx.seats.filter(s => s.q === riser.p && s.m != null).sort((a, b) => (a.m as number) - (b.m as number)),
    score: SEV.note + Math.min(25, riser.slope * 5),
  }
}

// ── 7. Social coalition — the leader's win-rate by seat category (where its base is, where it isn't).
function reservationSkew(ctx: SignalCtx): Signal | null {
  const m = new Map<string, number>()
  ctx.seats.forEach(s => m.set(s.p, (m.get(s.p) || 0) + 1))
  const lead = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!lead) return null
  const TONE_HEX = { pos: '#10b981', neg: '#f43f5e', neutral: '#64748b' }
  const stat = (cat: string) => {
    const inCat = ctx.seats.filter(s => resCat(s.r) === cat)
    return inCat.length >= 8 ? { cat, n: inCat.length, won: inCat.filter(s => s.p === lead).length, pct: Math.round((inCat.filter(s => s.p === lead).length / inCat.length) * 100) } : null
  }
  const got = ['GEN', 'SC', 'ST'].map(stat).filter((x): x is { cat: string; n: number; won: number; pct: number } => !!x)
  if (got.length < 2) return null
  const hi = [...got].sort((a, b) => b.pct - a.pct)[0]
  const lo = [...got].sort((a, b) => a.pct - b.pct)[0]
  if (hi.cat === lo.cat || hi.pct - lo.pct < 25) return null
  const label = (c: string) => (c === 'GEN' ? 'General' : c)
  const rows: SignalRow[] = [...got].sort((a, b) => b.pct - a.pct).map(g => {
    const tone: Tone = g.cat === hi.cat ? 'pos' : g.cat === lo.cat ? 'neg' : 'neutral'
    return { label: `${label(g.cat)} seats`, a: null, value: `${g.won}/${g.n} · ${g.pct}%`, bar: g.pct / 100, tone, color: TONE_HEX[tone], badge: g.cat === hi.cat ? 'stronghold' : g.cat === lo.cat ? 'exposed' : undefined }
  })
  const loSeats = ctx.seats.filter(s => resCat(s.r) === lo.cat)
  const loWinner = [...loSeats.reduce((mm, s) => mm.set(s.p, (mm.get(s.p) || 0) + 1), new Map<string, number>()).entries()].filter(([p]) => p !== lead).sort((a, b) => b[1] - a[1])[0]?.[0]
  return {
    id: 'reservation', severity: 'note', party: lead, a: ctx.seats.find(s => s.p === lead)?.a ?? null,
    title: 'Social coalition', caption: `${lead}'s win-rate by seat type — where its base is, where it isn't`,
    metric: `${hi.pct}% vs ${lo.pct}%`, metricSub: `${label(hi.cat)} vs ${label(lo.cat)} seats`,
    rows,
    soWhat: `${lead}'s coalition is ${label(hi.cat)}-anchored. The ${label(lo.cat)} seats are where it's beatable${loWinner ? ` — ${loWinner} leads there` : ''}, and where a rival builds the counter-bloc.`,
    seats: loSeats.filter(s => s.p !== lead).sort((a, b) => (a.m ?? 99) - (b.m ?? 99)),
    score: SEV.note + (hi.pct - lo.pct) / 4,
  }
}
