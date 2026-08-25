import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import ReactECharts from 'echarts-for-react'
import { useTheme } from '../store'
import { echartsTheme, voteSeatOption } from '../lib/theme'
import { GLOSSARY } from '../lib/glossary'
import { readable } from '../lib/colors'

/** Hoverable ⓘ that shows a plain-language explanation.
 *  The bubble is PORTALLED to <body> and fixed-positioned, then clamped to the viewport. It used to be
 *  an in-flow `absolute` span centred on the glyph, which pushed the document 148px wide at 390px
 *  whenever a ⓘ sat near the right edge — an absolutely-positioned child still counts toward the
 *  page's scroll area. Rendering nothing while closed means it can never affect layout again. */
export function Info({ children, w = 'w-60' }: { children: ReactNode; w?: string }) {
  const [box, setBox] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  const place = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const W = 240, GAP = 8, PAD = 12                     // W must match the w-60 default
    const left = Math.min(Math.max(PAD, r.left + r.width / 2 - W / 2), innerWidth - W - PAD)
    const below = r.top < 140                            // not enough room above → flip under the glyph
    setBox({ left, top: below ? r.bottom + GAP : r.top - GAP, below })
  }

  // any scroll or resize invalidates a fixed-position bubble, so just close it
  useEffect(() => {
    if (!box) return
    const close = () => setBox(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('scroll', close, true); addEventListener('resize', close); addEventListener('keydown', key)
    return () => { removeEventListener('scroll', close, true); removeEventListener('resize', close); removeEventListener('keydown', key) }
  }, [box])

  return (
    /* tabIndex makes the ⓘ focusable so a TAP opens the tooltip on phones (hover never fires on touch) */
    <span ref={ref} tabIndex={0} onMouseEnter={place} onFocus={place} onMouseLeave={() => setBox(null)} onBlur={() => setBox(null)}
      className="relative inline-flex align-middle">
      {/* ::before adds an invisible ~32px hit area around the 14px glyph without changing its visual size */}
      <span className="relative ml-1 w-3.5 h-3.5 grid place-items-center rounded-full border border-slate-400 text-[10px] leading-none text-muted cursor-help select-none font-sans font-semibold before:absolute before:-inset-[9px] before:content-['']">i</span>
      {box && createPortal(
        <span style={{ left: box.left, top: box.top, transform: box.below ? undefined : 'translateY(-100%)' }}
          className={`pointer-events-none fixed ${w} glass p-2.5 text-[11px] leading-relaxed text-ink z-[100] normal-case tracking-normal font-normal animate-fadeUp`}>
          {children}
        </span>, document.body)}
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
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink text-xl leading-none">×</button>
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
    <div className={`card p-3.5 flex flex-col ${className}`}>
      <h3 className="text-[12.5px] font-semibold mb-2 text-slate-200 tracking-tight shrink-0">{title}</h3>
      {children}
      {note && <p className="mt-2 text-[11px] text-slate-400 leading-snug border-t border-white/[0.05] pt-2">{note}</p>}
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
  if (!d) return <span className="text-slate-400 text-[11px]">–</span>
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
        <div className="relative mb-2.5 w-64 max-w-full">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          {/* text-[16px] on phones stops iOS Safari auto-zooming the viewport on focus; sm: restores the compact desktop field */}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
            className="w-full bg-slate-950/50 border border-white/[0.09] rounded-lg pl-8 pr-3 py-2 sm:py-1.5 min-h-[34px] sm:min-h-0 text-[16px] sm:text-xs outline-none placeholder:text-muted focus:border-gold/50 focus:bg-slate-950/70 transition-colors" />
        </div>
      )}
      <div className="overflow-auto rounded-xl border border-white/[0.07]" style={{ maxHeight: maxH }}>
        <table className="w-full text-xs border-separate" style={{ borderSpacing: 0 }}>
          <thead className="sticky top-0 z-10">
            <tr>
              {cols.map(c => {
                const active = sort === c.key
                return (
                  <th key={c.key} style={c.width ? { width: c.width } : undefined}
                    onClick={() => { if (active) setDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSort(c.key); setDir('desc') } }}
                    className={`group py-2 px-2.5 cursor-pointer select-none whitespace-nowrap text-[10px] uppercase tracking-[0.07em] font-semibold border-b border-white/[0.09] bg-slate-900/85 backdrop-blur-md transition-colors ${active ? 'text-gold' : 'text-muted hover:text-ink'} ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                    {c.label}<span className={`ml-1 inline-block ${active ? 'opacity-90' : 'opacity-0 group-hover:opacity-40'}`}>{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => (
              <tr key={idx} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`transition-colors hover:bg-white/[0.035] ${onRowClick ? 'cursor-pointer' : ''}`}>
                {cols.map(c => (
                  <td key={c.key} className={`py-[7px] px-2.5 whitespace-nowrap border-b border-white/[0.04] ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {c.render ? c.render(r) : c.get(r) ?? '–'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="py-10 text-center text-muted text-xs">{q ? 'No matching rows' : 'No rows'}</div>
        )}
      </div>
    </div>
  )
}

export function Seg({ options, value, onChange }: { options: readonly { v: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    /* Stays on ONE line (no wrap) and never shrinks — callers put it in a horizontally
       scrollable strip on phones, which is far more compact than letting pills wrap. */
    <div className="inline-flex shrink-0 rounded-full p-[3px] bg-slate-950/60 border border-white/[0.08] shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]">
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`whitespace-nowrap px-2.5 sm:px-3.5 py-1.5 sm:py-1 min-h-[32px] sm:min-h-0 text-[12.5px] rounded-full transition-all duration-200 ${
            value === o.v
              ? 'bg-gradient-to-b from-[#e8c766] to-[#b0812a] text-black font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.35)]'
              : 'text-muted hover:text-ink'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Options are plain strings, or `{v, label}` when the VALUE and what the user reads differ —
 *  e.g. a year that exists but has no candidate list behind it, labelled so the absence is visible
 *  in the picker rather than the year silently going missing from it. */
export type Option = string | { v: string; label: string }
export function Select({ value, onChange, options, width = 'w-48' }:
  { value: string; onChange: (v: string) => void; options: Option[]; width?: string }) {
  return (
    <div className={`relative inline-block align-middle ${width}`}>
      {/* text-[16px] on phones keeps iOS Safari from zooming the viewport when the native picker opens */}
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full appearance-none bg-slate-950/60 border border-white/[0.09] rounded-lg pl-3 pr-8 py-2 sm:py-1.5 min-h-[34px] sm:min-h-0 text-[16px] sm:text-[13px] hover:border-white/20 focus:border-gold/50 outline-none transition-colors cursor-pointer">
        {options.map(o => typeof o === 'string'
          ? <option key={o} value={o} className="bg-slate-900 text-ink">{o}</option>
          : <option key={o.v} value={o.v} className="bg-slate-900 text-ink">{o.label}</option>)}
      </select>
      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
    </div>
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
    /* the negative bleed MUST match the page padding (px-3 mobile / sm:px-5) or it overflows the viewport */
    <div className={`sticky z-20 -mx-3 px-3 sm:-mx-5 sm:px-5 max-w-[100vw] py-2 sm:py-2.5 mb-3 sm:mb-4 bg-slate-950/80 backdrop-blur-xl border-b border-white/[0.07] ${className}`}
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
  // cap the chart at 48vh so a phone never hands a single chart 320–460px of a ~700px viewport
  const boxH = `min(${height}px, 48vh)`
  if (!list.length) return <div style={{ height: boxH }} className="grid place-items-center text-muted text-sm">No data for this view.</div>
  const chosen = list.filter(x => has(x.p))
  return (
    <div>
      {/* on phones the chip row is capped + scrolls internally so 12 parties can't push the chart below the fold */}
      <div className="flex items-center gap-2 sm:gap-1.5 mb-2.5 flex-wrap max-h-[5.5rem] overflow-y-auto sm:max-h-none sm:overflow-visible">
        {extra}
        <button onClick={() => setSel(keys)} className="inline-flex items-center px-2.5 sm:px-2 py-1.5 sm:py-1 min-h-[32px] sm:min-h-0 rounded-full text-[11px] border border-white/10 text-muted hover:text-ink transition-colors">All</button>
        <button onClick={() => setSel([])} className="inline-flex items-center px-2.5 sm:px-2 py-1.5 sm:py-1 min-h-[32px] sm:min-h-0 rounded-full text-[11px] border border-white/10 text-muted hover:text-ink transition-colors">None</button>
        {list.map(x => {
          const on = has(x.p)
          return (
            <button key={x.p} onClick={() => toggle(x.p)} title={on ? 'Click to hide' : 'Click to show'}
              className={`inline-flex items-center px-2.5 py-1.5 sm:py-1 min-h-[32px] sm:min-h-0 rounded-full text-[11.5px] border transition-all ${on ? 'text-ink font-semibold' : 'text-muted hover:text-ink'}`}
              style={{ background: on ? x.color + '22' : 'transparent', borderColor: on ? x.color + '88' : 'rgba(148,163,184,0.16)' }}>
              <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: x.color, opacity: on ? 1 : 0.5 }} />{x.p}
            </button>
          )
        })}
      </div>
      {chosen.length
        ? <Chart option={voteSeatOption({ years, series: chosen.map(x => ({ label: x.p, color: x.color, seats: seatsOf(x.p), share: shareOf(x.p) })), seatMax, shareMax, glow })} style={{ height: boxH }} notMerge />
        : <div style={{ height: boxH }} className="grid place-items-center text-muted text-sm">No parties selected — pick one or more above.</div>}
    </div>
  )
}
