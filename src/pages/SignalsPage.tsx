import { useEffect, useMemo, useRef, useState } from 'react'
import { loadSeats, loadPartyAE, loadPartyGEState, loadPartyGENat, type Seat, type PartyAgg } from '../lib/data'
import { colorFor } from '../lib/colors'
import { useFilters } from '../store'
import SeatDrawer from '../components/SeatDrawer'
import { Dot, Seg, SortTable, StickyControls, type Col } from '../components/ui'
import { activeByState } from '../lib/analysis'
import { detectSignals, type Severity, type Signal, type SignalRow, type SignalGroup, type Tone } from '../lib/signals'
import { simulateAlliance, type AllianceSim } from '../lib/projections'

const tc = (s: string) => (s || '').toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())

const SEV: Record<Severity, { label: string; badge: string; ring: string }> = {
  critical: { label: 'CRITICAL', badge: 'bg-red-500/15 text-red-300 border-red-400/30', ring: 'border-l-red-500/70' },
  watch: { label: 'WATCH', badge: 'bg-amber-500/15 text-amber-200 border-amber-400/30', ring: 'border-l-amber-500/70' },
  note: { label: 'NOTE', badge: 'bg-white/[0.06] text-slate-300 border-white/15', ring: 'border-l-slate-500/60' },
}
const TONE: Record<Tone, string> = { pos: '#10b981', neg: '#f43f5e', neutral: '#64748b' }
// The segmented sections — auto-flags are grouped under these for scannability.
const GROUPS: { key: SignalGroup; label: string; caption: string }[] = [
  { key: 'control', label: 'Control of the house', caption: 'who holds power — and by how few seats' },
  { key: 'soft', label: 'Where the lead is soft', caption: 'exposure to shore up before chasing new ground' },
  { key: 'momentum', label: 'Momentum & conversion', caption: 'direction of travel, and who turns vote into seats' },
  { key: 'coalition', label: 'Social coalition', caption: 'the base across communities' },
]

// One party (or category) line in a signal's breakdown — dot · name · figure · magnitude bar · delta.
function Bar({ row }: { row: SignalRow }) {
  const dot = row.color ?? colorFor(row.label, row.a)
  const t = TONE[row.tone]
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/30" style={{ background: dot }} />
      <span className="w-16 sm:w-[84px] shrink-0 truncate text-[12px] font-medium text-ink">{row.label}</span>
      <span className="w-[104px] shrink-0 tabular-nums text-[11px] text-muted">{row.value}</span>
      <div className="flex-1 h-2.5 rounded-full bg-white/[0.05] overflow-hidden min-w-[32px]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, row.bar * 100)}%`, background: t }} />
      </div>
      {row.delta && <span className="w-14 shrink-0 text-right tabular-nums text-[11px] font-semibold" style={{ color: t }}>{row.delta}</span>}
      {row.badge && <span className="shrink-0 hidden md:inline text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded text-faint bg-white/[0.04] border border-white/10">{row.badge}</span>}
    </div>
  )
}
function SimStat({ label, value, sub, color, delta }: { label: string; value: number; sub?: string; color?: string; delta?: number }) {
  return (
    <div>
      <div className="kicker">{label}</div>
      <div className="text-[26px] font-bold tabular-nums leading-none" style={color ? { color } : undefined}>
        {value}{delta != null && delta > 0 && <span className="text-[13px] text-emerald-300 ml-1.5 align-middle">+{delta}</span>}
      </div>
      {sub && <div className="text-[10px] text-faint mt-0.5">{sub}</div>}
    </div>
  )
}

