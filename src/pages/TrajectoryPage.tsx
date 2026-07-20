import { useEffect, useMemo, useState } from 'react'
import { loadPartyAE, loadPartyGENat, loadPartyGEState, loadSeats, loadSegments, type PartyAgg, type Seat, type Segment } from '../lib/data'
import { colorFor, ALLIANCE_COLORS } from '../lib/colors'
import { useFilters, useTheme } from '../store'
import { Chart, ChartCard, Dot, Info, Seg, Select, StickyControls, VoteSeatChart } from '../components/ui'
import { allianceBase } from '../lib/analysis'
import { linearTrend, pedersen } from '../lib/projections'
import { baseOpt, catAxis, valAxis, AXIS, GRID, faintLine, vgrad } from '../lib/theme'

type Scope = 'NAT' | 'SAE' | 'SGE'

const SHARE_BUCKETS = [
  { label: '< 30%', lt: 30, color: '#7f1d1d' },
  { label: '30–40%', lt: 40, color: '#b45309' },
  { label: '40–50%', lt: 50, color: '#0e7490' },
  { label: '≥ 50% majority', lt: Infinity, color: '#15803d' },
]
const MARGIN_BUCKETS = [
  { label: '< 5%', lt: 5, color: '#b91c1c' },
  { label: '5–10%', lt: 10, color: '#c2410c' },
  { label: '10–20%', lt: 20, color: '#0e7490' },
  { label: '≥ 20%', lt: Infinity, color: '#15803d' },
]

const tc = (s: string) => (s || '').toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
type Grouping = { of: (s: Seat) => string; label: string } | null
type HoverCell = { year: number; bucket: string; color: string; suffix: string; valueLabel: string; groupLabel: string | null; items: { name: string; group: string; v: number }[] }

