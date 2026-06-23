// Party strategy engine — reads the constituency + party-aggregate data the way a senior
// political strategist would, and turns it into a decision-ready SWOT plus two playbooks:
// what to do to make a party WIN, and what to do to make it LOSE. Everything is computed and
// quoted with its numbers; no fabrication, and every line degrades gracefully when a metric
// (e.g. vote share for winners-only elections) is absent. No "pp" / "points" wording.
import type { Seat, PartyAgg } from './data'
import { seatHistories } from './analysis'
import { linearTrend } from './projections'

export type SwotItem = { text: string; tag: string }
export type Play = { n: number; move: string; why: string; seats?: Seat[] }
export type ScoreItem = { label: string; value: string; tone: 'pos' | 'neg' | 'neutral' }
export type PartyStrategy = {
  party: string
  a: string | null
  verdict: string
  scorecard: ScoreItem[]
  strengths: SwotItem[]
  weaknesses: SwotItem[]
  opportunities: SwotItem[]
  threats: SwotItem[]
  winPlan: Play[]
  losePlan: Play[]
  rival: string | null
}
export type StrategyCtx = {
  party: string
  seats: Seat[]       // the active election in scope
  allRows: Seat[]     // scope across all years (for stronghold / erosion history)
  partyRows: PartyAgg[] // party aggregates in scope, all years (v = vote share, may be empty)
  vy: number
  isState: boolean
  arena: 'AE' | 'GE'
}

const cat = (r: string | null) => (!r ? 'GEN' : /\bST\b/i.test(r) ? 'ST' : /\bSC\b/i.test(r) ? 'SC' : 'GEN')
const catName = (c: string) => (c === 'GEN' ? 'general' : c)

