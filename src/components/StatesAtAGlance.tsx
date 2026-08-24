// The macro picture: every state as a row, for the arena and year in view — who leads it, by how
// much, how the house splits, and where it is competitive. Hovering a state explains the numbers.
// This is the national counterpart to the per-state positions table.
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Seat } from '../lib/data'
import { colorFor, readable, inkOn } from '../lib/colors'
import { useFilters, useTheme } from '../store'
import { Info } from './ui'

const nf = (n: number) => n.toLocaleString('en-IN')
type SortKey = 'seats' | 'name' | 'margin' | 'close' | 'turnout'
type Hover = { x: number; y: number; title: string; colour: string; lines: string[] } | null

export default function StatesAtAGlance({ rows, arena, year }: { rows: Seat[]; arena: 'AE' | 'GE'; year: number }) {
  const mode = useTheme()
  const nav = useNavigate()
  const setState = useFilters(s => s.setState)
  const [sort, setSort] = useState<SortKey>('seats')
  const [q, setQ] = useState('')
  const [hover, setHover] = useState<Hover>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const states = useMemo(() => {
    const by = new Map<string, Seat[]>()
    rows.forEach(r => { const a = by.get(r.s) ?? []; a.push(r); by.set(r.s, a) })
    const out = [...by.entries()].map(([name, seats]) => {
      const tally = new Map<string, { n: number; a: string | null }>()
      seats.forEach(s => { const e = tally.get(s.p) ?? { n: 0, a: s.a }; e.n++; tally.set(s.p, e) })
      const ranked = [...tally.entries()].map(([p, e]) => ({ p, ...e })).sort((a, b) => b.n - a.n)
      const lead = ranked[0], second = ranked[1]
      const total = seats.length
      const withM = seats.filter(s => s.m != null)
      const close = withM.filter(s => (s.m as number) < 5).length
      const withT = seats.filter(s => s.t != null)
      const turnout = withT.length ? withT.reduce((a, s) => a + (s.t as number), 0) / withT.length : null
      const majority = Math.floor(total / 2) + 1
      return {
        name, total, lead, second, ranked, close, turnout, majority,
        share: total ? (lead.n / total) * 100 : 0,
        gap: lead.n - (second?.n ?? 0),
        parties: ranked.length,
        year: seats[0]?.y,
      }
    })
    const needle = q.trim().toLowerCase()
    const filtered = needle ? out.filter(s => s.name.toLowerCase().includes(needle)) : out
    const cmp: Record<SortKey, (a: typeof out[0], b: typeof out[0]) => number> = {
      seats: (a, b) => b.total - a.total,
      name: (a, b) => a.name.localeCompare(b.name),
      margin: (a, b) => b.share - a.share,
      close: (a, b) => b.close - a.close,
      turnout: (a, b) => (b.turnout ?? 0) - (a.turnout ?? 0),
    }
    return filtered.sort(cmp[sort])
  }, [rows, q, sort])

  const onEnter = (e: React.MouseEvent, s: typeof states[0]) => {
    const host = boxRef.current?.getBoundingClientRect()
    const lines: string[] = []
    const controls = s.lead.n >= s.majority
    lines.push(controls
      ? `${s.lead.p} holds ${s.lead.n} of ${s.total} seats — a majority (needs ${s.majority}).`
      : `${s.lead.p} leads with ${s.lead.n} of ${s.total}, short of the ${s.majority} needed for a majority.`)
    if (s.second) lines.push(`${s.gap} seat${s.gap === 1 ? '' : 's'} ahead of ${s.second.p} (${s.second.n}).`)
    lines.push(`${s.parties} part${s.parties === 1 ? 'y' : 'ies'} won at least one seat.`)
    if (s.close) lines.push(`${s.close} seat${s.close === 1 ? '' : 's'} decided by under 5% — where control could change.`)
    if (s.turnout != null) lines.push(`Average turnout ${s.turnout.toFixed(1)}%.`)
    lines.push('Click to open this state in depth.')
    setHover({ x: e.clientX - (host?.left ?? 0), y: e.clientY - (host?.top ?? 0), title: `${s.name} · ${s.year}`, colour: colorFor(s.lead.p, s.lead.a), lines })
  }

  const open = (name: string) => { setState(name); nav('/state') }
  const H = ({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) => (
    <th onClick={() => setSort(k)}
      className={`group py-2 px-2.5 cursor-pointer select-none whitespace-nowrap text-[10px] uppercase tracking-[0.07em] font-semibold border-b border-white/[0.09] bg-slate-900 transition-colors ${sort === k ? 'text-gold' : 'text-muted hover:text-ink'} ${className}`}>
      {label}<span className={`ml-1 inline-block ${sort === k ? 'opacity-90' : 'opacity-0 group-hover:opacity-40'}`}>{sort === k ? '↓' : '↕'}</span>
    </th>
  )

  if (!states.length) return <div className="h-[120px] grid place-items-center text-muted text-sm">No states in view.</div>

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[150px] sm:flex-none sm:w-56">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search state…"
            className="w-full bg-slate-950/50 border border-white/[0.09] rounded-lg pl-8 pr-8 py-2 sm:py-1.5 min-h-[34px] text-[16px] sm:text-xs outline-none placeholder:text-muted focus:border-gold/50 transition-colors" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-sm leading-none">×</button>}
        </div>
        <span className="text-[11px] text-muted tabular-nums">{states.length} states · {arena === 'AE' ? 'assembly' : 'Lok Sabha'} · latest ≤ {year}</span>
      </div>

      <div className="overflow-auto rounded-xl border border-white/[0.07] max-h-[62vh]">
        <table className="w-full text-xs border-separate" style={{ borderSpacing: 0 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <H k="name" label="State" className="sticky left-0 z-30 text-left" />
              <H k="seats" label="Seats" className="text-right" />
              <th className="py-2 px-2.5 text-[10px] uppercase tracking-[0.07em] font-semibold text-muted border-b border-white/[0.09] bg-slate-900 text-left min-w-[150px]">Who leads</th>
              <H k="margin" label="Share of house" className="text-right" />
              <H k="close" label="Under 5%" className="text-right" />
              <H k="turnout" label="Turnout" className="text-right" />
            </tr>
          </thead>
          <tbody>
            {states.map(s => {
              const col = colorFor(s.lead.p, s.lead.a)
              const controls = s.lead.n >= s.majority
              return (
                <tr key={s.name}
                  onClick={() => open(s.name)}
                  onMouseEnter={e => onEnter(e, s)} onMouseMove={e => onEnter(e, s)} onMouseLeave={() => setHover(null)}
                  className="cursor-pointer hover:bg-white/[0.04] transition-colors">
                  <th scope="row" className="sticky left-0 z-10 bg-slate-900 text-left px-2.5 py-2 border-b border-white/[0.05] font-medium text-ink whitespace-nowrap">{s.name}</th>
                  <td className="px-2.5 py-2 border-b border-white/[0.05] text-right tabular-nums text-muted">{s.total}</td>
                  <td className="px-2.5 py-2 border-b border-white/[0.05]">
                    {/* the bar IS the story: how much of the house one party holds */}
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ background: col, color: inkOn(col, 1, mode) }}>{s.lead.p}</span>
                      <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden min-w-[42px]">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(3, s.share)}%`, background: col }} />
                      </div>
                      <span className="shrink-0 tabular-nums text-[11px] text-muted">{s.lead.n}</span>
                    </div>
                  </td>
                  <td className="px-2.5 py-2 border-b border-white/[0.05] text-right tabular-nums font-semibold"
                    style={{ color: readable(controls ? '#16a34a' : '#64748b', mode) }}>
                    {s.share.toFixed(0)}%{controls ? ' ✓' : ''}
                  </td>
                  <td className="px-2.5 py-2 border-b border-white/[0.05] text-right tabular-nums" style={{ color: s.close ? readable('#dc2626', mode) : undefined }}>{s.close || '–'}</td>
                  <td className="px-2.5 py-2 border-b border-white/[0.05] text-right tabular-nums text-muted">{s.turnout != null ? s.turnout.toFixed(1) + '%' : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!states.length && <div className="py-10 text-center text-muted text-xs">No state matches “{q}”.</div>}
      </div>

      {hover && (
        <div className="pointer-events-none absolute z-50 w-[254px] rounded-xl border border-white/10 bg-slate-900 shadow-pop p-2.5 animate-fadeUp"
          style={{ left: Math.max(4, Math.min(hover.x + 14, (boxRef.current?.clientWidth ?? 400) - 262)), top: hover.y + 16 }}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hover.colour }} />
            <span className="text-[12px] font-semibold text-ink truncate">{hover.title}</span>
          </div>
          {hover.lines.map((l, i) => <div key={i} className="text-[11px] text-muted leading-snug mt-0.5">{l}</div>)}
        </div>
      )}

      <p className="mt-2.5 text-[11px] text-muted leading-snug">
        Every state at its most recent {arena === 'AE' ? 'assembly' : 'Lok Sabha'} election on or before {year}. The bar shows how much of each house the leading party holds — a <b className="text-ink">✓</b> marks an outright majority. <b className="text-ink">Hover a state</b> for the majority arithmetic and where it is competitive; <b className="text-ink">click</b> to open it in depth. Sort by any column.
        <Info>“Under 5%” counts seats won by less than five percentage points — the seats most likely to change hands, and therefore where control of the house is decided.</Info>
      </p>
    </div>
  )
}
