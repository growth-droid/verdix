// Winner matrix — every constituency in a state as a row, every election as a column, each cell
// filled with the WINNING PARTY'S COLOUR. Reads the whole electoral history of a state at a glance:
// stable colour bands = a fortress, alternating colours = a swing seat.
//
// Two views:
//  • AC (assembly constituencies) — Assembly results (direct) interleaved with Lok Sabha results
//    measured INSIDE each assembly segment (from segments.json), so split-ticket voting is visible
//    on one row.
//  • PC (parliamentary constituencies) — Lok Sabha results (direct), plus an Assembly ROLL-UP
//    column per AE year (the party that won the most assembly seats inside that PC).
import { useEffect, useMemo, useState } from 'react'
import { loadSeats, loadSegments, type Seat, type Segment } from '../lib/data'
import { colorFor, inkOn } from '../lib/colors'
import { comparableAE } from '../lib/joins'
import { useTheme } from '../store'
import { Info, Seg } from './ui'

const tc = (s: string | null) => (s ? s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()) : '–')
const norm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

type Cell = { p: string; a: string | null; v: number | null; m: number | null; seat?: Seat } | null
type Col = { key: string; year: number; arena: 'AE' | 'GE'; rollup?: boolean }
type Row = { no: number; name: string; cells: Cell[] }

/** Drop columns where no row has a result — a pre-delimitation election cannot join to today's
 *  seats, and an all-dash column is noise rather than information. */
function prune(cols: Col[], rows: Row[]) {
  const keep = cols.map((_, i) => rows.some(r => r.cells[i] != null))
  if (keep.every(Boolean)) return { cols, rows }
  return {
    cols: cols.filter((_, i) => keep[i]),
    rows: rows.map(r => ({ ...r, cells: r.cells.filter((_, i) => keep[i]) })),
  }
}

