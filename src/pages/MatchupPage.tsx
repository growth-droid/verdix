import { useEffect, useMemo, useState } from 'react'
import { loadSeats, loadPartyAE, loadPartyGEState, loadPartyGENat, type Seat, type PartyAgg } from '../lib/data'
import { colorFor } from '../lib/colors'
import { useFilters } from '../store'
import ChoroplethMap from '../components/ChoroplethMap'
import SeatDrawer from '../components/SeatDrawer'
import { Chart, ChartCard, Dot, Info, Select, StickyControls, VoteSeatChart } from '../components/ui'
import { activeByState } from '../lib/analysis'
import { linearTrend } from '../lib/projections'
import { baseOpt, valAxis, AXIS, GRID, vgrad } from '../lib/theme'

const tc = (s: string) => (s || '').toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
const GREY = '#3f3f46'
const pct = (n: number | null) => (n == null ? '–' : n.toFixed(1) + '%')
type Rec = { tone: 'edge' | 'risk' | 'note'; text: string }

export default function MatchupPage() {
  const { arena, state } = useFilters()
  const st = state ?? 'All states'
  const isState = st !== 'All states'
  const [rows, setRows] = useState<Seat[]>([])
  const [partyAE, setPartyAE] = useState<PartyAgg[]>([])
  const [partyGE, setPartyGE] = useState<PartyAgg[]>([])
  const [natGE, setNatGE] = useState<PartyAgg[]>([])
  const [picked, setPicked] = useState<Seat | null>(null)
  const [selA, setSelA] = useState<string | null>(null)
  const [selB, setSelB] = useState<string | null>(null)
  const [selC, setSelC] = useState<string | null>(null)
  const [threeWay, setThreeWay] = useState(false)
  useEffect(() => { loadSeats(arena).then(setRows) }, [arena])
  useEffect(() => { loadPartyAE().then(setPartyAE); loadPartyGEState().then(setPartyGE); loadPartyGENat().then(setNatGE) }, [])

  // latest election per state (then scoped) — the comparison snapshot
  const active = useMemo(() => {
    const all = [...activeByState(rows, arena, 2026).values()].flat()
    return isState ? all.filter(r => r.s === st) : all
  }, [rows, arena, isState, st])

  // parties present in scope, ranked by presence (winner + runner-up weight)
  const ranked = useMemo(() => {
    const c = new Map<string, number>()
    active.forEach(r => { c.set(r.p, (c.get(r.p) || 0) + 1); if (r.q) c.set(r.q, (c.get(r.q) || 0) + 0.4) })
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])
  }, [active])
  const parties = useMemo(() => [...ranked].sort(), [ranked])
  const A = selA && ranked.includes(selA) ? selA : ranked[0] ?? ''
  const B = selB && ranked.includes(selB) && selB !== A ? selB : ranked.find(p => p !== A) ?? ''
  const C = threeWay ? (selC && ranked.includes(selC) && selC !== A && selC !== B ? selC : ranked.find(p => p !== A && p !== B) ?? '') : null
  const sel = useMemo(() => [A, B, ...(C ? [C] : [])].filter(Boolean), [A, B, C])
  const selSet = useMemo(() => new Set(sel), [sel])
  const colOf = (p: string) => colorFor(p, active.find(r => r.p === p || r.q === p)?.a ?? null)
  useEffect(() => { setPicked(null) }, [arena, st])

  // vote share / strike rate source for the scope (per-state, or national for GE; AE-national has none)
  const shareSrc = useMemo(() => (isState ? (arena === 'AE' ? partyAE : partyGE).filter(r => r.s === st) : arena === 'GE' ? natGE : []), [isState, arena, partyAE, partyGE, natGE, st])
  const statOf = (p: string) => {
    const rs = shareSrc.filter(r => r.p === p)
    if (!rs.length) return { v: null as number | null, strike: null as number | null }
    const yr = Math.max(...rs.map(r => r.y)); const r = rs.find(x => x.y === yr)
    return { v: r?.v ?? null, strike: r?.f ? Math.round(((r.wo ?? 0) / r.f) * 100) : null }
  }

  // ── per-party scorecard ───────────────────────────────────────────────────
  const card = useMemo(() => sel.map(p => {
    const won = active.filter(r => r.p === p)
    const m = won.map(r => r.m).filter((x): x is number => x != null)
    const stat = statOf(p)
    return {
      p, color: colOf(p), seats: won.length,
      v: stat.v, strike: stat.strike,
      avgM: m.length ? +(m.reduce((a, b) => a + b, 0) / m.length).toFixed(1) : null,
      safe: won.filter(r => (r.m ?? 0) >= 10).length,
      thin: won.filter(r => r.m != null && r.m < 5).length,
      sub40: won.filter(r => (r.v ?? 100) < 40).length,
      targets: active.filter(r => r.q === p).length,
      closeT: active.filter(r => r.q === p && r.m != null && r.m < 5).length,
    }
  }), [sel, active, shareSrc]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── direct head-to-head among the selected parties ────────────────────────
  const h2h = useMemo(() => {
    const out: { w: string; r: string; n: number; close: number }[] = []
    for (const w of sel) for (const r of sel) if (w !== r) {
      const seats = active.filter(s => s.p === w && s.q === r)
      out.push({ w, r, n: seats.length, close: seats.filter(s => s.m != null && s.m < 5).length })
    }
    return out.sort((a, b) => b.n - a.n)
  }, [sel, active])
  const h2hMax = Math.max(1, ...h2h.map(x => x.n))

  // ── trajectory: seats + vote share over time ──────────────────────────────
  const scopeRows = useMemo(() => (isState ? rows.filter(r => r.s === st) : rows), [rows, isState, st])
  const years = useMemo(() => [...new Set(scopeRows.map(r => r.y))].sort((a, b) => a - b), [scopeRows])
  const seatsByPY = useMemo(() => {
    const m = new Map<string, Map<number, number>>()
    scopeRows.forEach(r => { if (!m.has(r.p)) m.set(r.p, new Map()); const yy = m.get(r.p)!; yy.set(r.y, (yy.get(r.y) || 0) + 1) })
    return m
  }, [scopeRows])
  const shareByPY = useMemo(() => {
    const m = new Map<string, Map<number, number | null>>()
    shareSrc.forEach(r => { if (!m.has(r.p)) m.set(r.p, new Map()); m.get(r.p)!.set(r.y, r.v) })
    return m
  }, [shareSrc])
  const momentum = useMemo(() => sel.map(p => {
    const tr = linearTrend(years.map(y => shareByPY.get(p)?.get(y) ?? null))
    return { p, slope: tr ? +tr.slope.toFixed(2) : null, next: tr ? +Math.max(0, Math.min(100, tr.project(years.length))).toFixed(1) : null }
  }), [sel, years, shareByPY])

  // ── territory map ─────────────────────────────────────────────────────────
  const mapByState = useMemo(() => {
    if (isState) return new Map([[st, active]])
    const m = activeByState(rows, arena, 2026)
    return m
  }, [isState, st, active, rows, arena])
  const territoryColor = (s: Seat) => (selSet.has(s.p) ? colorFor(s.p, s.a) : GREY)
  const territorySub = (s: Seat) => (selSet.has(s.p) ? `${s.p}${s.m != null ? ' · won by ' + s.m.toFixed(1) + '%' : ''}` : `${s.p} (not in this matchup)`)
  const legendItems = useMemo(() => [...sel.map(p => ({ label: p, color: colOf(p), n: active.filter(r => r.p === p).length })), { label: 'Other parties', color: GREY, n: active.filter(r => !selSet.has(r.p)).length }], [sel, active, selSet]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── framing verdict + strategic recommendations ───────────────────────────
  const scopeLabel = isState ? st : 'India'
  const arenaLabel = arena === 'AE' ? 'assembly' : 'Lok Sabha'
  const verdict = useMemo(() => {
    if (card.length < 2) return null
    const s = [...card].sort((a, b) => b.seats - a.seats)
    const [lead, second] = s
    const gap = lead.seats - second.seats
    const tone = gap > lead.seats * 0.5 ? 'a commanding lead' : gap > 0 ? 'a working edge' : 'a dead heat'
    return `Across ${scopeLabel}'s latest ${arenaLabel} election, ${lead.p} holds ${tone} — ${lead.seats} seats to ${second.p}'s ${second.seats}${C ? ` and ${s[2].p}'s ${s[2].seats}` : ''}. The questions below: who is rising, where they collide, and what each should do.`
  }, [card, C, scopeLabel, arenaLabel])

  const recs = useMemo<Rec[]>(() => {
    if (card.length < 2) return []
    const r: Rec[] = []
    const bySeats = [...card].sort((a, b) => b.seats - a.seats)
    const lead = bySeats[0]
    // 1 — the leader's grip
    r.push({ tone: 'edge', text: `${lead.p} leads with ${lead.seats} seats; ${lead.safe} are safe (won by ≥10%)${lead.thin ? `, but ${lead.thin} are held by under 5% — its soft spots` : ''}.` })
    // 2 — momentum / the climber
    const mom = [...momentum].filter(m => m.slope != null).sort((a, b) => (b.slope! - a.slope!))[0]
    if (mom && mom.slope! > 0.4) r.push({ tone: 'edge', text: `${mom.p} has the momentum — vote share trending about +${mom.slope}%/election (≈ ${mom.next}% next on a straight-line read). It's the party to watch.` })
    const fade = [...momentum].filter(m => m.slope != null).sort((a, b) => (a.slope! - b.slope!))[0]
    if (fade && fade.slope! < -0.4 && fade.p !== mom?.p) r.push({ tone: 'risk', text: `${fade.p} is sliding — about ${fade.slope}%/election. Without a reset it keeps shedding ground.` })
    // 3 — each party's prime target (where it's runner-up to a rival in the set, within 5%)
    for (const p of sel) {
      const c = card.find(x => x.p === p)!
      const versus = h2h.filter(x => x.r === p).sort((a, b) => b.close - a.close)[0] // who beats p the most
      if (c.closeT >= 3) {
        const topHeld = h2h.filter(x => x.w !== p && x.r === p).sort((a, b) => b.n - a.n)[0]
        r.push({ tone: 'note', text: `${p}'s clearest path: ${c.closeT} of its ${c.targets} reachable seats are losses by under 5%${topHeld ? ` — ${topHeld.close} of them to ${topHeld.w}` : ''}. Concentrate resources there.` })
      }
      void versus
    }
    // 4 — divided-field exposure
    const split = bySeats.find(c => c.sub40 >= Math.max(4, c.seats * 0.25))
    if (split) r.push({ tone: 'risk', text: `${split.p} won ${split.sub40} seats with under 40% of the vote — divided-field wins. If the others consolidate the anti-${split.p} vote, those are the first to fall.` })
    // 5 — conversion efficiency (needs vote share)
    const eff = card.filter(c => c.v != null)
    if (eff.length >= 2 && active.length) {
      const totalSeats = active.length
      const withGap = eff.map(c => ({ p: c.p, gap: +(((c.seats / totalSeats) * 100) - (c.v ?? 0)).toFixed(1) })).sort((a, b) => b.gap - a.gap)
      const best = withGap[0], worst = withGap[withGap.length - 1]
      if (best.gap - worst.gap > 4) r.push({ tone: 'note', text: `${best.p} converts votes to seats far better than ${worst.p} (seat-share runs ${best.gap >= 0 ? '+' : ''}${best.gap}% vs vote for ${best.p}, ${worst.gap >= 0 ? '+' : ''}${worst.gap}% for ${worst.p}) — ${worst.p}'s vote is spread thin; an alliance or targeting fix would unlock seats.` })
    }
    // 6 — the decisive contest
    const top = h2h[0]
    if (top && top.n > 0) r.push({ tone: 'note', text: `The decisive contest is ${top.w} vs ${top.r}: they finish 1–2 in ${top.n} seats (${top.close} within 5%). That cluster is where ${scopeLabel} turns.` })
    return r
  }, [card, momentum, h2h, sel, active, scopeLabel]) // eslint-disable-line react-hooks/exhaustive-deps

  // best-in-row highlight for the scorecard (true = this party is best for that metric)
  const bestOf = (vals: (number | null)[], hiGood: boolean) => {
    const nums = vals.filter((v): v is number => v != null)
    if (!nums.length) return -1
    const target = hiGood ? Math.max(...nums) : Math.min(...nums)
    return vals.findIndex(v => v === target)
  }
  const metrics: { label: string; get: (c: typeof card[number]) => number | null; fmt: (n: number | null) => string; hiGood: boolean; info?: string }[] = [
    { label: 'Seats won', get: c => c.seats, fmt: n => (n == null ? '–' : String(n)), hiGood: true },
    { label: 'Vote share', get: c => c.v, fmt: pct, hiGood: true, info: 'Latest election; national for Lok Sabha, statewide for a state. All-India assembly has no single national figure.' },
    { label: 'Strike rate', get: c => c.strike, fmt: n => (n == null ? '–' : n + '%'), hiGood: true, info: 'Of the seats it contested, the share it won.' },
    { label: 'Avg winning margin', get: c => c.avgM, fmt: pct, hiGood: true },
    { label: 'Safe seats (≥10%)', get: c => c.safe, fmt: n => (n == null ? '–' : String(n)), hiGood: true },
    { label: 'Thin holds (<5%)', get: c => c.thin, fmt: n => (n == null ? '–' : String(n)), hiGood: false, info: 'Seats it holds by under 5% — its most vulnerable wins.' },
    { label: 'Reachable targets', get: c => c.targets, fmt: n => (n == null ? '–' : String(n)), hiGood: true, info: 'Seats where it finished runner-up — its offensive board.' },
    { label: 'Won on <40%', get: c => c.sub40, fmt: n => (n == null ? '–' : String(n)), hiGood: false, info: 'Wins on a divided field — exposed to opposition consolidation.' },
  ]

  if (ranked.length < 2) return <div className="text-faint text-sm py-16 text-center">Not enough parties in this view to compare. Pick a region/arena with a real contest.</div>

  return (
    <div>
      <StickyControls>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-slate-500">Matchup</span>
          <span className="inline-flex items-center gap-1.5"><Dot color={colOf(A)} /><Select value={A} onChange={setSelA} options={parties} width="w-32" /></span>
          <span className="text-faint text-xs">vs</span>
          <span className="inline-flex items-center gap-1.5"><Dot color={colOf(B)} /><Select value={B} onChange={setSelB} options={parties.filter(p => p !== A)} width="w-32" /></span>
          {C && <><span className="text-faint text-xs">vs</span><span className="inline-flex items-center gap-1.5"><Dot color={colOf(C)} /><Select value={C} onChange={setSelC} options={parties.filter(p => p !== A && p !== B)} width="w-32" /></span></>}
          <button onClick={() => setThreeWay(t => !t)} className="text-xs px-2.5 py-1 rounded-full border border-white/10 text-muted hover:text-ink hover:border-white/25 transition-colors">
            {threeWay ? '− third party' : '+ third party'}
          </button>
          <span className="text-[11px] text-slate-500 ml-auto">{isState ? st : 'All India'} · {arenaLabel} · change region/arena in the Focus bar</span>
        </div>
      </StickyControls>

      {verdict && (
        <div className="mb-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-3.5">
          <div className="flex items-center gap-2 mb-1">
            {sel.map(p => <span key={p} className="inline-flex items-center text-[12px] font-semibold" style={{ color: colOf(p) }}><Dot color={colOf(p)} />{p}</span>)}
          </div>
          <p className="text-[13.5px] text-ink leading-relaxed">{verdict}</p>
        </div>
      )}

      {/* Scorecard — metric rows × party columns */}
      <ChartCard className="mb-4" title="Head-to-head scorecard"
        note="Best value in each row is highlighted in the party's colour. ‘Reachable targets’ = seats where the party was runner-up; ‘thin holds’ and ‘won on <40%’ are vulnerability signals. Vote share / strike rate need candidate-vote data (statewide or Lok Sabha-national).">
        <div className="overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left font-medium text-faint py-2 pr-3 whitespace-nowrap">Metric</th>
                {card.map(c => <th key={c.p} className="text-right font-semibold py-2 px-3 whitespace-nowrap" style={{ color: c.color }}><Dot color={c.color} />{c.p}</th>)}
              </tr>
            </thead>
            <tbody>
              {metrics.map(mt => {
                const vals = card.map(c => mt.get(c))
                const bi = bestOf(vals, mt.hiGood)
                return (
                  <tr key={mt.label} className="border-b border-white/[0.05]">
                    <td className="py-2 pr-3 text-muted whitespace-nowrap">{mt.label}{mt.info && <Info>{mt.info}</Info>}</td>
                    {card.map((c, i) => (
                      <td key={c.p} className={`py-2 px-3 text-right tabular-nums ${i === bi ? 'font-bold' : 'text-slate-300'}`} style={i === bi ? { color: c.color } : undefined}>
                        {mt.fmt(mt.get(c))}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        {/* Trajectory */}
        <ChartCard title="Trajectory — seats + vote share over time"
          note="Columns = seats won; line = vote share % (where available). Read them together: who is climbing, who is fading.">
          {momentum.some(m => m.slope != null) && (
            <div className="flex flex-wrap gap-2 mb-3">
              {momentum.filter(m => m.slope != null).map(m => (
                <span key={m.p} className={`text-[11.5px] px-2.5 py-1 rounded-lg border ${m.slope! > 0.2 ? 'border-emerald-400/25 text-emerald-200/90' : m.slope! < -0.2 ? 'border-red-400/25 text-red-200/90' : 'border-white/10 text-muted'}`}>
                  <Dot color={colOf(m.p)} />{m.p} {m.slope! > 0 ? '+' : ''}{m.slope}%/election
                </span>
              ))}
            </div>
          )}
          <VoteSeatChart years={years} parties={sel.map(p => ({ p, a: active.find(r => r.p === p)?.a ?? null, color: colOf(p) }))}
            seatsOf={p => years.map(y => seatsByPY.get(p)?.get(y) ?? null)}
            shareOf={p => years.map(y => shareByPY.get(p)?.get(y) ?? null)} height={300} />
        </ChartCard>

        {/* Direct head-to-head */}
        <ChartCard title="Direct battleground — who beats whom"
          note="Among the selected parties, the seats where two of them finished 1–2. The brighter segment is who won more; the number in brackets is how many were within 5% — the live contest.">
          {h2h.some(x => x.n > 0) ? (
            <div className="space-y-2.5 pt-1">
              {h2h.filter(x => x.n > 0).map(x => (
                <div key={x.w + x.r} className="text-[12px]">
                  <div className="flex items-center justify-between mb-1">
                    <span><b style={{ color: colOf(x.w) }}>{x.w}</b> <span className="text-faint">beat</span> <b style={{ color: colOf(x.r) }}>{x.r}</b></span>
                    <span className="tabular-nums text-muted">{x.n} seats {x.close > 0 && <span className="text-amber-300">· {x.close} within 5%</span>}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-900 overflow-hidden">
                    <div className="h-2.5 rounded-full" style={{ width: `${(x.n / h2hMax) * 100}%`, background: colOf(x.w) }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="h-[220px] grid place-items-center text-faint text-sm text-center px-6">These parties rarely finish 1–2 against each other in {scopeLabel} — they aren't each other's main rivals here.</div>}
        </ChartCard>
      </div>

      {/* Territory map */}
      <ChartCard className="mb-4" title={`Territory — where each party wins${isState ? '' : ' (all-India)'}`}
        note="Each seat is coloured by which of the selected parties won it; everything else is grey. Shows each party's geographic base and where their territories meet. Click a seat for its full report.">
        <ChoroplethMap key={'matchup' + arena + st + sel.join('-')} byState={mapByState} arena={arena} activeYear={2026}
          focusState={isState ? st : undefined} height="h-[440px]"
          colorOf={territoryColor} subOf={territorySub} legendTitle="Winner (this matchup)" legendItems={legendItems}
          onPick={s => { if (s) setPicked(s) }} />
      </ChartCard>

      {/* Strategic recommendations */}
      <ChartCard title="Strategic read — what the data says to do"
        note="Generated from the metrics above (seats, margins, momentum, direct contests, conversion). Directional reads to interrogate, not instructions.">
        {recs.length ? (
          <div className="grid md:grid-cols-2 gap-2.5">
            {recs.map((rc, i) => (
              <div key={i} className={`text-[12.5px] leading-relaxed px-3.5 py-2.5 rounded-xl border ${rc.tone === 'edge' ? 'border-emerald-400/25 bg-emerald-400/[0.05] text-emerald-100/90' : rc.tone === 'risk' ? 'border-red-400/25 bg-red-400/[0.05] text-red-100/90' : 'border-white/10 bg-white/[0.02] text-slate-200/90'}`}>
                <span className="mr-1.5">{rc.tone === 'edge' ? '▲' : rc.tone === 'risk' ? '▼' : '◆'}</span>{rc.text}
              </div>
            ))}
          </div>
        ) : <div className="h-[80px] grid place-items-center text-faint text-sm">Pick two parties to generate the strategic read.</div>}
      </ChartCard>

      {picked && <SeatDrawer seat={picked} all={rows} arena={arena} onClose={() => setPicked(null)} />}
    </div>
  )
}
