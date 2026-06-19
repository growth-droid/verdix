import { useEffect, useMemo, useState } from 'react'
import {
  loadPartyAE, loadPartyGEState, loadSegments, loadSeats, loadStateTurnout, loadSplitIndex, loadSplit, loadAESegShares,
  type PartyAgg, type Segment, type Seat, type StateTurnout, type SplitRow, type SplitFile,
} from '../lib/data'
import { colorFor } from '../lib/colors'
import { useFilters } from '../store'
import { Chart, ChartCard, Dot, Info, Seg, Select, SortTable, StickyControls, type Col } from '../components/ui'
import { baseOpt, valAxis, GRID } from '../lib/theme'

const tc = (s: string) => s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())

/** Per-party split-ticket dumbbell: each party's mean assembly share ○──● its mean Lok Sabha share.
 *  Line blue = the party runs stronger NATIONALLY here, amber = stronger in the STATE ballot. */
function SplitDumbbell({ rows, max, aeYear, geYear }: {
  rows: { p: string; a: string | null; n: number; aeV: number; geV: number }[]; max: number; aeYear?: number; geYear: number | null
}) {
  if (!rows.length) return <div className="h-[200px] grid place-items-center text-faint text-sm">No comparable segments.</div>
  return (
    <div className="space-y-3.5 pt-1">
      <div className="text-[11px] text-muted flex flex-wrap items-center gap-x-4 gap-y-1">
        <span><span className="inline-block w-3 h-3 rounded-full border-2 border-slate-400 align-middle mr-1.5" />Assembly {aeYear ?? ''}</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-slate-300 align-middle mr-1.5" />Lok Sabha {geYear ?? ''}</span>
        <span className="text-faint">line: <span className="text-sky-300">blue</span> = stronger nationally · <span className="text-amber-300">amber</span> = stronger in state</span>
      </div>
      {rows.map(r => {
        const color = colorFor(r.p, r.a)
        const pa = (r.aeV / max) * 100, pg = (r.geV / max) * 100
        const lo = Math.min(pa, pg), w = Math.abs(pg - pa), gain = r.geV >= r.aeV, d = +(r.geV - r.aeV).toFixed(1)
        return (
          <div key={r.p} className="flex items-center gap-3">
            <span className="w-20 text-xs shrink-0 text-right truncate"><Dot color={color} />{r.p}</span>
            <div className="relative flex-1 h-5">
              <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.07]" />
              <div className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full" style={{ left: `${lo}%`, width: `${w}%`, background: gain ? '#38bdf8' : '#fbbf24' }} />
              <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 bg-slate-950" style={{ left: `${pa}%`, borderColor: color }} />
              <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full" style={{ left: `${pg}%`, background: color }} />
            </div>
            <span className="w-[120px] text-[11px] tabular-nums text-faint shrink-0 text-right">{r.aeV.toFixed(1)}→{r.geV.toFixed(1)}% <span className={gain ? 'text-sky-300' : 'text-amber-300'}>({d > 0 ? '+' : ''}{d})</span></span>
          </div>
        )
      })}
      <div className="flex justify-between text-[10px] text-faint" style={{ paddingLeft: '5.75rem', paddingRight: '7.5rem' }}><span>0%</span><span>{max / 2}%</span><span>{max}%</span></div>
    </div>
  )
}

type Side = {
  arena: 'AE' | 'GE'; y: number; label: string; seatNoun: string
  byP: Map<string, PartyAgg>; seatsByP: Map<string, number>; total: number
  turn: number | null; lead: { p: string; n: number; a: string | null } | null
}