export default function WinnerMatrix({ state, onPick }: { state: string; onPick?: (seat: Seat, all: Seat[], arena: 'AE' | 'GE') => void }) {
  const mode = useTheme()
  const [ae, setAe] = useState<Seat[]>([])
  const [ge, setGe] = useState<Seat[]>([])
  const [seg, setSeg] = useState<Segment[]>([])
  const [view, setView] = useState<'AC' | 'PC'>('AC')
  const [q, setQ] = useState('')

  useEffect(() => { loadSeats('AE').then(setAe); loadSeats('GE').then(setGe); loadSegments().then(setSeg) }, [])

  const mine = useMemo(() => ({
    ae: ae.filter(r => r.s === state),
    ge: ge.filter(r => r.s === state),
    seg: seg.filter(r => r.s === state),
  }), [ae, ge, seg, state])

  // ── AC view: rows = the latest assembly's seats; columns = every AE + GE election, newest first ──
  const acData = useMemo(() => {
    const { ae: A, seg: S } = mine
    if (!A.length) return null
    const aeYears = [...new Set(A.map(r => r.y))].sort((a, b) => b - a)
    const segYears = [...new Set(S.map(r => r.y))].sort((a, b) => b - a)
    const cols: Col[] = [
      ...aeYears.map(y => ({ key: `AE${y}`, year: y, arena: 'AE' as const })),
      ...segYears.map(y => ({ key: `GE${y}`, year: y, arena: 'GE' as const })),
    ].sort((a, b) => b.year - a.year || (a.arena === 'GE' ? -1 : 1))

    // AE cells join on `j` (the continuity domain); segment cells join on the normalised AC name
    const byJ = new Map<number, Map<number, Seat>>()
    A.forEach(r => { const m = byJ.get(r.j) ?? new Map(); m.set(r.y, r); byJ.set(r.j, m) })
    const byName = new Map<string, Map<number, Segment>>()
    S.forEach(r => { const k = norm(r.c); const m = byName.get(k) ?? new Map(); m.set(r.y, r); byName.set(k, m) })

    const latest = aeYears[0]
    const rows: Row[] = A.filter(r => r.y === latest).sort((a, b) => a.n - b.n).map(r => ({
      no: r.n,
      name: tc(r.c),
      cells: cols.map(c => {
        if (c.arena === 'AE') {
          const s = byJ.get(r.j)?.get(c.year)
          return s ? { p: s.p, a: s.a, v: s.v, m: s.m, seat: s } : null
        }
        const g = byName.get(norm(r.c))?.get(c.year)
        // segment margin `mg` is in VOTES; convert to a share of the segment's votes for consistency
        return g ? { p: g.p, a: g.a, v: g.v, m: g.mg != null && g.sv ? +((g.mg / g.sv) * 100).toFixed(1) : null } : null
      }),
    }))
    return prune(cols, rows)
  }, [mine])

  // ── PC view: rows = the latest Lok Sabha's seats; AE columns are a roll-up of the ACs inside ──
  const pcData = useMemo(() => {
    const { ge: G, ae: A, seg: S } = mine
    if (!G.length) return null
    const geYears = [...new Set(G.map(r => r.y))].sort((a, b) => b - a)
    // The roll-up joins ACs to PCs BY NAME, which would silently cross a delimitation change —
    // so only keep AE years that sit on the same constituency map as the latest one.
    const allAeYears = [...new Set(A.map(r => r.y))].sort((a, b) => b - a)
    const aeYears = allAeYears.filter(y => comparableAE(state, y, allAeYears[0]))
    const cols: Col[] = [
      ...geYears.map(y => ({ key: `GE${y}`, year: y, arena: 'GE' as const })),
      ...aeYears.map(y => ({ key: `AErollup${y}`, year: y, arena: 'AE' as const, rollup: true })),
    ].sort((a, b) => b.year - a.year || (a.arena === 'GE' ? -1 : 1))

    const byJ = new Map<number, Map<number, Seat>>()
    G.forEach(r => { const m = byJ.get(r.j) ?? new Map(); m.set(r.y, r); byJ.set(r.j, m) })

    // AC → PC name, from the most recent segment year we have
    const segLatest = S.length ? Math.max(...S.map(r => r.y)) : null
    const pcOfAc = new Map<string, string>()
    if (segLatest != null) S.filter(r => r.y === segLatest).forEach(r => pcOfAc.set(norm(r.c), norm(r.pcn)))

    // per AE year, per PC: which party won the most assembly seats inside it
    const rollup = new Map<string, Map<number, { p: string; a: string | null; won: number; of: number }>>()
    A.forEach(r => {
      const pc = pcOfAc.get(norm(r.c)); if (!pc) return
      const perYear = rollup.get(pc) ?? new Map(); rollup.set(pc, perYear)
      const acc = (perYear.get(r.y) as unknown as { tally?: Map<string, number>; a?: Map<string, string | null> }) ?? {}
      const t = acc.tally ?? new Map<string, number>(); const al = acc.a ?? new Map<string, string | null>()
      t.set(r.p, (t.get(r.p) || 0) + 1); al.set(r.p, r.a)
      perYear.set(r.y, { tally: t, a: al } as never)
    })
    const leaderOf = (pc: string, y: number) => {
      const raw = rollup.get(pc)?.get(y) as unknown as { tally?: Map<string, number>; a?: Map<string, string | null> } | undefined
      if (!raw?.tally?.size) return null
      const [p, won] = [...raw.tally.entries()].sort((x, z) => z[1] - x[1])[0]
      const of = [...raw.tally.values()].reduce((s, v) => s + v, 0)
      return { p, a: raw.a?.get(p) ?? null, won, of }
    }

    const latest = geYears[0]
    const rows: Row[] = G.filter(r => r.y === latest).sort((a, b) => a.n - b.n).map(r => ({
      no: r.n,
      name: tc(r.c),
      cells: cols.map(c => {
        if (c.arena === 'GE') {
          const s = byJ.get(r.j)?.get(c.year)
          return s ? { p: s.p, a: s.a, v: s.v, m: s.m, seat: s } : null
        }
        const l = leaderOf(norm(r.c), c.year)
        return l ? { p: l.p, a: l.a, v: null, m: null, seat: undefined, ...{ won: l.won, of: l.of } } as Cell : null
      }),
    }))
    return prune(cols, rows)
  }, [mine, state])

  const data = view === 'AC' ? acData : pcData
  const shown = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    if (!s) return data.rows
    return data.rows.filter(r => r.name.toLowerCase().includes(s) || String(r.no) === s)
  }, [data, q])

  if (!data || !data.rows.length) {
    return <div className="h-[120px] grid place-items-center text-muted text-sm">No constituency history for {state} yet.</div>
  }

  const label = view === 'AC' ? 'assembly constituency' : 'parliamentary constituency'

  return (
    <div>
      {/* controls */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap mb-3">
        <Seg options={[{ v: 'AC', label: 'Assembly (AC)' }, { v: 'PC', label: 'Parliament (PC)' }]} value={view} onChange={v => { setView(v as 'AC' | 'PC'); setQ('') }} />
        <div className="relative flex-1 min-w-[150px] sm:flex-none sm:w-64">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${view === 'AC' ? 'constituency' : 'PC'}…`}
            className="w-full bg-slate-950/50 border border-white/[0.09] rounded-lg pl-8 pr-8 py-2 sm:py-1.5 min-h-[34px] text-[16px] sm:text-xs outline-none placeholder:text-muted focus:border-gold/50 transition-colors" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-sm leading-none">×</button>}
        </div>
        <span className="text-[11px] text-muted tabular-nums shrink-0">
          {shown.length}{shown.length !== data.rows.length ? ` of ${data.rows.length}` : ''} {view === 'AC' ? 'ACs' : 'PCs'} · {data.cols.length} elections
        </span>
      </div>

      {/* matrix — scrolls inside its own box, never the page */}
      <div className="overflow-auto rounded-xl border border-white/[0.07] max-h-[70vh]">
        <table className="border-separate text-xs" style={{ borderSpacing: 3 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 bg-slate-900 text-left px-2 sm:px-2.5 py-2 text-[10px] uppercase tracking-[0.07em] font-semibold text-muted rounded-md whitespace-nowrap w-[104px] sm:w-auto">
                {view === 'AC' ? 'Constituency' : 'Parliament seat'}
              </th>
              {data.cols.map(c => (
                <th key={c.key} className="bg-slate-900 px-2.5 py-1.5 rounded-md whitespace-nowrap min-w-[104px]">
                  <div className="text-[13px] font-bold tabular-nums text-ink leading-none">{c.year}</div>
                  <div className={`text-[9.5px] uppercase tracking-wider font-semibold mt-0.5 ${c.arena === 'GE' ? 'text-sky-400' : 'text-gold'}`}>
                    {c.arena === 'GE' ? (view === 'AC' ? 'LS · segment' : 'Lok Sabha') : (c.rollup ? 'AE · roll-up' : 'Assembly')}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.no} className="group">
                <th scope="row" className="sticky left-0 z-10 bg-slate-900 text-left px-2 sm:px-2.5 py-1.5 rounded-md font-medium w-[104px] sm:w-auto sm:max-w-[190px]">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-muted tabular-nums text-[10.5px] shrink-0">{r.no}</span>
                    <span className="text-ink truncate" title={r.name}>{r.name}</span>
                  </div>
                </th>
                {r.cells.map((cell, i) => {
                  if (!cell) return <td key={i} className="rounded-md text-center text-muted/60 bg-white/[0.03] min-w-[104px]">–</td>
                  const bg = colorFor(cell.p, cell.a)
                  const ink = inkOn(bg, 1, mode)
                  const clickable = !!(cell.seat && onPick)
                  const rollup = cell as unknown as { won?: number; of?: number }
                  return (
                    <td key={i}
                      onClick={clickable ? () => onPick!(cell.seat!, view === 'AC' ? mine.ae : mine.ge, view === 'AC' ? 'AE' : 'GE') : undefined}
                      title={`${r.name} · ${data.cols[i].year} ${data.cols[i].arena === 'GE' ? 'Lok Sabha' : 'Assembly'} — won by ${cell.p}${clickable ? ' (click for the full briefing)' : ''}`}
                      className={`rounded-md px-2 py-1.5 align-middle min-w-[104px] transition-shadow ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-white/70' : ''}`}
                      style={{ background: bg, color: ink }}>
                      <div className="font-bold text-[12px] leading-none truncate">{cell.p}</div>
                      <div className="text-[10px] leading-none mt-1 tabular-nums" style={{ opacity: 0.85 }}>
                        {rollup.won != null
                          ? `${rollup.won}/${rollup.of} seats`
                          : <>{cell.v != null ? `${cell.v.toFixed(1)}%` : '–'}{cell.m != null ? <> · <span title="winning margin">+{cell.m.toFixed(1)}</span></> : null}</>}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div className="py-10 text-center text-muted text-xs">No {label} matches “{q}”.</div>}
      </div>

      <p className="mt-2.5 text-[11px] text-muted leading-snug">
        Every cell is filled with the <b className="text-ink">winning party's colour</b> — read a row left-to-right to see a seat's whole history: an unbroken colour band is a fortress, alternating colours mark a swing seat.
        {view === 'AC'
          ? <> Assembly columns are that seat's own result; <b className="text-ink">LS · segment</b> columns are the Lok Sabha result measured <i>inside</i> the same area, so a row that changes colour between them is split-ticket voting. Click any Assembly cell for the full constituency briefing.</>
          : <> Lok Sabha columns are the seat's own result; <b className="text-ink">AE · roll-up</b> columns show which party won the most assembly seats inside that parliamentary seat. Click any Lok Sabha cell for the full briefing.</>}
        {' '}Second line = winner's vote share and margin. <Info>Margins and shares are percentages of votes polled. Segment figures come from assembly-segment results published with each Lok Sabha election (GE-2024 segment votes are EVM-only).</Info>
      </p>
    </div>
  )
}
