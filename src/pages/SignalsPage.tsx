import { useEffect, useMemo, useState } from 'react'
import { loadSeats, loadPartyAE, loadPartyGEState, loadPartyGENat, type Seat, type PartyAgg } from '../lib/data'
import { colorFor } from '../lib/colors'
import { useFilters } from '../store'
import SeatDrawer from '../components/SeatDrawer'
import { Dot, Select, SortTable, StickyControls, type Col } from '../components/ui'
import { activeByState } from '../lib/analysis'
import { detectSignals, type Severity } from '../lib/signals'

const tc = (s: string) => (s || '').toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())

const SEV: Record<Severity, { label: string; badge: string; ring: string }> = {
  critical: { label: 'CRITICAL', badge: 'bg-red-500/15 text-red-300 border-red-400/30', ring: 'border-l-red-500/70' },
  watch: { label: 'WATCH', badge: 'bg-amber-500/15 text-amber-200 border-amber-400/30', ring: 'border-l-amber-500/70' },
  note: { label: 'NOTE', badge: 'bg-white/[0.06] text-slate-300 border-white/15', ring: 'border-l-slate-500/60' },
}

export default function SignalsPage() {
  const { arena, state, year, setYear } = useFilters()
  const st = state ?? 'All states'
  const isState = st !== 'All states'
  const [rows, setRows] = useState<Seat[]>([])
  const [partyAE, setPartyAE] = useState<PartyAgg[]>([])
  const [partyGE, setPartyGE] = useState<PartyAgg[]>([])
  const [natGE, setNatGE] = useState<PartyAgg[]>([])
  const [picked, setPicked] = useState<Seat | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { loadSeats(arena).then(setRows) }, [arena])
  useEffect(() => { loadPartyAE().then(setPartyAE); loadPartyGEState().then(setPartyGE); loadPartyGENat().then(setNatGE) }, [])

  const scopeRows = useMemo(() => (isState ? rows.filter(r => r.s === st) : rows), [rows, isState, st])
  const years = useMemo(() => [...new Set(scopeRows.map(r => r.y))].sort((a, b) => a - b), [scopeRows])
  const vy = years.includes(year) ? year : years[years.length - 1]
  const active = useMemo(() => (isState ? scopeRows.filter(r => r.y === vy) : [...activeByState(rows, arena, vy).values()].flat()), [scopeRows, rows, arena, isState, vy])
  const partyRows = useMemo(() => (isState ? (arena === 'AE' ? partyAE : partyGE).filter(r => r.s === st) : arena === 'GE' ? natGE : []), [isState, arena, partyAE, partyGE, natGE, st])

  const signals = useMemo(() => (active.length ? detectSignals({ seats: active, allRows: scopeRows, partyRows, vy, isState, arena }) : []), [active, scopeRows, partyRows, vy, isState, arena])
  const nCrit = signals.filter(s => s.severity === 'critical').length

  const cols: Col<Seat>[] = [
    { key: 'c', label: 'Constituency', get: r => r.c, render: r => tc(r.c) },
    ...(isState ? [] : [{ key: 's', label: 'State', get: (r: Seat) => r.s } as Col<Seat>]),
    { key: 'p', label: 'Winner', get: r => r.p, render: r => <span><Dot color={colorFor(r.p, r.a)} />{r.p}</span> },
    { key: 'q', label: 'Runner-up', get: r => r.q, render: r => r.q ? <span><Dot color={colorFor(r.q)} />{r.q}</span> : '–' },
    { key: 'm', label: 'Margin%', get: r => r.m, align: 'right', render: r => r.m?.toFixed(1) },
    { key: 'v', label: 'Win share%', get: r => r.v, align: 'right', render: r => r.v?.toFixed(1) ?? '–' },
  ]

  return (
    <div>
      <StickyControls>
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold leading-tight tracking-tight">Signals · {isState ? st : 'All India'}</h2>
            <div className="kicker">the patterns that change a decision — auto-flagged, with the numbers</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            Election
            <Select value={String(vy)} onChange={v => setYear(+v)} options={[...years].reverse().map(String)} width="w-24" />
          </div>
          <span className="text-sm text-slate-400 ml-auto">
            {signals.length} signal{signals.length !== 1 ? 's' : ''}{nCrit ? <span className="text-red-300"> · {nCrit} critical</span> : null}
          </span>
        </div>
      </StickyControls>

      <p className="text-[12.5px] text-muted mb-4 leading-relaxed max-w-3xl">
        Verdix scans this election for the handful of patterns a strategist would act on — vote that doesn't convert, thin-margin books, split-field wins, eroding strongholds, the seats that decide control, momentum. Each flag states its parameters and the decision it informs; open <b className="text-ink">show seats</b> to drill to the exact constituencies (and their full reports). Set the region/arena in the Focus bar above.
      </p>

      {signals.length ? (
        <div className="space-y-3">
          {signals.map(sig => {
            const sv = SEV[sig.severity]
            const isOpen = open === sig.id
            const col = sig.party ? colorFor(sig.party, sig.a) : undefined
            return (
              <div key={sig.id} className={`card p-0 overflow-hidden border-l-4 ${sv.ring}`}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 mt-0.5 text-[10px] font-bold tracking-wide px-2 py-1 rounded-md border ${sv.badge}`}>{sv.label}</span>
                    {sig.party && <Dot color={col!} />}
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-ink leading-snug">{sig.headline}</div>
                      <div className="text-[12.5px] text-muted mt-1.5 leading-relaxed">{sig.soWhat}</div>
                    </div>
                    <div className="text-right shrink-0 w-40">
                      <div className="text-[13.5px] font-bold tabular-nums leading-tight" style={col ? { color: col } : undefined}>{sig.metric}</div>
                      {sig.metricSub && <div className="text-[10px] text-faint mt-0.5">{sig.metricSub}</div>}
                    </div>
                  </div>
                  {sig.seats.length > 0 && (
                    <button onClick={() => setOpen(isOpen ? null : sig.id)}
                      className="mt-2.5 text-xs text-orange-400 hover:text-orange-300 underline decoration-dotted decoration-orange-400/40 underline-offset-2 transition-colors">
                      {isOpen ? 'Hide seats' : `Show the ${sig.seats.length} seats →`}
                    </button>
                  )}
                </div>
                {isOpen && sig.seats.length > 0 && (
                  <div className="border-t border-white/[0.06] px-4 py-3 bg-white/[0.015]">
                    <div className="text-[11px] text-faint mb-2">The last mile — click any seat for its full constituency report.</div>
                    <SortTable rows={sig.seats} cols={cols} defaultSort="m" initialDir="asc" maxH={320}
                      search searchIn={r => `${r.c} ${r.s} ${r.p} ${r.q ?? ''}`} onRowClick={s => setPicked(s)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="h-[200px] grid place-items-center text-faint text-sm text-center px-8">
          No strong signals for {isState ? st : 'All India'} ({arena === 'AE' ? 'assembly' : 'Lok Sabha'}) {vy}. Pick a region/arena with a real contest, or an election with vote-share data.
        </div>
      )}

      {picked && <SeatDrawer seat={picked} all={rows} arena={arena} onClose={() => setPicked(null)} />}
    </div>
  )
}
