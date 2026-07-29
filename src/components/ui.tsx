import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import ReactECharts from 'echarts-for-react'
import { useTheme } from '../store'
import { echartsTheme, voteSeatOption } from '../lib/theme'
import { GLOSSARY } from '../lib/glossary'
import { readable } from '../lib/colors'

/** Hoverable ⓘ that shows a plain-language explanation. */
export function Info({ children, w = 'w-60' }: { children: ReactNode; w?: string }) {
  return (
    <span className="relative inline-flex group align-middle">
      <span className="ml-1 w-3.5 h-3.5 grid place-items-center rounded-full border border-slate-400/50 text-[9px] leading-none text-faint cursor-help select-none font-sans font-semibold">i</span>
      <span className={`pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 ${w} glass p-2.5 text-[11px] leading-relaxed text-ink opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 normal-case tracking-normal font-normal`}>
        {children}
      </span>
    </span>
  )
}

/** Header button + overlay listing every term in plain English. */
export function Glossary() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} title="What do these terms mean?"
        className="shrink-0 h-9 px-2.5 grid place-items-center rounded-lg border border-white/10 bg-slate-900/40 text-muted hover:text-ink hover:border-white/25 transition-colors text-[13px] font-semibold">
        ?
      </button>
      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <aside onClick={e => e.stopPropagation()}
            className="absolute right-0 top-0 h-full w-[440px] max-w-[94vw] bg-slate-950/95 backdrop-blur-xl border-l border-white/10 p-5 overflow-y-auto shadow-pop animate-fadeUp">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-lg">Glossary — in plain English</h2>
              <button onClick={() => setOpen(false)} className="text-faint hover:text-ink text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-muted mb-4">Every term used in this dashboard, explained simply.</p>
            <dl className="space-y-3.5">
              {GLOSSARY.map(g => (
                <div key={g.term} className="border-b border-white/[0.06] pb-3 last:border-0">
                  <dt className="text-[13px] font-semibold text-ink">{g.term}</dt>
                  <dd className="text-xs text-muted mt-0.5 leading-relaxed">{g.long}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      )}
    </>
  )
}

/** Theme-aware ECharts drop-in for <ReactECharts>. Passing a stable theme-object
 *  reference makes echarts-for-react dispose + re-init when the app theme flips. */
export function Chart({ option, h, style, notMerge = true, onEvents }: { option: unknown; h?: number; style?: CSSProperties; notMerge?: boolean; onEvents?: Record<string, (params: { name?: string; data?: unknown }) => void> }) {
  const mode = useTheme()
  return <ReactECharts theme={echartsTheme(mode)} option={option} style={style ?? { height: h }} notMerge={notMerge} lazyUpdate onEvents={onEvents as never} />
}

export function ChartCard({ title, children, note, className = '' }:
  { title: ReactNode; children: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={`card p-3.5 ${className}`}>
      <h3 className="text-[12.5px] font-semibold mb-2 text-slate-200 tracking-tight">{title}</h3>
      {children}
      {note && <p className="mt-2 text-[11px] text-slate-500 leading-snug border-t border-white/[0.05] pt-2">{note}</p>}
    </div>
  )
}

export function KPI({ label, value, sub, accent, delta, spark }:
  { label: ReactNode; value: ReactNode; sub?: ReactNode; accent?: string
    delta?: { value: string; up: boolean; good?: boolean }; spark?: (number | null)[] }) {
  const mode = useTheme()
  const good = delta ? (delta.good ?? delta.up) : false
  return (
    <div className="card px-3.5 py-2.5 relative overflow-hidden">
      {accent && <span className="absolute inset-x-0 top-0 h-[2px] opacity-70" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />}
      <div className="kicker">{label}</div>
      <div className="flex items-end gap-2 mt-0.5">
        <div className="text-[24px] leading-7 font-bold tabular-nums" style={accent ? { color: readable(accent, mode) } : undefined}>{value}</div>
        {delta && (
          <span className="mb-0.5 text-[11px] font-semibold tabular-nums inline-flex items-center gap-0.5" style={{ color: readable(good ? '#16a34a' : '#dc2626', mode) }}>
            {delta.up ? '▲' : '▼'}{delta.value}
          </span>
        )}
        {spark && spark.filter(v => v != null).length >= 2 && <span className="ml-auto mb-1">{<Spark data={spark} color={accent ?? '#38bdf8'} />}</span>}
      </div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{sub}</div>}
    </div>
  )
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle ring-1 ring-black/40" style={{ background: color }} />
}