export default function ComparePage() {
  const { state: focus } = useFilters()
  const [partyAE, setPartyAE] = useState<PartyAgg[]>([])
  const [partyGE, setPartyGE] = useState<PartyAgg[]>([])
  const [segs, setSegs] = useState<Segment[]>([])
  const [ge, setGe] = useState<Seat[]>([])
  const [turn, setTurn] = useState<StateTurnout>({ AE: {}, GE: {} })
  const [splitIndex, setSplitIndex] = useState<Record<string, string[]>>({})
  const [splitFile, setSplitFile] = useState<SplitFile | null>(null)
  const [aeShares, setAeShares] = useState<Record<string, Record<string, number>> | null>(null)
  const [splitView, setSplitView] = useState<'dots' | 'summary'>('dots')   // segment scatter vs per-party dumbbell
  const [cmpA, setCmpA] = useState<string | null>(null)
  const [cmpB, setCmpB] = useState<string | null>(null)
  useEffect(() => {
    loadPartyAE().then(setPartyAE); loadPartyGEState().then(setPartyGE); loadSegments().then(setSegs)
    loadSeats('GE').then(setGe); loadStateTurnout().then(setTurn); loadSplitIndex().then(setSplitIndex)
  }, [])

  const states = useMemo(() => [...new Set([...partyAE, ...partyGE].map(r => r.s!).filter(Boolean))].sort(), [partyAE, partyGE])
  const st = focus && states.includes(focus) ? focus : (states.includes('Uttar Pradesh') ? 'Uttar Pradesh' : states[0] ?? '')

  // every election this state has held, as pickable labels (assembly + Lok Sabha)
  const aeYears = useMemo(() => [...new Set(partyAE.filter(r => r.s === st).map(r => r.y))].sort((a, b) => a - b), [partyAE, st])
  const geYears = useMemo(() => [...new Set(partyGE.filter(r => r.s === st).map(r => r.y))].sort((a, b) => a - b), [partyGE, st])
  const elabels = useMemo(() => [
    ...[...aeYears].reverse().map(y => `AE ${y}`),
    ...[...geYears].reverse().map(y => `LS ${y}`),
  ], [aeYears, geYears])
  // default: the two most recent elections of EITHER kind (the freshest story), A older → B newer
  const def = useMemo(() => {
    const all = [
      ...aeYears.map(y => ({ k: `AE ${y}`, y })),
      ...geYears.map(y => ({ k: `LS ${y}`, y })),
    ].sort((a, b) => a.y - b.y)
    const n = all.length
    return { A: n >= 2 ? all[n - 2].k : all[0]?.k ?? null, B: all[n - 1]?.k ?? null }
  }, [aeYears, geYears])
  const keyA = cmpA && elabels.includes(cmpA) ? cmpA : def.A
  const keyB = cmpB && elabels.includes(cmpB) ? cmpB : def.B

  const h2h = useMemo(() => {
    const side = (label: string | null): Side | null => {
      if (!label) return null
      const [tag, ys] = label.split(' '); const arena = tag === 'LS' ? 'GE' : 'AE'; const y = +ys
      const pm = (arena === 'AE' ? partyAE : partyGE).filter(r => r.s === st && r.y === y)
      const byP = new Map(pm.map(r => [r.p, r]))
      const seatsByP = new Map<string, number>()
      if (arena === 'AE') pm.forEach(r => seatsByP.set(r.p, r.wo || 0))
      else segs.filter(s2 => s2.s === st && s2.y === y).forEach(s2 => seatsByP.set(s2.p, (seatsByP.get(s2.p) || 0) + 1))
      const total = [...seatsByP.values()].reduce((a, b) => a + b, 0)
      const le = [...seatsByP.entries()].sort((a, b) => b[1] - a[1])[0]
      return {
        arena, y, byP, seatsByP, total,
        turn: turn[arena][`${st}|${y}`] ?? null,
        lead: le ? { p: le[0], n: le[1], a: byP.get(le[0])?.a ?? null } : null,
        seatNoun: arena === 'AE' ? 'seats won' : 'segments led',
        label: arena === 'AE' ? `AE ${y}` : `LS ${y}`,
      }
    }
    const A = side(keyA), B = side(keyB)
    if (!A || !B) return null
    const parties = [...new Set([...A.byP.keys(), ...B.byP.keys(), ...A.seatsByP.keys(), ...B.seatsByP.keys()])]
    const rows = parties.map(p => ({
      p, a: A.byP.get(p)?.a ?? B.byP.get(p)?.a ?? null,
      vA: A.byP.get(p)?.v ?? null, vB: B.byP.get(p)?.v ?? null,
      sA: A.seatsByP.get(p) ?? 0, sB: B.seatsByP.get(p) ?? 0,
    })).filter(r => (r.vA ?? 0) >= 2 || (r.vB ?? 0) >= 2 || r.sA > 0 || r.sB > 0)
      .sort((a, b) => Math.max(b.vA || 0, b.vB || 0) - Math.max(a.vA || 0, a.vB || 0))
    const maxShare = Math.max(10, ...rows.flatMap(r => [r.vA || 0, r.vB || 0]))
    const crossArena = A.arena !== B.arena
    return { A, B, rows, maxShare, crossArena }
  }, [partyAE, partyGE, segs, turn, st, keyA, keyB])

  // ── the strategist's read: what actually changed, in plain language ──
  const story = useMemo(() => {
    if (!h2h) return null
    const { A, B, rows, crossArena } = h2h
    const both = rows.filter(r => r.vA != null && r.vB != null)
    const swings = both.map(r => ({ p: r.p, a: r.a, d: +((r.vB ?? 0) - (r.vA ?? 0)).toFixed(1) })).sort((x, y) => y.d - x.d)
    const gainer = swings[0], loser = swings[swings.length - 1]
    const seatMov = rows.map(r => ({ p: r.p, a: r.a, d: r.sB - r.sA })).sort((x, y) => y.d - x.d)
    const seatGainer = seatMov[0], seatLoser = seatMov[seatMov.length - 1]
    const turnoutD = A.turn != null && B.turn != null ? +(B.turn - A.turn).toFixed(1) : null
    const shift = A.lead && B.lead && A.lead.p !== B.lead.p
    const leaderNowDelta = B.lead ? (B.lead.n - (A.seatsByP.get(B.lead.p) ?? 0)) : 0

    let verdict = ''
    if (A.lead && B.lead) {
      if (shift) {
        verdict = `The mandate in ${st} changed hands — ${A.lead.p} led ${A.label} with ${A.lead.n} ${A.seatNoun}, but ${B.lead.p} led ${B.label} with ${B.lead.n} ${B.seatNoun}.`
      } else {
        const dir = leaderNowDelta > 0 ? `widened its lead by ${leaderNowDelta}` : leaderNowDelta < 0 ? `held on but slipped ${Math.abs(leaderNowDelta)}` : 'held steady'
        verdict = `${A.lead.p} stayed on top in ${st} — ${dir} between ${A.label} (${A.seatsByP.get(A.lead.p) ?? A.lead.n}) and ${B.label} (${B.lead.n}).`
      }
    }
    if (crossArena) {
      const geS = A.arena === 'GE' ? A : B
      verdict += ` This pairs a state ballot with a national one — the gap between them is the split-ticket vote (assembly seats won vs the assembly segments each party led in ${geS.label}).`
    }

    const chips: { tone: 'edge' | 'risk' | 'note'; text: string }[] = []
    if (gainer && gainer.d >= 1) chips.push({ tone: 'edge', text: `${gainer.p} gained the most ground — +${gainer.d}% vote share from ${A.label} to ${B.label}.` })
    if (loser && loser.d <= -1 && loser.p !== gainer?.p) chips.push({ tone: 'risk', text: `${loser.p} bled the most — ${loser.d}% vote share. ${loser.d < -8 ? 'A collapse, not a dip.' : ''}`.trim() })
    if (seatGainer && seatGainer.d > 0) chips.push({ tone: 'note', text: `On the assembly map: ${seatGainer.p} ${seatGainer.d > 0 ? '+' : ''}${seatGainer.d}${seatLoser && seatLoser.d < 0 ? `, ${seatLoser.p} ${seatLoser.d}` : ''} ${A.seatNoun === B.seatNoun ? A.seatNoun : 'seats/segments'}.` })
    // efficiency tell: gained vote share but not the seat race → inefficient / divided field
    if (gainer && seatGainer && gainer.p !== seatGainer.p && gainer.d >= 3) {
      chips.push({ tone: 'note', text: `${gainer.p} added votes but ${seatGainer.p} took the seats — share without a winning geography (vote-splitting or an inefficient spread).` })
    }
    if (turnoutD != null && Math.abs(turnoutD) >= 0.5) chips.push({ tone: 'note', text: `Turnout ${turnoutD > 0 ? 'rose' : 'fell'} ${Math.abs(turnoutD)}% (${A.turn}%→${B.turn}%).` })

    return { verdict, chips: chips.slice(0, 4), shift }
  }, [h2h, st])

  // ── cross-arena (AE×GE) only: segment-level vote transfer deep-dive ──
  const geSide = h2h?.crossArena ? (h2h.A.arena === 'GE' ? h2h.A : h2h.B) : null
  const aeSide = h2h?.crossArena ? (h2h.A.arena === 'AE' ? h2h.A : h2h.B) : null
  const geYear = geSide?.y ?? null
  const aeY = aeSide?.y ?? null
  const hasSplit = geYear != null && (splitIndex[String(geYear)] ?? []).includes(st)
  useEffect(() => {
    if (!hasSplit || geYear == null) { setSplitFile(null); return }
    let live = true; setSplitFile(null)
    loadSplit(geYear, st).then(f => { if (live) setSplitFile(f) }).catch(() => { if (live) setSplitFile(null) })
    return () => { live = false }
  }, [hasSplit, geYear, st])
  useEffect(() => {  // AE segment baselines for ALL assembly years → so the deep-dive follows the assembly-year picker
    let live = true; setAeShares(null)
    loadAESegShares(st).then(d => { if (live) setAeShares(d) }).catch(() => { if (live) setAeShares(null) })
    return () => { live = false }
  }, [st])

  // each split row's AE baseline = the SELECTED assembly year's segment share (override the file's fixed nearest-AE av)
  const aeAvail = aeY != null && !!aeShares?.[String(aeY)]
  const paired = useMemo(() => {
    const sh = aeY != null ? aeShares?.[String(aeY)] : undefined
    if (!splitFile || !sh) return [] as (SplitRow & { av: number })[]
    return splitFile.rows.map(r => ({ ...r, av: sh[`${r.n}|${r.p}`] ?? null })).filter(r => r.av != null) as (SplitRow & { av: number })[]
  }, [splitFile, aeShares, aeY])
  // per-party mean assembly share → mean Lok Sabha share (replaces the cluttered per-segment scatter)
  const splitDumbbell = useMemo(() => {
    const byP = new Map<string, { ae: number[]; ge: number[]; a: string | null }>()
    paired.forEach(r => { const e = byP.get(r.p) ?? { ae: [], ge: [], a: r.a }; e.ae.push(r.av); e.ge.push(r.gv); byP.set(r.p, e) })
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
    const rows = [...byP.entries()].filter(([, e]) => e.ge.length >= 8)
      .map(([p, e]) => ({ p, a: e.a, n: e.ge.length, aeV: +avg(e.ae).toFixed(1), geV: +avg(e.ge).toFixed(1) }))
      .sort((a, b) => b.geV - a.geV)
    const max = rows.length ? Math.min(80, Math.ceil((Math.max(...rows.flatMap(r => [r.aeV, r.geV])) * 1.08) / 5) * 5) : 50
    return { rows, max }
  }, [paired])
  // per-segment scatter (one dot per assembly segment) — the granular alternative to the dumbbell
  const scatter = useMemo(() => {
    if (!paired.length) return null
    const byP = new Map<string, (SplitRow & { av: number })[]>()
    paired.forEach(r => { if (!byP.has(r.p)) byP.set(r.p, []); byP.get(r.p)!.push(r) })
    const top = [...byP.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 7)
    const lim = Math.min(85, Math.ceil(Math.max(40, ...paired.map(r => Math.max(r.gv, r.av))) / 5) * 5)
    return {
      ...baseOpt,
      tooltip: {
        ...baseOpt.tooltip, trigger: 'item',
        formatter: (q: { data: { r: SplitRow } }) => { const r = q.data.r; return `<b>${tc(r.c)}</b>${r.pcn ? ' · ' + tc(String(r.pcn)) + ' PC' : ''}<br/>${r.p}: AE ${aeY ?? ''} ${r.av?.toFixed(1)}% → LS ${geYear} ${r.gv.toFixed(1)}%<br/>split ${(r.gv - (r.av ?? 0)) > 0 ? '+' : ''}${(r.gv - (r.av ?? 0)).toFixed(1)}%` },
      },
      grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
      xAxis: { ...valAxis('{value}%'), name: `AE ${aeY ?? ''} share`, nameTextStyle: { color: '#94a3b8' }, max: lim },
      yAxis: { ...valAxis('{value}%'), name: `LS ${geYear} segment share`, nameTextStyle: { color: '#94a3b8' }, max: lim },
      series: [
        ...top.map(([p, list]) => ({ name: p, type: 'scatter', symbolSize: 7, itemStyle: { color: colorFor(p, list[0].a), opacity: 0.75 }, data: list.map(r => ({ value: [r.av, r.gv], r })) })),
        { name: 'parity', type: 'line', silent: true, showSymbol: false, lineStyle: { color: GRID, type: 'dashed', width: 1.5 }, data: [[0, 0], [lim, lim]], tooltip: { show: false } },
      ],
    }
  }, [paired, aeY, geYear])
  const partySplit = useMemo(() => {
    const byP = new Map<string, { d: number[]; a: string | null }>()
    paired.forEach(r => { const e = byP.get(r.p) ?? { d: [], a: r.a }; e.d.push(r.gv - r.av); byP.set(r.p, e) })
    return [...byP.entries()].filter(([, e]) => e.d.length >= 8)
      .map(([p, e]) => ({ p, a: e.a, n: e.d.length, mean: e.d.reduce((s, x) => s + x, 0) / e.d.length }))
      .sort((a, b) => b.mean - a.mean)
  }, [paired])
  const pcMatrix = useMemo(() => {
    if (geYear == null) return []
    const segY = segs.filter(s2 => s2.s === st && s2.y === geYear)
    const winners = new Map(ge.filter(r => r.s === st && r.y === geYear).map(r => [r.n, r]))
    const byPC = new Map<number, Segment[]>()
    segY.forEach(s2 => { if (!byPC.has(s2.pc)) byPC.set(s2.pc, []); byPC.get(s2.pc)!.push(s2) })
    return [...byPC.entries()].map(([pc, list]) => {
      const w = winners.get(pc)
      const led = w ? list.filter(s2 => s2.p === w.p).length : 0
      const topSeg = [...list.reduce((m, s2) => m.set(s2.p, (m.get(s2.p) || 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]
      return { pc, pcn: list[0].pcn, w, led, total: list.length, topSegP: topSeg?.[0], topSegN: topSeg?.[1] ?? 0 }
    }).filter(r => r.w).sort((a, b) => (a.led / a.total) - (b.led / b.total))
  }, [segs, ge, st, geYear])

  const splitCols: Col<SplitRow>[] = [
    { key: 'c', label: 'Segment', get: r => r.c, render: r => tc(r.c) },
    { key: 'pcn', label: 'PC', get: r => r.pcn, render: r => tc(String(r.pcn ?? '–')) },
    { key: 'p', label: 'Party', get: r => r.p, render: r => <span><Dot color={colorFor(r.p, r.a)} />{r.p}</span> },
    { key: 'av', label: `AE${aeY ? ' ' + aeY : ''}%`, get: r => r.av, align: 'right', render: r => r.av?.toFixed(1) ?? '–' },
    { key: 'gv', label: `LS ${geYear}%`, get: r => r.gv, align: 'right', render: r => r.gv.toFixed(1) },
    { key: 'd', label: 'Split %', get: r => (r.av == null ? null : r.gv - r.av), align: 'right',
      render: r => { if (r.av == null) return '–'; const d = r.gv - r.av; return <span className={d > 0 ? 'text-sky-300' : 'text-amber-300'}>{d > 0 ? '+' : ''}{d.toFixed(1)}</span> } },
  ]
  const mCols: Col<(typeof pcMatrix)[number]>[] = [
    { key: 'pcn', label: 'PC', get: r => r.pcn, render: r => tc(r.pcn) },
    { key: 'w', label: 'PC winner', get: r => r.w?.p ?? null, render: r => r.w ? <span><Dot color={colorFor(r.w.p, r.w.a)} />{r.w.p}</span> : '–' },
    { key: 'led', label: 'Segments led by winner', get: r => r.led / r.total, align: 'right', render: r => `${r.led} / ${r.total}` },
    { key: 'top', label: 'Most segments', get: r => r.topSegP ?? null, render: r => r.topSegP ? <span><Dot color={colorFor(r.topSegP)} />{r.topSegP} ({r.topSegN})</span> : '–' },
  ]

  const toneCls = { edge: 'border-emerald-400/25 text-emerald-200/90', risk: 'border-red-400/25 text-red-200/90', note: 'border-white/10 text-slate-300' }

  return (
    <div>
      <StickyControls>
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold leading-tight tracking-tight">{st} <span className="text-faint font-normal text-sm">· compare any two elections</span></h2>
          <div className="kicker">Pick two — two assembly years, two Lok Sabha years, or one of each</div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <Select value={keyA ?? ''} onChange={setCmpA} options={elabels} width="w-28" />
          <button onClick={() => { const a = keyA, b = keyB; setCmpA(b); setCmpB(a) }} title="Swap"
            className="px-2 py-1.5 rounded-lg border border-white/10 text-faint hover:text-ink hover:border-white/25 transition-colors">⇄</button>
          <Select value={keyB ?? ''} onChange={setCmpB} options={elabels} width="w-28" />
        </div>
      </div>
      </StickyControls>

      {!h2h ? (
        <ChartCard title="Compare two elections">
          <div className="h-[160px] flex items-center justify-center text-faint text-sm text-center px-6">
            Need at least two elections for {st || 'this state'} (Lok Sabha segment data excludes J&K / Ladakh).
          </div>
        </ChartCard>
      ) : (
        <>
          {/* the verdict — strategist's read */}
          {story && (
            <div className="card p-4 mb-4 relative overflow-hidden">
              <span className="absolute inset-x-0 top-0 h-[2px] opacity-70" style={{ background: `linear-gradient(90deg, transparent, ${story.shift ? '#f97316' : '#38bdf8'}, transparent)` }} />
              <div className="kicker mb-1">The verdict — {h2h.A.label} → {h2h.B.label}</div>
              <p className="text-[15px] leading-relaxed text-ink font-medium">{story.verdict}</p>
              {story.chips.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {story.chips.map((c, i) => (
                    <span key={i} className={`text-[12px] leading-snug px-3 py-1.5 rounded-xl border bg-white/[0.03] ${toneCls[c.tone]}`}>
                      {c.tone === 'risk' ? '⚠ ' : c.tone === 'edge' ? '◎ ' : '• '}{c.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* side-by-side summary */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[h2h.A, h2h.B].map((S, i) => (
              <div key={i} className="card !rounded-xl p-3">
                <div className="kicker">{S.label} · {S.seatNoun}</div>
                {S.lead && <div className="text-sm mt-1"><Dot color={colorFor(S.lead.p, S.lead.a)} /><b>{S.lead.p}</b> {S.arena === 'AE' ? 'won' : 'led'} <span className="num">{S.lead.n}</span>/<span className="num">{S.total}</span></div>}
                <div className="text-[11px] text-faint mt-0.5">turnout {S.turn != null ? <span className="num text-slate-300">{S.turn}%</span> : '–'}</div>
              </div>
            ))}
          </div>

          <ChartCard className="mb-4"
            title={<>Vote share &amp; seats — head-to-head <Info>Pick any two elections. “Seats” means assembly seats won; for a Lok Sabha election it’s the assembly segments that party led — so both sides sit on the same assembly map and compare like-for-like.</Info></>}
            note={<>Vote share is statewide. {[h2h.A, h2h.B].some(s => s.arena === 'GE' && s.y === 2024) ? 'GE-2024 segment shares are EVM-only. ' : ''}A party strong on one side but weak on the other is the swing / split-mandate story.</>}>
            <div className="grid lg:grid-cols-2 gap-x-6 gap-y-2">
              <div>
                <div className="text-xs text-muted mb-1.5">Vote share — ○ {h2h.A.label} → ● {h2h.B.label}</div>
                <div className="space-y-2">
                  {h2h.rows.map(r => {
                    const color = colorFor(r.p, r.a)
                    const pa = ((r.vA ?? 0) / h2h.maxShare) * 100, pg = ((r.vB ?? 0) / h2h.maxShare) * 100
                    const lo = Math.min(pa, pg), w = Math.abs(pg - pa), gain = (r.vB ?? 0) >= (r.vA ?? 0)
                    return (
                      <div key={r.p} className="flex items-center gap-2">
                        <span className="w-14 text-xs shrink-0 text-right"><Dot color={color} />{r.p}</span>
                        <div className="relative flex-1 h-5">
                          <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.06]" />
                          {r.vA != null && r.vB != null && <div className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full" style={{ left: `${lo}%`, width: `${w}%`, background: gain ? '#38bdf8' : '#fbbf24' }} />}
                          {r.vA != null && <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 bg-slate-950" style={{ left: `${pa}%`, borderColor: color }} title={`${h2h.A.label} ${r.vA?.toFixed(1)}%`} />}
                          {r.vB != null && <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{ left: `${pg}%`, background: color }} title={`${h2h.B.label} ${r.vB?.toFixed(1)}%`} />}
                        </div>
                        <span className="w-24 text-[11px] tabular-nums text-faint shrink-0">{r.vA?.toFixed(1) ?? '–'}→{r.vB?.toFixed(1) ?? '–'}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted mb-1.5">{h2h.A.label} {h2h.A.seatNoun} vs {h2h.B.label} {h2h.B.seatNoun} — same assembly map</div>
                <table className="w-full text-xs">
                  <thead className="text-faint text-left"><tr><th className="py-1">Party</th><th className="text-right">{h2h.A.label}</th><th className="text-right">{h2h.B.label}</th><th className="text-right">Δ</th></tr></thead>
                  <tbody>
                    {h2h.rows.filter(r => r.sA > 0 || r.sB > 0).map(r => (
                      <tr key={r.p} className="border-t border-white/[0.05]">
                        <td className="py-1"><Dot color={colorFor(r.p, r.a)} />{r.p}</td>
                        <td className="text-right tabular-nums">{r.sA}</td>
                        <td className="text-right tabular-nums">{r.sB}</td>
                        <td className={`text-right tabular-nums ${r.sB - r.sA > 0 ? 'text-sky-300' : r.sB - r.sA < 0 ? 'text-amber-300' : 'text-faint'}`}>{r.sB - r.sA > 0 ? '+' : ''}{r.sB - r.sA}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </ChartCard>

          {/* cross-arena deep dive: segment-level vote transfer */}
          {h2h.crossArena && (
            hasSplit && paired.length ? (
              <>
                {partySplit.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {partySplit.slice(0, 5).map(e => (
                      <div key={e.p} className="text-[12px] px-3.5 py-2 rounded-xl border border-white/10 bg-white/[0.03]">
                        <Dot color={colorFor(e.p, e.a)} /><b>{e.p}</b>{' '}
                        {e.mean >= 0 ? <span className="text-sky-300">+{e.mean.toFixed(1)}%</span> : <span className="text-amber-300">{e.mean.toFixed(1)}%</span>}
                        <span className="text-slate-500"> in LS vs AE ({e.n} seg)</span>
                        <span className="text-slate-400"> — {e.mean > 3 ? 'national brand outruns state unit' : e.mean < -3 ? 'state-first vote; weak national transfer' : 'vote transfers cleanly'}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid lg:grid-cols-2 gap-4">
                  <ChartCard title={`Assembly vs Lok Sabha vote share — ${st}`}
                    note={splitView === 'dots'
                      ? <>Each dot = one assembly segment: <b>AE {aeY}</b> share (x) vs <b>LS {geYear}</b> share (y). Above the dashed parity line = the party ran <b>stronger nationally</b> there. {geYear === 2024 && <b>2024 segment shares are EVM-only; Surat absent.</b>} J&K/Ladakh excluded.</>
                      : <>Per party: average vote share across the state's assembly segments in <b>AE {aeY}</b> vs the same ground in <b>LS {geYear}</b>. Blue line = stronger nationally; amber = stronger in state. {geYear === 2024 && <b>2024 EVM-only; Surat absent.</b>} J&K/Ladakh excluded.</>}>
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted">View
                      <Seg options={[{ v: 'dots', label: 'Per-segment dots' }, { v: 'summary', label: 'Party summary' }]} value={splitView} onChange={v => setSplitView(v as 'dots' | 'summary')} />
                    </div>
                    {splitView === 'dots'
                      ? (scatter ? <Chart option={scatter} style={{ height: 392 }} notMerge /> : <div className="h-[200px]" />)
                      : <SplitDumbbell rows={splitDumbbell.rows} max={splitDumbbell.max} aeYear={aeY ?? undefined} geYear={geYear} />}
                  </ChartCard>
                  <ChartCard title="Biggest split-ticket segments" note="Same party, same ground, different ballot — the gap is the persuadable / tactical vote that splits between state and national elections.">
                    <SortTable rows={paired} cols={splitCols} defaultSort="d" initialDir="desc" maxH={430} search searchIn={r => `${r.c} ${r.pcn} ${r.p}`} />
                  </ChartCard>
                </div>
                <div className="mt-4">
                  <ChartCard title={`PC won vs ground held — ${st} · LS ${geYear}`}
                    note={pcMatrix.length ? `${pcMatrix.filter(r => r.led < r.total / 2).length} of ${pcMatrix.length} seats were won while leading under half the segments — alliance arithmetic or a candidate's personal pull decided them, not uniform ground strength.` : undefined}>
                    <SortTable rows={pcMatrix} cols={mCols} defaultSort="led" initialDir="asc" maxH={360} />
                  </ChartCard>
                </div>
              </>
            ) : (
              <ChartCard title="Segment-level vote transfer">
                <div className="h-[120px] flex items-center justify-center text-faint text-sm text-center px-6">
                  {hasSplit && aeY != null && !aeAvail
                    ? <>The segment breakdown needs full assembly candidate lists, but <b className="text-amber-300">AE {aeY}</b> is winners-only for {st}. Pick an assembly year with complete data (an earlier one) to compare its segments against LS {geYear}.</>
                    : <>Segment-level assembly↔Lok Sabha data isn’t available for {st} in LS {geYear} (J&K/Ladakh use non-comparable numbering, or candidate data is incomplete).</>}
                </div>
              </ChartCard>
            )
          )}
        </>
      )}
    </div>
  )
}
