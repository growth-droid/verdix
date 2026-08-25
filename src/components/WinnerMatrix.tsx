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
import { loadCandidates, loadSeats, loadSegments, type CandFile, type Seat, type Segment } from '../lib/data'
import { colorFor, inkOn } from '../lib/colors'
import { comparableAE } from '../lib/joins'
import { useTheme } from '../store'
import { Info, Seg } from './ui'

const tc = (s: string | null) => (s ? s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()) : '–')
// Reservation suffixes vary between the seat tables and segments.json — "ARAKU (ST)" and "ARAKU"
// are one seat, and not stripping the suffix silently dropped their segment joins.
const norm = (s: string) =>
  (s || '').toUpperCase().replace(/\s*\((?:SC|ST|GEN)\)\s*$/, '').replace(/[^A-Z0-9]/g, '')

// `won`/`of` = seats (or segments) the party led inside this parliamentary seat, so a roll-up cell
// and a Lok Sabha cell both read party -> seats won -> vote share -> lead over the next party.
type Cell = {
  p: string; a: string | null; v: number | null; m: number | null; seat?: Seat
  won?: number; of?: number; unit?: 'seats' | 'segments'; vs?: string | null
} | null
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
  const [cand, setCand] = useState<CandFile | null>(null)
  const [view, setView] = useState<'AC' | 'PC'>('AC')
  const [q, setQ] = useState('')

  useEffect(() => { loadSeats('AE').then(setAe); loadSeats('GE').then(setGe); loadSegments().then(setSeg) }, [])
  // Candidate lists give a per-party vote share per assembly seat, which is what lets a roll-up cell
  // report the leader's vote share across the PC rather than only how many seats it won. Already
  // cached by the positions table on the same page, so this is usually free.
  useEffect(() => { setCand(null); loadCandidates(state).then(setCand) }, [state])

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

    // Which assembly seats sit inside each PC, PER YEAR. Keyed by year because AC NUMBERING is not
    // stable: undivided Andhra numbered its assembly seats 1-294 and the post-2014 state numbers its
    // own 1-175, so a list built from the latest year finds only 56 of 175 seats in 2009.
    // The AC -> PC link itself is by NAME, which survives renumbering.
    const acsOfPc = new Map<string, { no: number; name: string }[]>()
    A.forEach(r => {
      const pc = pcOfAc.get(norm(r.c)); if (!pc) return
      const k = `${pc}|${r.y}`
      const list = acsOfPc.get(k) ?? []; list.push({ no: r.n, name: r.c }); acsOfPc.set(k, list)
    })
    // Leader's MEAN vote share across the PC's assembly segments, and its lead over the next party.
    // Assembly seats inside a PC are drawn to be near-equal in population, so an unweighted mean is
    // a fair reading; per-seat electorate weights are not in the extracts.
    const shareOf = (pc: string, y: number, party: string) => {
      const acs = acsOfPc.get(`${pc}|${y}`)
      const bucket = cand?.AE?.[String(y)]
      if (!acs?.length || !bucket) return { v: null as number | null, m: null as number | null, vs: null as string | null }
      const sums = new Map<string, number>()
      let counted = 0
      for (const ac of acs) {
        const seat = bucket[String(ac.no)]
        if (!seat) continue
        counted++
        for (const c of seat.c) if (c[3] != null) sums.set(c[1], (sums.get(c[1]) ?? 0) + c[3])
      }
      if (!counted) return { v: null, m: null, vs: null }
      const mean = [...sums.entries()].map(([p2, t]) => [p2, t / counted] as const).sort((x, z) => z[1] - x[1])
      const own = mean.find(x => x[0] === party)
      if (!own) return { v: null, m: null, vs: null }
      const next = mean.find(x => x[0] !== party)
      // Can be NEGATIVE, and that is the interesting case: the party won the most SEATS here while
      // polling fewer votes than a rival — efficient conversion. Keep the sign, name the rival.
      return { v: own[1], m: next ? own[1] - next[1] : null, vs: next ? next[0] : null }
    }
    // How many of a PC's assembly segments a party led in a given Lok Sabha election.
    // Match on NAME first, then on PC NUMBER — neither key is reliable on its own: names drift
    // between years ("ARUKU" in 2009-19 vs "ARAKU" in 2024) and numbers shift when a state splits
    // (Andhra's 2009/2014 rows still carry undivided-AP numbering, overlapping today's by 56/175).
    // When BOTH fail we return null rather than guess, which is the correct answer for those
    // pre-split rows: they belong to a different map and must not join to today's seats.
    const segLed = (pcName: string, pcNo: number, y: number, party: string) => {
      let rows2 = S.filter(r => r.y === y && norm(r.pcn) === norm(pcName))
      if (!rows2.length) rows2 = S.filter(r => r.y === y && r.pc === pcNo)
      if (!rows2.length) return null
      return { won: rows2.filter(r => r.p === party).length, of: rows2.length }
    }

    const latest = geYears[0]
    const rows: Row[] = G.filter(r => r.y === latest).sort((a, b) => a.n - b.n).map(r => ({
      no: r.n,
      name: tc(r.c),
      cells: cols.map(c => {
        if (c.arena === 'GE') {
          const s = byJ.get(r.j)?.get(c.year)
          if (!s) return null
          const sl = segLed(r.c, r.n, c.year, s.p)
          return { p: s.p, a: s.a, v: s.v, m: s.m, seat: s, won: sl?.won, of: sl?.of, unit: 'segments' as const }
        }
        const l = leaderOf(norm(r.c), c.year)
        if (!l) return null
        const sh = shareOf(norm(r.c), c.year, l.p)
        return { p: l.p, a: l.a, v: sh.v, m: sh.m, vs: sh.vs, seat: undefined, won: l.won, of: l.of, unit: 'seats' as const }
      }),
    }))
    return prune(cols, rows)
  }, [mine, state, cand])

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
        {/* w-full only matters when the columns DON'T fill the card — full width now that this card
            is stacked rather than paired, a state with few elections left half the card empty. Once
            the columns need more than the container, their min-w-[104px] wins and it scrolls as before. */}
        <table className="w-full border-separate text-xs" style={{ borderSpacing: 3 }}>
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
                  const isRoll = cell.unit === 'seats'
                  // Both kinds of cell now read the same way: party -> how much of the seat it took
                  // -> vote share -> lead over the next party.
                  const tip = `${r.name} · ${data.cols[i].year} ${data.cols[i].arena === 'GE' ? 'Lok Sabha' : 'Assembly'} — ${cell.p}`
                    + (cell.won != null ? `, led ${cell.won} of ${cell.of} assembly ${cell.unit === 'segments' ? 'segments' : 'seats'} here` : '')
                    + (cell.v != null ? `, ${cell.v.toFixed(1)}% ${isRoll ? 'average vote share across those segments' : 'of the vote'}` : '')
                    + (cell.m != null
                        ? isRoll
                          ? (cell.m >= 0
                              ? `, ${cell.m.toFixed(1)} clear of ${cell.vs ?? 'the next party'}`
                              : `, ${Math.abs(cell.m).toFixed(1)} BEHIND ${cell.vs ?? 'the next party'} on votes — it won more seats on fewer votes`)
                          : `, +${cell.m.toFixed(1)} winning margin`
                        : '')
                    + (clickable ? ' (click for the full briefing)' : '')
                  return (
                    <td key={i}
                      onClick={clickable ? () => onPick!(cell.seat!, view === 'AC' ? mine.ae : mine.ge, view === 'AC' ? 'AE' : 'GE') : undefined}
                      title={tip}
                      className={`rounded-md px-2 py-1.5 align-middle min-w-[104px] transition-shadow ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-white/70' : ''}`}
                      style={{ background: bg, color: ink }}>
                      <div className="font-bold text-[12px] leading-none truncate">{cell.p}</div>
                      {cell.won != null && (
                        <div className="text-[10px] leading-none mt-1 tabular-nums font-semibold">
                          {cell.won}/{cell.of} {cell.unit === 'segments' ? 'seg' : 'seats'}
                        </div>
                      )}
                      <div className="text-[10px] leading-none mt-1 tabular-nums" style={{ opacity: 0.85 }}>
                        {cell.v != null ? `${cell.v.toFixed(1)}%` : '–'}
                        {cell.m != null ? <> · <span>{cell.m >= 0 ? '+' : ''}{cell.m.toFixed(1)}</span></> : null}
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
          : <> Lok Sabha columns are the seat's own result — the party, how many of the seat's <b className="text-ink">assembly segments</b> it led, its vote share and its winning margin. <b className="text-ink">AE · roll-up</b> columns read the same way for the assembly election: the party that won the most assembly seats inside that parliamentary seat, how many it won, its average vote share across those segments and how far clear of the next party that put it. Click any Lok Sabha cell for the full briefing.</>}
        {' '}Second line = winner's vote share and margin. <Info>Margins and shares are percentages of votes polled. Segment figures come from assembly-segment results published with each Lok Sabha election (GE-2024 segment votes are EVM-only).</Info>
      </p>
    </div>
  )
}
