import { useEffect, useMemo, useState } from 'react'
import { loadSeats, loadSegments, loadBypolls, type Seat, type Segment, type Bypoll } from '../lib/data'
import { colorFor } from '../lib/colors'
import { useFilters } from '../store'
import { Chart, ChartCard, Dot, Info, KPI, Seg, Select, SortTable, Spark, StickyControls, type Col } from '../components/ui'
import { activeByState, seatHistories, seatKey } from '../lib/analysis'
import { swingometer } from '../lib/insights'
import { seatCurve, swingToMajority, tippingSeat, projSeatsAt } from '../lib/projections'
import { baseOpt, valAxis, AXIS, GRID, vgrad } from '../lib/theme'

const tc = (s: string) => s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())

type Mode = 'attack' | 'defend'
type Row = {
  seat: Seat; gapTrend: (number | null)[]; mom: boolean       // momentum (offence: lead improving · defence: lead eroding)
  bypoll: boolean; seg: boolean | null; sub40: boolean; score: number
}

export default function BattlegroundPage() {
  const { arena, state, party, setParty } = useFilters()
  const st = state ?? 'All states'
  const [rows, setRows] = useState<Seat[]>([])
  const [segs, setSegs] = useState<Segment[]>([])
  const [byp, setByp] = useState<Bypoll[]>([])
  const [band, setBand] = useState(5)
  const [mode, setMode] = useState<Mode>('attack')
  const [swingPP, setSwingPP] = useState(2)
  const [from, setFrom] = useState<string | null>(null)
  useEffect(() => { loadSeats(arena).then(setRows); loadSegments().then(setSegs); loadBypolls().then(setByp) }, [arena])

  const active = useMemo(() => [...activeByState(rows, arena, 2026).values()].flat(), [rows, arena])
  const scoped = useMemo(() => st === 'All states' ? active : active.filter(r => r.s === st), [active, st])
  // ranked by presence (winner + runner-up weight) so the default is the biggest player, not alphabetical
  const ranked = useMemo(() => {
    const c = new Map<string, number>()
    active.forEach(r => { c.set(r.p, (c.get(r.p) || 0) + 1); if (r.q) c.set(r.q, (c.get(r.q) || 0) + 0.5) })
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(e => e[0])
  }, [active])
  const parties = useMemo(() => [...ranked].sort(), [ranked])
  const P = party && parties.includes(party) ? party : ranked[0] ?? ''

  // GE-2024 segment leads in the AE j-domain (skip Assam: its 2026 AE is a different delimitation)
  const segLead = useMemo(() => {
    const m = new Map<string, string>()
    segs.filter(s2 => s2.y === 2024 && s2.s !== 'Assam').forEach(s2 => {
      const j = s2.s === 'Andhra Pradesh' ? s2.n + 119 : s2.n // 2024 segments use current numbering
      m.set(`${s2.s}|${j}`, s2.p)
    })
    return m
  }, [segs])

  // Build BOTH boards in one pass: offence (seats where P is runner-up within the band) and
  // defence (P-held seats within the band, at risk). Same signal engine, mirrored meaning.
  const { offense, defense } = useMemo(() => {
    if (!P) return { offense: [] as Row[], defense: [] as Row[] }
    const hist = seatHistories(rows)
    const lastBypoll = new Map<string, Bypoll>()
    byp.filter(b => b.arena === arena && b.n != null).forEach(b => {
      const k = `${b.s}|${b.n}`
      const prev = lastBypoll.get(k)
      lastBypoll.set(k, prev && prev.y > b.y ? prev : b)
    })
    // P's signed lead on a seat over its recent history (+ = P ahead) → momentum direction
    const trendOf = (seat: Seat) => {
      const h = (hist.get(seatKey(seat)) ?? []).slice(-4)
      const gt = h.map(e => (e.p === P ? e.m : e.q === P ? -(e.m ?? 0) : null))
      const def = gt.filter((g): g is number => g != null)
      return { gt, rising: def.length >= 2 && def[def.length - 1] > def[0], falling: def.length >= 2 && def[def.length - 1] < def[0] }
    }
    const bp = (seat: Seat) => { const b = lastBypoll.get(`${seat.s}|${seat.n}`); return b && b.y >= seat.y ? b : null }
    const segOf = (seat: Seat) => arena === 'AE' && segLead.has(`${seat.s}|${seat.j}`) ? segLead.get(`${seat.s}|${seat.j}`) === P : null

    const offense = scoped
      .filter(r => r.p !== P && r.q === P && r.m != null && (r.m ?? 99) < band)
      .map(seat => {
        const { gt, rising } = trendOf(seat)
        const b = bp(seat); const bypoll = !!b && b.p === P
        const seg = segOf(seat); const sub40 = (seat.v ?? 100) < 40
        const score = Math.round(((band - (seat.m ?? band)) / band) * 50 + (rising ? 20 : 0) + (bypoll ? 15 : 0) + (seg ? 15 : 0))
        return { seat, gapTrend: gt, mom: rising, bypoll, seg, sub40, score }
      }).sort((a, b2) => b2.score - a.score)

    const defense = scoped
      .filter(r => r.p === P && r.m != null && (r.m ?? 99) < band)
      .map(seat => {
        const { gt, falling } = trendOf(seat)
        const b = bp(seat); const bypoll = !!b && b.p !== P                     // lost a bypoll on a seat P holds
        const seg = arena === 'AE' && segLead.has(`${seat.s}|${seat.j}`) ? segLead.get(`${seat.s}|${seat.j}`) !== P : null  // lost the LS-24 ground
        const sub40 = (seat.v ?? 100) < 40                                       // P won it on a divided field
        const score = Math.round(((band - (seat.m ?? band)) / band) * 50 + (falling ? 20 : 0) + (bypoll ? 15 : 0) + (seg ? 15 : 0))
        return { seat, gapTrend: gt, mom: falling, bypoll, seg, sub40, score }
      }).sort((a, b2) => b2.score - a.score)

    return { offense, defense }
  }, [scoped, rows, P, band, byp, arena, segLead])

  const board = mode === 'attack' ? offense : defense

  // ── Seat-projection curve (path to control) ───────────────────────────────
  const houseMode = arena === 'AE' ? st !== 'All states' : st === 'All states'   // one legislature ↔ a real majority line
  const houseN = scoped.length
  const majority = Math.floor(houseN / 2) + 1
  const curve = useMemo(() => (P ? seatCurve(scoped, P) : { base: 0, pts: [] }), [scoped, P])
  const s2m = useMemo(() => (P && houseMode ? swingToMajority(scoped, P, majority) : null), [scoped, P, houseMode, majority])
  const tip = useMemo(() => (P && houseMode ? tippingSeat(scoped, P, majority) : null), [scoped, P, houseMode, majority])
  const netAt = (s: number) => projSeatsAt(scoped, P, s) - curve.base
  const Pcol = colorFor(P)

  const curveOption = useMemo(() => ({
    ...baseOpt,
    grid: { left: 8, right: 18, top: 22, bottom: 28, containLabel: true },
    tooltip: {
      ...baseOpt.tooltip, trigger: 'axis',
      formatter: (ps: { data: [number, number] }[]) => {
        const [s, seats] = ps[0].data; const d = seats - curve.base
        return `<b>${s > 0 ? '+' : ''}${s}% swing ${s >= 0 ? '→ ' + P : 'against ' + P}</b><br/>${seats} seats <span style="color:${d > 0 ? '#34d399' : d < 0 ? '#f87171' : '#94a3b8'}">(${d > 0 ? '+' : ''}${d})</span>`
      },
    },
    xAxis: {
      ...valAxis((v: number) => (v > 0 ? '+' : '') + v + '%'), name: 'uniform swing', nameLocation: 'middle', nameGap: 26,
      nameTextStyle: { color: AXIS, fontSize: 10 }, min: -12, max: 12, splitLine: { show: false },
    },
    yAxis: { ...valAxis(undefined, { min: 0 }), name: 'projected seats', nameGap: 12, nameTextStyle: { color: AXIS, fontSize: 10 }, splitLine: { lineStyle: { type: 'dashed', color: GRID } } },
    series: [{
      type: 'line', smooth: true, showSymbol: false, data: curve.pts.map(p => [p.s, p.seats]),
      lineStyle: { color: Pcol, width: 3 }, areaStyle: { color: vgrad(Pcol), opacity: 0.18 }, z: 3,
      markLine: {
        symbol: 'none', silent: true,
        data: [
          { xAxis: 0, lineStyle: { color: AXIS, width: 1.5 }, label: { formatter: 'now', color: AXIS, fontSize: 10, position: 'insideEndTop' } },
          ...(houseMode ? [{ yAxis: majority, lineStyle: { color: '#fbbf24', type: 'dashed' as const }, label: { formatter: `majority ${majority}`, color: '#fbbf24', fontSize: 10, position: 'insideStartTop' as const } }] : []),
          ...(s2m && s2m.kind === 'reach' && !s2m.capped ? [{ xAxis: s2m.s, lineStyle: { color: '#34d399' }, label: { formatter: `+${s2m.s}%`, color: '#34d399', fontSize: 10 } }] : []),
        ],
      },
    }],
  }), [curve, Pcol, P, houseMode, majority, s2m])

  // opponents holding P's targets — drives the swingometer "from"
  const holders = useMemo(() => {
    const c = new Map<string, number>()
    offense.forEach(t => c.set(t.seat.p, (c.get(t.seat.p) || 0) + 1))
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [offense])
  const FROM = from && holders.some(h => h[0] === from) ? from : holders[0]?.[0] ?? ''
  const swing = useMemo(() => (P && FROM ? swingometer(scoped, FROM, P, swingPP) : null), [scoped, FROM, P, swingPP])
  const swingMax = swing ? Math.max(swing.fromBefore, swing.toBefore, swing.fromAfter, swing.toAfter, 1) : 1

  const cols: Col<Row>[] = [
    { key: 'c', label: 'Seat', get: t => t.seat.c, render: t => <span>{tc(t.seat.c)} <span className="text-slate-500">· {t.seat.y}</span></span> },
    { key: 's', label: 'State', get: t => t.seat.s },
    mode === 'attack'
      ? { key: 'p', label: 'Held by', get: t => t.seat.p, render: t => <span><Dot color={colorFor(t.seat.p, t.seat.a)} />{t.seat.p}</span> }
      : { key: 'p', label: 'Challenger', get: t => t.seat.q, render: t => <span><Dot color={colorFor(t.seat.q ?? '')} />{t.seat.q ?? '–'}</span> },
    { key: 'm', label: 'Margin%', get: t => t.seat.m, align: 'right', render: t => t.seat.m?.toFixed(1) },
    { key: 'wv', label: mode === 'attack' ? 'Holder share%' : 'Your share%', get: t => t.seat.v, align: 'right', render: t => <span className={(t.seat.v ?? 100) < 40 ? 'text-amber-300' : ''}>{t.seat.v?.toFixed(1) ?? '–'}</span> },
    { key: 'tr', label: mode === 'attack' ? `${P} gap trend` : `${P} lead trend`, get: t => t.gapTrend.filter(g => g != null).length, render: t => <Spark data={t.gapTrend} color={t.mom ? (mode === 'attack' ? '#34d399' : '#f87171') : '#94a3b8'} /> },
    {
      key: 'sig', label: 'Signals', get: t => (t.mom ? 1 : 0) + (t.bypoll ? 1 : 0) + (t.seg ? 1 : 0) + (t.sub40 ? 1 : 0),
      render: t => mode === 'attack' ? (
        <span className="flex gap-1 flex-wrap">
          {t.mom && <span className="px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 text-[10px]">momentum</span>}
          {t.bypoll && <span className="px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300 text-[10px]">bypoll✓</span>}
          {t.seg && <span className="px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 text-[10px]">led LS-24</span>}
          {t.sub40 && <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 text-[10px]">&lt;40% hold</span>}
        </span>
      ) : (
        <span className="flex gap-1 flex-wrap">
          {t.mom && <span className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 text-[10px]">lead eroding</span>}
          {t.bypoll && <span className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 text-[10px]">bypoll✗</span>}
          {t.seg && <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 text-[10px]">lost LS-24</span>}
          {t.sub40 && <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 text-[10px]">&lt;40% win</span>}
        </span>
      ),
    },
    { key: 'score', label: mode === 'attack' ? 'Flippability' : 'Vulnerability', get: t => t.score, align: 'right', render: t => <b className={t.score >= 60 ? (mode === 'attack' ? 'text-emerald-300' : 'text-red-300') : t.score >= 35 ? 'text-amber-200' : 'text-slate-300'}>{t.score}</b> },
  ]

  const kpi3 = houseMode && s2m
    ? (s2m.kind === 'reach'
        ? <KPI label={<>Swing to majority <Info>The smallest uniform vote-share swing toward {P} that would lift it to the {majority}-seat majority line, flipping its closest near-miss seats first. A what-if, not a forecast.</Info></>} value={`+${s2m.s}%${s2m.capped ? '+' : ''}`} accent="#34d399" sub={tip ? `tipping seat: ${tc(tip.c)}` : `to reach ${majority}`} />
        : <KPI label={<>Majority buffer <Info>How much uniform swing AGAINST {P} its current majority can absorb before falling below {majority} seats.</Info></>} value={`−${s2m.s}%${s2m.capped ? '+' : ''}`} accent="#fbbf24" sub={`holds ${curve.base}/${houseN} now`} />)
    : <KPI label="Net @ +5% swing" value={`${netAt(5) >= 0 ? '+' : ''}${netAt(5)}`} accent="#34d399" sub={`${curve.base} now → ${projSeatsAt(scoped, P, 5)} seats`} />

  return (
    <div>
      <StickyControls>
      <div className="flex items-center gap-3 flex-wrap">
        <Seg options={[{ v: 'attack', label: '⚔ Attack' }, { v: 'defend', label: '🛡 Defend' }]} value={mode} onChange={v => setMode(v as Mode)} />
        <span className="text-xs text-slate-500">for</span>
        <Select value={P} onChange={setParty} options={parties} width="w-32" />
        <span className="text-xs text-slate-500">{mode === 'attack' ? 'lost by under' : 'held by under'}</span>
        <Seg options={[{ v: '3', label: '3%' }, { v: '5', label: '5%' }, { v: '8', label: '8%' }]} value={String(band)} onChange={v => setBand(+v)} />
        <span className="text-xs text-slate-400">{st === 'All states' ? 'across India' : `in ${st}`}</span>
        <span className="text-[11px] text-slate-500 ml-auto">{arena === 'AE' ? 'basis: each state’s most recent assembly election' : 'basis: 2024 Lok Sabha'}</span>
      </div>
      </StickyControls>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KPI label="Target seats" value={offense.length} accent={mode === 'attack' ? '#34d399' : undefined} sub={`${P} runner-up within ${band}%`} />
        <KPI label="Seats at risk" value={defense.length} accent={mode === 'defend' ? '#f87171' : undefined} sub={`${P} holds these by <${band}%`} />
        {kpi3}
        <KPI label={mode === 'attack' ? 'Top opponent' : 'Top challenger'} value={(mode === 'attack' ? holders[0]?.[0] : defenceChallenger(defense)) ?? '–'} sub={mode === 'attack' ? (holders[0] ? `holds ${holders[0][1]} of your targets` : '') : 'most-frequent runner-up on your thin seats'} />
      </div>

      <ChartCard title={<>Path to control — uniform-swing seat projection <Info>Projected seats for {P} as a uniform vote-share swing is applied evenly across {st === 'All states' ? 'the field' : st}. Right of “now”, {P} gains every seat where it’s the runner-up within twice the swing; left, it sheds every seat it holds that thinly. A first-order what-if, not a forecast.</Info></>}
        className="mb-4"
        note={houseMode
          ? `${majority}-seat line = majority of the ${houseN}-seat house. ${s2m?.kind === 'reach' ? `${P} reaches it on a +${s2m.s}%${s2m.capped ? '+' : ''} swing${tip ? ` — the seat that tips it is ${tc(tip.c)} (${tip.s}, held by ${tip.p} by ${tip.m?.toFixed(1)}%)` : ''}.` : `${P} already holds the majority — it survives an adverse swing of −${s2m?.s}%${s2m?.capped ? '+' : ''}.`}`
          : `Across ${st === 'All states' ? 'all elections in scope' : st} this is a reach/exposure curve, not a single house — there’s no one majority line. At +5% ${P} nets ${netAt(5) >= 0 ? '+' : ''}${netAt(5)} seats; at −5%, ${netAt(-5)}.`}>
        <Chart option={curveOption} style={{ height: 300 }} notMerge />
      </ChartCard>

      <div className="grid lg:grid-cols-3 gap-4">
        <ChartCard title={mode === 'attack' ? `Target board — seats ${P} can flip` : `Defence board — seats ${P} must hold`} className="lg:col-span-2"
          note={mode === 'attack'
            ? `${P} as runner-up, lost by under ${band}%${st !== 'All states' ? ' in ' + st : ''}. Flippability = margin closeness (50) + margin-trend momentum (20) + bypoll won since (15) + led the seat in LS-2024 (15). Read the signals, not just the number.`
            : `${P} as winner, holding by under ${band}%${st !== 'All states' ? ' in ' + st : ''}. Vulnerability = margin thinness (50) + eroding lead (20) + bypoll lost since (15) + lost the seat's ground in LS-2024 (15). High score = defend first.`}>
          {board.length
            ? <SortTable rows={board} cols={cols} defaultSort="score" initialDir="desc" maxH={560}
                search searchIn={t => `${t.seat.c} ${t.seat.s} ${t.seat.p} ${t.seat.q ?? ''}`} />
            : <div className="h-[200px] flex items-center justify-center text-slate-500 text-sm text-center px-8">
                {mode === 'attack'
                  ? <span>No seats where <b className="text-slate-300 mx-1">{P}</b> finished runner-up within {band}%{st !== 'All states' ? ` in ${st}` : ''}. Widen the band or pick another party.</span>
                  : <span><b className="text-slate-300 mx-1">{P}</b> holds no seat by under {band}%{st !== 'All states' ? ` in ${st}` : ''} — no thin-margin exposure at this band.</span>}
              </div>}
        </ChartCard>
        <div className="flex flex-col gap-4">
          <ChartCard title={<>Swingometer — detailed flips <Info>Drag the slider to move a chosen percentage of votes from one party to {P}, evenly everywhere. A seat flips when the winner's margin is smaller than twice the swing. A rough what-if, not a forecast.</Info></>}
            note={`A seat flips when its margin is under 2× the swing. Uniform swings are blunt — treat this as an order-of-magnitude read.`}>
            <div className="flex items-center gap-2 mb-2 text-xs text-slate-400">
              <Select value={FROM} onChange={setFrom} options={holders.map(h => h[0])} width="w-28" />
              <span>→</span>
              <span className="text-slate-200 font-semibold">{P}</span>
            </div>
            <div className="flex items-center gap-3 mb-1">
              <input type="range" min={0} max={10} step={0.25} value={swingPP} onChange={e => setSwingPP(+e.target.value)} className="flex-1 accent-orange-500" />
              <span className="text-lg font-bold tabular-nums w-16 text-right">{swingPP.toFixed(2)}%</span>
            </div>
            {swing && FROM ? (
              <>
                <p className="text-xs text-muted mb-3 leading-relaxed">
                  If <b className="num text-ink">{swingPP.toFixed(2)}</b> in every 100 votes shift from{' '}
                  <b style={{ color: colorFor(FROM) }}>{FROM}</b> to <b style={{ color: colorFor(P) }}>{P}</b>
                  {st !== 'All states' ? ` across ${st}` : ' nationwide'}, <b className="text-ink">{swing.flips.length}</b> seats would change hands:
                </p>
                {([[FROM, swing.fromBefore, swing.fromAfter], [P, swing.toBefore, swing.toAfter]] as const).map(([pty, before, after]) => {
                  const col = colorFor(pty); const d = after - before
                  return (
                    <div key={pty} className="mb-2.5">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span><Dot color={col} />{pty}</span>
                        <span className="num text-faint">{before} → <b className="text-ink">{after}</b>{' '}
                          <span className={d > 0 ? 'text-emerald-400' : d < 0 ? 'text-red-400' : ''}>{d > 0 ? '+' : ''}{d}</span></span>
                      </div>
                      <div className="relative h-2.5 rounded-full bg-slate-900 overflow-hidden">
                        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(before / swingMax) * 100}%`, background: col, opacity: 0.4 }} title="now" />
                        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(after / swingMax) * 100}%`, background: col }} title="projected" />
                      </div>
                    </div>
                  )
                })}
                <div className="mt-3 mb-1 text-[11px] text-muted">Seats that would flip — closest first ({FROM} holds them by this margin today)</div>
                <div className="max-h-[150px] overflow-auto">
                  <table className="w-full text-[11px]">
                    <tbody>{swing.flips.slice(0, 30).map(r => (
                      <tr key={seatKey(r)} className="border-t border-white/[0.05]">
                        <td className="py-1">{tc(r.c)}</td><td className="text-faint">{r.s}</td>
                        <td className="text-right tabular-nums">{r.m?.toFixed(1)}%</td>
                      </tr>))}</tbody>
                  </table>
                  {!swing.flips.length && <div className="text-faint text-xs py-4 text-center">No seats flip at this swing — raise the slider.</div>}
                </div>
              </>
            ) : (
              <div className="text-sm text-faint py-6 text-center">Pick a party with target seats to project a swing.</div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  )
}

// most-frequent challenger across a party's thin-margin held seats
function defenceChallenger(defense: Row[]): string | null {
  const c = new Map<string, number>()
  defense.forEach(t => { if (t.seat.q) c.set(t.seat.q, (c.get(t.seat.q) || 0) + 1) })
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