export function partyStrategy(ctx: StrategyCtx): PartyStrategy | null {
  const { party, seats, allRows, partyRows, vy } = ctx
  const total = seats.length
  if (!total || !party) return null
  const a = seats.find(s => s.p === party)?.a ?? seats.find(s => s.q === party)?.a ?? null
  const won = seats.filter(s => s.p === party)
  const losses = seats.filter(s => s.q === party)
  const wonN = won.length
  const seatShare = (wonN / total) * 100
  const mAsc = (xs: Seat[]) => [...xs].sort((x, y) => (x.m as number) - (y.m as number))

  const share = partyRows.find(r => r.y === vy && r.p === party)?.v ?? null
  const conv = share != null ? seatShare - (share as number) : null
  const thin = mAsc(won.filter(s => s.m != null && (s.m as number) < 5))
  const dominant = won.filter(s => s.m != null && (s.m as number) >= 20)
  const splitField = [...won.filter(s => s.v != null && (s.v as number) < 40)].sort((x, y) => (x.v as number) - (y.v as number))
  const reachable = mAsc(losses.filter(s => s.m != null && (s.m as number) < 10))
  const closeLoss = reachable.filter(s => (s.m as number) < 5)
  const contested = wonN + losses.length
  const strike = contested ? Math.round((wonN / contested) * 100) : null

  // strongholds + eroding (party held a seat every election in its window; margin now shrinking)
  const hist = seatHistories(allRows)
  let strongholds = 0
  const eroding: Seat[] = []
  for (const s of won) {
    const h = (hist.get(`${s.s}|${s.j}`) ?? []).filter(r => r.y <= s.y)
    if (h.length < 3) continue
    if (h.every(r => r.p === party)) strongholds++
    const prev = h[h.length - 2]
    if (prev?.p === party && s.m != null && prev.m != null && (s.m as number) < (prev.m as number) - 5) eroding.push(s)
  }

  // momentum (party + main rival), if a vote-share series exists
  const years = [...new Set(partyRows.map(r => r.y))].sort((x, y) => x - y)
  const slopeOf = (p: string) => {
    if (years.length < 3) return null
    const t = linearTrend(years.map(y => partyRows.find(r => r.p === p && r.y === y)?.v ?? null))
    return t && t.r2 >= 0.4 ? t.slope : null
  }
  const slope = slopeOf(party)

  // reservation profile (win-rate by seat category)
  const catRate = (c: string) => { const inC = seats.filter(s => cat(s.r) === c); return inC.length >= 8 ? Math.round((inC.filter(s => s.p === party).length / inC.length) * 100) : null }
  const cats = (['GEN', 'SC', 'ST'] as const).map(c => [catName(c), catRate(c)] as const).filter((x): x is readonly [string, number] => x[1] != null)
  const strongCat = cats.length ? cats.reduce((p, c) => (c[1] > p[1] ? c : p)) : null
  const weakCat = cats.length ? cats.reduce((p, c) => (c[1] < p[1] ? c : p)) : null

  // rivals: who beats it (winners of the seats where it's runner-up)
  const beat = new Map<string, number>()
  losses.forEach(s => beat.set(s.p, (beat.get(s.p) || 0) + 1))
  const rivalsRanked = [...beat.entries()].sort((x, y) => y[1] - x[1])
  const rival = rivalsRanked[0]?.[0] ?? null
  const oppParties = rivalsRanked.length
  const rivalSlope = rival ? slopeOf(rival) : null

  // ── SWOT ──
  const S: SwotItem[] = [], W: SwotItem[] = [], O: SwotItem[] = [], T: SwotItem[] = []
  if (seatShare >= 40) S.push({ tag: 'scale', text: `Commands the house — ${wonN} of ${total} seats (${seatShare.toFixed(0)}%).` })
  if (strongholds >= 3) S.push({ tag: 'base', text: `${strongholds} fortress seats it has never lost across the window — a guaranteed floor.` })
  if (conv != null && conv >= 5) S.push({ tag: 'efficiency', text: `Efficient — ${(share as number).toFixed(0)}% of the vote becomes ${seatShare.toFixed(0)}% of seats; support sits where it converts.` })
  if (dominant.length >= Math.max(3, wonN * 0.25)) S.push({ tag: 'depth', text: `${dominant.length} wins by 20%+ — deep, uncontested seats no swing reaches.` })
  if (slope != null && slope >= 1.2) S.push({ tag: 'momentum', text: `Momentum is with it — vote share rising about ${slope.toFixed(1)}% an election.` })
  if (strongCat && strongCat[1] >= 60) S.push({ tag: 'coalition', text: `Owns the ${strongCat[0]} seats (${strongCat[1]}%) — a locked social bloc.` })
  if (strike != null && strike >= 60 && wonN >= 5) S.push({ tag: 'strike', text: `Wins ${strike}% of the seats it seriously contests — a high strike rate.` })

  if (thin.length && thin.length / Math.max(1, wonN) >= 0.2) W.push({ tag: 'fragile', text: `${thin.length} of its ${wonN} wins are under 5% — ${Math.round((thin.length / wonN) * 100)}% of the book is knife-edge.` })
  if (splitField.length >= Math.max(3, wonN * 0.15)) W.push({ tag: 'minority', text: `${splitField.length} wins on under 40% — minority mandates that hold only while the opposition stays split.` })
  if (conv != null && conv <= -5) W.push({ tag: 'efficiency', text: `Inefficient — ${(share as number).toFixed(0)}% of the vote yields only ${seatShare.toFixed(0)}% of seats; the vote is spread too thin.` })
  if (slope != null && slope <= -1) W.push({ tag: 'momentum', text: `Slipping — vote share down about ${Math.abs(slope).toFixed(1)}% an election.` })
  if (weakCat && weakCat[1] <= 35) W.push({ tag: 'coalition', text: `Weak among ${weakCat[0]} seats (only ${weakCat[1]}%) — a coalition gap a rival can prise open.` })
  if (eroding.length >= 3) W.push({ tag: 'erosion', text: `${eroding.length} strongholds are softening — the floor is thinning under it.` })
  if (seatShare < 15 && strongholds < 2) W.push({ tag: 'base', text: `Shallow base — ${wonN} seats and no deep fortress block to build from.` })

  if (closeLoss.length) O.push({ tag: 'targets', text: `${closeLoss.length} seats lost by under 5% — flips with a nudge.` })
  if (reachable.length) O.push({ tag: 'targets', text: `${reachable.length} losses within 10% — the realistic target board.` })
  if (oppParties >= 3 && losses.length >= 6) O.push({ tag: 'consolidation', text: `The vote against it is split across ${oppParties} parties — wherever it leads, a straight fight or alliance lets it bank the plurality.` })
  if (weakCat && weakCat[1] <= 40) O.push({ tag: 'growth', text: `Room to grow in ${weakCat[0]} seats — only ${weakCat[1]}% today.` })
  if (slope != null && slope >= 1) O.push({ tag: 'momentum', text: `The tide is in — press the near-misses now, while the trend runs its way.` })

  const exposure = splitField.length + thin.length
  if (rival && rivalSlope != null && rivalSlope >= 1.2) T.push({ tag: 'rival', text: `${rival} is gaining (about ${rivalSlope.toFixed(1)}% an election) — the structural challenger.` })
  if (exposure >= Math.max(4, wonN * 0.25)) T.push({ tag: 'consolidation', text: `${exposure} seats are exposed if the opposition unites — its sub-40% wins and thin holds are the soft underbelly.` })
  if (eroding.length >= 3) T.push({ tag: 'erosion', text: `Its safe seats are eroding — today's fortress is next cycle's battleground.` })
  if (slope != null && slope <= -1 && rival) T.push({ tag: 'momentum', text: `A falling base hands ${rival} the initiative — every soft seat is now in play.` })
  if (conv != null && conv >= 8) T.push({ tag: 'efficiency', text: `Its edge is geographic, not numerical — lose the pockets and the seat count falls faster than the vote.` })

  // ── playbooks ──
  const win: Play[] = []
  if (thin.length) win.push({ n: 0, move: 'Fortify the floor', why: `Hold the ${thin.length} seats it carries by under 5% — a swing of about ${(thin.reduce((s, x) => s + (x.m as number), 0) / thin.length / 2).toFixed(1)}% erases them. Defend before you attack.`, seats: thin })
  if (reachable.length) win.push({ n: 0, move: 'Take the near-misses', why: `Throw weight at the ${reachable.length} seats lost within 10% — the realistic gains, not the no-hopes.`, seats: reachable })
  if (splitField.length) win.push({ n: 0, move: 'Lock the minority mandates', why: `Shore up the ${splitField.length} sub-40% wins before the opposition consolidates against them.`, seats: splitField })
  if (oppParties >= 3 && losses.length >= 6) win.push({ n: 0, move: 'Pre-empt the alliance', why: `The anti-${party} vote is split ${oppParties} ways — keep it that way, or absorb the swing voters first before a rival unites them.` })
  if (conv != null && conv <= -5) win.push({ n: 0, move: 'Concentrate the vote', why: `A vote spread evenly wins nothing under first-past-the-post — pick winnable pockets, build a base there, and stop bleeding effort into no-hope seats.` })
  if (weakCat && weakCat[1] <= 40) win.push({ n: 0, move: 'Close the coalition gap', why: `Build among ${weakCat[0]} seats (only ${weakCat[1]}% now) — the bloc keeping it short of a majority.` })
  if (slope != null && slope >= 1) win.push({ n: 0, move: 'Ride the momentum', why: `Vote share is climbing about ${slope.toFixed(1)}% an election — front-load the near-misses while the tide carries.` })

  const lose: Play[] = []
  if (splitField.length) lose.push({ n: 0, move: 'Unite the opposition', why: `Its ${splitField.length} sub-40% wins flip in a straight fight — one challenger, not three. Consolidating the anti-${party} vote is the single biggest lever.`, seats: splitField })
  if (thin.length) lose.push({ n: 0, move: 'Hit the thin book', why: `Target the ${thin.length} seats it holds by under 5% — a modest, focused swing takes them.`, seats: thin })
  if (eroding.length >= 3) lose.push({ n: 0, move: 'Crack the fortresses', why: `${eroding.length} of its strongholds are already softening — push there; the base is cracking on its own.`, seats: eroding })
  if (weakCat && weakCat[1] <= 40) lose.push({ n: 0, move: 'Attack the weak flank', why: `Build where it is weakest — the ${weakCat[0]} seats (only ${weakCat[1]}% to it) — and deny it a cross-community coalition.` })
  if (conv != null && conv >= 5) lose.push({ n: 0, move: 'Break the pockets', why: `It wins on concentrated pockets, not broad reach — nationalise the contest or split its core areas to dilute that efficiency.` })
  if (rival) lose.push({ n: 0, move: 'Back the challenger', why: `${rival} already beats it in ${beat.get(rival)} seats${rivalSlope != null && rivalSlope > 0 ? ' and is rising' : ''} — consolidate behind ${rival} as the single alternative.` })
  win.forEach((p, i) => (p.n = i + 1))
  lose.forEach((p, i) => (p.n = i + 1))

  // ── scorecard + verdict ──
  const tone = (good: boolean, bad: boolean): 'pos' | 'neg' | 'neutral' => (good ? 'pos' : bad ? 'neg' : 'neutral')
  const scorecard: ScoreItem[] = [
    { label: 'Seats', value: `${wonN}/${total}`, tone: tone(seatShare >= 40, seatShare < 12) },
    ...(share != null ? [{ label: 'Vote share', value: `${(share as number).toFixed(1)}%`, tone: 'neutral' as const }] : []),
    ...(conv != null ? [{ label: 'Conversion', value: `${conv >= 0 ? '+' : ''}${conv.toFixed(0)}`, tone: tone(conv >= 4, conv <= -4) }] : []),
    ...(strike != null ? [{ label: 'Strike rate', value: `${strike}%`, tone: tone(strike >= 60, strike < 35) }] : []),
    { label: 'Thin holds', value: `${thin.length}`, tone: tone(false, thin.length >= Math.max(3, wonN * 0.25)) },
    { label: 'Targets <10%', value: `${reachable.length}`, tone: tone(reachable.length >= 5, false) },
    ...(slope != null ? [{ label: 'Momentum', value: `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}/elec`, tone: tone(slope >= 1, slope <= -1) }] : []),
  ]

  const fragile = (thin.length + splitField.length) / Math.max(1, wonN)
  let verdict: string
  if (seatShare >= 45) verdict = fragile > 0.35 ? 'Commands the house — but on soft ground, exposed to a united opposition.' : 'Dominant and secure — the party to beat.'
  else if (seatShare >= 25) verdict = slope != null && slope > 0 ? 'A rising contender with a real target board.' : 'A serious contender — a strong bloc with room to grow.'
  else if (seatShare >= 8) verdict = slope != null && slope >= 1 ? 'Insurgent — small but climbing fast.' : 'A mid-tier force — niche strongholds, limited reach.'
  else verdict = slope != null && slope >= 1 ? 'Marginal but stirring — watch the trend.' : 'Marginal — a spoiler or a fading force.'

  return {
    party, a, verdict, scorecard,
    strengths: S.slice(0, 4), weaknesses: W.slice(0, 4), opportunities: O.slice(0, 4), threats: T.slice(0, 4),
    winPlan: win.slice(0, 5), losePlan: lose.slice(0, 5), rival,
  }
}
