import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { loadSeats, loadStateTurnout, type Seat, type StateTurnout } from '../lib/data'
import { colorFor, ALLIANCE_COLORS } from '../lib/colors'
import { useFilters, useTheme } from '../store'
import ChoroplethMap, { type MapMode } from '../components/ChoroplethMap'
import SeatDrawer from '../components/SeatDrawer'
import { Chart, Info, KPI, Seg, Select, Skeleton, StickyControls } from '../components/ui'
import { activeByState, seatChanges, allianceBase } from '../lib/analysis'
import { baseOpt, catAxis, valAxis, labelColor } from '../lib/theme'
import { useIsPhone } from '../lib/useMedia'

const WON = '#16a34a', LOST = '#dc2626'

export default function MapPage() {
  const { arena, year, setYear, setState } = useFilters()
  const themeMode = useTheme()
  const isPhone = useIsPhone()
  const lab = labelColor(themeMode)
  const OUT = themeMode === 'light' ? '#e2e8f0' : '#101727'   // "not in top-2" fill — flips with theme
  const [rows, setRows] = useState<Seat[]>([])
  const [turn, setTurn] = useState<StateTurnout>({ AE: {}, GE: {} })
  const [picked, setPicked] = useState<Seat | null>(null)
  const [sp, setSp] = useSearchParams()
  const grouped = sp.get('group') === 'state'
  const colorParam = sp.get('color') ?? 'winner'
  const mode = (['winner', 'alliance', 'margin', 'turnout', 'party'].includes(colorParam) ? colorParam : 'winner') as MapMode | 'party'
  const nav = useNavigate()
  useEffect(() => { loadSeats(arena).then(setRows); setPicked(null) }, [arena])
  useEffect(() => { loadStateTurnout().then(setTurn) }, [])

  const years = useMemo(() => [...new Set(rows.map(r => r.y))].sort(), [rows])
  const activeYear = useMemo(() => years.includes(year) ? year : (years.length ? Math.max(...years.filter(y => y <= year)) || years[years.length - 1] : year), [years, year])
  const byState = useMemo(() => activeByState(rows, arena, activeYear), [rows, arena, activeYear])
  const active = useMemo(() => [...byState.values()].flat(), [byState])

  const kpi = useMemo(() => {
    const total = active.length
    const changes = seatChanges(active, rows, arena)
    const flips = changes.filter(c => c.status === 'flipped').length
    const nc = changes.filter(c => c.status === 'not-comparable').length
    const close = active.filter(r => r.m != null && r.m < 3).length
    return { total, flips, nc, close }
  }, [active, rows, arena])

  // Avg turnout. HEADLINE = mean over the active snapshot (every state at its latest
  // election ≤ activeYear) so it matches the map; falls back to official state turnout
  // when seat-level t is absent. SPARKLINE + Δ are GE-only: a Lok Sabha year is one
  // clean national cycle (so the per-year trend and the headline agree), whereas AE
  // years mix different state sets and would make the headline and sparkline disagree.
  const turnoutTrend = useMemo(() => {
    const src = turn[arena] ?? {}
    // National turnout from per-state figures, weighted by each state's seat count that year
    // (≈ electorate) — an unweighted mean is skewed by many small high-turnout states
    // (GE-2024 unweighted = 69.6% vs the true elector-weighted ~65.8%).
    const stMean = (y: number) => {
      const seatsOf = new Map<string, number>()
      rows.forEach(r => { if (r.y === y) seatsOf.set(r.s, (seatsOf.get(r.s) || 0) + 1) })
      let wsum = 0, w = 0
      for (const [k, val] of Object.entries(src)) {
        if (!k.endsWith('|' + y)) continue
        const seats = seatsOf.get(k.slice(0, k.lastIndexOf('|'))) || 1
        wsum += val * seats; w += seats
      }
      return w ? +(wsum / w).toFixed(1) : null
    }
    const at = active.filter(r => r.t != null)
    const headline = at.length ? +(at.reduce((a, r) => a + (r.t ?? 0), 0) / at.length).toFixed(1) : stMean(activeYear)
    let spark: (number | null)[] | undefined
    let delta: { value: string; up: boolean; good?: boolean } | undefined
    let prevYear: number | null = null
    if (arena === 'GE') {
      const yVal = (y: number) => {
        const s = rows.filter(r => r.y === y && r.t != null)
        return s.length ? +(s.reduce((a, r) => a + (r.t ?? 0), 0) / s.length).toFixed(1) : stMean(y)
      }
      const ys = [...new Set(rows.map(r => r.y))].sort((a, b) => a - b)
      spark = ys.map(yVal)
      prevYear = [...ys].reverse().find(y => y < activeYear) ?? null
      if (prevYear != null) {
        const cur = yVal(activeYear), prev = yVal(prevYear)
        if (cur != null && prev != null) { const d = +(cur - prev).toFixed(1); delta = { value: Math.abs(d) + '%', up: d >= 0, good: d >= 0 } }
      }
    }
    return { spark, delta, prevYear, headline }
  }, [rows, active, turn, arena, activeYear])

  const partyBar = useMemo(() => {
    const seats = new Map<string, { n: number; a: string | null }>()
    active.forEach(r => { const e = seats.get(r.p) ?? { n: 0, a: r.a }; e.n++; seats.set(r.p, e) })
    const top = [...seats.entries()].sort((a, b) => a[1].n - b[1].n).slice(-10)
    return {
      ...baseOpt, legend: undefined,
      tooltip: { ...baseOpt.tooltip, trigger: 'item' },
      grid: { left: 8, right: 30, top: 6, bottom: 2, containLabel: true },
      xAxis: valAxis(), yAxis: catAxis(top.map(e => e[0])),
      series: [{
        type: 'bar', barWidth: 12,
        data: top.map(([p, e]) => ({ value: e.n, itemStyle: { color: colorFor(p, e.a), borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'right', color: lab, fontSize: 10 },
      }],
    }
  }, [active, lab])

  const donut = useMemo(() => {
    const seats = new Map<string, number>()
    active.forEach(r => seats.set(allianceBase(r.a), (seats.get(allianceBase(r.a)) || 0) + 1))
    const data = [...seats.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
      name, value, itemStyle: { color: ALLIANCE_COLORS[name] ?? '#475569' },
    }))
    return {
      ...baseOpt, legend: undefined,
      tooltip: { ...baseOpt.tooltip, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [{
        type: 'pie', radius: ['52%', '78%'], center: ['50%', '52%'],
        label: { color: lab, fontSize: 10, formatter: '{b}\n{c}' },
        labelLine: { lineStyle: { color: lab } },
        itemStyle: { borderColor: 'transparent', borderWidth: 1.5 },
        data,
      }],
    }
  }, [active, lab])

  // ---- party scoreboard mode (won / lost-as-runner-up / out of top-2) ----
  const rankedParties = useMemo(() => {
    const c = new Map<string, number>()
    active.forEach(r => { c.set(r.p, (c.get(r.p) || 0) + 1); if (r.q) c.set(r.q, (c.get(r.q) || 0) + 0.4) })
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(e => e[0])
  }, [active])
  const partyList = useMemo(() => [...rankedParties].sort(), [rankedParties])
  // default the scoreboard to the biggest party in view (not hardcoded INC)
  const P = sp.get('pp') && partyList.includes(sp.get('pp')!) ? sp.get('pp')! : rankedParties[0] ?? ''
  const partyColorOf = useCallback((r: Seat) => (r.p === P ? WON : r.q === P ? LOST : OUT), [P, OUT])
  const partySubOf = useCallback((r: Seat) => {
    if (r.p === P) return `${P} WON · ${r.v != null ? r.v.toFixed(1) + '%' : ''}${r.m != null ? ' · margin ' + r.m.toFixed(1) + '%' : ''}`
    if (r.q === P) return `${P} lost to ${r.p}${r.m != null ? ' by ' + r.m.toFixed(1) + '%' : ''}${r.v != null && r.m != null ? ` (got ${(r.v - r.m).toFixed(1)}%)` : ''}`
    return `${P} not in top-2 · won by ${r.p}`
  }, [P])
  const partyLegend = useMemo(() => {
    if (mode !== 'party') return undefined
    const won = active.filter(r => r.p === P).length
    const lost = active.filter(r => r.q === P).length
    return [
      { label: `${P} won`, color: WON, n: won },
      { label: 'Runner-up', color: LOST, n: lost },
      { label: 'Not in top-2', color: OUT, n: active.length - won - lost },
    ]
  }, [mode, active, P, OUT])

  // ---- click a party bar / alliance slice → filter the map to just that party / alliance ----
  const [pick, setPick] = useState<{ kind: 'party' | 'alliance'; value: string } | null>(null)
  useEffect(() => { setPick(null) }, [arena])   // a different arena has a different party set
  const filterColorOf = useCallback((r: Seat) => {
    if (!pick) return OUT
    if (pick.kind === 'party') return r.p === pick.value ? colorFor(pick.value, r.a) : OUT
    return allianceBase(r.a) === pick.value ? (ALLIANCE_COLORS[pick.value] ?? '#64748b') : OUT
  }, [pick, OUT])
  const filterSubOf = useCallback((r: Seat) => {
    if (!pick) return r.s
    if (pick.kind === 'party') return r.p === pick.value ? `${pick.value} WON${r.m != null ? ' · margin ' + r.m.toFixed(1) + '%' : ''}` : `won by ${r.p}`
    return allianceBase(r.a) === pick.value ? `${pick.value} · ${r.p}` : `won by ${r.p} (${allianceBase(r.a)})`
  }, [pick])
  const pickInfo = useMemo(() => {
    if (!pick) return null
    const n = pick.kind === 'party' ? active.filter(r => r.p === pick.value).length : active.filter(r => allianceBase(r.a) === pick.value).length
    const color = pick.kind === 'party' ? colorFor(pick.value, active.find(r => r.p === pick.value)?.a) : (ALLIANCE_COLORS[pick.value] ?? '#64748b')
    return { n, color }
  }, [pick, active])
  const pickLegend = useMemo(() => pick && pickInfo ? [{ label: `${pick.value} — ${pickInfo.n} seats`, color: pickInfo.color, n: null }, { label: 'Others', color: OUT, n: null }] : undefined, [pick, pickInfo, OUT])
  const barEvents = useMemo(() => ({ click: (p: { name?: string }) => { if (p.name) setPick(prev => (prev && prev.kind === 'party' && prev.value === p.name ? null : { kind: 'party', value: p.name! })) } }), [])
  const donutEvents = useMemo(() => ({ click: (p: { name?: string }) => { if (p.name) setPick(prev => (prev && prev.kind === 'alliance' && prev.value === p.name ? null : { kind: 'alliance', value: p.name! })) } }), [])

  // ---- group-by-state mode (uniform state fills, like the tile grid on the real map) ----
  const stateLeader = useMemo(() => {
    const m = new Map<string, { p: string; a: string | null; n: number; total: number }>()
    for (const [st, seats] of byState) {
      if (!seats.length) continue
      const c = new Map<string, number>()
      seats.forEach(r => c.set(r.p, (c.get(r.p) || 0) + 1))
      const [p, n] = [...c.entries()].sort((a, b) => b[1] - a[1])[0]
      m.set(st, { p, a: seats.find(r => r.p === p)?.a ?? null, n, total: seats.length })
    }
    return m
  }, [byState])
  const groupColorOf = useCallback((r: Seat) => {
    const e = stateLeader.get(r.s)
    return e ? colorFor(e.p, e.a) : OUT
  }, [stateLeader, OUT])
  const groupSubOf = useCallback((r: Seat) => {
    const e = stateLeader.get(r.s)
    return e ? `${e.p} leads ${r.s}: ${e.n}/${e.total} seats (${r.y})` : r.s
  }, [stateLeader])
  const groupLegend = useMemo(() => {
    if (!grouped) return undefined
    const c = new Map<string, { n: number; a: string | null }>()
    for (const e of stateLeader.values()) {
      const x = c.get(e.p) ?? { n: 0, a: e.a }
      x.n++
      c.set(e.p, x)
    }
    // cap the overlay legend on phones — 8 rows cover too much of a ~358px-wide map
    return [...c.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, isPhone ? 4 : 8)
      .map(([p, e]) => ({ label: p, color: colorFor(p, e.a), n: e.n }))
  }, [grouped, stateLeader, isPhone])

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp)
    if (v) next.set(k, v); else next.delete(k)
    setSp(next, { replace: true })
  }

  return (
    <div>
      <StickyControls>
      {/* PHONE: exactly two rows — the year, then every toggle in one side-scrolling strip.
          The text labels and the wide gaps are desktop-only, so the map starts near the top. */}
      <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
        <div className="flex w-full flex-1 items-center gap-2 text-xs text-muted sm:w-auto sm:flex-none">
          <span className="hidden sm:inline">Year</span>
          <input type="range" min={2004} max={2026} value={year} onChange={e => setYear(+e.target.value)} className="w-full min-w-0 h-7 accent-gold sm:w-56 sm:h-auto" />
          <span className="text-lg sm:text-xl font-bold tabular-nums text-ink shrink-0">{activeYear}</span>
        </div>
        <div className="w-full sm:flex-1 overflow-x-auto sm:overflow-visible -mx-3 px-3 sm:mx-0 sm:px-0">
          <div className="flex items-center gap-2 sm:gap-4 w-max sm:w-auto">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="hidden sm:inline">Level</span>
              <Seg options={[{ v: 'seat', label: 'Seats' }, { v: 'state', label: 'States' }]}
                value={grouped ? 'state' : 'seat'} onChange={v => setParam('group', v === 'state' ? 'state' : null)} />
            </div>
            {!grouped && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="hidden sm:inline">Color</span>
                <Seg options={[{ v: 'winner', label: 'Winner' }, { v: 'alliance', label: 'Alliance' }, { v: 'margin', label: 'Margin' }, { v: 'turnout', label: 'Turnout' }, { v: 'party', label: 'Party' }]}
                  value={mode} onChange={v => setParam('color', v === 'winner' ? null : v)} />
                {mode === 'party' && <Select value={P} onChange={v => setParam('pp', v)} options={partyList} width="w-28" />}
              </div>
            )}
          </div>
        </div>
      </div>
      </StickyControls>

      {!rows.length ? (
        <div className="grid lg:grid-cols-3 gap-4">
          <Skeleton h={340} className="lg:col-span-2 !rounded-2xl lg:!h-[640px]" />
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Skeleton h={86} /><Skeleton h={86} /><Skeleton h={86} /><Skeleton h={86} /></div>
            <Skeleton h={266} />
            <Skeleton h={246} />
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 min-h-[340px] sm:min-h-[480px] flex flex-col">
            {pick && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs shrink-0">
                <span className="inline-block w-3 h-3 rounded-[3px] ring-1 ring-black/30" style={{ background: pickInfo?.color }} />
                <span className="text-muted">Map filtered to {pick.kind === 'alliance' ? 'alliance' : 'party'} <b className="text-ink">{pick.value}</b> · {pickInfo?.n} seats</span>
                <button onClick={() => setPick(null)} className="ml-1 px-3 py-1.5 min-h-[32px] inline-flex items-center rounded-md border border-white/20 text-muted hover:text-ink hover:border-white/25 transition-colors sm:min-h-0 sm:px-2 sm:py-0.5">clear ✕</button>
              </div>
            )}
            <div className="flex-1 min-h-0">
              <ChoroplethMap byState={byState} arena={arena} activeYear={activeYear} height="h-full"
                mode={mode === 'party' ? 'winner' : mode}
                colorOf={pick ? filterColorOf : grouped ? groupColorOf : mode === 'party' ? partyColorOf : undefined}
                subOf={pick ? filterSubOf : grouped ? groupSubOf : mode === 'party' ? partySubOf : undefined}
                legendTitle={pick ? `Showing only ${pick.value}` : grouped ? 'State leaders' : mode === 'party' ? `${P} scoreboard` : undefined}
                legendItems={pick ? pickLegend : grouped ? groupLegend : partyLegend}
                onPick={(seat, state) => {
                  if (grouped || !seat) { setState(state); nav('/state') }
                  else setPicked(seat)
                }} />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <KPI label="Seats" value={kpi.total.toLocaleString()} sub={arena === 'AE' ? 'held as of ' + activeYear : activeYear + ' Lok Sabha'} />
              <KPI label={<>Avg turnout <Info>Of everyone registered to vote, the share who actually voted. Uses official state turnout where seat-level figures aren't published; the sparkline is the trend across elections.</Info></>}
                value={turnoutTrend.headline != null ? turnoutTrend.headline.toFixed(1) + '%' : 'n/a'}
                spark={turnoutTrend.spark} delta={turnoutTrend.delta}
                sub={turnoutTrend.headline == null ? `${activeYear} turnout not yet in data`
                  : turnoutTrend.delta && turnoutTrend.prevYear ? `vs ${turnoutTrend.prevYear} Lok Sabha` : 'mean across seats'} />
              <KPI label={<>Flips vs last <Info>Seats whose winning party changed compared with the previous election.</Info></>} value={kpi.flips.toLocaleString()} accent="#c99a2e"
                sub={kpi.nc ? `${kpi.nc} seats not comparable (delim.)` : 'same-seat winner change'} />
              <KPI label={<>Close seats <Info>Seats the winner took by less than 3% of the vote — the genuine nail-biters.</Info></>} value={kpi.close.toLocaleString()} accent="#f87171" sub="margin &lt; 3%" />
            </div>
            <div className="card p-3">
              <h3 className="kicker mb-1">Top parties · seats <span className="text-muted normal-case tracking-normal">· click to filter map</span></h3>
              <div className="h-[300px] sm:h-[230px]">
                <Chart option={partyBar} style={{ height: '100%' }} notMerge onEvents={barEvents} />
              </div>
            </div>
            <div className="card p-3 flex-1">
              <h3 className="kicker mb-1">Alliance share <span className="text-muted normal-case tracking-normal">· click to filter map</span></h3>
              <div className="h-[260px] sm:h-[210px]">
                <Chart option={donut} style={{ height: '100%' }} notMerge onEvents={donutEvents} />
              </div>
            </div>
          </div>
        </div>
      )}

      {picked && <SeatDrawer seat={picked} all={rows} arena={arena} onClose={() => setPicked(null)} />}
    </div>
  )
}
