// Candidate positions — for a state (optionally narrowed to ONE parliamentary seat), every
// constituency with its top-5 candidates: name, party, votes and vote share. Hovering any
// candidate explains what that number means (margin, deposit, share of the field).
//
// Data: public/data/cand/<state>.json (tools/build_candidates.py), lazy-loaded per state.
// The AC→PC mapping comes from segments.json, so "show me the assemblies inside Vijayawada" works.
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadCandidates, loadSegments, type CandFile, type CandSeat, type Segment } from '../lib/data'
import { colorFor, readable } from '../lib/colors'
import { useTheme } from '../store'
import { Info, Seg, Select } from './ui'

const tc = (s: string) => (s || '').toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
const norm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const nf = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString('en-IN'))
const ALL = 'All parliament seats'

type Hover = { x: number; y: number; lines: string[]; title: string; colour: string } | null

export default function PositionsTable({ state }: { state: string }) {
  const mode = useTheme()
  const [file, setFile] = useState<CandFile | null>(null)
  const [seg, setSeg] = useState<Segment[]>([])
  const [arena, setArena] = useState<'AE' | 'GE'>('AE')
  const [year, setYear] = useState<string>('')
  const [pc, setPc] = useState<string>(ALL)
  const [q, setQ] = useState('')
  const [hover, setHover] = useState<Hover>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setFile(null); loadCandidates(state).then(setFile) }, [state])
  useEffect(() => { loadSegments().then(setSeg) }, [])

  const years = useMemo(() => Object.keys(file?.[arena] ?? {}).sort((a, b) => +b - +a), [file, arena])
  useEffect(() => { if (years.length && !years.includes(year)) setYear(years[0]) }, [years, year])

  // AC → PC name, from the most recent segment year we hold for this state
  const pcOfAc = useMemo(() => {
    const mine = seg.filter(r => r.s === state)
    if (!mine.length) return new Map<string, string>()
    const latest = Math.max(...mine.map(r => r.y))
    return new Map(mine.filter(r => r.y === latest).map(r => [norm(r.c), tc(r.pcn)]))
  }, [seg, state])
  const pcList = useMemo(() => [ALL, ...[...new Set([...pcOfAc.values()])].sort()], [pcOfAc])
  useEffect(() => { setPc(ALL) }, [state, arena])

  const rows = useMemo(() => {
    const bucket = file?.[arena]?.[year]
    if (!bucket) return []
    let list = Object.entries(bucket).map(([no, s]) => ({ no: +no, ...s, pc: pcOfAc.get(norm(s.n)) ?? null }))
    if (arena === 'AE' && pc !== ALL) list = list.filter(r => r.pc === pc)
    const needle = q.trim().toLowerCase()
    if (needle) list = list.filter(r => tc(r.n).toLowerCase().includes(needle) || String(r.no) === needle)
    return list.sort((a, b) => a.no - b.no)
  }, [file, arena, year, pc, q, pcOfAc])

  // hover insight for one candidate within a seat
  const explain = (seat: CandSeat & { no: number }, i: number): string[] => {
    const c = seat.c[i], win = seat.c[0], next = seat.c[1]
    const lines: string[] = []
    if (i === 0 && next) {
      const gap = (c[2] ?? 0) - (next[2] ?? 0)
      const gapPct = seat.vv ? (gap / seat.vv) * 100 : null
      lines.push(`Won by ${nf(gap)} votes${gapPct != null ? ` (${gapPct.toFixed(1)}% of votes polled)` : ''} over ${next[1]}.`)
      if (gapPct != null && gapPct < 3) lines.push('A knife-edge result — inside the 3% band that decides governments.')
      else if (gapPct != null && gapPct >= 20) lines.push('A safe hold — a swing of this size is rare.')
    } else if (i > 0 && win) {
      const gap = (win[2] ?? 0) - (c[2] ?? 0)
      const gapPct = seat.vv ? (gap / seat.vv) * 100 : null
      lines.push(`Lost by ${nf(gap)} votes${gapPct != null ? ` (${gapPct.toFixed(1)}%)` : ''} to ${win[1]}.`)
      if (i === 1 && gapPct != null && gapPct < 5) lines.push('Close enough to be a genuine target next time.')
    }
    if (c[3] != null) {
      lines.push(`${c[3].toFixed(2)}% of the votes polled.`)
      // ECI rule: a candidate polling under 1/6 of valid votes forfeits their deposit
      if (c[3] < 100 / 6) lines.push(`Below one-sixth of the vote — deposit forfeited.`)
    }
    if (seat.t != null) lines.push(`Seat turnout ${seat.t.toFixed(1)}%${seat.vv ? ` · ${nf(seat.vv)} valid votes` : ''}.`)
    return lines
  }

  const onEnter = (e: React.MouseEvent, seat: CandSeat & { no: number }, i: number) => {
    const c = seat.c[i]
    const host = boxRef.current?.getBoundingClientRect()
    setHover({
      x: e.clientX - (host?.left ?? 0), y: e.clientY - (host?.top ?? 0),
      title: `${c[0]} · ${c[1]}`, colour: colorFor(c[1]),
      lines: explain(seat, i),
    })
  }

  if (!file) return <div className="h-[120px] grid place-items-center text-muted text-sm">Loading candidates for {state}…</div>
  if (!years.length) {
    return (
      <div className="py-8 text-center text-muted text-sm">
        Candidate-level results aren’t available for {state}{arena === 'AE' ? ' assembly' : ' Lok Sabha'} elections yet.
        <div className="mt-2"><Seg options={[{ v: 'AE', label: 'Assembly' }, { v: 'GE', label: 'Lok Sabha' }]} value={arena} onChange={v => setArena(v as 'AE' | 'GE')} /></div>
      </div>
    )
  }

  const totalInPc = arena === 'AE' && pc !== ALL ? rows.length : null

  return (
    <div ref={boxRef} className="relative">
      {/* controls */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap mb-3">
        <Seg options={[{ v: 'AE', label: 'Assembly' }, { v: 'GE', label: 'Lok Sabha' }]} value={arena} onChange={v => setArena(v as 'AE' | 'GE')} />
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="hidden sm:inline">Election</span>
          <Select value={year} onChange={setYear} options={years} width="w-24" />
        </div>
        {arena === 'AE' && pcList.length > 1 && (
          <div className="flex items-center gap-2 text-xs text-muted min-w-0">
            <span className="hidden sm:inline shrink-0">Parliament</span>
            <Select value={pc} onChange={setPc} options={pcList} width="w-[11rem] sm:w-56" />
          </div>
        )}
        <div className="relative flex-1 min-w-[150px] sm:flex-none sm:w-56">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search seat…"
            className="w-full bg-slate-950/50 border border-white/[0.09] rounded-lg pl-8 pr-8 py-2 sm:py-1.5 min-h-[34px] text-[16px] sm:text-xs outline-none placeholder:text-muted focus:border-gold/50 transition-colors" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-sm leading-none">×</button>}
        </div>
      </div>

      {totalInPc != null && (
        <div className="mb-2.5 text-[12.5px] text-muted">
          <b className="text-ink">{pc}</b> contains <b className="text-ink tabular-nums">{totalInPc}</b> assembly {totalInPc === 1 ? 'seat' : 'seats'} · {year}
        </div>
      )}

      <div className="overflow-auto rounded-xl border border-white/[0.07] max-h-[60vh] lg:max-h-[520px]">
        <table className="w-full text-xs border-separate" style={{ borderSpacing: 0 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 bg-slate-900 text-left px-2.5 py-2 text-[10px] uppercase tracking-[0.07em] font-semibold text-muted border-b border-white/[0.09] min-w-[132px]">
                {arena === 'AE' ? 'Assembly seat' : 'Parliament seat'}
              </th>
              {[1, 2, 3, 4, 5].map(i => (
                <th key={i} className="bg-slate-900 px-2.5 py-2 text-[10px] uppercase tracking-[0.07em] font-semibold text-muted border-b border-white/[0.09] text-left min-w-[150px]">
                  Position {i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.no} className="hover:bg-white/[0.03] transition-colors">
                <th scope="row" className="sticky left-0 z-10 bg-slate-900 text-left px-2.5 py-2 border-b border-white/[0.05] font-medium align-top">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-muted tabular-nums text-[10.5px]">{r.no}</span>
                    <span className="text-ink">{tc(r.n)}</span>
                  </div>
                  <div className="text-[10px] text-muted mt-0.5">
                    {r.r && r.r !== 'GEN' ? <span className="text-gold">{r.r} · </span> : null}
                    {r.t != null ? `${r.t.toFixed(1)}% turnout` : ''}
                    {arena === 'AE' && r.pc && pc === ALL ? <> · {r.pc}</> : null}
                  </div>
                </th>
                {[0, 1, 2, 3, 4].map(i => {
                  const c = r.c[i]
                  if (!c) return <td key={i} className="px-2.5 py-2 border-b border-white/[0.05] text-muted/60 align-top">–</td>
                  const col = colorFor(c[1])
                  return (
                    <td key={i}
                      onMouseEnter={e => onEnter(e, r, i)}
                      onMouseMove={e => onEnter(e, r, i)}
                      onMouseLeave={() => setHover(null)}
                      className="px-2.5 py-2 border-b border-white/[0.05] align-top cursor-help">
                      <div className="flex items-start gap-1.5">
                        <span className="mt-[5px] w-2 h-2 rounded-full shrink-0 ring-1 ring-black/30" style={{ background: col }} />
                        <div className="min-w-0">
                          <div className="text-ink leading-tight truncate" title={c[0]}>{tc(c[0])}</div>
                          <div className="text-[10.5px] leading-tight mt-0.5 tabular-nums">
                            <span className="font-semibold" style={{ color: readable(col, mode) }}>{c[1]}</span>
                            <span className="text-muted"> · {nf(c[2])}{c[3] != null ? ` · ${c[3].toFixed(2)}%` : ''}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="py-10 text-center text-muted text-xs">No seat matches “{q}”.</div>}
      </div>

      {/* hover insight */}
      {hover && (
        <div className="pointer-events-none absolute z-50 w-[248px] rounded-xl border border-white/10 bg-slate-900 shadow-pop p-2.5 animate-fadeUp"
          style={{ left: Math.max(4, Math.min(hover.x + 14, (boxRef.current?.clientWidth ?? 400) - 256)), top: hover.y + 16 }}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hover.colour }} />
            <span className="text-[12px] font-semibold text-ink truncate">{hover.title}</span>
          </div>
          {hover.lines.map((l, i) => <div key={i} className="text-[11px] text-muted leading-snug mt-0.5">{l}</div>)}
        </div>
      )}

      <p className="mt-2.5 text-[11px] text-muted leading-snug">
        The top five candidates in each seat, in order of votes polled — name, party, votes and vote share.
        {arena === 'AE' && pcList.length > 1 ? <> Pick a <b className="text-ink">parliament seat</b> to see only the assembly seats inside it.</> : null}
        {' '}<b className="text-ink">Hover any candidate</b> for what the number means — the margin they won or lost by, whether they saved their deposit, and the seat's turnout.
        <Info>Candidate-level results come from the ECI/TCPD candidate tables. By-elections are excluded — those live in the Bypolls module. A candidate polling under one-sixth of the votes forfeits their deposit.</Info>
      </p>
    </div>
  )
}
