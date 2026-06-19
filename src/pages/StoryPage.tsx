import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  loadSeats, loadPartyAE, loadPartyGEState, loadPartyGENat, loadSegments, loadStateTurnout, loadAllianceCF,
  type Seat, type PartyAgg, type Segment, type StateTurnout, type CFRow,
} from '../lib/data'
import { colorFor, ALLIANCE_COLORS } from '../lib/colors'
import { useFilters } from '../store'
import ChoroplethMap from '../components/ChoroplethMap'
import { Chart, Select, Skeleton } from '../components/ui'
import { activeByState, allianceBase, classifyState, seatChanges, swing, netChange, type SeatClass } from '../lib/analysis'
import { majorityCushion, shallowWins, minorityWins, flipConcentration, worstDefence, swingometer, type Insight } from '../lib/insights'
import { baseOpt, catAxis, valAxis, pctFmt, AXIS, GRID } from '../lib/theme'

const tc = (s: string) => s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
const SAFE = '#16a34a', LEAN = '#f59e0b', SWG = '#ef4444'
const SHARE_B = [{ l: '<30%', lt: 30, c: '#b91c1c' }, { l: '30–40%', lt: 40, c: '#c2410c' }, { l: '40–50%', lt: 50, c: '#0e7490' }, { l: '≥50%', lt: Infinity, c: '#15803d' }]
const MARGIN_B = [{ l: '<5%', lt: 5, c: '#b91c1c' }, { l: '5–10%', lt: 10, c: '#c2410c' }, { l: '10–20%', lt: 20, c: '#0e7490' }, { l: '≥20%', lt: Infinity, c: '#15803d' }]
const RES_ORDER = ['GEN', 'SC', 'ST', 'BL', 'SAN', 'NA']
// gradient fills — vertical (columns) and horizontal (bars) — for premium-looking charts
const vgrad = (c: string) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c }, { offset: 1, color: c + '8a' }] })
const hgrad = (c: string) => ({ type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: c + '7a' }, { offset: 1, color: c }] })
const agrad = (c: string) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c + '4d' }, { offset: 1, color: c + '00' }] })
type PN = { p: string; a: string | null; n: number }
const tally = (rows: { p: string; a: string | null }[]): PN[] => {
  const m = new Map<string, { n: number; a: string | null }>()
  rows.forEach(r => { const e = m.get(r.p) ?? { n: 0, a: r.a }; e.n++; m.set(r.p, e) })
  return [...m.entries()].map(([p, e]) => ({ p, a: e.a, n: e.n })).sort((a, b) => b.n - a.n)
}
const challengerOf = (seats: Seat[], leader: string | undefined) => {
  if (!leader) return null
  const c = new Map<string, number>(); seats.filter(r => r.p === leader && r.q).forEach(r => c.set(r.q!, (c.get(r.q!) || 0) + 1))
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
const decisiveSwing = (seats: Seat[], leader: string | undefined, challenger: string | null) => {
  if (!leader || !challenger) return null
  for (let pp = 0.5; pp <= 12; pp += 0.5) { const sw = swingometer(seats, leader, challenger, pp); if (sw.toAfter > sw.fromAfter) return { pp, flips: sw.flips.length } }
  return null
}
function Dot({ c }: { c: string }) { return <span className="inline-block w-3 h-3 rounded-full mr-2 align-middle ring-1 ring-black/30" style={{ background: c }} /> }

// ── chart builders ──
const hbar = (items: { p: string; a: string | null; v: number }[], suffix = '') => ({
  ...baseOpt, legend: undefined, tooltip: { ...baseOpt.tooltip, trigger: 'item' }, grid: { left: 8, right: 54, top: 6, bottom: 6, containLabel: true },
  xAxis: valAxis(), yAxis: catAxis(items.slice(0, 8).reverse().map(e => e.p)),
  series: [{ type: 'bar', barWidth: '62%', data: items.slice(0, 8).reverse().map(e => ({ value: e.v, itemStyle: { color: hgrad(colorFor(e.p, e.a)), borderRadius: [0, 6, 6, 0] } })), label: { show: true, position: 'right', color: AXIS, fontSize: 13, fontWeight: 600, formatter: (q: { value: number }) => q.value + suffix } }],
})
const netBar = (rows: { p: string; a: string | null; net: number }[]) => {
  const top = [...rows.slice(0, 5), ...rows.slice(-5)].filter((e, i, a) => a.findIndex(x => x.p === e.p) === i).sort((a, b) => a.net - b.net)
  return { ...baseOpt, legend: undefined, tooltip: { ...baseOpt.tooltip, trigger: 'item' }, grid: { left: 8, right: 44, top: 6, bottom: 6, containLabel: true }, xAxis: valAxis(), yAxis: catAxis(top.map(e => e.p)), series: [{ type: 'bar', barWidth: 15, data: top.map(e => ({ value: e.net, itemStyle: { color: hgrad(colorFor(e.p, e.a)), borderRadius: [3, 3, 3, 3] } })), label: { show: true, position: 'right', color: AXIS, fontSize: 11, fontWeight: 600, formatter: (q: { value: number }) => (q.value > 0 ? '+' : '') + q.value } }] }
}
const donut = (items: [string, number][]) => ({
  ...baseOpt, legend: undefined, tooltip: { ...baseOpt.tooltip, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  series: [{ type: 'pie', radius: ['46%', '76%'], center: ['50%', '52%'], label: { color: AXIS, fontSize: 13, formatter: '{b}\n{c}' }, labelLine: { lineStyle: { color: '#64748b' } }, itemStyle: { borderColor: 'transparent', borderWidth: 2 }, data: items.map(([name, value]) => ({ name, value, itemStyle: { color: ALLIANCE_COLORS[name] ?? '#475569' } })) }],
})
const trend = (years: number[], series: { name: string; color: string; data: (number | null)[] }[], fmt?: string, area = false) => ({
  ...baseOpt, tooltip: { ...baseOpt.tooltip, trigger: 'axis' }, grid: { ...baseOpt.grid, right: 100, top: 16 },
  xAxis: catAxis(years.map(String), { boundaryGap: false }), yAxis: valAxis(fmt),
  series: series.map(s => ({
    name: s.name, type: 'line', smooth: 0.4, symbol: 'circle', symbolSize: 7, showSymbol: series.length <= 6,
    lineStyle: { width: 3, shadowBlur: 12, shadowColor: s.color + '55' }, itemStyle: { color: s.color },
    areaStyle: area ? { color: agrad(s.color) } : undefined,
    emphasis: { focus: 'series', lineStyle: { width: 4.5 } }, blur: { lineStyle: { opacity: 0.25 } },
    endLabel: { show: true, formatter: '{a}', color: s.color, fontSize: 12, fontWeight: 600, distance: 6 }, labelLayout: { moveOverlap: 'shiftY' },
    data: s.data, connectNulls: true,
  })),
})
const buckets = (wins: Seat[], spec: { l: string; lt: number; c: string }[], get: (r: Seat) => number | null) => {
  const tot = wins.filter(r => get(r) != null).length || 1
  const counts = spec.map((b, bi) => wins.filter(r => { const v = get(r); if (v == null) return false; const lo = bi === 0 ? -1 : spec[bi - 1].lt; return v >= lo && v < b.lt }).length)
  return { ...baseOpt, legend: undefined, tooltip: { ...baseOpt.tooltip, trigger: 'item', valueFormatter: (v: number) => `${v} (${Math.round((v / tot) * 100)}%)` }, grid: { left: 8, right: 16, top: 14, bottom: 6, containLabel: true }, xAxis: catAxis(spec.map(b => b.l)), yAxis: valAxis(), series: [{ type: 'bar', barWidth: '56%', data: counts.map((n, bi) => ({ value: n, itemStyle: { color: vgrad(spec[bi].c), borderRadius: [6, 6, 0, 0] } })), label: { show: true, position: 'top', color: AXIS, fontSize: 14, fontWeight: 700 } }] }
}
const scatter = (pts: { p: string; a: string | null; v: number; ss: number; label: string }[], lim: number) => ({
  ...baseOpt, tooltip: { ...baseOpt.tooltip, trigger: 'item', formatter: (q: { data: { label: string; value: number[] } }) => `${q.data.label}: ${q.data.value[0]}% votes → ${q.data.value[1]}% seats` },
  grid: { left: 8, right: 18, top: 28, bottom: 8, containLabel: true }, xAxis: { ...valAxis('{value}%'), name: 'vote share', nameTextStyle: { color: AXIS }, max: lim }, yAxis: { ...valAxis('{value}%'), name: 'seat share', nameTextStyle: { color: AXIS }, max: lim },
  series: [
    { type: 'scatter', symbolSize: 19, data: pts.map(p => ({ value: [p.v, p.ss], label: p.label, itemStyle: { color: colorFor(p.p, p.a), opacity: 0.92, shadowBlur: 14, shadowColor: colorFor(p.p, p.a) + '77', borderColor: 'rgba(0,0,0,0.25)', borderWidth: 0.5 } })), label: { show: true, formatter: (q: { data: { label: string } }) => q.data.label.split(' ')[0], position: 'right', color: AXIS, fontSize: 11, fontWeight: 600 } },
    { type: 'line', silent: true, showSymbol: false, lineStyle: { color: GRID, type: 'dashed' }, data: [[0, 0], [lim, lim]], tooltip: { show: false } },
  ],
})
const resBar = (seats: Seat[]) => {
  const present = [...new Set(seats.map(r => r.r ?? 'NA'))]
  const cats = [...RES_ORDER.filter(c => present.includes(c)), ...present.filter(c => !RES_ORDER.includes(c))]
  const byP = new Map<string, { a: string | null; byCat: Record<string, number> }>()
  seats.forEach(r => { const cat = r.r ?? 'NA'; const e = byP.get(r.p) ?? { a: r.a, byCat: {} }; e.byCat[cat] = (e.byCat[cat] || 0) + 1; byP.set(r.p, e) })
  const top = [...byP.entries()].map(([p, e]) => ({ p, a: e.a, byCat: e.byCat, total: Object.values(e.byCat).reduce((s, x) => s + x, 0) })).sort((a, b) => b.total - a.total).slice(0, 5)
  const catTot = Object.fromEntries(cats.map(c => [c, seats.filter(r => (r.r ?? 'NA') === c).length]))
  return { ...baseOpt, tooltip: { ...baseOpt.tooltip, trigger: 'axis' }, legend: { ...baseOpt.legend, data: top.map(t => t.p), top: 0 }, grid: { ...baseOpt.grid, top: 30 }, xAxis: catAxis(cats.map(c => `${c} (${catTot[c]})`)), yAxis: valAxis(), series: top.map(t => ({ name: t.p, type: 'bar', barMaxWidth: 24, data: cats.map(c => t.byCat[c] || 0), itemStyle: { color: colorFor(t.p, t.a), borderRadius: [3, 3, 0, 0] } })) }
}
const swingCurveOpt = (data: { pp: number; n: number }[], color: string) => ({
  ...baseOpt, legend: undefined, tooltip: { ...baseOpt.tooltip, trigger: 'axis', valueFormatter: (v: number) => v + ' seats flip' }, grid: { ...baseOpt.grid, top: 14 },
  xAxis: catAxis(data.map(d => d.pp + '%')), yAxis: valAxis(), series: [{ type: 'bar', barWidth: '56%', data: data.map(d => ({ value: d.n, itemStyle: { color: vgrad(color), borderRadius: [6, 6, 0, 0] } })), label: { show: true, position: 'top', color: AXIS, fontSize: 14, fontWeight: 700 } }],
})
function Dumbbell({ rows, max }: { rows: { p: string; a: string | null; aeV: number | null; geV: number | null }[]; max: number }) {
  return (
    <div className="space-y-2.5">
      <div className="text-xs text-muted mb-1">○ Assembly vote share &nbsp;→&nbsp; ● Lok Sabha vote share</div>
      {rows.map(r => {
        const color = colorFor(r.p, r.a)
        const pa = ((r.aeV ?? 0) / max) * 100, pg = ((r.geV ?? 0) / max) * 100
        const lo = Math.min(pa, pg), w = Math.abs(pg - pa), gain = (r.geV ?? 0) >= (r.aeV ?? 0)
        return (
          <div key={r.p} className="flex items-center gap-3">
            <span className="w-16 text-xs shrink-0 text-right"><Dot c={color} />{r.p}</span>
            <div className="relative flex-1 h-5">
              <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.06]" />
              {r.aeV != null && r.geV != null && <div className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full" style={{ left: `${lo}%`, width: `${w}%`, background: gain ? '#38bdf8' : '#fbbf24' }} />}
              {r.aeV != null && <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 bg-slate-950" style={{ left: `${pa}%`, borderColor: color }} />}
              {r.geV != null && <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full" style={{ left: `${pg}%`, background: color }} />}
            </div>
            <span className="w-24 text-[11px] tabular-nums text-faint shrink-0">{r.aeV?.toFixed(1) ?? '–'}→{r.geV?.toFixed(1) ?? '–'}%</span>
          </div>
        )
      })}
    </div>
  )
}
function SoWhat({ ins }: { ins: Insight | null | undefined }) {
  if (!ins) return null
  const cls = ins.tone === 'risk' ? 'border-red-400/30 text-red-200/90 bg-red-500/[0.05]' : ins.tone === 'edge' ? 'border-emerald-400/30 text-emerald-200/90 bg-emerald-500/[0.05]' : 'border-sky-400/25 text-sky-100/90 bg-sky-500/[0.04]'
  return <div className={`text-[13px] leading-snug px-3.5 py-2 rounded-xl border ${cls}`}>{ins.tone === 'risk' ? '⚠ ' : ins.tone === 'edge' ? '◎ ' : '▸ '}{ins.text}</div>
}
function BlocStrip({ items, total }: { items: { label: string; n: number; color: string }[]; total: number }) {
  return (
    <div className="mt-6 max-w-3xl">
      <div className="flex h-3.5 rounded-full overflow-hidden ring-1 ring-white/10">{items.map(it => <div key={it.label} style={{ width: `${(it.n / total) * 100}%`, background: it.color }} title={`${it.label}: ${it.n}`} />)}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-muted">{items.slice(0, 6).map(it => <span key={it.label}><Dot c={it.color} />{it.label} <span className="num text-faint">{it.n}</span></span>)}</div>
    </div>
  )
}
function Shell({ eyebrow, title, sowhat, foot, children }: { eyebrow: string; title: ReactNode; sowhat?: ReactNode; foot?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col h-full deck-stagger">
      <div className="shrink-0">
        <div className="kicker text-orange-300/80">{eyebrow}</div>
        <h2 className="text-[clamp(18px,2.45vw,28px)] font-extrabold tracking-tight leading-[1.09] mt-1 max-w-5xl">{title}</h2>
        {sowhat && <div className="mt-2.5 max-w-4xl">{sowhat}</div>}
      </div>
      <div className="flex-1 min-h-0 mt-3">{children}</div>
      {foot && <div className="shrink-0 text-[10.5px] text-faint mt-2 pt-1.5 border-t border-white/[0.05]">{foot}</div>}
    </div>
  )
}
type Slide = { id: string; crumb: string; body: ReactNode }

export default function StoryPage() {
  const { state, setState } = useFilters()
  const [ae, setAe] = useState<Seat[]>([]); const [ge, setGe] = useState<Seat[]>([])
  const [pAE, setPAE] = useState<PartyAgg[]>([]); const [pGE, setPGE] = useState<PartyAgg[]>([]); const [nGE, setNGE] = useState<PartyAgg[]>([])
  const [segs, setSegs] = useState<Segment[]>([]); const [turn, setTurn] = useState<StateTurnout>({ AE: {}, GE: {} }); const [cf, setCf] = useState<CFRow[]>([])
  const [i, setI] = useState(0); const [playing, setPlaying] = useState(false)
  const deckRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    loadSeats('AE').then(setAe); loadSeats('GE').then(setGe)
    loadPartyAE().then(setPAE); loadPartyGEState().then(setPGE); loadPartyGENat().then(setNGE)
    loadSegments().then(setSegs); loadStateTurnout().then(setTurn); loadAllianceCF().then(setCf)
  }, [])
  const ready = ae.length && ge.length && nGE.length
  const states = useMemo(() => [...new Set(ae.map(r => r.s))].sort(), [ae])
  const isNat = !state || !states.includes(state)
  const st = isNat ? '' : state!

  const wTurnout = useCallback((arena: 'AE' | 'GE', y: number) => {
    const src = turn[arena] ?? {}; const seats = arena === 'AE' ? ae : ge
    const sb = new Map<string, number>(); seats.forEach(r => { if (r.y === y) sb.set(r.s, (sb.get(r.s) || 0) + 1) })
    let ws = 0, w = 0
    for (const [k, v] of Object.entries(src)) { if (!k.endsWith('|' + y)) continue; const s = sb.get(k.slice(0, k.lastIndexOf('|'))) || 1; ws += v * s; w += s }
    return w ? +(ws / w).toFixed(1) : null
  }, [turn, ae, ge])

  // ── NATIONAL ──
  const aeMax = useMemo(() => (ae.length ? Math.max(...ae.map(r => r.y)) : 2026), [ae])
  const byStateAE = useMemo(() => activeByState(ae, 'AE', aeMax), [ae, aeMax])
  const natAE = useMemo(() => [...byStateAE.values()].flat(), [byStateAE])
  const ge24 = useMemo(() => ge.filter(r => r.y === 2024), [ge])
  const natGovern = useMemo(() => { const c = new Map<string, { n: number; a: string | null }>(); for (const [, seats] of byStateAE) { const t = tally(seats)[0]; if (t) { const e = c.get(t.p) ?? { n: 0, a: t.a }; e.n++; c.set(t.p, e) } } return [...c.entries()].map(([p, e]) => ({ p, a: e.a, n: e.n })).sort((a, b) => b.n - a.n) }, [byStateAE])
  const natLS = useMemo(() => nGE.filter(r => r.y === 2024 && (r.wo ?? 0) > 0).map(r => ({ p: r.p, a: r.a, n: r.wo ?? 0 })).sort((a, b) => b.n - a.n), [nGE])
  const gYears = useMemo(() => [...new Set(nGE.map(r => r.y))].sort((a, b) => a - b), [nGE])
  const natVote = useMemo(() => {
    const byP = new Map<string, Map<number, number | null>>()
    nGE.forEach(r => { if (!byP.has(r.p)) byP.set(r.p, new Map()); byP.get(r.p)!.set(r.y, r.v) })
    const top = [...byP.entries()].map(([p, m]) => ({ p, a: nGE.find(r => r.p === p)?.a ?? null, peak: Math.max(...[...m.values()].map(v => v ?? 0)), m }))
      .filter(e => e.peak >= 2).sort((a, b) => b.peak - a.peak).slice(0, 9)
    return { years: gYears, series: top.map(e => ({ name: e.p, color: colorFor(e.p, e.a), data: gYears.map(y => e.m.get(y) ?? null) })) }
  }, [nGE, gYears])
  const natEff = useMemo(() => { const rows = nGE.filter(r => r.y === 2024 && r.v != null && (r.v ?? 0) >= 3); const pts = rows.map(r => ({ p: r.p, a: r.a, v: r.v!, ss: +(((r.wo ?? 0) / 543) * 100).toFixed(1), label: `${r.p} ${r.v!.toFixed(0)}→${(((r.wo ?? 0) / 543) * 100).toFixed(0)}` })); const lim = Math.min(60, Math.ceil(Math.max(20, ...pts.flatMap(p => [p.v, p.ss])) / 10) * 10); return { pts, lim } }, [nGE])
  const natBloc = useMemo(() => { const m = new Map<string, number>(); ge24.forEach(r => m.set(allianceBase(r.a), (m.get(allianceBase(r.a)) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7) }, [ge24])
  const natTurn = useMemo(() => { const ys = [...new Set([...ae.map(r => r.y), ...ge.map(r => r.y)])].sort((a, b) => a - b); return { years: ys, ae: ys.map(y => (ae.some(r => r.y === y) ? wTurnout('AE', y) : null)), ge: ys.map(y => (ge.some(r => r.y === y) ? wTurnout('GE', y) : null)) } }, [ae, ge, wTurnout])
  const natChanges = useMemo(() => seatChanges(natAE, ae, 'AE'), [natAE, ae])
  const natNet = useMemo(() => netChange(natChanges), [natChanges])

  // ── STATE ──
  const aeY = useMemo(() => [...new Set(ae.filter(r => r.s === st).map(r => r.y))].sort((a, b) => a - b), [ae, st])
  const geY = useMemo(() => [...new Set(ge.filter(r => r.s === st).map(r => r.y))].sort((a, b) => a - b), [ge, st])
  const aeLatest = aeY[aeY.length - 1], geLatest = geY[geY.length - 1]
  const aeSel = useMemo(() => ae.filter(r => r.s === st && r.y === aeLatest), [ae, st, aeLatest])
  const stP = useMemo(() => tally(aeSel), [aeSel])
  const segLatest = useMemo(() => segs.filter(s2 => s2.s === st && s2.y === geLatest), [segs, st, geLatest])
  const geSegP = useMemo(() => tally(segLatest), [segLatest])
  const classed = useMemo(() => (st ? classifyState(ae, st, 'AE') : { seats: [] as SeatClass[], window: [] as number[] }), [ae, st])
  const classByJ = useMemo(() => { const m = new Map<number, SeatClass>(); classed.seats.forEach(c => m.set(c.cur.j, c)); return m }, [classed])
  const sec = useMemo(() => { let safe = 0, lean = 0, swg = 0; classed.seats.forEach(c => { if (c.status === 'swing') swg++; else if (c.status === 'safe') safe++; else lean++ }); return { safe, lean, swg, total: classed.seats.length, swingSeats: classed.seats.filter(c => c.status === 'swing') } }, [classed])
  const stChanges = useMemo(() => (aeSel.length ? seatChanges(aeSel, ae, 'AE') : []), [aeSel, ae])
  const stNet = useMemo(() => netChange(stChanges), [stChanges])
  const stRet = useMemo(() => { const lead = stP[0]?.p; if (!lead) return null; let had = 0, kept = 0; stChanges.forEach(c => { if (c.prev?.p === lead && c.status !== 'not-comparable') { had++; if (c.status === 'held') kept++ } }); return had ? { lead, had, kept, rate: Math.round((kept / had) * 100) } : null }, [stChanges, stP])
  const split = useMemo(() => {
    const aeS = new Map(pAE.filter(r => r.s === st && r.y === aeLatest && r.v != null).map(r => [r.p, r.v!]))
    const geS = new Map(pGE.filter(r => r.s === st && r.y === geLatest && r.v != null).map(r => [r.p, r.v!]))
    const keys = [...new Set([...aeS.keys(), ...geS.keys()])]
    const rows = keys.map(p => ({ p, a: aeSel.find(r => r.p === p)?.a ?? null, aeV: aeS.get(p) ?? null, geV: geS.get(p) ?? null })).filter(r => (r.aeV ?? 0) >= 3 || (r.geV ?? 0) >= 3).sort((a, b) => Math.max(b.aeV ?? 0, b.geV ?? 0) - Math.max(a.aeV ?? 0, a.geV ?? 0)).slice(0, 8)
    const top = [...rows].filter(r => r.aeV != null && r.geV != null).sort((a, b) => (b.geV! - b.aeV!) - (a.geV! - a.aeV!))
    return { rows, max: Math.max(10, ...rows.flatMap(r => [r.aeV ?? 0, r.geV ?? 0])), gainer: top[0] }
  }, [pAE, pGE, st, aeLatest, geLatest, aeSel])
  const stSwing = useMemo(() => { const prev = aeY[aeY.length - 2]; if (!prev) return [] as { p: string; a: string | null; d: number }[]; return swing(pAE, st, aeLatest, prev, 1.5).filter(r => Math.abs(r.d) >= 0.5).slice(0, 10) }, [pAE, st, aeLatest, aeY])
  const stVote = useMemo(() => {
    const rows = pAE.filter(r => r.s === st)
    const byP = new Map<string, Map<number, number | null>>()
    rows.forEach(r => { if (!byP.has(r.p)) byP.set(r.p, new Map()); byP.get(r.p)!.set(r.y, r.v) })
    const top = [...byP.entries()].map(([p, m]) => ({ p, a: rows.find(r => r.p === p)?.a ?? null, peak: Math.max(...[...m.values()].map(v => v ?? 0)), m }))
      .filter(e => e.peak >= 3).sort((a, b) => b.peak - a.peak).slice(0, 10)
    return { years: aeY, series: top.map(e => ({ name: e.p, color: colorFor(e.p, e.a), data: aeY.map(y => e.m.get(y) ?? null) })) }
  }, [pAE, st, aeY])
  const stEff = useMemo(() => { const rows = pAE.filter(r => r.s === st && r.y === aeLatest && r.v != null && (r.v ?? 0) >= 3); const tot = aeSel.length || 1; const pts = rows.map(r => ({ p: r.p, a: r.a, v: r.v!, ss: +(((r.wo ?? 0) / tot) * 100).toFixed(1), label: `${r.p} ${r.v!.toFixed(0)}→${(((r.wo ?? 0) / tot) * 100).toFixed(0)}` })); const lim = Math.min(80, Math.ceil(Math.max(30, ...pts.flatMap(p => [p.v, p.ss])) / 10) * 10); return { pts, lim } }, [pAE, st, aeLatest, aeSel])
  const stCF = useMemo(() => { const all = cf.filter(r => r.arena === 'AE' && r.s === st); if (!all.length) return null; const y = Math.max(...all.map(r => r.y)); return { y, rows: all.filter(r => r.y === y).sort((a, b) => b.actual - a.actual) } }, [cf, st])
  const stChal = useMemo(() => challengerOf(aeSel, stP[0]?.p), [aeSel, stP])
  const stCurve = useMemo(() => (stP[0] && stChal ? [1, 2, 3, 4, 5, 6].map(pp => ({ pp, n: swingometer(aeSel, stP[0].p, stChal, pp).flips.length })) : []), [aeSel, stP, stChal])
  const stDecisive = useMemo(() => decisiveSwing(aeSel, stP[0]?.p, stChal), [aeSel, stP, stChal])
  const stTurn = useMemo(() => { const ys = [...new Set([...aeY, ...geY])].sort((a, b) => a - b); return { years: ys, ae: ys.map(y => (turn.AE ?? {})[`${st}|${y}`] ?? null), ge: ys.map(y => (turn.GE ?? {})[`${st}|${y}`] ?? null) } }, [aeY, geY, turn, st])
  const stTurnAE = (turn.AE ?? {})[`${st}|${aeLatest}`] ?? null

  const Stat = ({ label, value, color }: { label: ReactNode; value: ReactNode; color?: string }) => (
    <div className="card !rounded-2xl px-4 py-3"><div className="kicker">{label}</div><div className="text-[clamp(18px,2.1vw,27px)] font-bold tabular-nums leading-tight" style={color ? { color } : undefined}>{value}</div></div>
  )

  const slides = useMemo<Slide[]>(() => {
    if (!ready) return []
    const ch = (h: number) => ({ height: `min(${h}vh, ${Math.round(h * 8.8)}px)` })
    if (isNat) {
      const gov = natGovern[0], ls = natLS[0]
      const cushion = majorityCushion(ge24), soft = shallowWins(ge24)[0], minor = minorityWins(ge24)
      const effLead = [...natEff.pts].sort((a, b) => (b.ss - b.v) - (a.ss - a.v))[0]
      const voteDelta = natVote.series.map(s => { const v = s.data.filter((x): x is number => x != null); return { name: s.name, d: v.length >= 2 ? +(v[v.length - 1] - v[0]).toFixed(1) : 0 } }).sort((a, b) => b.d - a.d)
      const flips = flipConcentration(natChanges), worst = worstDefence(natChanges)
      const blocStrip = natBloc.slice(0, 6).map(([al, n]) => ({ label: al, n, color: ALLIANCE_COLORS[al] ?? '#475569' }))
      return [
        { id: 'n1', crumb: 'Thesis', body: (
          <div className="flex flex-col justify-center h-full deck-stagger">
            <div className="kicker text-orange-300/80">The brief · India 2009–2026</div>
            <h1 className="text-[clamp(30px,5.4vw,62px)] font-black tracking-tighter leading-[0.98] mt-2 max-w-5xl bg-gradient-to-br from-ink to-slate-400 bg-clip-text text-transparent">Two democracies, one country</h1>
            <p className="text-[clamp(15px,1.85vw,20px)] text-muted font-medium mt-3 max-w-4xl leading-relaxed">{ls && gov && <><b className="text-ink">{ls.p}</b> commands Delhi with {ls.n} of 543 seats, yet governs only <b className="text-ink">{natGovern.find(g => g.p === ls.p)?.n ?? 0}</b> of {byStateAE.size} assemblies. The distance between the national vote and the state vote is where every election is decided.</>}</p>
            <BlocStrip items={blocStrip} total={543} />
          </div>
        ) },
        { id: 'n2', crumb: 'Two Indias', body: (
          <Shell eyebrow="The structural divide" title={gov && ls && gov.p !== ls.p ? <>India elects <span style={{ color: colorFor(gov.p, gov.a) }}>{gov.p}</span> to run its states and <span style={{ color: colorFor(ls.p, ls.a) }}>{ls.p}</span> to run the nation</> : 'States and Delhi rank parties differently'}
            sowhat={<SoWhat ins={{ tone: 'note', text: 'A national wave does not reach the state line, and a state machine does not travel to Delhi. The two rankings barely overlap.' }} />}
            foot="States governed = leading party in each state's latest assembly. Lok Sabha = 2024 seats.">
            <div className="grid md:grid-cols-2 gap-6 h-full">
              <div><div className="text-xs text-muted mb-1">States governed</div><Chart option={hbar(natGovern.map(g => ({ ...g, v: g.n })))} style={ch(38)} notMerge /></div>
              <div><div className="text-xs text-muted mb-1">Lok Sabha seats (2024)</div><Chart option={hbar(natLS.map(g => ({ ...g, v: g.n })))} style={ch(38)} notMerge /></div>
            </div>
          </Shell>
        ) },
        { id: 'n3', crumb: 'Mandate quality', body: (
          <Shell eyebrow="Is the majority a fortress or a facade?" title={cushion ? cushion.text.split('—')[0].trim() : 'How solid is the parliamentary majority?'}
            sowhat={<SoWhat ins={soft ?? cushion} />} foot="The leading bloc's 2024 wins, by winning vote share (left) and victory margin (right). Sub-40% / sub-5% wins are the soft underbelly.">
            <div className="grid md:grid-cols-2 gap-6 h-full">
              <div><div className="text-xs text-muted mb-1">By winning vote share</div><Chart option={buckets(ge24.filter(r => allianceBase(r.a) === (natBloc[0]?.[0] ?? '')), SHARE_B, r => r.v)} style={ch(38)} notMerge /></div>
              <div><div className="text-xs text-muted mb-1">By victory margin</div><Chart option={buckets(ge24.filter(r => allianceBase(r.a) === (natBloc[0]?.[0] ?? '')), MARGIN_B, r => r.m)} style={ch(38)} notMerge /></div>
            </div>
          </Shell>
        ) },
        { id: 'n4', crumb: 'Votes vs seats', body: (
          <Shell eyebrow="The conversion engine" title={effLead ? <><span style={{ color: colorFor(effLead.p, effLead.a) }}>{effLead.p}</span> turns {effLead.v.toFixed(1)}% of the vote into {effLead.ss}% of the seats — the system rewards concentration</> : 'Votes do not convert one-for-one'}
            sowhat={<SoWhat ins={minor} />} foot="Each dot is a party in 2024. Above the 45° line = over-converts (concentrated, alliance-leveraged); below = wasted share.">
            <Chart option={scatter(natEff.pts, natEff.lim)} style={ch(44)} notMerge />
          </Shell>
        ) },
        { id: 'n5', crumb: 'Trends', body: (
          <Shell eyebrow="Vote share across elections, 2009 → 2024" title={voteDelta[0] ? <><span style={{ color: colorFor(voteDelta[0].name, null) }}>{voteDelta[0].name}</span> has gained {voteDelta[0].d}% of the national vote since 2009; {voteDelta[voteDelta.length - 1].name} has shed {Math.abs(voteDelta[voteDelta.length - 1].d)}%</> : 'The vote-share arc'}
            sowhat={<SoWhat ins={{ tone: 'note', text: 'Seats lurch; vote share creeps. The slope of the vote line is the truest read of where momentum sits.' }} />} foot="National Lok Sabha vote share — every major party (peak ≥2%), 2009–2024.">
            <Chart option={trend(natVote.years, natVote.series, pctFmt)} style={ch(48)} notMerge />
          </Shell>
        ) },
        { id: 'n6', crumb: 'The patchwork', body: (
          <Shell eyebrow="The regional firewall" title={<>India's states answer to {natGovern.length} different parties — a regional firewall no single national machine has cleared</>}
            sowhat={<SoWhat ins={flips} />} foot="Every assembly seat, coloured by winner — the structural brake on national consolidation.">
            <ChoroplethMap byState={byStateAE} arena="AE" activeYear={aeMax} height="h-full" />
          </Shell>
        ) },
        { id: 'n7', crumb: 'Incumbency', body: (
          <Shell eyebrow="The anti-incumbency tide" title={worst ? worst.text.split('—')[0].trim() : 'Who is defending, who is bleeding'}
            sowhat={<SoWhat ins={worst ?? flips} />} foot="Net assembly-seat change for each party vs its previous election, across the snapshot — gains minus losses.">
            <Chart option={netBar(natNet)} style={ch(46)} notMerge />
          </Shell>
        ) },
        { id: 'n8', crumb: 'Coalition math', body: (
          <Shell eyebrow="The arithmetic of power" title={natBloc[0] ? <>Government runs through the <span style={{ color: ALLIANCE_COLORS[natBloc[0][0]] ?? undefined }}>{natBloc[0][0]}</span> bloc and its {natBloc[0][1]} seats</> : 'The blocs'}
            sowhat={<SoWhat ins={{ tone: 'note', text: 'No single party owns a durable majority alone — the marginal ally sets the price of power.' }} />} foot="2024 Lok Sabha seats pooled into pre-poll alliances.">
            <Chart option={donut(natBloc)} style={ch(44)} notMerge />
          </Shell>
        ) },
        { id: 'n9', crumb: 'Turnout', body: (
          <Shell eyebrow="The participation gap" title="Indians turn out at different rates for their state and for Delhi"
            sowhat={<SoWhat ins={{ tone: 'note', text: 'A turnout gap between the two ballots is a reservoir of conditional voters — mobilisable, but not loyal.' }} />} foot="Seat-weighted national turnout by election year.">
            <Chart option={trend(natTurn.years, [{ name: 'Assembly', color: '#fb923c', data: natTurn.ae }, { name: 'Lok Sabha', color: '#38bdf8', data: natTurn.ge }], pctFmt, true)} style={ch(46)} notMerge />
          </Shell>
        ) },
        { id: 'n10', crumb: 'Synthesis', body: (
          <div className="flex flex-col justify-center h-full deck-stagger max-w-4xl">
            <div className="kicker text-orange-300/80">The takeaway</div>
            <p className="text-[clamp(20px,2.6vw,31px)] font-bold leading-snug mt-3">India is not one electorate but two, voting on the same ground for different prizes.</p>
            <div className="space-y-2.5 mt-5">{cushion && <SoWhat ins={cushion} />}{minor && <SoWhat ins={minor} />}{flips && <SoWhat ins={flips} />}</div>
            <p className="text-muted text-[clamp(14px,1.7vw,18px)] mt-5 leading-relaxed">Watch the soft seats, the consolidation index, and the trajectory — not the headline number. The next mandate is decided in the gap between the two Indias.</p>
          </div>
        ) },
      ]
    }
    // ── STATE ──
    const aeLead = stP[0], geLead = geSegP[0], same = aeLead && geLead && aeLead.p === geLead.p
    const cushion = majorityCushion(aeSel), soft = shallowWins(aeSel)[0], minor = minorityWins(aeSel)
    const effLead = [...stEff.pts].sort((a, b) => (b.ss - b.v) - (a.ss - a.v))[0]
    const worst = worstDefence(stChanges)
    const vd = stVote.series.map(s => { const v = s.data.filter((x): x is number => x != null); return { name: s.name, d: v.length >= 2 ? +(v[v.length - 1] - v[0]).toFixed(1) : 0 } }).sort((a, b) => b.d - a.d)
    const secColor = (r: Seat) => { const c = classByJ.get(r.j); return !c ? '#64748b' : c.status === 'safe' ? SAFE : c.status === 'lean' ? LEAN : SWG }
    const secLegend = [{ label: 'Safe — one party always wins', color: SAFE, n: sec.safe }, { label: 'Lean', color: LEAN, n: sec.lean }, { label: 'Swing — the battleground', color: SWG, n: sec.swg }]
    const gain = split.gainer
    const reserved = aeSel.filter(r => r.r === 'SC' || r.r === 'ST'); const resTopRaw = tally(reserved)[0]
    const blocStrip = stP.slice(0, 6).map(p => ({ label: p.p, n: p.n, color: colorFor(p.p, p.a) }))
    return [
      { id: 's1', crumb: 'Thesis', body: (
        <div className="flex flex-col justify-center h-full deck-stagger">
          <div className="kicker text-orange-300/80">The brief · {st}</div>
          <h1 className="text-[clamp(30px,5.4vw,60px)] font-black tracking-tighter leading-[0.98] mt-2 bg-gradient-to-br from-ink to-slate-400 bg-clip-text text-transparent">{st}</h1>
          <p className="text-[clamp(15px,1.85vw,20px)] text-muted font-medium mt-3 max-w-4xl leading-relaxed">{same ? <><b className="text-ink">{aeLead?.p}</b> holds {st} in both houses — but the contest is never the {sec.safe + sec.lean} locked seats; it is the <b className="text-ink">{sec.swg}</b> that move.</> : <>{st} splits its ticket — <b className="text-ink">{aeLead?.p}</b> rules the assembly, <b className="text-ink">{geLead?.p}</b> carried the {geLatest} national vote. The prize is the bloc that switches.</>}</p>
          <BlocStrip items={blocStrip} total={aeSel.length} />
        </div>
      ) },
      { id: 's2', crumb: 'The battlefield', body: (
        <Shell eyebrow="Where the election is actually fought" title={<>Only <span className="text-red-400">{sec.swg}</span> of {sec.total} seats are genuinely in play — the rest are decided before the campaign starts</>}
          sowhat={<SoWhat ins={{ tone: sec.swg < sec.total * 0.2 ? 'risk' : 'note', text: `${sec.safe + sec.lean} seats are strongholds — money spent there is wasted. The ${sec.swg} red seats decide the house.` }} />}
          foot={`Classified over ${st}'s last ${classed.window.length} comparable assembly elections.`}>
          {classed.seats.length ? <ChoroplethMap byState={new Map([[st, aeSel]])} arena="AE" activeYear={aeLatest} focusState={st} height="h-full" colorOf={secColor} legendTitle="Seat security" legendItems={secLegend} /> : <div className="h-full grid place-items-center text-faint text-sm">Need ≥2 comparable elections.</div>}
        </Shell>
      ) },
      { id: 's3', crumb: 'Incumbency', body: (
        <Shell eyebrow="The incumbency verdict" title={stRet ? <><span style={{ color: colorFor(stRet.lead, aeLead?.a ?? null) }}>{stRet.lead}</span> retained {stRet.rate}% of the seats it was defending — {stRet.rate >= 75 ? 'incumbency held' : stRet.rate >= 50 ? 'a warning' : 'an anti-incumbency rout'}</> : 'Who gained, who bled'}
          sowhat={<SoWhat ins={worst ?? { tone: 'note', text: 'Net assembly-seat change vs the previous election — the swing in raw seats, before any spin.' }} />}
          foot="Seat gains minus losses per party vs the previous comparable assembly election.">
          {stNet.length ? <Chart option={netBar(stNet)} style={ch(44)} notMerge /> : <div className="h-full grid place-items-center text-faint text-sm">No comparable previous election.</div>}
        </Shell>
      ) },
      { id: 's4', crumb: 'Mandate depth', body: (
        <Shell eyebrow="Is the win a mandate or a fluke of arithmetic?" title={minor ? minor.text.split('—')[0].trim() : `How deep is ${aeLead?.p}'s win?`}
          sowhat={<SoWhat ins={soft ?? minor} />} foot={`${aeLead?.p}'s ${aeLatest} wins by winning vote share (left) and victory margin (right). Sub-40% / sub-5% wins survive only while the opposition stays divided.`}>
          <div className="grid md:grid-cols-2 gap-6 h-full">
            <div><div className="text-xs text-muted mb-1">By winning vote share</div><Chart option={buckets(aeSel.filter(r => r.p === (aeLead?.p ?? '')), SHARE_B, r => r.v)} style={ch(38)} notMerge /></div>
            <div><div className="text-xs text-muted mb-1">By victory margin</div><Chart option={buckets(aeSel.filter(r => r.p === (aeLead?.p ?? '')), MARGIN_B, r => r.m)} style={ch(38)} notMerge /></div>
          </div>
        </Shell>
      ) },
      { id: 's5', crumb: 'Trends', body: (
        <Shell eyebrow="Vote share across every election" title={vd[0] ? <><span style={{ color: colorFor(vd[0].name, null) }}>{vd[0].name}</span> has {vd[0].d >= 0 ? 'climbed' : 'fallen'} {Math.abs(vd[0].d)}% since {stVote.years[0]}; {vd[vd.length - 1].name} is the mirror image</> : 'How the parties rose and fell'}
          sowhat={<SoWhat ins={stSwing[0] ? { tone: 'note', text: `Latest swing — ${stSwing[0].p} ${stSwing[0].d >= 0 ? '+' : ''}${stSwing[0].d.toFixed(1)}%, ${stSwing[stSwing.length - 1].p} ${stSwing[stSwing.length - 1].d.toFixed(1)}%. A party can hold seats while its vote erodes — the line shows it first.` } : { tone: 'note', text: 'Each line is a party\'s statewide vote share over time — the long arc of who rose and who faded.' }} />}
          foot="Statewide assembly vote share — every party peaking ≥3%, across all elections.">
          {stVote.series.length ? <Chart option={trend(stVote.years, stVote.series, pctFmt)} style={ch(48)} notMerge /> : <div className="h-full grid place-items-center text-faint text-sm">Insufficient vote-share history.</div>}
        </Shell>
      ) },
      { id: 's6', crumb: 'Split-ticket', body: (
        <Shell eyebrow="The persuadable reservoir" title={gain ? <><span style={{ color: colorFor(gain.p, gain.a) }}>{gain.p}</span> gains {(((gain.geV ?? 0) - (gain.aeV ?? 0))).toFixed(1)}% of the vote the moment voters mark a national ballot</> : 'The vote shifts between state and nation'}
          sowhat={<SoWhat ins={{ tone: 'edge', text: 'The gap between a party\'s assembly and parliamentary vote is the switchable bloc — the only vote actually in contention.' }} />} foot="Statewide vote share, latest assembly vs latest Lok Sabha. GE-2024 shares are EVM-only.">
          {split.rows.length ? <Dumbbell rows={split.rows} max={split.max} /> : <div className="h-full grid place-items-center text-faint text-sm">Vote-share comparison unavailable.</div>}
        </Shell>
      ) },
      { id: 's7', crumb: 'Social map', body: (
        <Shell eyebrow="The social coalition" title={resTopRaw && aeLead ? (resTopRaw.p === aeLead.p ? <><span style={{ color: colorFor(aeLead.p, aeLead.a) }}>{aeLead.p}</span> also owns the reserved seats — {resTopRaw.n} of {reserved.length} SC/ST constituencies</> : <>The reserved seats break differently — <span style={{ color: colorFor(resTopRaw.p, resTopRaw.a) }}>{resTopRaw.p}</span> leads the SC/ST seats, not {aeLead.p}</>) : 'Performance across General and reserved seats'}
          sowhat={<SoWhat ins={{ tone: 'note', text: 'Reserved (SC/ST) seats follow caste arithmetic, not the statewide wave. A party strong in General but weak in reserved has a coalition gap.' }} />} foot="Seats won by category — grouped, not stacked. GEN = General; SC/ST = reserved.">
          <Chart option={resBar(aeSel)} style={ch(44)} notMerge />
        </Shell>
      ) },
      { id: 's8', crumb: 'Leverage', body: (
        <Shell eyebrow="Where votes become seats" title={effLead ? <><span style={{ color: colorFor(effLead.p, effLead.a) }}>{effLead.p}</span> converts {effLead.v.toFixed(1)}% of the vote into {effLead.ss}% of the seats</> : 'Vote efficiency'}
          sowhat={<SoWhat ins={{ tone: 'note', text: 'Above the line, a party banks more seats than its vote deserves — concentrated, transfer-friendly support. Below it, the vote is spread thin. This is the case for, or against, an alliance.' }} />} foot={`Each dot is a party in the ${aeLatest} assembly election (≥3% share).`}>
          {stEff.pts.length ? <Chart option={scatter(stEff.pts, stEff.lim)} style={ch(44)} notMerge /> : <div className="h-full grid place-items-center text-faint text-sm">Insufficient party data.</div>}
        </Shell>
      ) },
      { id: 's9', crumb: 'The path to power', body: (
        <Shell eyebrow="What it takes to flip the state" title={stDecisive && stChal ? <>A <span className="text-red-300">{stDecisive.pp}%</span> uniform swing from {aeLead?.p} to {stChal} flips {stDecisive.flips} seats — and the state</> : 'How fragile is the majority?'}
          sowhat={<SoWhat ins={stCF && stCF.rows[0] ? { tone: 'edge', text: `Consolidation cuts both ways: pooling allied votes would have shifted up to ${Math.max(0, ...stCF.rows.map(r => r.pooled - r.actual))} seats in ${stCF.y} — the friendly-fight cost.` } : { tone: 'note', text: 'Seats flipping as a uniform vote swings from the leader to its main challenger — the fragility curve.' }} />}
          foot={`Uniform-swing projection: ${aeLead?.p} → ${stChal ?? 'challenger'}. A blunt instrument, but it sizes the cliff edge.`}>
          {stCurve.length ? <Chart option={swingCurveOpt(stCurve, colorFor(stChal ?? '', null))} style={ch(44)} notMerge /> : <div className="h-full grid place-items-center text-faint text-sm">Margins unavailable for a swing read.</div>}
        </Shell>
      ) },
      { id: 's10', crumb: 'The board', body: (
        <Shell eyebrow="Where the next election is decided" title={<>The state turns on <span className="text-red-400">{sec.swg}</span> swing seats — this is the board</>}
          sowhat={<SoWhat ins={{ tone: 'note', text: same ? 'A durable grip — but built on the swing seats below, not the strongholds. Lose these and the majority goes.' : 'A split, persuadable electorate. Whoever wins the seats below wins the state.' }} />}
          foot="Seats that change hands across the comparable window. Dots show each past winner, oldest → newest.">
          <div className="h-full overflow-auto pr-1 grid sm:grid-cols-2 gap-x-6 gap-y-1 content-start">
            {sec.swingSeats.slice(0, 24).map(c => (
              <div key={c.cur.j} className="flex items-center gap-2 text-[12px] border-b border-white/[0.05] py-1.5">
                <span className="w-32 shrink-0 truncate">{tc(c.cur.c)}</span>
                <span className="flex items-center gap-1 flex-wrap">{c.seq.map((w, k) => <span key={k} title={`${w.y}: ${w.p}`}><Dot c={colorFor(w.p, w.a)} /></span>)}</span>
                <span className="ml-auto text-faint shrink-0">now {c.cur.p}</span>
              </div>
            ))}
            {!sec.swingSeats.length && <div className="text-faint text-sm">No swing seats — every seat has a clear owner.</div>}
          </div>
        </Shell>
      ) },
    ]
  }, [ready, isNat, st, ae, ge24, aeMax, byStateAE, natAE, natGovern, natLS, natVote, natEff, natBloc, natTurn, natChanges, natNet, gYears, wTurnout, nGE, aeLatest, geLatest, aeSel, stP, geSegP, classed, classByJ, sec, stChanges, stNet, stRet, split, stSwing, stVote, stEff, stCF, stChal, stCurve, stDecisive, stTurn, stTurnAE])

  useEffect(() => { setI(0); setPlaying(false) }, [isNat, st])
  const idx = Math.min(i, Math.max(0, slides.length - 1))
  const go = useCallback((d: number) => setI(v => Math.max(0, Math.min(slides.length - 1, v + d))), [slides.length])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; if (t && /^(input|select|textarea)$/i.test(t.tagName)) return; if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1) } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [go])
  useEffect(() => { if (!playing) return; if (idx >= slides.length - 1) { setPlaying(false); return } const id = setTimeout(() => go(1), 9000); return () => clearTimeout(id) }, [playing, idx, slides.length, go])

  const cur = slides[idx]
  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)]">
      <div className="flex items-center gap-3 mb-2 flex-wrap shrink-0">
        <span className="kicker text-faint">Brief on</span>
        <Select value={isNat ? 'India (National)' : st} onChange={v => setState(v === 'India (National)' ? null : v)} options={['India (National)', ...states]} width="w-60" />
        <span className="text-sm text-slate-400 ml-auto">a strategist's read · assembly + Lok Sabha · ← → to move</span>
      </div>
      {!ready ? <Skeleton h={520} className="!rounded-2xl flex-1" /> : (
        <div ref={deckRef} className="deck card overflow-hidden flex-1 flex flex-col min-h-0">
          <div className="deck-stage relative flex-1 min-h-0">
            {cur && <div key={cur.id} className="absolute inset-0 p-5 sm:p-8 animate-deckIn overflow-hidden">{cur.body}</div>}
          </div>
          <div className="flex items-center gap-1.5 px-3 sm:px-4 py-2 border-t border-white/[0.07] overflow-x-auto shrink-0">
            <button onClick={() => go(-1)} disabled={idx === 0} className="shrink-0 w-8 h-8 grid place-items-center rounded-lg border border-white/10 text-muted enabled:hover:text-ink enabled:hover:border-white/25 disabled:opacity-30 transition-colors">←</button>
            {slides.map((s, k) => (
              <button key={s.id} onClick={() => setI(k)} className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition-all ${k === idx ? 'bg-orange-500 text-black font-semibold' : 'text-faint hover:text-ink bg-white/[0.04] hover:bg-white/[0.08]'}`}>
                <span className="tabular-nums opacity-60">{k + 1}</span> {s.crumb}
              </button>
            ))}
            <button onClick={() => go(1)} disabled={idx === slides.length - 1} className="shrink-0 w-8 h-8 grid place-items-center rounded-lg border border-white/10 text-muted enabled:hover:text-ink enabled:hover:border-white/25 disabled:opacity-30 transition-colors">→</button>
            <button onClick={() => setPlaying(p => !p)} className="ml-auto shrink-0 px-3 h-8 rounded-lg border border-white/10 text-[12px] text-muted hover:text-ink hover:border-white/25 transition-colors">{playing ? '⏸ Pause' : '▶ Play'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
