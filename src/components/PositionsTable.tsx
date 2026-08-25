// Candidate positions — for a state (optionally narrowed to ONE parliamentary seat), every
// constituency with its top-5 candidates: name, party, votes and vote share. Hovering any
// candidate explains what that number means (margin, deposit, share of the field).
//
// Data: public/data/cand/<state>.json (tools/build_candidates.py), lazy-loaded per state.
// The AC→PC mapping comes from segments.json, so "show me the assemblies inside Vijayawada" works.
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadCandidates, loadSegments, type CandFile, type CandSeat, type Segment } from '../lib/data'
import { colorFor, inkOn, readable } from '../lib/colors'
import { useTheme, type Theme } from '../store'
import { Info, Seg, Select } from './ui'

const tc = (s: string) => (s || '').toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
const norm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const nf = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString('en-IN'))
const ALL = 'All parliament seats'

// ── Ordinal party-colour ramp ────────────────────────────────────────────────────────────────
// Position 1 is painted the way WinnerMatrix paints a win: the party's colour, FULL saturation,
// whole cell, ink from inkOn(). Later positions get the SAME hue at a lower alpha, a narrowing
// party rail and a fainter share rule — so a row reads as the shape of a contest (one solid slab
// = a walkover, two heavy blocks = a real race) before it reads as five names.
// Every number here is measured across all 49 palette hexes x both themes — see CONVENTIONS.md.
type Tier = { fill: number; rail: number; bar: number; dim: number }
const TIERS: Tier[] = [
  { fill: 1,    rail: 0, bar: 0.95, dim: 1    }, // 1 · winner — the WinnerMatrix contract
  { fill: 0.34, rail: 4, bar: 0.80, dim: 0.76 }, // 2 · the challenger who could flip it
  { fill: 0.24, rail: 3, bar: 0.80, dim: 0.76 }, // 3
  { fill: 0.17, rail: 2, bar: 0.80, dim: 0.76 }, // 4
  { fill: 0.11, rail: 2, bar: 0.80, dim: 0.76 }, // 5 · usually a lost deposit
]
// 0.34 is the CEILING for a tint, and the rail sets it, not the text: text has 7.9-14.8:1 of
// headroom at every tinted tier, but the rail must clear 3:1 against the wash it actually abuts.
// At readable(col, mode, 6.0): 0.34 -> 3.53:1 floor, 0 failures; 0.38 -> 2.86:1, 6 failures.
const RAIL_MIN = 6.0     // readable() target for the rail + dot ring
const DEPOSIT = 100 / 6  // ECI: under one-sixth of votes polled = deposit forfeited

const at = (hex: string, a: number) =>
  hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')

