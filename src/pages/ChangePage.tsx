import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadSeats, loadSegments, type Seat, type Segment } from '../lib/data'
import { colorFor, readable } from '../lib/colors'
import { useFilters, useTheme } from '../store'
import { useIsPhone } from '../lib/useMedia'
import ChoroplethMap from '../components/ChoroplethMap'
import SeatDrawer from '../components/SeatDrawer'
import { Chart, ChartCard, Dot, Seg, SortTable, StickyControls, type Col } from '../components/ui'
import { activeByState, seatChanges, seatHistories, seatKey, retentionMatrix, netChange, type SeatChange } from '../lib/analysis'
import { comparable } from '../lib/joins'
import { majorityCushion, worstDefence, flipConcentration, shallowWins, minorityWins, type Insight } from '../lib/insights'
import { baseOpt, catAxis, valAxis, AXIS, labelColor } from '../lib/theme'
const tc = (s: string) => s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function InsightStrip({ items }: { items: Insight[] }) {
  if (!items.length) return null
  // 200-level tints are raw Tailwind (NOT re-pointed by the theme vars) so they vanish on the cream
  // canvas — these headline findings use mid-tones that clear both canvases. No useTheme() here by design.
  const toneCls = { risk: 'border-red-400/40 text-red-500', edge: 'border-emerald-400/40 text-emerald-600', note: 'border-white/10 text-muted' }
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {items.map((it, i) => (
        <div key={i} className={`text-[12px] leading-snug px-3.5 py-2 rounded-xl border bg-white/[0.03] max-w-xl ${toneCls[it.tone]}`}>
          {it.tone === 'risk' ? '⚠ ' : it.tone === 'edge' ? '◎ ' : '• '}{it.text}
        </div>
      ))}
    </div>
  )
}