// Heatmap of a party's win-quality: rows = quality buckets (strongest on top), columns =
// elections. Cell shows the % (or seat count, via the toggle) of that election's wins in the
// bucket; brighter = more. Hover a cell to list the actual constituencies it covers.
function BucketHeatmap({ title, wins, years, buckets, get, mode, suffix, valueLabel, grouping, selKey, onSelect }: {
  title: string; wins: Seat[]; years: number[]; buckets: typeof SHARE_BUCKETS
  get: (r: Seat) => number | null; mode: 'pct' | 'count'; suffix: string; valueLabel: string
  grouping: Grouping; selKey: string | null; onSelect: (key: string | null, cell: HoverCell | null) => void
}) {
  const rows = buckets.map((b, bi) => ({
    b,
    cells: years.map(y => {
      const ofYear = wins.filter(r => r.y === y && get(r) != null)
      const lo = bi === 0 ? -1 : buckets[bi - 1].lt
      const seats = ofYear.filter(r => { const v = get(r)!; return v >= lo && v < b.lt })
      return { total: ofYear.length, n: seats.length, seats }
    }),
  })).reverse()   // strongest bucket on top
  return (
    <div>
      <div className="text-xs text-muted mb-2">{title} <span className="text-faint">· {mode === 'count' ? 'seats won' : "% of each election's wins"}</span></div>
      <table className="w-full border-separate" style={{ borderSpacing: 4 }}>
        <thead>
          <tr>
            <th className="w-32" />
            {years.map(y => <th key={y} className="text-center text-[11px] font-semibold text-muted pb-1 tabular-nums">{y}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ b, cells }) => (
            <tr key={b.label}>
              <td className="text-[11px] whitespace-nowrap pr-2 text-right text-muted"><Dot color={b.color} />{b.label}</td>
              {cells.map((c, i) => {
                const pct = c.total ? Math.round((c.n / c.total) * 100) : null
                const op = pct == null ? 0 : 0.12 + 0.78 * (pct / 100)
                const display = c.total === 0 ? '–' : (mode === 'count' ? String(c.n) : pct + '%')
                const cellKey = `${title}|${b.label}|${years[i]}`
                const isSel = selKey === cellKey
                return (
                  <td key={i}
                    onClick={() => { if (c.n > 0) onSelect(isSel ? null : cellKey, isSel ? null : { year: years[i], bucket: b.label, color: b.color, suffix, valueLabel, groupLabel: grouping ? grouping.label : null, items: c.seats.map(s => ({ name: tc(s.c), group: grouping ? grouping.of(s) : '', v: get(s) ?? 0 })) }) }}
                    className={`text-center text-[12px] font-bold tabular-nums rounded-md h-9 transition-shadow ${c.n > 0 ? 'cursor-pointer' : ''} ${isSel ? 'ring-2 ring-white/80' : c.n > 0 ? 'hover:ring-2 hover:ring-white/30' : ''}`}
                    style={{ background: pct == null ? 'rgba(148,163,184,0.05)' : b.color + Math.round(op * 255).toString(16).padStart(2, '0'), color: pct != null && op > 0.45 ? '#fff' : undefined }}>
                    {display}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function TrajectoryPage() {
  const { state } = useFilters()
  const track = faintLine(useTheme())   // strike-rate "contested" track — light grey on light, dark on dark
  const [scope, setScope] = useState<Scope>('NAT')
  const [rollup, setRollup] = useState(false)
  const [nat, setNat] = useState<PartyAgg[]>([])
  const [ae, setAe] = useState<PartyAgg[]>([])
  const [ges, setGes] = useState<PartyAgg[]>([])
  const [seats, setSeats] = useState<Seat[]>([])
  const [segs, setSegs] = useState<Segment[]>([])
  const [qp, setQp] = useState('')
  useEffect(() => { loadPartyGENat().then(setNat); loadPartyAE().then(setAe); loadPartyGEState().then(setGes); loadSegments().then(setSegs) }, [])

  const states = useMemo(() => [...new Set(ae.map(r => r.s!))].sort(), [ae])
  const st = state && states.includes(state) ? state : 'Uttar Pradesh'
  const raw = useMemo(() =>
    scope === 'NAT' ? nat : (scope === 'SAE' ? ae : ges).filter(r => r.s === st),
    [scope, nat, ae, ges, st])
  useEffect(() => { loadSeats(scope === 'SAE' ? 'AE' : 'GE').then(setSeats) }, [scope])
  const scopeSeats = useMemo(() => scope === 'NAT' ? seats : seats.filter(r => r.s === st), [seats, scope, st])
  // assembly seat → its parent Lok Sabha constituency (from GE assembly-segment data; latest delimitation wins)
  const pcByKey = useMemo(() => {
    const m = new Map<string, { y: number; pc: string }>()
    segs.forEach(g => { const k = `${g.s}::${norm(g.c)}`; const cur = m.get(k); if (!cur || g.y > cur.y) m.set(k, { y: g.y, pc: g.pcn }) })
    const out = new Map<string, string>(); m.forEach((v, k) => out.set(k, v.pc)); return out
  }, [segs])
  // win-quality seat list grouping: assembly → by parliament (PC); national → by state; state-LS → flat
  const grouping: Grouping = useMemo(() => scope === 'SAE'
    ? { of: (s: Seat) => pcByKey.get(`${s.s}::${norm(s.c)}`) ?? 'Unmapped', label: 'parliament' }
    : scope === 'NAT' ? { of: (s: Seat) => s.s ?? '', label: 'state' } : null,
    [scope, pcByKey])

  // roll parties up to alliances when asked
  const rows = useMemo(() => {
    if (!rollup) return raw
    const agg = new Map<string, PartyAgg>()
    for (const r of raw) {
      const k = allianceBase(r.a) + '|' + r.y
      const e = agg.get(k) ?? { y: r.y, p: allianceBase(r.a), a: r.a, f: 0, wo: 0, v: 0 }
      e.f = (e.f ?? 0) + (r.f ?? 0); e.wo = (e.wo ?? 0) + (r.wo ?? 0); e.v = +(((e.v ?? 0) + (r.v ?? 0))).toFixed(2)
      agg.set(k, e)
    }
    return [...agg.values()]
  }, [raw, rollup])

  const years = useMemo(() => [...new Set(rows.map(r => r.y))].sort((a, b) => a - b), [rows])
  const totalByYear = useMemo(() => {
    const m = new Map<number, number>()
    raw.forEach(r => m.set(r.y, (m.get(r.y) || 0) + (r.wo ?? 0)))
    return m
  }, [raw])
  const colorOfKey = (p: string, a: string | null) => rollup ? (ALLIANCE_COLORS[p] ?? '#475569') : colorFor(p, a)

  const byKey = useMemo(() => {
    const m = new Map<string, Map<number, PartyAgg>>()
    rows.forEach(r => { if (!m.has(r.p)) m.set(r.p, new Map()); m.get(r.p)!.set(r.y, r) })
    return m
  }, [rows])
  const top = useMemo(() =>
    [...byKey.entries()]
      .map(([p, m]) => ({ p, a: [...m.values()][0]?.a ?? null, peakV: Math.max(...[...m.values()].map(r => r.v ?? 0)) }))
      .filter(e => e.peakV >= (rollup ? 8 : 6))
      .sort((a, b) => b.peakV - a.peakV).slice(0, 8),
    [byKey, rollup])

  // votes → seats conversion efficiency
  const efficiency = useMemo(() => {
    const pts: { p: string; a: string | null; y: number; v: number; ss: number }[] = []
    rows.forEach(r => {
      const tot = totalByYear.get(r.y) ?? 0
      if (!tot || r.v == null || r.v < 4) return
      pts.push({ p: r.p, a: r.a, y: r.y, v: r.v, ss: +(((r.wo ?? 0) / tot) * 100).toFixed(1) })
    })
    const lim = Math.min(90, Math.ceil(Math.max(30, ...pts.map(q => Math.max(q.v, q.ss))) / 10) * 10)
    const byP = new Map<string, typeof pts>()
    pts.forEach(q => { if (!byP.has(q.p)) byP.set(q.p, []); byP.get(q.p)!.push(q) })
    const series = [...byP.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 9)
    return {
      option: {
        ...baseOpt,
        tooltip: {
          ...baseOpt.tooltip, trigger: 'item',
          formatter: (q: { data: { q: (typeof pts)[number] } }) =>
            `<b>${q.data.q.p} · ${q.data.q.y}</b><br/>${q.data.q.v}% votes → ${q.data.q.ss}% seats`,
        },
        grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
        xAxis: { ...valAxis('{value}%'), name: 'vote share', nameTextStyle: { color: AXIS }, max: lim },
        yAxis: { ...valAxis('{value}%'), name: 'seat share', nameTextStyle: { color: AXIS }, max: lim },
        series: [
          ...series.map(([p, list]) => ({
            name: p, type: 'scatter', symbolSize: 9,
            itemStyle: { color: colorOfKey(p, list[0].a), opacity: 0.8 },
            data: list.map(q => ({ value: [q.v, q.ss], q })),
          })),
          { name: 'proportional', type: 'line', silent: true, showSymbol: false, lineStyle: { color: GRID, type: 'dashed' }, data: [[0, 0], [lim, lim]], tooltip: { show: false } },
        ],
      },
      verdicts: [...byP.entries()].map(([p, list]) => ({
        p, a: list[0].a, gap: list.reduce((s2, q) => s2 + (q.ss - q.v), 0) / list.length, n: list.length,
      })).filter(e => e.n >= 2).sort((a, b) => b.gap - a.gap),
    }
  }, [rows, totalByYear])

  const strike = useMemo(() => top.slice(0, 6).map(e => {
    const data = years.map(y => {
      const r = byKey.get(e.p)?.get(y)
      return { y, f: r?.f ?? null, wo: r?.wo ?? null, rate: r?.f ? Math.round(((r.wo ?? 0) / r.f) * 100) : null }
    })
    return {
      p: e.p, color: colorOfKey(e.p, e.a),
      option: {
        ...baseOpt, legend: undefined,
        tooltip: { ...baseOpt.tooltip, trigger: 'axis', formatter: (qs: { dataIndex: number }[]) => { const d = data[qs[0].dataIndex]; return `${d.y}: won ${d.wo ?? '–'} / ${d.f ?? '–'} contested (${d.rate ?? '–'}%)` } },
        grid: { left: 4, right: 6, top: 18, bottom: 2, containLabel: true },
        xAxis: catAxis(years, { axisLabel: { color: AXIS, fontSize: 9 } }),
        yAxis: { type: 'value', show: false },
        series: [
          { type: 'bar', barGap: '-100%', barMaxWidth: 16, data: data.map(d => d.f), itemStyle: { color: track, borderRadius: 2 }, silent: true },
          { type: 'bar', barMaxWidth: 16, data: data.map(d => d.wo), itemStyle: { color: colorOfKey(e.p, e.a), borderRadius: 2 },
            label: { show: true, position: 'top', fontSize: 9, color: AXIS, formatter: (q: { dataIndex: number }) => data[q.dataIndex].rate != null ? data[q.dataIndex].rate + '%' : '' } },
        ],
      },
    }
  }), [top, years, byKey, track])

  // ── Trajectory projection: least-squares vote-share trend → next election ──
  const projection = useMemo(() => top.slice(0, 6).map(e => {
    const hist = years.map(y => byKey.get(e.p)?.get(y)?.v ?? null)
    const tr = linearTrend(hist)
    const next = tr ? +Math.max(0, Math.min(100, tr.project(years.length))).toFixed(1) : null
    return { p: e.p, a: e.a, color: colorOfKey(e.p, e.a), hist, next, slope: tr ? +tr.slope.toFixed(2) : null, r2: tr ? +tr.r2.toFixed(2) : null }
  }), [top, years, byKey])

  const projOption = useMemo(() => {
    const cats = [...years.map(String), 'Next ▸']
    const series = projection.flatMap(d => {
      const solid = { name: d.p, type: 'line', data: [...d.hist, null], connectNulls: true, smooth: 0.3, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2.5, color: d.color }, itemStyle: { color: d.color }, emphasis: { focus: 'series' }, blur: { lineStyle: { opacity: 0.16 } } }
      let lastIdx = -1
      for (let i = 0; i < d.hist.length; i++) if (d.hist[i] != null) lastIdx = i
      if (lastIdx < 0 || d.next == null) return [solid]
      const proj: (number | null)[] = cats.map(() => null)
      proj[lastIdx] = d.hist[lastIdx]; proj[years.length] = d.next
      return [solid,
        { name: d.p + ' proj', type: 'line', data: proj, connectNulls: true, symbol: 'none', silent: true, lineStyle: { width: 2, type: 'dashed' as const, color: d.color, opacity: 0.9 }, z: 4,
          endLabel: { show: true, formatter: `${d.p}  ${d.next}%`, color: d.color, fontSize: 10, fontWeight: 600 } },
      ]
    })
    return {
      ...baseOpt, legend: undefined,
      tooltip: { ...baseOpt.tooltip, trigger: 'axis', formatter: (ps: { seriesName: string; data: number | null; color: string; axisValue: string }[]) => {
        const real = ps.filter(p => !/ proj$/.test(p.seriesName) && p.data != null)
        if (!real.length) return ''
        return `<b>${ps[0].axisValue}</b><br/>` + real.sort((a, b) => (b.data ?? 0) - (a.data ?? 0))
          .map(p => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.seriesName}: <b>${(+(p.data ?? 0)).toFixed(1)}%</b>`).join('<br/>')
      } },
      grid: { left: 8, right: 86, top: 14, bottom: 8, containLabel: true },
      xAxis: catAxis(cats, { boundaryGap: false, axisLabel: { color: AXIS, fontSize: 11, formatter: (v: string) => v } }),
      yAxis: { ...valAxis('{value}%'), name: 'vote share', nameTextStyle: { color: AXIS, fontSize: 10 }, splitLine: { lineStyle: { type: 'dashed', color: GRID } } },
      series,
    }
  }, [projection, years])

  const momentum = useMemo(() => {
    const w = projection.filter(d => d.slope != null && d.r2 != null && d.next != null)
    const rising = [...w].sort((a, b) => (b.slope! - a.slope!))[0]
    const falling = [...w].sort((a, b) => (a.slope! - b.slope!))[0]
    return { rising: rising && rising.slope! > 0.3 ? rising : null, falling: falling && falling.slope! < -0.3 ? falling : null }
  }, [projection])

  // ── Electoral volatility (Pedersen index) over time ───────────────────────
  const volatility = useMemo(() => pedersen(raw, years), [raw, years])
  const volOption = useMemo(() => ({
    ...baseOpt, legend: undefined,
    tooltip: { ...baseOpt.tooltip, trigger: 'axis', formatter: (qs: { dataIndex: number }[]) => { const d = volatility[qs[0].dataIndex]; return d ? `<b>${d.y}</b><br/>${d.v}% of the vote churned between parties` : '' } },
    grid: { left: 4, right: 14, top: 18, bottom: 4, containLabel: true },
    xAxis: catAxis(volatility.map(d => String(d.y))),
    yAxis: { ...valAxis('{value}%'), name: 'volatility', nameTextStyle: { color: AXIS, fontSize: 10 }, splitLine: { lineStyle: { type: 'dashed', color: GRID } }, min: 0 },
    series: [{ type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, data: volatility.map(d => d.v), lineStyle: { width: 3, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' }, areaStyle: { color: vgrad('#f59e0b'), opacity: 0.16 } }],
  }), [volatility])
  const volVerdict = useMemo(() => {
    if (volatility.length < 2) return null
    const f = volatility[0].v, l = volatility[volatility.length - 1].v, d = l - f
    return d > 4 ? `Volatility is climbing (${f}% → ${l}%) — a dealigning electorate; more seats genuinely in play each cycle.`
      : d < -4 ? `Volatility is easing (${f}% → ${l}%) — the vote is settling into stable blocs.`
      : `Volatility is broadly steady (~${l}%) — the inter-party vote churn isn't trending.`
  }, [volatility])

  return (
    <div>
      <StickyControls>
        <div className="flex items-center gap-3 flex-wrap">
          <Seg options={[{ v: 'NAT', label: 'National · LS' }, { v: 'SAE', label: 'State · Assembly' }, { v: 'SGE', label: 'State · LS' }]}
            value={scope} onChange={v => setScope(v as Scope)} />
          {scope !== 'NAT' && <span className="text-sm text-slate-400">{st}</span>}
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={rollup} onChange={e => setRollup(e.target.checked)} className="accent-gold" />
            Alliance roll-up
          </label>
        </div>
      </StickyControls>

      {efficiency.verdicts.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {[efficiency.verdicts[0], efficiency.verdicts[efficiency.verdicts.length - 1]].map(e => (
            <div key={e.p} className={`text-[12px] px-3.5 py-2 rounded-xl border bg-white/[0.03] ${e.gap >= 0 ? 'border-emerald-400/25 text-emerald-200/90' : 'border-amber-400/25 text-amber-200/90'}`}>
              <b>{e.p}</b> converts votes {e.gap >= 0 ? 'efficiently' : 'poorly'}: seat share runs {e.gap >= 0 ? '+' : ''}{e.gap.toFixed(1)}% vs vote share
              {e.gap >= 0 ? ' — concentrated, transfer-friendly vote.' : ' — spread vote without regional anchor: classic wasted-share pattern.'}
            </div>
          ))}
        </div>
      )}

      <ChartCard title="Vote share % + seats won — the conversion view"
        note="Columns = seats won (left axis); line = vote share % (right axis), on one timeline. All parties show by default — click a chip to hide/show it (or All / None). A tall line over short bars = votes that don't convert (spread thin); short line over tall bars = an efficient, concentrated vote.">
        <VoteSeatChart years={years}
          parties={top.map(e => ({ p: e.p, a: e.a, color: colorOfKey(e.p, e.a) }))}
          seatsOf={p => years.map(y => { const r = byKey.get(p)?.get(y); return r ? (r.wo ?? 0) : null })}
          shareOf={p => years.map(y => { const r = byKey.get(p)?.get(y); return r ? r.v : null })}
          height={340} />
      </ChartCard>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <ChartCard className="lg:col-span-2"
          title={<>Trajectory projection — where the vote is heading <Info>Each party's vote share fitted with a least-squares trend line and extrapolated one election forward (the dashed tail and the “Next ▸” point). Straight-line extrapolation off the recent record — a directional read, NOT a forecast; turnout shocks, alliances and candidates can break any trend.</Info></>}
          note="Solid = the actual record; dashed = the linear-trend extrapolation to the next election. The slope is the average vote-share move per election; fit (r²) near 1 means a clean trend, near 0 means a noisy one — treat low-fit projections with caution.">
          {(momentum.rising || momentum.falling) && (
            <div className="flex flex-wrap gap-2 mb-3">
              {momentum.rising && (
                <div className="text-[12px] px-3.5 py-2 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-200/90">
                  <b>{momentum.rising.p}</b> is gaining fastest — about <b>+{momentum.rising.slope}%</b>/election → projected <b>{momentum.rising.next}%</b> next <span className="text-faint">(fit r² {momentum.rising.r2})</span>
                </div>
              )}
              {momentum.falling && (
                <div className="text-[12px] px-3.5 py-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] text-amber-200/90">
                  <b>{momentum.falling.p}</b> is fading — about <b>{momentum.falling.slope}%</b>/election → projected <b>{momentum.falling.next}%</b> next <span className="text-faint">(fit r² {momentum.falling.r2})</span>
                </div>
              )}
            </div>
          )}
          <Chart option={projOption} style={{ height: 320 }} notMerge />
        </ChartCard>
        <ChartCard title={<>Electoral volatility <Info>The Pedersen index: half the sum of every listed party's vote-share change between two consecutive elections. It measures how much of the vote is moving between parties — a proxy for how dealigned and in-play the electorate is. Computed over listed parties, so unlisted “Others” are not captured.</Info></>}
          note={volVerdict ?? 'Need at least two comparable elections to measure vote churn.'}>
          {volatility.length
            ? <Chart option={volOption} style={{ height: 300 }} notMerge />
            : <div className="h-[300px] grid place-items-center text-faint text-sm text-center px-6">Not enough comparable elections in this scope to chart volatility.</div>}
        </ChartCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <ChartCard title="Votes → seats conversion" note="Above the dashed line = over-converts (geographic concentration / alliance leverage). Below = wasted vote share. Points are party-elections ≥4% share.">
          <Chart option={efficiency.option} style={{ height: 380 }} notMerge />
        </ChartCard>
        <ChartCard title="Strike rate — won vs contested" note="Grey = contested, colored = won, label = strike rate. Wide footprint with a low rate is expansion mode — or a spoiler.">
          <div className="grid grid-cols-2 gap-3">
            {strike.map(s2 => (
              <div key={s2.p} className="border border-slate-800/70 rounded-lg p-2">
                <div className="text-xs font-semibold mb-1" style={{ color: s2.color }}>{s2.p}</div>
                <Chart option={s2.option} style={{ height: 120 }} notMerge />
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <WinQuality seats={scopeSeats} party={qp} setParty={setQp} grouping={grouping} />
    </div>
  )
}

/** Win-quality buckets (national-analysis-deck pattern): is the mandate deepening or are wins getting flukier? */
function WinQuality({ seats, party, setParty, grouping }: { seats: Seat[]; party: string; setParty: (p: string) => void; grouping: Grouping }) {
  const ranked = useMemo(() => {
    const c = new Map<string, number>()
    seats.forEach(r => c.set(r.p, (c.get(r.p) || 0) + 1))
    return [...c.entries()].filter(([, n]) => n >= 8).sort((a, b) => b[1] - a[1]).slice(0, 20).map(e => e[0])
  }, [seats])
  const parties = useMemo(() => [...ranked].sort(), [ranked])
  const P = party && parties.includes(party) ? party : ranked[0]
  const wins = useMemo(() => seats.filter(r => r.p === P), [seats, P])
  const years = useMemo(() => [...new Set(wins.map(r => r.y))].sort((a, b) => a - b), [wins])
  const verdict = useMemo(() => {
    if (years.length < 2) return null
    const maj = (y: number) => {
      const w = wins.filter(r => r.y === y && r.v != null)
      return w.length ? (w.filter(r => (r.v ?? 0) >= 50).length / w.length) * 100 : null
    }
    const first = maj(years[0]), last = maj(years[years.length - 1])
    if (first == null || last == null) return null
    const d = last - first
    return `${P}: ${last.toFixed(0)}% of wins now carry a 50%+ majority share (${d >= 0 ? 'up' : 'down'} from ${first.toFixed(0)}% in ${years[0]}) — ${d > 5 ? 'the mandate is deepening, not just widening.' : d < -5 ? 'wins are getting shallower — more plurality flukes, more exposure to consolidation.' : 'depth roughly stable.'}`
  }, [wins, years, P])
  const [metric, setMetric] = useState<'pct' | 'count'>('pct')
  const [sel, setSel] = useState<HoverCell | null>(null)
  const [selKey, setSelKey] = useState<string | null>(null)
  const onSelect = (k: string | null, cell: HoverCell | null) => { setSelKey(k); setSel(cell) }
  useEffect(() => { setSel(null); setSelKey(null) }, [P])   // clear the picked cell when the party changes
  if (!parties.length) return null
  return (
    <div className="mt-4">
      <ChartCard title="Win quality — depth of the mandate"
        note="Heatmap: each cell = the share (or seat count) of that election's wins in that bucket — brighter = more wins there. Read a row across the years to see the trend. Majority-share / ≥20% margin wins survive opposition consolidation; sub-30% / <5% wins are gifts of a divided field.">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Select value={P} onChange={setParty} options={parties} width="w-32" />
          <Seg options={[{ v: 'pct', label: '%' }, { v: 'count', label: '#' }]} value={metric} onChange={v => setMetric(v as 'pct' | 'count')} />
          {verdict && <span className="text-[12px] text-slate-300">{verdict}</span>}
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <BucketHeatmap title="Winning vote-share buckets" wins={wins} years={years} buckets={SHARE_BUCKETS} get={r => r.v} mode={metric} suffix="%" valueLabel="vote share" grouping={grouping} selKey={selKey} onSelect={onSelect} />
          <BucketHeatmap title="Victory-margin buckets" wins={wins} years={years} buckets={MARGIN_BUCKETS} get={r => r.m} mode={metric} suffix="%" valueLabel="victory margin" grouping={grouping} selKey={selKey} onSelect={onSelect} />
        </div>
        <div className="mt-3 border-t border-white/[0.06] pt-2.5 text-[11px] leading-relaxed min-h-[3rem]">
          {sel ? (() => {
            const items = [...sel.items].sort((a, b) => b.v - a.v)
            const fmt = (i: { name: string; v: number }) => `${i.name} (${i.v.toFixed(1)}${sel.suffix})`
            const byGroup = new Map<string, { name: string; v: number }[]>()
            items.forEach(i => { const g = i.group || '—'; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g)!.push(i) })
            const groups = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length || b[1][0].v - a[1][0].v)
            const grouped = !!sel.groupLabel && groups.length > 1
            return (
              <div>
                <div className="mb-1.5 text-[11.5px] flex items-center gap-2 flex-wrap">
                  <span className="font-semibold" style={{ color: sel.color }}>{sel.year} · {sel.bucket}</span>
                  <span className="text-faint">· {items.length} seats · sorted by {sel.valueLabel} high → low{grouped ? ` · grouped by ${sel.groupLabel}` : ''}</span>
                  <button onClick={() => onSelect(null, null)} className="text-faint underline decoration-dotted hover:text-ink">clear</button>
                </div>
                <div className="max-h-[200px] overflow-auto pr-1 space-y-1">
                  {grouped ? groups.map(([g, list]) => (
                    <div key={g} className="text-muted"><span className="text-ink font-medium">{g}</span> <span className="text-faint">({list.length})</span> — {list.map(fmt).join('  ·  ')}</div>
                  )) : <div className="text-muted">{items.map(fmt).join('  ·  ')}</div>}
                </div>
              </div>
            )
          })() : <span className="text-faint"><b className="text-muted">Click</b> any cell to list <b className="text-muted">all</b> its constituencies — grouped by {grouping ? grouping.label : 'state'}, sorted high → low. Toggle <b className="text-muted">%</b> / <b className="text-muted">#</b> above for share vs seat counts.</span>}
        </div>
      </ChartCard>
    </div>
  )
}
