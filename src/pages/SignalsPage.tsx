import { useEffect, useMemo, useState } from 'react'
import { loadSeats, loadPartyAE, loadPartyGEState, loadPartyGENat, type Seat, type PartyAgg } from '../lib/data'
import { colorFor } from '../lib/colors'
import { useFilters } from '../store'
import SeatDrawer from '../components/SeatDrawer'
import { Dot, Seg, SortTable, StickyControls, type Col } from '../components/ui'
import { activeByState } from '../lib/analysis'
import { detectSignals, type Severity, type Signal } from '../lib/signals'

const tc = (s: string) => (s || '').toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())

const SEV: Record<Severity, { label: string; badge: string; ring: string }> = {
  critical: { label: 'CRITICAL', badge: 'bg-red-500/15 text-red-300 border-red-400/30', ring: 'border-l-red-500/70' },
  watch: { label: 'WATCH', badge: 'bg-amber-500/15 text-amber-200 border-amber-400/30', ring: 'border-l-amber-500/70' },
  note: { label: 'NOTE', badge: 'bg-white/[0.06] text-slate-300 border-white/15', ring: 'border-l-slate-500/60' },
}

type ScopeArena = 'AE' | 'GE' | 'BOTH'
type Election = { key: string; arena: 'AE' | 'GE'; year: number }
const elFull = (e: Election) => `${e.arena === 'AE' ? 'Assembly' : 'Lok Sabha'} ${e.year}`
type Tagged = Signal & { election: Election; rows: Seat[] }