type ScopeArena = 'AE' | 'GE' | 'BOTH'
type Election = { key: string; arena: 'AE' | 'GE'; year: number }
const elFull = (e: Election) => `${e.arena === 'AE' ? 'Assembly' : 'Lok Sabha'} ${e.year}`
type Tagged = Signal & { election: Election; arenaRows: Seat[] }

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
        .forEach(s => out.push({ ...s, id: `${el.key}:${s.id}`, election: el, arenaRows: rows }))
    }
    return out.sort((a, b) => b.score - a.score)
  }, [selectedEls, ae, ge, partyAE, partyGE, natGE, isState, st])
  const nCrit = signals.filter(s => s.severity === 'critical').length
  const multi = selectedEls.length > 1
  const grouped = useMemo(() => GROUPS.map(g => ({ ...g, items: signals.filter(s => s.group === g.key) })).filter(g => g.items.length), [signals])

  // ── Alliance simulator — operates on the most recent selected election ──
  const simEl = useMemo(() => (selectedEls.length ? [...selectedEls].sort((a, b) => b.year - a.year)[0] : null), [selectedEls])
  const simActive = useMemo(() => {
    if (!simEl) return [] as Seat[]
    const rows = simEl.arena === 'AE' ? ae : ge
    const scopeRows = isState ? rows.filter(r => r.s === st) : rows
    return isState ? scopeRows.filter(r => r.y === simEl.year) : [...activeByState(rows, simEl.arena, simEl.year).values()].flat()
  }, [simEl, ae, ge, isState, st])
  const shareMap = useMemo(() => {
    const m = new Map<string, number>()
    if (!simEl) return m
    const src = isState ? (simEl.arena === 'AE' ? partyAE : partyGE).filter(r => r.s === st && r.y === simEl.year) : simEl.arena === 'GE' ? natGE.filter(r => r.y === simEl.year) : []
    src.forEach(r => { if (r.v != null) m.set(r.p, r.v as number) })
    return m
  }, [simEl, isState, st, partyAE, partyGE, natGE])
  const simParties = useMemo(() => {
    const seatsByP = new Map<string, { a: string | null; n: number }>()
    simActive.forEach(s => { const e = seatsByP.get(s.p) ?? { a: s.a, n: 0 }; e.n++; seatsByP.set(s.p, e) })
    const keys = new Set([...seatsByP.keys(), ...shareMap.keys()])
    return [...keys].map(p => ({ p, a: seatsByP.get(p)?.a ?? simActive.find(s => s.q === p)?.a ?? null, seats: seatsByP.get(p)?.n ?? 0, share: shareMap.get(p) ?? 0 }))
      .filter(x => x.seats > 0 || x.share >= 2).sort((a, b) => b.seats - a.seats || b.share - a.share).slice(0, 12)
  }, [simActive, shareMap])
  const [bloc, setBloc] = useState<string[]>([])
  const [transfer, setTransfer] = useState(70)
  const [simOpen, setSimOpen] = useState(false)
  // Region-qualified: the election key alone is arena|year, which DOESN'T change when the region
  // switches (All India → a state), so the ref guard below would keep a stale all-India bloc.
  const simKey = simEl ? `${isState ? st : 'ALL'}|${simEl.key}` : ''
  // Default the bloc ONCE per election (when its parties first load): the two largest OPPOSITION
  // vote-blocs (by vote share, excluding the seat leader) — the realistic "consolidate the
  // opposition" what-if, which is the transfer-sensitive case worth opening on. A ref guards
  // against re-defaulting over a user's edits while the data settles.
  const defaultedFor = useRef('')
  useEffect(() => {
    if (!simKey || simParties.length < 2) return
    if (defaultedFor.current === simKey) return
    defaultedFor.current = simKey
    const leader = simParties[0].p
    const opp = simParties.filter(x => x.p !== leader).sort((a, b) => b.share - a.share || b.seats - a.seats)
    const pick = (opp.length >= 2 ? opp.slice(0, 2) : simParties.slice(0, 2)).map(x => x.p)
    setBloc(pick); setSimOpen(false)
  }, [simKey, simParties])
  const toggleBloc = (p: string) => setBloc(prev => (prev.includes(p) ? prev.filter(x => x !== p) : prev.length < 4 ? [...prev, p] : prev))
  const hasShares = shareMap.size > 0
  const sim = useMemo<AllianceSim | null>(() =>
    (simEl && hasShares && bloc.length >= 2 && simActive.length) ? simulateAlliance(simActive, p => shareMap.get(p) ?? 0, bloc, transfer / 100) : null,
  [simEl, hasShares, bloc, transfer, simActive, shareMap])
  const simHouse = simEl ? (simEl.arena === 'AE' ? isState : !isState) : false
  const simN = simActive.length
  const simMaj = simHouse && simN ? Math.floor(simN / 2) + 1 : null
  const blocColor = bloc.length ? colorFor(bloc[0], simParties.find(x => x.p === bloc[0])?.a ?? null) : '#10b981'
  const pct = (n: number) => (simN ? (n / simN) * 100 : 0)

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

  const renderCard = (sig: Tagged) => {
    const sv = SEV[sig.severity]
    const isOpen = open === sig.id
    const accent = sig.party ? colorFor(sig.party, sig.a) : undefined
    return (
      <div key={sig.id} className={`card p-0 overflow-hidden border-l-4 ${sv.ring}`}>
        <div className="p-4">
          <div className="flex items-start gap-3">
            <span className={`shrink-0 mt-0.5 text-[10px] font-bold tracking-wide px-2 py-1 rounded-md border ${sv.badge}`}>{sv.label}</span>
            {multi && <span className="shrink-0 mt-0.5 text-[10px] font-medium px-2 py-1 rounded-md border border-white/10 bg-white/[0.04] text-slate-300 whitespace-nowrap">{elFull(sig.election)}</span>}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {sig.party && <Dot color={accent!} />}
                <span className="text-[14.5px] font-bold text-ink leading-tight">{sig.title}</span>
              </div>
              <div className="text-[11.5px] text-faint mt-0.5 leading-snug">{sig.caption}</div>
            </div>
            <div className="text-right shrink-0 w-36">
              <div className="text-[13px] font-bold tabular-nums leading-tight" style={accent ? { color: accent } : undefined}>{sig.metric}</div>
              {sig.metricSub && <div className="text-[10px] text-faint mt-0.5">{sig.metricSub}</div>}
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {sig.rows.map((r, i) => <Bar key={i} row={r} />)}
            {sig.rowsNote && <div className="text-[10px] text-faint pl-5">{sig.rowsNote}</div>}
          </div>
          <div className="mt-3 pt-2.5 border-t border-white/[0.05] text-[12px] text-muted leading-relaxed">
            <span className="text-orange-300/90 font-bold">▸ </span>{sig.soWhat}
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
              search searchIn={r => `${r.c} ${r.s} ${r.p} ${r.q ?? ''}`} onRowClick={s => setPicked({ seat: s, rows: sig.arenaRows, arena: sig.election.arena })} />
          </div>
        )}
      </div>
    )
  }

  // simulator readout helpers
  const crosses = simMaj != null && sim != null && sim.projected >= simMaj && sim.now < simMaj
  const shortBy = simMaj != null && sim != null ? Math.max(0, simMaj - sim.projected) : 0

  return (
    <div>
      <StickyControls>
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold leading-tight tracking-tight">Signals · {isState ? st : 'All India'}</h2>
            <div className="kicker">auto-flagged patterns + an alliance simulator — one election or many; assembly · parliament · both</div>
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
        Verdix scans each chosen election for the patterns a strategist would act on — every flag opens with the <b className="text-ink">whole field</b> (each party on one mini-chart) and the decision it informs, grouped into the sections below. The <b className="text-ink">alliance simulator</b> then asks the what-if: if these parties contested as one bloc, with a given vote transfer, how does the result change? Pick <b className="text-ink">one election or several</b> above; open <b className="text-ink">show seats</b> to drill to the constituencies. Region is set in the Focus bar.
      </p>

      {/* ── Alliance simulator ── */}
      {sel.length > 0 && simEl && (
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-[15px] font-bold text-ink flex items-center gap-2"><span className="text-orange-400">⚯</span> Alliance simulator</h3>
              <div className="kicker">if these parties contested as one bloc — {elFull(simEl)}{isState ? '' : ' · all India'}</div>
            </div>
            {hasShares && bloc.length >= 2 && (
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-faint">Vote transfer</span>
                <input type="range" min={0} max={100} step={5} value={transfer} onChange={e => setTransfer(+e.target.value)} className="w-40 sm:w-52 accent-orange-500" />
                <span className="text-base font-bold tabular-nums w-11 text-right" style={{ color: blocColor }}>{transfer}%</span>
              </div>
            )}
          </div>

          {!hasShares ? (
            <div className="text-faint text-[13px] mt-3 leading-relaxed">The simulator needs vote-share data — pick a <b className="text-muted">state</b>, or a <b className="text-muted">Lok Sabha</b> election. (All-India assembly has no national vote-share series to transfer.)</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <span className="text-[10px] text-faint uppercase tracking-wide mr-1">Bloc</span>
                {simParties.map(x => {
                  const on = bloc.includes(x.p)
                  return (
                    <button key={x.p} onClick={() => toggleBloc(x.p)}
                      className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors flex items-center gap-1.5 ${on ? 'border-orange-400/60 bg-orange-500/15 text-ink font-semibold' : 'border-white/10 text-muted hover:text-ink hover:border-white/25 bg-white/[0.03]'}`}>
                      <span className="w-2 h-2 rounded-full" style={{ background: colorFor(x.p, x.a) }} />{x.p}
                      <span className="opacity-60 tabular-nums text-[10px]">{x.seats || (x.share ? x.share.toFixed(0) + '%' : '·')}</span>
                    </button>
                  )
                })}
                <span className="text-[10px] text-faint ml-1">pick 2–4</span>
              </div>

              {bloc.length < 2 ? (
                <div className="text-faint text-[13px] mt-4">Pick at least two parties to simulate an alliance.</div>
              ) : sim && (
                <div className="mt-4">
                  <div className="flex items-end gap-5 flex-wrap">
                    <SimStat label="Win apart (now)" value={sim.now} />
                    <span className="text-2xl text-faint pb-1.5">→</span>
                    <SimStat label="As one bloc" value={sim.projected} color={blocColor} delta={sim.gains.length} />
                    {simMaj != null && <SimStat label="Majority" value={simMaj} sub={`of ${simN}`} />}
                  </div>
                  <div className="relative mt-6">
                    <div className="h-7 rounded-lg bg-white/[0.04] overflow-hidden ring-1 ring-white/10">
                      <div className="absolute inset-y-0 left-0" style={{ width: `${pct(sim.now)}%`, background: blocColor }} />
                      <div className="absolute inset-y-0" style={{ left: `${pct(sim.now)}%`, width: `${pct(sim.gains.length)}%`, background: blocColor, opacity: 0.42 }} />
                    </div>
                    {simMaj != null && <div className="absolute top-0 bottom-0 w-px bg-white/80" style={{ left: `${pct(simMaj)}%` }} />}
                    {simMaj != null && <div className="absolute -top-4 text-[9px] text-faint whitespace-nowrap" style={{ left: `${pct(simMaj)}%`, transform: 'translateX(-50%)' }}>majority {simMaj}</div>}
                  </div>
                  <div className="text-[12.5px] text-muted mt-3 leading-relaxed">
                    <span className="text-orange-300/90 font-bold">▸ </span>
                    At <b className="text-ink">{transfer}%</b> transfer, <b style={{ color: blocColor }}>{bloc.join(' + ')}</b> would hold <b style={{ color: blocColor }}>{sim.projected}</b> of {simN} —{' '}
                    {sim.gains.length > 0 ? <><b className="text-emerald-300">+{sim.gains.length}</b> over the {sim.now} they win apart</> : <>no gain over the {sim.now} they win apart</>}
                    {sim.friendlyFights > 0 ? <>; {sim.friendlyFights} internal contest{sim.friendlyFights !== 1 ? 's' : ''} consolidated</> : null}
                    {crosses ? <b className="text-emerald-300"> — crosses the majority line</b> : simMaj != null && shortBy > 0 ? <> — still {shortBy} short of majority</> : null}.{' '}
                    <span className="text-faint">Reachable ceiling: {sim.contestable} runner-up seats.</span>
                  </div>
                  {sim.gains.length > 0 && (
                    <button onClick={() => setSimOpen(o => !o)} className="mt-2.5 text-xs text-orange-400 hover:text-orange-300 underline decoration-dotted decoration-orange-400/40 underline-offset-2 transition-colors">
                      {simOpen ? 'Hide flip seats' : `Show the ${sim.gains.length} flip seats →`}
                    </button>
                  )}
                  {simOpen && sim.gains.length > 0 && (
                    <div className="mt-2">
                      <SortTable rows={sim.gains} cols={cols} defaultSort="m" initialDir="asc" maxH={300}
                        search searchIn={r => `${r.c} ${r.s} ${r.p} ${r.q ?? ''}`} onRowClick={s => setPicked({ seat: s, rows: simEl.arena === 'AE' ? ae : ge, arena: simEl.arena })} />
                    </div>
                  )}
                  <div className="text-[10px] text-faint mt-2.5 leading-relaxed">Uniform model: a non-bloc seat flips in when {transfer}% of the other bloc members' statewide vote share covers the losing margin. Seats where the bloc ran third can't be judged from top-two data, so this is a <b className="text-muted">floor</b> on the gain, not a forecast.</div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Segmented auto-flags ── */}
      {!sel.length ? (
        <div className="h-[160px] grid place-items-center text-faint text-sm text-center px-8">Pick one or more elections above to scan for signals.</div>
      ) : signals.length ? (
        <div className="space-y-6">
          {grouped.map(g => (
            <div key={g.key}>
              <div className="flex items-baseline gap-2 mb-2.5">
                <h3 className="text-[12.5px] font-bold uppercase tracking-wide text-ink">{g.label}</h3>
                <span className="text-[11px] text-faint">{g.caption}</span>
                <span className="text-[11px] text-faint ml-auto tabular-nums">{g.items.length}</span>
              </div>
              <div className="grid xl:grid-cols-2 gap-3 items-start">
                {g.items.map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="h-[160px] grid place-items-center text-faint text-sm text-center px-8">
          No strong signals in the {selectedEls.length === 1 ? elFull(selectedEls[0]).toLowerCase() : `${selectedEls.length} selected elections`} for {isState ? st : 'All India'}. Try another election, add more, or pick a region with a real contest (vote-efficiency and momentum flags need vote-share data).
        </div>
      )}

      {picked && <SeatDrawer seat={picked.seat} all={picked.rows} arena={picked.arena} onClose={() => setPicked(null)} />}
    </div>
  )
}