export default function ChangePage() {
  const nav = useNavigate()
  const { arena, year, setYear, state } = useFilters()
  const [rows, setRows] = useState<Seat[]>([])
  const [picked, setPicked] = useState<Seat | null>(null)
  const [drill, setDrill] = useState<{ kind: 'net'; party: string } | { kind: 'flow'; from: string; to: string } | null>(null)
  const [groupBy, setGroupBy] = useState<'state' | 'pc'>('state')   // assembly drill: group by state or by parliament (PC)
  const [segs, setSegs] = useState<Segment[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())   // drill rows expanded to show ALL their seats
  const toggleExp = (k: string) => setExpanded(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const mode = useTheme()
  const isPhone = useIsPhone()   // phone-only column drops (reactive — survives resize/rotate)
  const lab = labelColor(mode)
  const HELD = mode === 'light' ? '#e2e8f0' : '#1e293b'
  const NOCMP = mode === 'light' ? '#d6d3d1' : '#44403c'
  const NOPREV = mode === 'light' ? '#f1f5f9' : '#0c1322'
  useEffect(() => { loadSeats(arena).then(setRows); setPicked(null) }, [arena])
  useEffect(() => { loadSegments().then(setSegs) }, [])   // GE assembly-segment data → assembly seat ⇒ its parliament (PC)

  // assembly seat → its parent Lok Sabha constituency (latest delimitation wins), for "group by parliament"
  const pcByKey = useMemo(() => {
    const m = new Map<string, { y: number; pc: string }>()
    segs.forEach(g => { const k = `${g.s}::${norm(g.c)}`; const cur = m.get(k); if (!cur || g.y > cur.y) m.set(k, { y: g.y, pc: g.pcn }) })
    const out = new Map<string, string>(); m.forEach((v, k) => out.set(k, v.pc)); return out
  }, [segs])
  const grp: 'state' | 'pc' = groupBy === 'pc' && arena === 'AE' ? 'pc' : 'state'
  // group a seat → { unique key, display label, optional sub-label }. By parliament: label = PC, sub = state
  // (so the state shows AND PCs of the same name in different states / "Unmapped" don't merge).
  const groupOf = useCallback((s: Seat): { key: string; label: string; sub?: string } => {
    if (grp !== 'pc') return { key: s.s, label: s.s }
    const pc = pcByKey.get(`${s.s}::${norm(s.c)}`) ?? 'Unmapped'
    return { key: `${pc}|${s.s}`, label: pc, sub: s.s }
  }, [grp, pcByKey])
  const netCap = grp === 'pc' ? 99 : 6, flowCap = grp === 'pc' ? 99 : 12   // by-parliament groups are small; by-state caps + a "+N more" expander

  const years = useMemo(() => [...new Set(rows.map(r => r.y))].sort(), [rows])
  const activeYear = useMemo(() => {
    if (years.includes(year)) return year
    if (!years.length) return year
    const le = years.filter(y => y <= year)
    return le.length ? Math.max(...le) : years[0]   // slider below earliest → earliest (not a jump to latest)
  }, [years, year])
  // region-aware: follow the global filter — All-India shows national change, a picked state scopes to it
  const stateSel = useMemo(() => (state && rows.some(r => r.s === state) ? state : null), [state, rows])
  useEffect(() => { setDrill(null) }, [arena, activeYear, stateSel])
  useEffect(() => { setExpanded(new Set()) }, [drill, groupBy])
  const histAll = useMemo(() => seatHistories(rows), [rows])   // built ONCE per rows; shared by changes + strongholds/churn (was rebuilt twice — incl. on every year-slider tick)
  const byState = useMemo(() => {
    const all = activeByState(rows, arena, activeYear)
    if (!stateSel) return all
    return new Map(all.has(stateSel) ? [[stateSel, all.get(stateSel)!]] : [])
  }, [rows, arena, activeYear, stateSel])
  const active = useMemo(() => [...byState.values()].flat(), [byState])
  const changes = useMemo(() => seatChanges(active, rows, arena, histAll), [active, rows, arena, histAll])
  const statusBySeat = useMemo(() => {
    const m = new Map<string, SeatChange>()
    changes.forEach(c => m.set(seatKey(c.cur), c))
    return m
  }, [changes])

  const colorOf = useCallback((r: Seat) => {
    const c = statusBySeat.get(seatKey(r))
    if (!c || c.status === 'no-previous') return NOPREV
    if (c.status === 'not-comparable') return NOCMP
    return c.status === 'flipped' ? colorFor(r.p, r.a) : HELD
  }, [statusBySeat, HELD, NOCMP, NOPREV])
  const subOf = useCallback((r: Seat) => {
    const c = statusBySeat.get(seatKey(r))
    if (!c || !c.prev) return 'first election in range'
    if (c.status === 'not-comparable') return `delimitation changed since ${c.prev.y} — not comparable`
    return c.status === 'flipped'
      ? `FLIP: ${c.prev.p} (${c.prev.y}) → ${r.p}${r.m != null ? ' · margin ' + r.m.toFixed(1) + '%' : ''}`
      : `held by ${r.p} since ${c.prev.y}${r.m != null ? ' · margin ' + r.m.toFixed(1) + '%' : ''}`
  }, [statusBySeat])

  const counts = useMemo(() => ({
    flipped: changes.filter(c => c.status === 'flipped').length,
    held: changes.filter(c => c.status === 'held').length,
    nc: changes.filter(c => c.status === 'not-comparable').length,
    np: changes.filter(c => c.status === 'no-previous').length,
  }), [changes])
  const legendItems = useMemo(() => [
    { label: 'Flipped → new winner color', color: '#f97316', n: counts.flipped },
    { label: 'Held', color: HELD, n: counts.held },
    ...(counts.nc ? [{ label: 'Delim. changed', color: NOCMP, n: counts.nc }] : []),
    ...(counts.np ? [{ label: 'No previous', color: NOPREV, n: counts.np }] : []),
  ], [counts])

  const insights = useMemo(() => [
    majorityCushion(active),
    worstDefence(changes),
    flipConcentration(changes),
    ...shallowWins(active, 1),
    minorityWins(active),
  ].filter(Boolean) as Insight[], [active, changes])

  const net = useMemo(() => {
    const d = netChange(changes).filter(e => e.net !== 0)
    const top = [...d.slice(0, 7), ...d.slice(-7)].filter((e, i, a2) => a2.findIndex(x => x.p === e.p) === i)
      .sort((a, b) => a.net - b.net)
    return {
      ...baseOpt, legend: undefined,
      tooltip: {
        ...baseOpt.tooltip, trigger: 'item',
        formatter: (q: { dataIndex: number }) => { const e = top[q.dataIndex]; return `${e.p}: ${e.before} → ${e.now} (${e.net > 0 ? '+' : ''}${e.net})` },
      },
      grid: { left: 8, right: 36, top: 6, bottom: 4, containLabel: true },
      xAxis: valAxis(), yAxis: catAxis(top.map(e => e.p)),
      series: [{
        type: 'bar', barWidth: 11,
        data: top.map(e => ({ value: e.net, itemStyle: { color: colorFor(e.p, e.a), borderRadius: 3 } })),
        label: { show: true, position: 'right', color: AXIS, fontSize: 10, formatter: (q: { value: number }) => (q.value > 0 ? '+' : '') + q.value },
      }],
    }
  }, [changes])


  const matrix = useMemo(() => retentionMatrix(changes, 8), [changes])
  const maxCell = useMemo(() => {
    let m = 1
    for (const a of matrix.parties) for (const b of matrix.parties) if (a !== 'Other' || b !== 'Other') m = Math.max(m, matrix.get(a, b))
    return m
  }, [matrix])

  // ── drill-down: click a net-change bar → that party's gains/losses BY STATE (high→low);
  //    click a retention cell → those flips by state. Mirrors netChange's comparable-only rule. ──
  const netEvents = useMemo(() => ({ click: (p: { name?: string }) => { if (p.name) setDrill(d => (d?.kind === 'net' && d.party === p.name ? null : { kind: 'net', party: p.name! })) } }), [])
  const drillData = useMemo(() => {
    if (!drill) return null
    if (drill.kind === 'net') {
      const P = drill.party
      const m = new Map<string, { label: string; sub?: string; now: number; before: number; gained: { seat: Seat; from: string }[]; lost: { seat: Seat; to: string }[] }>()
      for (const c of changes) {
        if (c.status === 'not-comparable' || !c.prev) continue
        if (c.cur.p !== P && c.prev.p !== P) continue
        const g = groupOf(c.cur)
        const e = m.get(g.key) ?? { label: g.label, sub: g.sub, now: 0, before: 0, gained: [], lost: [] }
        if (c.cur.p === P) { e.now++; if (c.status === 'flipped') e.gained.push({ seat: c.cur, from: c.prev.p }) }
        if (c.prev.p === P) { e.before++; if (c.cur.p !== P) e.lost.push({ seat: c.cur, to: c.cur.p }) }
        m.set(g.key, e)
      }
      const rows = [...m.entries()].map(([s, e]) => ({ s, ...e, net: e.now - e.before })).sort((a, b) => b.net - a.net || b.now - a.now)
      return { kind: 'net' as const, party: P, a: changes.find(c => c.cur.p === P)?.cur.a ?? null, rows, total: rows.reduce((t, r) => t + r.net, 0) }
    }
    const { from, to } = drill
    const m = new Map<string, { label: string; sub?: string; seats: Seat[] }>()
    for (const c of changes) {
      if (c.status === 'not-comparable' || !c.prev) continue
      if (c.prev.p === from && c.cur.p === to) { const g = groupOf(c.cur); const e = m.get(g.key) ?? { label: g.label, sub: g.sub, seats: [] }; e.seats.push(c.cur); m.set(g.key, e) }
    }
    const rows = [...m.entries()].map(([s, e]) => ({ s, ...e })).sort((a, b) => b.seats.length - a.seats.length)
    return { kind: 'flow' as const, from, to, rows, total: rows.reduce((t, r) => t + r.seats.length, 0) }
  }, [drill, changes, groupOf])

  // strongholds & churn from full seat histories
  const { strongholds, churn } = useMemo(() => {
    const hist = histAll
    const sh: { seat: Seat; streak: number; since: number }[] = []
    const ch: { seat: Seat; flips: number; n: number }[] = []
    for (const list of hist.values()) {
      if (stateSel && list[0]?.s !== stateSel) continue
      const upto = list.filter(r => r.y <= activeYear)
      if (upto.length < 2) continue
      const cur = upto[upto.length - 1]
      let streak = 1, since = cur.y
      for (let i = upto.length - 2; i >= 0; i--) {
        if (!comparable(arena, cur.s, upto[i].y, upto[i + 1].y)) break
        if (upto[i].p !== cur.p) break
        streak++; since = upto[i].y
      }
      if (streak >= 3) sh.push({ seat: cur, streak, since })
      let flips = 0, cmp = 0
      for (let i = 1; i < upto.length; i++) {
        if (!comparable(arena, cur.s, upto[i - 1].y, upto[i].y)) continue
        cmp++
        if (upto[i].p !== upto[i - 1].p) flips++
      }
      if (cmp >= 2 && flips >= 2) ch.push({ seat: cur, flips, n: cmp })
    }
    sh.sort((a, b) => b.streak - a.streak || a.since - b.since)
    ch.sort((a, b) => b.flips - a.flips)
    return { strongholds: sh, churn: ch }   // show ALL (the tables sort + scroll); no silent top-N cap
  }, [histAll, arena, activeYear, stateSel])

  type Fort = { seat: Seat; streak: number; since: number }
  type Churn = { seat: Seat; flips: number; n: number }
  const partyCell = (s: Seat) => <span className="whitespace-nowrap"><Dot color={colorFor(s.p, s.a)} />{s.p}</span>
  const pcName = useCallback((s: Seat) => pcByKey.get(`${s.s}::${norm(s.c)}`) ?? '–', [pcByKey])
  // Parliament is the widest optional column — drop it below sm so the 5-col table fits a phone.
  const pcCol = <T extends { seat: Seat }>(): Col<T>[] => arena === 'AE' && !isPhone ? [{ key: 'pc', label: 'Parliament', get: r => pcName(r.seat) }] : []
  const fortressCols = useMemo<Col<Fort>[]>(() => [
    { key: 'c', label: 'Seat', get: r => tc(r.seat.c) },
    { key: 's', label: 'State', get: r => r.seat.s },
    ...pcCol<Fort>(),
    { key: 'p', label: 'Party', get: r => r.seat.p, render: r => partyCell(r.seat) },
    { key: 'streak', label: 'Streak', align: 'right', get: r => r.streak, render: r => `${r.streak}×` },
    { key: 'since', label: 'Since', align: 'right', get: r => r.since },
  ], [arena, pcName, isPhone])
  const churnCols = useMemo<Col<Churn>[]>(() => [
    { key: 'c', label: 'Seat', get: r => tc(r.seat.c) },
    { key: 's', label: 'State', get: r => r.seat.s },
    ...pcCol<Churn>(),
    { key: 'p', label: 'Now', get: r => r.seat.p, render: r => partyCell(r.seat) },
    { key: 'flips', label: 'Flips', align: 'right', get: r => r.flips },
    { key: 'n', label: 'Elections', align: 'right', get: r => r.n + 1 },
  ], [arena, pcName, isPhone])

  return (
    <div>
      <StickyControls>
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-sm font-semibold text-ink">{stateSel ? `What changed in ${stateSel}` : 'What changed across India'}</span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          Year
          <input type="range" min={2004} max={2026} value={year} onChange={e => setYear(+e.target.value)} className="w-full max-w-[220px] h-8 sm:h-auto accent-gold" />
          <span className="text-xl font-bold tabular-nums text-ink">{activeYear}</span>
        </div>
        <span className="text-xs text-slate-400">each seat vs its previous election{arena === 'AE' && !stateSel ? ' (state-wise)' : ''}</span>
        <button onClick={() => nav('/state')} className="ml-auto text-xs text-gold hover:text-gold underline decoration-dotted decoration-gold/40 underline-offset-2 transition-colors">
          {stateSel ? `Full ${stateSel} deep-dive →` : 'Open the full state deep-dive →'}
        </button>
      </div>
      </StickyControls>

      <InsightStrip items={insights} />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="min-w-0 lg:col-span-2 min-h-[280px] sm:min-h-[360px] lg:min-h-[480px]">
          <ChoroplethMap key={arena + (stateSel ?? 'all') + activeYear} byState={byState} arena={arena} activeYear={activeYear}
            focusState={stateSel ?? undefined}
            colorOf={colorOf} subOf={subOf} legendTitle="Seat status vs previous" legendItems={legendItems}
            height="h-full"
            onPick={seat => { if (seat) setPicked(seat) }} />
        </div>
        <div className="min-w-0 flex flex-col gap-4">
          <ChartCard title="Net seat change (vs previous)" note="Click a party's bar to break its change down by state, biggest first.">
            <div className="h-[220px] sm:h-[300px]">
              <Chart option={net} style={{ height: '100%' }} notMerge onEvents={netEvents} />
            </div>
          </ChartCard>
          <ChartCard title="Retention matrix — defended → outcome" note="Rows: party defending the seat. Columns: who holds it now. Diagonal = retained. Click a cell to see those seats by state.">
            <div className="overflow-auto">
              <table className="text-[11px] sm:text-[10px] border-collapse">
                <thead><tr><th className="p-1 text-slate-400 text-left">prev ↓ / now →</th>
                  {matrix.parties.map(p => <th key={p} className="p-1 text-slate-400 font-medium">{p}</th>)}</tr></thead>
                <tbody>
                  {matrix.parties.map(a => (
                    <tr key={a}>
                      <td className="p-1 text-slate-300 font-medium whitespace-nowrap">{a}</td>
                      {matrix.parties.map(b => {
                        const v = matrix.get(a, b)
                        const alpha = v ? 0.12 + 0.78 * (v / maxCell) : 0
                        const sel = drill?.kind === 'flow' && drill.from === a && drill.to === b
                        return (
                          <td key={b} title={`${a} → ${b}: ${v}`}
                            onClick={() => { if (v > 0) setDrill(d => (d?.kind === 'flow' && d.from === a && d.to === b ? null : { kind: 'flow', from: a, to: b })) }}
                            className={`p-2 sm:p-1 text-center tabular-nums min-w-[34px] sm:min-w-[30px] ${v > 0 ? 'cursor-pointer' : ''} ${a === b ? 'outline outline-1 outline-slate-600' : ''} ${sel ? 'ring-2 ring-inset ring-white/80' : ''}`}
                            style={{ background: v ? `rgba(249,115,22,${alpha})` : 'transparent', color: alpha > 0.5 ? '#0f172a' : lab }}>
                            {v || ''}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      </div>

      {drillData && (
        <ChartCard className="mt-4"
          title={drillData.kind === 'net'
            ? <span className="flex items-center gap-2"><Dot color={colorFor(drillData.party, drillData.a)} />{drillData.party} · net {drillData.total >= 0 ? '+' : ''}{drillData.total} seats · by {grp === 'pc' ? 'parliament' : 'state'} (high → low)</span>
            : drillData.from === drillData.to
              ? <><Dot color={colorFor(drillData.from)} />{drillData.from} retained · {drillData.total} seats · by {grp === 'pc' ? 'parliament' : 'state'}</>
              : <><Dot color={colorFor(drillData.from)} />{drillData.from} → <Dot color={colorFor(drillData.to)} />{drillData.to} · {drillData.total} seats · by {grp === 'pc' ? 'parliament' : 'state'}</>}>
          <div className="mb-2 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px] text-muted">{drillData.rows.length} {grp === 'pc' ? 'parliament' : 'state'}{drillData.rows.length !== 1 ? 's' : ''} · sorted high → low · click a seat for its report · <b className="text-ink">+N more</b> to expand</span>
            <div className="flex items-center gap-2">
              {arena === 'AE' && <Seg options={[{ v: 'state', label: 'By state' }, { v: 'pc', label: 'By parliament' }]} value={groupBy} onChange={v => setGroupBy(v as 'state' | 'pc')} />}
              <button onClick={() => setDrill(null)} className="inline-flex items-center min-h-[32px] sm:min-h-0 text-[11px] text-muted underline decoration-dotted hover:text-ink transition-colors">clear ✕</button>
            </div>
          </div>
          {drillData.rows.length === 0 ? <div className="text-muted text-sm py-6">No comparable seats moved here.</div> : drillData.kind === 'net' ? (
            <div className="overflow-auto max-h-[55vh] sm:max-h-[420px] rounded-lg border border-white/[0.05]">
              <table className="w-full text-xs">
                <thead className="text-slate-400 text-left sticky top-0 bg-slate-950/95 backdrop-blur z-10">
                  <tr><th className="py-2 px-3 font-medium">{grp === 'pc' ? 'Parliament' : 'State'}</th><th className="hidden sm:table-cell text-right px-2 font-medium">Before</th><th className="hidden sm:table-cell text-right px-2 font-medium">Now</th><th className="text-right px-2 font-medium">Net</th><th className="pl-4 pr-3 font-medium">Where it moved</th></tr>
                </thead>
                <tbody>
                  {drillData.rows.map(r => (
                    <tr key={r.s} className="border-t border-white/[0.05] align-top hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-medium whitespace-nowrap">{r.label}{r.sub ? <span className="text-slate-400 font-normal"> · {r.sub}</span> : null}</td>
                      <td className="hidden sm:table-cell text-right px-2 py-2.5 tabular-nums text-muted">{r.before}</td>
                      <td className="hidden sm:table-cell text-right px-2 py-2.5 tabular-nums text-muted">{r.now}</td>
                      <td className="text-right px-2 py-2.5 tabular-nums font-bold" style={{ color: r.net > 0 ? readable('#34d399', mode) : r.net < 0 ? readable('#fb7185', mode) : undefined }}>{r.net > 0 ? '+' : ''}{r.net}</td>
                      <td className="pl-4 pr-3 py-2">
                        {(() => {
                          const exp = expanded.has(r.s), more = Math.max(0, r.gained.length - netCap) + Math.max(0, r.lost.length - netCap)
                          return (
                            <div className="flex flex-wrap gap-1.5">
                              {r.gained.slice(0, exp ? r.gained.length : netCap).map((g, i) => <button key={'g' + i} onClick={() => setPicked(g.seat)} className="inline-flex items-center min-h-[32px] px-2 py-1.5 sm:min-h-0 sm:px-1.5 sm:py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[11px] whitespace-nowrap hover:bg-emerald-500/20 transition-colors" style={{ color: readable('#10b981', mode) }}>{`▲ ${tc(g.seat.c)}`}<span style={{ color: readable('#34d399', mode) }}>&nbsp;· {g.from}</span></button>)}
                              {r.lost.slice(0, exp ? r.lost.length : netCap).map((l, i) => <button key={'l' + i} onClick={() => setPicked(l.seat)} className="inline-flex items-center min-h-[32px] px-2 py-1.5 sm:min-h-0 sm:px-1.5 sm:py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-[11px] whitespace-nowrap hover:bg-rose-500/20 transition-colors" style={{ color: readable('#f43f5e', mode) }}>{`▼ ${tc(l.seat.c)}`}<span style={{ color: readable('#fb7185', mode) }}>&nbsp;· {l.to}</span></button>)}
                              {more > 0 && <button onClick={() => toggleExp(r.s)} className="inline-flex items-center min-h-[32px] px-3 py-1.5 sm:min-h-0 sm:px-2 sm:py-0.5 rounded-full border border-white/20 text-[11px] text-slate-300 hover:bg-white/10 hover:border-white/35 transition-colors">{exp ? '− show less' : `+${more} more`}</button>}
                              {!r.gained.length && !r.lost.length && <span className="text-[11px] text-slate-400">no flips — count shift only</span>}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-auto max-h-[55vh] sm:max-h-[420px] rounded-lg border border-white/[0.05]">
              <table className="w-full text-xs">
                <thead className="text-slate-400 text-left sticky top-0 bg-slate-950/95 backdrop-blur z-10"><tr><th className="py-2 px-3 font-medium">{grp === 'pc' ? 'Parliament' : 'State'}</th><th className="text-right px-2 font-medium">Seats</th><th className="pl-4 pr-3 font-medium">Which seats</th></tr></thead>
                <tbody>
                  {drillData.rows.map(r => (
                    <tr key={r.s} className="border-t border-white/[0.05] align-top hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-medium whitespace-nowrap">{r.label}{r.sub ? <span className="text-slate-400 font-normal"> · {r.sub}</span> : null}</td>
                      <td className="text-right px-2 py-2.5 tabular-nums font-bold text-ink">{r.seats.length}</td>
                      <td className="pl-4 pr-3 py-2">
                        {(() => {
                          const exp = expanded.has(r.s), more = Math.max(0, r.seats.length - flowCap)
                          return (
                            <div className="flex flex-wrap gap-1.5">
                              {r.seats.slice(0, exp ? r.seats.length : flowCap).map((s, i) => <button key={i} onClick={() => setPicked(s)} className="inline-flex items-center min-h-[32px] px-2 py-1.5 sm:min-h-0 sm:px-1.5 sm:py-0.5 rounded bg-white/[0.04] border border-white/[0.07] text-[11px] text-slate-300 whitespace-nowrap hover:bg-white/[0.09] transition-colors">{tc(s.c)}</button>)}
                              {more > 0 && <button onClick={() => toggleExp(r.s)} className="inline-flex items-center min-h-[32px] px-3 py-1.5 sm:min-h-0 sm:px-2 sm:py-0.5 rounded-full border border-white/20 text-[11px] text-slate-300 hover:bg-white/10 hover:border-white/35 transition-colors">{exp ? '− show less' : `+${more} more`}</button>}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <ChartCard title={`Fortresses — longest live winning streaks (${strongholds.length})`} note="Same party, ≥3 consecutive wins, unbroken by delimitation. Sort any column · search · click a row for its report.">
          {strongholds.length
            ? <SortTable rows={strongholds} cols={fortressCols} defaultSort="streak" initialDir="desc" maxH={360} search searchIn={r => `${r.seat.c} ${r.seat.s} ${r.seat.p}`} onRowClick={r => setPicked(r.seat)} />
            : <div className="text-muted text-sm py-6">No seat here has a live ≥3-win streak.</div>}
        </ChartCard>
        <ChartCard title={`Churn seats — flip most often (${churn.length})`} note="Bellwether/no-loyalty seats: ≥2 flips across comparable elections since 2009. Sort any column · search · click a row for its report.">
          {churn.length
            ? <SortTable rows={churn} cols={churnCols} defaultSort="flips" initialDir="desc" maxH={360} search searchIn={r => `${r.seat.c} ${r.seat.s} ${r.seat.p}`} onRowClick={r => setPicked(r.seat)} />
            : <div className="text-muted text-sm py-6">No seat here has flipped ≥2 times.</div>}
        </ChartCard>
      </div>

      {picked && <SeatDrawer seat={picked} all={rows} arena={arena} onClose={() => setPicked(null)} />}
    </div>
  )
}