export default function SignalsPage() {
  const { arena, state } = useFilters()
  const st = state ?? 'All states'
  const isState = st !== 'All states'
  const [ae, setAe] = useState<Seat[]>([])
  const [ge, setGe] = useState<Seat[]>([])
  const [partyAE, setPartyAE] = useState<PartyAgg[]>([])
  const [partyGE, setPartyGE] = useState<PartyAgg[]>([])
  const [natGE, setNatGE] = useState<PartyAgg[]>([])
  const [picked, setPicked] = useState<{ seat: Seat; rows: Seat[]; arena: 'AE' | 'GE' } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [scope, setScope] = useState<ScopeArena>(arena)
  const [sel, setSel] = useState<string[]>([])
  useEffect(() => { loadSeats('AE').then(setAe); loadSeats('GE').then(setGe) }, [])
  useEffect(() => { loadPartyAE().then(setPartyAE); loadPartyGEState().then(setPartyGE); loadPartyGENat().then(setNatGE) }, [])

  // Elections available in the current region scope, restricted by the Assemblies/Parliaments/Both toggle.
  const aeYears = useMemo(() => [...new Set((isState ? ae.filter(r => r.s === st) : ae).map(r => r.y))].sort((a, b) => b - a), [ae, isState, st])
  const geYears = useMemo(() => [...new Set((isState ? ge.filter(r => r.s === st) : ge).map(r => r.y))].sort((a, b) => b - a), [ge, isState, st])
  const elections = useMemo<Election[]>(() => {
    const list: Election[] = []
    if (scope !== 'GE') aeYears.forEach(y => list.push({ key: `AE|${y}`, arena: 'AE', year: y }))
    if (scope !== 'AE') geYears.forEach(y => list.push({ key: `GE|${y}`, arena: 'GE', year: y }))
    return list
  }, [scope, aeYears, geYears])
  const optSig = elections.map(e => e.key).join(',')

  // Whenever the option set changes (region / scope / data load), reset to the single most recent
  // election — so the page opens "one election" by default, and the user adds more from there.
  useEffect(() => {
    if (!elections.length) { setSel([]); return }
    const latest = [...elections].sort((a, b) => b.year - a.year || (a.arena === arena ? -1 : 1))[0]
    setSel([latest.key]); setOpen(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optSig])

  const toggle = (key: string) => setSel(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  const toggleAll = (ar: 'AE' | 'GE', years: number[]) => setSel(prev => {
    const keys = years.map(y => `${ar}|${y}`)
    return keys.every(k => prev.includes(k)) ? prev.filter(k => !keys.includes(k)) : [...new Set([...prev, ...keys])]
  })

  const selectedEls = useMemo(() => elections.filter(e => sel.includes(e.key)), [elections, sel])
  const signals = useMemo<Tagged[]>(() => {
    const out: Tagged[] = []
    for (const el of selectedEls) {
      const rows = el.arena === 'AE' ? ae : ge
      const scopeRows = isState ? rows.filter(r => r.s === st) : rows
      const active = isState ? scopeRows.filter(r => r.y === el.year) : [...activeByState(rows, el.arena, el.year).values()].flat()
      if (!active.length) continue
      const partyRows = isState ? (el.arena === 'AE' ? partyAE : partyGE).filter(r => r.s === st) : el.arena === 'GE' ? natGE : []
      detectSignals({ seats: active, allRows: scopeRows, partyRows, vy: el.year, isState, arena: el.arena })
        .forEach(s => out.push({ ...s, id: `${el.key}:${s.id}`, election: el, rows }))
    }
    return out.sort((a, b) => b.score - a.score)
  }, [selectedEls, ae, ge, partyAE, partyGE, natGE, isState, st])
  const nCrit = signals.filter(s => s.severity === 'critical').length
  const multi = selectedEls.length > 1

  const cols: Col<Seat>[] = [
    { key: 'c', label: 'Constituency', get: r => r.c, render: r => tc(r.c) },
    ...(isState ? [] : [{ key: 's', label: 'State', get: (r: Seat) => r.s } as Col<Seat>]),
    { key: 'p', label: 'Winner', get: r => r.p, render: r => <span><Dot color={colorFor(r.p, r.a)} />{r.p}</span> },
    { key: 'q', label: 'Runner-up', get: r => r.q, render: r => r.q ? <span><Dot color={colorFor(r.q)} />{r.q}</span> : '–' },
    { key: 'm', label: 'Margin%', get: r => r.m, align: 'right', render: r => r.m?.toFixed(1) },
    { key: 'v', label: 'Win share%', get: r => r.v, align: 'right', render: r => r.v?.toFixed(1) ?? '–' },
  ]

  const Group = ({ label, ar, years }: { label: string; ar: 'AE' | 'GE'; years: number[] }) => (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-faint uppercase tracking-wide">{label}</span>
      {years.map(y => {
        const key = `${ar}|${y}`, on = sel.includes(key)
        return (
          <button key={key} onClick={() => toggle(key)}
            className={`px-2.5 py-1 rounded-full text-[11px] tabular-nums transition-colors border ${on ? 'bg-orange-500 text-black border-orange-400 font-semibold' : 'text-muted border-white/10 hover:text-ink hover:border-white/25 bg-white/[0.03]'}`}>{y}</button>
        )
      })}
      {years.length > 1 && <button onClick={() => toggleAll(ar, years)} className="text-[10px] text-faint hover:text-ink ml-0.5 underline decoration-dotted">all</button>}
    </div>
  )

  return (
    <div>
      <StickyControls>
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold leading-tight tracking-tight">Signals · {isState ? st : 'All India'}</h2>
            <div className="kicker">auto-flagged patterns — one election or many; assembly · parliament · both</div>
          </div>
          <Seg options={[{ v: 'AE', label: 'Assemblies' }, { v: 'GE', label: 'Parliaments' }, { v: 'BOTH', label: 'Both' }]} value={scope} onChange={v => setScope(v as ScopeArena)} />
          <span className="text-sm text-slate-400 ml-auto">
            {signals.length} signal{signals.length !== 1 ? 's' : ''}{nCrit ? <span className="text-red-300"> · {nCrit} critical</span> : null}
            {multi ? <span className="text-faint"> · {selectedEls.length} elections</span> : null}
          </span>
        </div>
        <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-2.5 pt-2.5 border-t border-white/[0.05]">
          <span className="kicker text-faint">Elections</span>
          {scope !== 'GE' && aeYears.length > 0 && <Group label="Assembly" ar="AE" years={aeYears} />}
          {scope !== 'AE' && geYears.length > 0 && <Group label="Lok Sabha" ar="GE" years={geYears} />}
          {sel.length > 0 && <button onClick={() => setSel([])} className="text-[11px] text-faint hover:text-ink underline decoration-dotted ml-1">clear</button>}
        </div>
      </StickyControls>

      <p className="text-[12.5px] text-muted mb-4 leading-relaxed max-w-3xl">
        Verdix scans each chosen election for the handful of patterns a strategist would act on — vote that doesn't convert, thin-margin books, split-field wins, eroding strongholds, the seats that decide control, momentum. Pick <b className="text-ink">one election or several</b> (assemblies, parliaments, or both) above; each flag states its parameters and the decision it informs, and opens <b className="text-ink">show seats</b> to drill to the exact constituencies (and their full reports). Set the region in the Focus bar at the top.
      </p>

      {!sel.length ? (
        <div className="h-[200px] grid place-items-center text-faint text-sm text-center px-8">Pick one or more elections above to scan for signals.</div>
      ) : signals.length ? (
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
                    {multi && <span className="shrink-0 mt-0.5 text-[10px] font-medium px-2 py-1 rounded-md border border-white/10 bg-white/[0.04] text-slate-300 whitespace-nowrap">{elFull(sig.election)}</span>}
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
                    <div className="text-[11px] text-faint mb-2">The last mile — {elFull(sig.election)} · click any seat for its full constituency report.</div>
                    <SortTable rows={sig.seats} cols={cols} defaultSort="m" initialDir="asc" maxH={320}
                      search searchIn={r => `${r.c} ${r.s} ${r.p} ${r.q ?? ''}`} onRowClick={s => setPicked({ seat: s, rows: sig.rows, arena: sig.election.arena })} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="h-[200px] grid place-items-center text-faint text-sm text-center px-8">
          No strong signals in the {selectedEls.length === 1 ? elFull(selectedEls[0]).toLowerCase() : `${selectedEls.length} selected elections`} for {isState ? st : 'All India'}. Try another election, add more, or pick a region with a real contest (vote-efficiency and momentum flags need vote-share data).
        </div>
      )}

      {picked && <SeatDrawer seat={picked.seat} all={picked.rows} arena={picked.arena} onClose={() => setPicked(null)} />}
    </div>
  )
}