// onMouseMove re-renders the whole table on every pixel of pointer travel (~875 cells x 2 colour
// computations), and inkOn/readable are pure — so memoise per (colour, alpha, theme).
const _cc = new Map<string, string>()
const memo = (k: string, f: () => string) => { let v = _cc.get(k); if (v === undefined) { v = f(); _cc.set(k, v) } return v }
const inkFor = (hex: string, a: number, m: Theme) => memo(`i|${hex}|${a}|${m}`, () => inkOn(hex, a, m))
const edgeFor = (hex: string, m: Theme) => memo(`e|${hex}|${m}`, () => readable(hex, m, RAIL_MIN))

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

  // Legend key: the party winning most seats in the CURRENT view, so the ramp is demonstrated in a
  // colour the reader is already looking at. Declared HERE, above the `!file` / `!years.length`
  // early returns below — a useMemo under those returns is a hooks-order crash on every state load.
  const keyParty = useMemo(() => {
    const t = new Map<string, number>()
    rows.forEach(r => { const p = r.c[0]?.[1]; if (p) t.set(p, (t.get(p) ?? 0) + 1) })
    return [...t.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'IND'
  }, [rows])

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
        <div className="relative flex-1 min-w-[168px] sm:flex-none sm:w-56">
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

      {/* Reads the ramp back in a colour already on screen: "this is what TDP looks like at each position". */}
      <div className="mb-2 flex items-center gap-1.5 flex-wrap text-[10px] text-muted">
        <span className="uppercase tracking-[0.07em] font-semibold text-ink shrink-0">Fill = party</span>
        {[0, 1, 2, 3, 4].map(i => {
          const col = colorFor(keyParty), t = TIERS[i]
          return (
            <span key={i} className="inline-flex items-center rounded-[3px] pl-2 pr-1.5 py-[3px] font-semibold tabular-nums"
              style={{
                backgroundColor: at(col, t.fill),
                color: inkFor(col, t.fill, mode),
                boxShadow: t.rail ? `inset ${t.rail}px 0 0 0 ${edgeFor(col, mode)}` : undefined,
              }}>
              {i + 1}{i === 0 ? ` ${keyParty} won` : ''}
            </span>
          )
        })}
        <span className="min-w-0">— depth of colour = where they finished; the rule near a cell's bottom is that candidate's vote share.</span>
      </div>

      <div className="overflow-auto rounded-xl border border-white/[0.07] max-h-[60vh] lg:max-h-[560px]">
        <table className="w-full text-xs border-separate" style={{ borderSpacing: 0 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 bg-slate-900 text-left px-2.5 py-2 text-[10px] uppercase tracking-[0.07em] font-semibold text-muted border-b border-white/[0.09] min-w-[132px]">
                {arena === 'AE' ? 'Assembly seat' : 'Parliament seat'}
              </th>
              {[1, 2, 3, 4, 5].map(i => (
                <th key={i} className="bg-slate-900 px-2.5 py-2 text-[10px] uppercase tracking-[0.07em] font-semibold text-muted border-b border-white/[0.09] text-left min-w-[168px]">
                  Position {i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.no} className="pos-row">
                <th scope="row" className="sticky left-0 z-10 bg-slate-900 [.pos-row:hover_&]:bg-slate-800 text-left px-2.5 py-2 border-b border-white/[0.05] font-medium align-top transition-colors">
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
                  const share = c[3]                                 // % of votes polled, or null
                  // Ordinal tier, with ONE data override: below the deposit line you are not a
                  // contender, so you drop to the faintest step whatever column you sit in. Guarded
                  // by i > 0 — the WINNER is never clamped, so the cell the WinnerMatrix rule
                  // governs is always the full, unblended party colour even in a divided field.
                  const t = TIERS[i > 0 && share != null && share < DEPOSIT ? 4 : i]
                  const ink = inkFor(col, t.fill, mode)              // black/white off the BLENDED fill
                  const edge = edgeFor(col, mode)                    // party hue, nudged until visible
                  // Share rule on an absolute 0–100% scale (NOT normalised to the row), so bar
                  // lengths compare down all 175 rows. Drawn only where it can be read — a 1.2%
                  // also-ran would render a 2px stub and read as a broken underline. No bar =
                  // deposit forfeited.
                  const showBar = share != null && (i === 0 || share >= DEPOSIT)
                  return (
                    <td key={i}
                      onMouseEnter={e => onEnter(e, r, i)}
                      onMouseMove={e => onEnter(e, r, i)}
                      onMouseLeave={() => setHover(null)}
                      className="pos-cell px-2.5 py-2 border-b border-white/[0.05] align-top cursor-help"
                      style={{
                        // backgroundColor LONGHAND, never the `background` shorthand — the shorthand
                        // resets backgroundImage/Position/Size and silently drops the share rule.
                        backgroundColor: at(col, t.fill),
                        backgroundImage: showBar
                          ? `linear-gradient(90deg, ${at(ink, t.bar)} ${share}%, transparent ${share}%)`
                          : undefined,
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '100% 3px',
                        // inset 4px off the bottom edge so it can't be mistaken for border-b; sits
                        // inside the existing py-2 padding, so zero reflow.
                        backgroundPosition: 'left calc(100% - 4px)',
                        // Party rail, tapering 4→2px down the field. An inset shadow paints above
                        // the background and costs zero layout width.
                        boxShadow: t.rail ? `inset ${t.rail}px 0 0 0 ${edge}` : undefined,
                      }}>
                      <div className="flex items-start gap-1.5">
                        {/* The dot keeps the LITERAL colorFor() hex on positions 2–5, ringed so it
                            clears 3:1 on its own tint. On the winner the whole cell already IS that
                            hex, so a hex dot would be invisible by construction — it becomes ink. */}
                        <span className="mt-[5px] w-2 h-2 rounded-full shrink-0"
                          style={i === 0 ? { background: ink } : { background: col, boxShadow: `0 0 0 1.5px ${edge}` }} />
                        <div className="min-w-0">
                          <div className="leading-tight truncate" style={{ color: ink }} title={c[0]}>{tc(c[0])}</div>
                          <div className="text-[10.5px] leading-tight mt-0.5 tabular-nums">
                            <span className="font-semibold" style={{ color: ink }}>{c[1]}</span>
                            <span style={{ color: at(ink, t.dim) }}> · {nf(c[2])}{share != null ? ` · ${share.toFixed(2)}%` : ''}</span>
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
        {' '}<b className="text-ink">Every cell is filled with that candidate's party colour</b> — solid for the winner, exactly as in the
        winner matrix beside it, then the same colour fading through the field to fifth. A row with one solid block is a walkover; a row with
        two heavy blocks is a real contest. The rule near the bottom of a cell is that candidate's <b className="text-ink">share of the votes
        polled</b>, on the same 0–100% scale everywhere, so bar lengths compare across seats and down the whole table. <b className="text-ink">A
        cell with no bar, at the faintest step, polled under one-sixth and forfeited its deposit</b> — so a Position-4 or -5 cell that still
        holds colour is a third force worth looking at.
        {arena === 'AE' && pcList.length > 1 ? <> Pick a <b className="text-ink">parliament seat</b> to see only the assembly seats inside it.</> : null}
        {' '}<b className="text-ink">Hover any candidate</b> for what the number means — the margin they won or lost by, whether they saved their deposit, and the seat's turnout.
        <Info>Candidate-level results come from the ECI/TCPD candidate tables. By-elections are excluded — those live in the Bypolls module. A candidate polling under one-sixth of the votes forfeits their deposit. Colour never carries information on its own: the column header gives the finishing position and the party code is printed in every cell. Party colours are the shared palette used on the winner matrix and the seat map — they are data, never re-mapped; only the thin rail down a cell's left edge is nudged (hue preserved) so it stays visible on a faint wash.</Info>
      </p>
    </div>
  )
}
