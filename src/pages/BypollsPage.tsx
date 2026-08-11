import { useEffect, useMemo, useState } from 'react'
import { loadBypolls, type Bypoll } from '../lib/data'
import { colorFor } from '../lib/colors'
import { Chart, ChartCard, Dot, KPI, Seg, StickyControls } from '../components/ui'
import { useFilters, useTheme } from '../store'
import { baseOpt, catAxis, valAxis, AXIS, labelColor, faintLine } from '../lib/theme'

const tc = (s: string) => s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())

export default function BypollsPage() {
  const mode = useTheme()
  const lab = labelColor(mode)
  const { state } = useFilters()
  const st = state ?? 'All states'
  const [all, setAll] = useState<Bypoll[]>([])
  const [arena, setArena] = useState<'ALL' | 'AE' | 'GE'>('ALL')
  useEffect(() => { loadBypolls().then(setAll) }, [])

  const rows = useMemo(() => all
    .filter(r => arena === 'ALL' || r.arena === arena)
    .filter(r => st === 'All states' || r.s === st), [all, arena, st])

  const kpi = useMemo(() => {
    const withRet = rows.filter(r => r.ret === 'Y' || r.ret === 'N')
    const held = withRet.filter(r => r.ret === 'Y').length
    return { total: rows.length, judged: withRet.length, held, rate: withRet.length ? Math.round((held / withRet.length) * 100) : null }
  }, [rows])

  // who defends, who raids — per party hold/gain ledger
  const ledger = useMemo(() => {
    const m = new Map<string, { defended: number; held: number; gained: number; a: string | null }>()
    for (const r of rows) {
      if (r.ret !== 'Y' && r.ret !== 'N') continue
      if (r.prev) {
        const d = m.get(r.prev) ?? { defended: 0, held: 0, gained: 0, a: null }
        d.defended++
        if (r.ret === 'Y') d.held++
        m.set(r.prev, d)
      }
      if (r.ret === 'N') {
        const g = m.get(r.p) ?? { defended: 0, held: 0, gained: 0, a: r.a }
        g.gained++; g.a = g.a ?? r.a
        m.set(r.p, g)
      }
    }
    return [...m.entries()].map(([p, e]) => ({ p, ...e, rate: e.defended ? Math.round((e.held / e.defended) * 100) : null }))
      .filter(e => e.defended + e.gained >= 5)
      .sort((a, b) => (b.defended + b.gained) - (a.defended + a.gained)).slice(0, 8)
  }, [rows])

  const timeline = useMemo(() => {
    const judged = rows.filter(r => r.ret === 'Y' || r.ret === 'N')
    const parties = [...new Set(judged.map(r => r.p))]
      .map(p => ({ p, n: judged.filter(r => r.p === p).length }))
      .sort((a, b) => b.n - a.n).slice(0, 12).map(e => e.p)
    const data = judged.filter(r => parties.includes(r.p)).map(r => ({
      value: [r.y + ((r.mo ?? 6) - 0.5) / 12, parties.indexOf(r.p)],
      itemStyle: { color: r.ret === 'Y' ? '#10b981' : '#f87171' }, r,
    }))
    return {
      ...baseOpt, legend: undefined,
      tooltip: {
        ...baseOpt.tooltip, trigger: 'item',
        formatter: (q: { data: { r: Bypoll } }) => {
          const r = q.data.r
          return `<b>${tc(r.c)}</b> · ${r.s} · ${r.y}${r.mo ? '/' + r.mo : ''}<br/>${r.ret === 'Y' ? 'HELD' : 'FLIPPED'}: ${r.prev ?? '?'} → ${r.p}${r.cause ? '<br/>cause: ' + r.cause : ''}`
        },
      },
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: valAxis(undefined, { min: 2009, max: 2027, axisLabel: { color: AXIS, formatter: (v: number) => String(Math.round(v)) }, splitLine: { lineStyle: { color: faintLine(mode) } } }),
      yAxis: catAxis(parties, { axisLabel: { color: lab, fontSize: 10 } }),
      series: [{ type: 'scatter', symbolSize: 8, data }],
    }
  }, [rows, lab, mode])

  const causes = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach(r => { if (r.cause) m.set(r.cause, (m.get(r.cause) || 0) + 1) })
    const top = [...m.entries()].sort((a, b) => a[1] - b[1]).slice(-8)
    return {
      ...baseOpt, legend: undefined,
      tooltip: { ...baseOpt.tooltip, trigger: 'item' },
      grid: { left: 8, right: 30, top: 6, bottom: 4, containLabel: true },
      xAxis: valAxis(), yAxis: catAxis(top.map(e => e[0])),
      series: [{
        type: 'bar', barWidth: 12, data: top.map(e => ({ value: e[1], itemStyle: { color: '#64748b', borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'right', color: AXIS, fontSize: 10 },
      }],
    }
  }, [rows])

  return (
    <div>
      <StickyControls>
      <div className="flex items-center gap-3 flex-wrap">
        <Seg options={[{ v: 'ALL', label: 'All' }, { v: 'AE', label: 'Assembly' }, { v: 'GE', label: 'Lok Sabha' }]} value={arena} onChange={v => setArena(v as 'ALL' | 'AE' | 'GE')} />
        <span className="text-sm text-slate-400">{st === 'All states' ? 'All of India' : st} · {rows.length} bypolls</span>
      </div>
      </StickyControls>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KPI label="Bypolls" value={kpi.total} sub="2009–2026 in data" />
        <KPI label="With verdict" value={kpi.judged} sub="previous holder known" />
        <KPI label="Held" value={kpi.held} accent="#10b981" />
        <KPI label="Hold rate" value={kpi.rate != null ? kpi.rate + '%' : '–'} accent={kpi.rate != null && kpi.rate < 50 ? '#f87171' : '#10b981'}
          sub="bypolls are the cheapest midterm read — sub-50% means the ground is moving" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <ChartCard title="Timeline — every adjudicated bypoll" className="lg:col-span-2"
          note="Green = holder defended the seat, red = flipped. Clusters of red around one party are the early-warning signal.">
          <div className="h-[260px] sm:h-[380px]">
            <Chart option={timeline} style={{ height: '100%' }} notMerge />
          </div>
        </ChartCard>
        <div className="flex flex-col gap-4">
          <ChartCard title="Defend vs raid record">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-xs">
                <thead className="text-muted text-left"><tr><th className="py-1">Party</th><th className="text-right">Defended</th><th className="text-right">Held</th><th className="text-right">Raided</th><th className="text-right">Hold%</th></tr></thead>
                <tbody>{ledger.map(e => (
                  <tr key={e.p} className="border-t border-slate-800/60">
                    <td className="py-1.5"><Dot color={colorFor(e.p, e.a)} />{e.p}</td>
                    <td className="text-right tabular-nums">{e.defended}</td>
                    <td className="text-right tabular-nums">{e.held}</td>
                    <td className="text-right tabular-nums">{e.gained}</td>
                    {/* Hold% is the ledger's verdict number — the 300-tints are unreadable on the cream light canvas, so darken them there (mode is already in scope via useTheme). */}
                    <td className={`text-right tabular-nums ${e.rate != null && e.rate < 50 ? (mode === 'light' ? 'text-red-700' : 'text-red-300') : (mode === 'light' ? 'text-emerald-700' : 'text-emerald-300')}`}>{e.rate ?? '–'}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </ChartCard>
          <ChartCard title="Why the seat fell vacant" note="Votes for 2023+ bypolls pending in source (winners verified).">
            <Chart option={causes} style={{ height: 200 }} notMerge />
          </ChartCard>
        </div>
      </div>
    </div>
  )
}