/** Tiny inline sparkline (values may contain nulls → gaps). */
export function Spark({ data, color = '#94a3b8', w = 84, h = 22 }: { data: (number | null)[]; color?: string; w?: number; h?: number }) {
  const d = useMemo(() => {
    const vals = data.filter((v): v is number => v != null)
    if (vals.length < 2) return ''
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1
    return data.map((v, idx) => {
      if (v == null) return ''
      const x = (idx / (data.length - 1)) * (w - 4) + 2
      const y = h - 3 - ((v - min) / span) * (h - 6)
      return `${x},${y}`
    }).filter(Boolean).join(' ')
  }, [data, w, h])
  if (!d) return <span className="text-slate-600 text-[10px]">–</span>
  return (
    <svg width={w} height={h} className="inline-block align-middle">
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export type Col<T> = {
  key: string; label: string
  get: (r: T) => string | number | null
  render?: (r: T) => ReactNode
  align?: 'right' | 'left'
  width?: string
}

/** Sortable data table with optional search. */
export function SortTable<T>({ rows, cols, defaultSort, search, searchIn, maxH = 420, initialDir = 'asc', onRowClick }: {
  rows: T[]; cols: Col<T>[]; defaultSort: string
  search?: boolean; searchIn?: (r: T) => string; maxH?: number; initialDir?: 'asc' | 'desc'
  onRowClick?: (r: T) => void
}) {
  const [sort, setSort] = useState(defaultSort)
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir)
  const [q, setQ] = useState('')
  const sorted = useMemo(() => {
    const col = cols.find(c => c.key === sort) ?? cols[0]
    const filtered = q && searchIn ? rows.filter(r => searchIn(r).toLowerCase().includes(q.toLowerCase())) : rows
    return [...filtered].sort((a, b) => {
      const va = col.get(a), vb = col.get(b)
      if (va == null) return 1
      if (vb == null) return -1
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return dir === 'asc' ? c : -c
    })
  }, [rows, cols, sort, dir, q, searchIn])
  return (
    <div>
      {search && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
          className="mb-2 w-60 bg-slate-950/60 border border-white/[0.09] rounded-lg px-3 py-1.5 text-xs outline-none placeholder:text-slate-600 focus:border-gold/50 transition-colors" />
      )}
      <div className="overflow-auto rounded-lg" style={{ maxHeight: maxH }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-950/95 backdrop-blur">
              {cols.map(c => (
                <th key={c.key} style={c.width ? { width: c.width } : undefined}
                  className={`py-2 px-2 cursor-pointer select-none whitespace-nowrap kicker hover:text-slate-300 transition-colors ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  onClick={() => { if (sort === c.key) setDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSort(c.key); setDir('desc') } }}>
                  {c.label}{sort === c.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => (
              <tr key={idx} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`border-t border-white/[0.04] hover:bg-white/[0.03] transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}>
                {cols.map(c => (
                  <td key={c.key} className={`py-[7px] px-2 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {c.render ? c.render(r) : c.get(r) ?? '–'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <div className="text-slate-500 text-xs py-8 text-center">No rows</div>}
      </div>
    </div>
  )
}

export function Seg({ options, value, onChange }: { options: readonly { v: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-full p-[3px] bg-slate-950/70 border border-white/[0.08]">
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`px-3.5 py-1 text-[12.5px] rounded-full transition-all duration-150 ${
            value === o.v
              ? 'bg-gradient-to-b from-[#e8c766] to-[#b0812a] text-black font-semibold shadow-glow'
              : 'text-slate-400 hover:text-white'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select({ value, onChange, options, width = 'w-48' }:
  { value: string; onChange: (v: string) => void; options: string[]; width?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`bg-slate-950/70 border border-white/[0.09] rounded-lg px-3 py-1.5 text-[13px] hover:border-white/20 focus:border-gold/50 outline-none transition-colors cursor-pointer ${width}`}>
      {options.map(o => <option key={o} className="bg-slate-900">{o}</option>)}
    </select>
  )
}

/** Full-card loading shimmer. */
export function Skeleton({ h = 320, className = '' }: { h?: number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height: h }} />
}

/** Pins a page's primary controls just under the global header+FilterBar while
 *  scrolling. `--app-top` (the height of the sticky global stack) is published by
 *  App.tsx; the -mx-6/px-6 bleed makes the backdrop span the content width so rows
 *  scroll cleanly underneath. */
export function StickyControls({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`sticky z-20 -mx-6 px-6 py-2.5 mb-4 bg-slate-950/80 backdrop-blur-xl border-b border-white/[0.07] ${className}`}
      style={{ top: 'var(--app-top, 92px)' }}>
      {children}
    </div>
  )
}

export type VSParty = { p: string; a: string | null; color: string }
/** Seats won (columns) + vote share % (line) per party on a shared timeline. Chips
 *  MULTI-SELECT — every party shown by default; click a chip to hide/show it (or use
 *  All / None). Axis ceilings stay fixed across all parties so toggling never rescales. */
export function VoteSeatChart({ years, parties, seatsOf, shareOf, height = 320, glow, extra }: {
  years: (number | string)[]
  parties: VSParty[]
  seatsOf: (p: string) => (number | null)[]
  shareOf: (p: string) => (number | null)[]
  height?: number
  glow?: boolean
  extra?: ReactNode
}) {
  const list = parties.slice(0, 12)
  const keys = list.map(x => x.p)
  const sig = keys.join('|')
  const [sel, setSel] = useState<string[] | null>(null)   // null = all selected
  useEffect(() => { setSel(null) }, [sig])                 // reset to "all" when the party set changes (state / arena / mode switch)
  const chosenKeys = sel === null ? keys : sel.filter(k => keys.includes(k))
  const has = (k: string) => chosenKeys.includes(k)
  const toggle = (k: string) => { const base = sel === null ? keys : sel; setSel(base.includes(k) ? base.filter(x => x !== k) : [...base, k]) }
  // stable ceilings across EVERY party (so showing/hiding never rescales the axes)
  const seatMax = useMemo(() => { const m = Math.max(0, ...list.flatMap(x => seatsOf(x.p).map(v => v ?? 0))); return m ? Math.ceil(m / 5) * 5 : undefined }, [sig, seatsOf])
  const shareMax = useMemo(() => { const m = Math.max(0, ...list.flatMap(x => shareOf(x.p).map(v => v ?? 0))); return m ? Math.min(100, Math.ceil(m / 10) * 10 + 5) : undefined }, [sig, shareOf])
  if (!list.length) return <div style={{ height }} className="grid place-items-center text-faint text-sm">No data for this view.</div>
  const chosen = list.filter(x => has(x.p))
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
        {extra}
        <button onClick={() => setSel(keys)} className="px-2 py-1 rounded-full text-[11px] border border-white/10 text-faint hover:text-ink transition-colors">All</button>
        <button onClick={() => setSel([])} className="px-2 py-1 rounded-full text-[11px] border border-white/10 text-faint hover:text-ink transition-colors">None</button>
        {list.map(x => {
          const on = has(x.p)
          return (
            <button key={x.p} onClick={() => toggle(x.p)} title={on ? 'Click to hide' : 'Click to show'}
              className={`px-2.5 py-1 rounded-full text-[11.5px] border transition-all ${on ? 'text-ink font-semibold' : 'text-faint opacity-55 hover:opacity-100'}`}
              style={{ background: on ? x.color + '22' : 'transparent', borderColor: on ? x.color + '88' : 'rgba(148,163,184,0.16)' }}>
              <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: x.color, opacity: on ? 1 : 0.5 }} />{x.p}
            </button>
          )
        })}
      </div>
      {chosen.length
        ? <Chart option={voteSeatOption({ years, series: chosen.map(x => ({ label: x.p, color: x.color, seats: seatsOf(x.p), share: shareOf(x.p) })), seatMax, shareMax, glow })} style={{ height }} notMerge />
        : <div style={{ height }} className="grid place-items-center text-faint text-sm">No parties selected — pick one or more above.</div>}
    </div>
  )
}
