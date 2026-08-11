import { useEffect, useMemo, useRef, useState } from 'react'
import { loadSeats, loadPartyAE, loadPartyGEState, loadPartyGENat, type Seat, type PartyAgg } from '../lib/data'
import { colorFor, readable } from '../lib/colors'
import { useFilters, useTheme } from '../store'
import SeatDrawer from '../components/SeatDrawer'
import { Dot, Seg, SortTable, StickyControls, type Col } from '../components/ui'
import { activeByState } from '../lib/analysis'
import { detectSignals, type Severity, type Signal, type SignalRow, type SignalGroup, type Tone } from '../lib/signals'
import { simulateAlliance, type AllianceSim } from '../lib/projections'
import { partyStrategy, type SwotItem } from '../lib/strategy'
import { useIsPhone } from '../lib/useMedia'

const tc = (s: string) => (s || '').toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())

// Severity badges use MID-TONE text (red-500 / amber-700) instead of the old red-300/amber-200
// pastels: this page has no useTheme(), so the colour must clear contrast on BOTH the cream light
// canvas and the teal-black dark canvas. The 200/300 tints were ~1.4-2.0:1 on cream.
const SEV: Record<Severity, { label: string; badge: string; ring: string }> = {
  critical: { label: 'CRITICAL', badge: 'bg-red-500/20 text-red-500 border-red-500/40', ring: 'border-l-red-500/70' },
  watch: { label: 'WATCH', badge: 'bg-amber-500/20 text-amber-700 border-amber-500/40', ring: 'border-l-amber-500/70' },
  note: { label: 'NOTE', badge: 'bg-white/[0.06] text-slate-300 border-white/15', ring: 'border-l-slate-500/60' },
}
// Tone hexes double as TEXT colour (the per-party delta) — deepened to mid-tones that read on both
// themes (#10b981 was 2.3:1 on cream, #f43f5e 3.4:1). Same reason as SEV above: no useTheme() here.
const TONE: Record<Tone, string> = { pos: '#059669', neg: '#e11d48', neutral: '#64748b' }
const GROUPS: { key: SignalGroup; label: string; caption: string }[] = [
  { key: 'control', label: 'Control of the house', caption: 'who holds power — and by how few seats' },
  { key: 'soft', label: 'Where the lead is soft', caption: 'exposure to shore up before chasing new ground' },
  { key: 'momentum', label: 'Momentum & conversion', caption: 'direction of travel, and who turns vote into seats' },
  { key: 'coalition', label: 'Social coalition', caption: 'the base across communities' },
]

function Bar({ row }: { row: SignalRow }) {
  const dot = row.color ?? colorFor(row.label, row.a)
  const t = TONE[row.tone]
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/30" style={{ background: dot }} />
      <span className="w-16 sm:w-[84px] shrink-0 truncate text-[12px] font-medium text-ink">{row.label}</span>
      <span className="w-[72px] sm:w-[104px] shrink-0 tabular-nums text-[11px] text-muted">{row.value}</span>
      <div className="flex-1 h-2.5 rounded-full bg-white/[0.05] overflow-hidden min-w-[32px]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, row.bar * 100)}%`, background: t }} />
      </div>
      {row.delta && <span className="w-11 sm:w-14 shrink-0 text-right tabular-nums text-[11px] font-semibold" style={{ color: t }}>{row.delta}</span>}
      {row.badge && <span className="shrink-0 hidden md:inline text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded text-muted bg-white/[0.04] border border-white/20">{row.badge}</span>}
    </div>
  )
}
function SimStat({ label, value, sub, color, delta }: { label: string; value: number; sub?: string; color?: string; delta?: number }) {
  return (
    <div>
      <div className="kicker">{label}</div>
      <div className="text-[26px] font-bold tabular-nums leading-none" style={color ? { color } : undefined}>
        {/* emerald-600, not -300: the projected gain must read on the cream canvas too (no useTheme here) */}
        {value}{delta != null && delta > 0 && <span className="text-[13px] text-emerald-600 ml-1.5 align-middle">+{delta}</span>}
      </div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  )
}
// One quadrant of the SWOT grid.
function SwotQuad({ title, sub, accent, items }: { title: string; sub: string; accent: string; items: SwotItem[] }) {
  const mode = useTheme()
  return (
    <div className="card p-0 overflow-hidden border-l-4" style={{ borderLeftColor: accent }}>
      <div className="px-4 pt-3 pb-1.5 flex items-baseline gap-2">
        {/* the border keeps the raw accent; the TEXT is contrast-corrected for the canvas */}
        <span className="text-[13px] font-bold" style={{ color: readable(accent, mode) }}>{title}</span>
        <span className="text-[11px] text-muted">{sub}</span>
        <span className="ml-auto text-[11px] text-muted tabular-nums">{items.length}</span>
      </div>
      <div className="px-4 pb-3 space-y-2">
        {items.length ? items.map((it, i) => (
          <div key={i} className="flex gap-2 text-[12.5px] text-muted leading-relaxed">
            <span className="shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
            <span>{it.text} <span className="text-[10px] uppercase tracking-wide text-muted border border-white/20 rounded px-1 py-px ml-0.5 whitespace-nowrap">{it.tag}</span></span>
          </div>
        )) : <div className="text-muted text-[12px]">No clear read from this election.</div>}
      </div>
    </div>
  )
}

type ScopeArena = 'AE' | 'GE' | 'BOTH'
type ViewKey = 'swot' | 'alliance' | 'patterns'
type Election = { key: string; arena: 'AE' | 'GE'; year: number }
const elFull = (e: Election) => `${e.arena === 'AE' ? 'Assembly' : 'Lok Sabha'} ${e.year}`
type Tagged = Signal & { election: Election; arenaRows: Seat[] }

export default function SignalsPage() {
  const { arena, state } = useFilters()
  const mode = useTheme()
  const isPhone = useIsPhone()   // reactive (matchMedia) — only used to shorten the view-toggle labels
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
  const [view, setView] = useState<ViewKey>('swot')
  const [sel, setSel] = useState<string[]>([])
  useEffect(() => { loadSeats('AE').then(setAe); loadSeats('GE').then(setGe) }, [])
  useEffect(() => { loadPartyAE().then(setPartyAE); loadPartyGEState().then(setPartyGE); loadPartyGENat().then(setNatGE) }, [])

  const aeYears = useMemo(() => [...new Set((isState ? ae.filter(r => r.s === st) : ae).map(r => r.y))].sort((a, b) => b - a), [ae, isState, st])
  const geYears = useMemo(() => [...new Set((isState ? ge.filter(r => r.s === st) : ge).map(r => r.y))].sort((a, b) => b - a), [ge, isState, st])
  const elections = useMemo<Election[]>(() => {
    const list: Election[] = []
    if (scope !== 'GE') aeYears.forEach(y => list.push({ key: `AE|${y}`, arena: 'AE', year: y }))
    if (scope !== 'AE') geYears.forEach(y => list.push({ key: `GE|${y}`, arena: 'GE', year: y }))
    return list
  }, [scope, aeYears, geYears])
  const optSig = elections.map(e => e.key).join(',')
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
  // The SWOT + Alliance views analyse ONE election, so their picker is single-select (click = switch).
  // Only Patterns scans several. Collapse a multi-selection to the most recent when leaving Patterns.
  const selectOne = (key: string) => { setSel([key]); setOpen(null); setOpenPlay(null) }
  useEffect(() => {
    if (view === 'patterns') return
    setSel(prev => (prev.length > 1 ? [[...prev].sort((a, b) => (+b.split('|')[1]) - (+a.split('|')[1]))[0]] : prev))
  }, [view])

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

  // ── the "active election" the what-if tools (SWOT + simulator) operate on: most recent selected ──
  const simEl = useMemo(() => (selectedEls.length ? [...selectedEls].sort((a, b) => b.year - a.year)[0] : null), [selectedEls])
  const simScopeRows = useMemo(() => {
    if (!simEl) return [] as Seat[]
    const rows = simEl.arena === 'AE' ? ae : ge
    return isState ? rows.filter(r => r.s === st) : rows
  }, [simEl, ae, ge, isState, st])
  const simActive = useMemo(() => {
    if (!simEl) return [] as Seat[]
    const rows = simEl.arena === 'AE' ? ae : ge
    return isState ? simScopeRows.filter(r => r.y === simEl.year) : [...activeByState(rows, simEl.arena, simEl.year).values()].flat()
  }, [simEl, ae, ge, isState, simScopeRows])
  const simPartyRows = useMemo(() => {
    if (!simEl) return [] as PartyAgg[]
    return isState ? (simEl.arena === 'AE' ? partyAE : partyGE).filter(r => r.s === st) : simEl.arena === 'GE' ? natGE : []
  }, [simEl, isState, st, partyAE, partyGE, natGE])
  const shareMap = useMemo(() => {
    const m = new Map<string, number>()
    if (!simEl) return m
    simPartyRows.filter(r => r.y === simEl.year).forEach(r => { if (r.v != null) m.set(r.p, r.v as number) })
    return m
  }, [simEl, simPartyRows])
  const simParties = useMemo(() => {
    const seatsByP = new Map<string, { a: string | null; n: number }>()
    simActive.forEach(s => { const e = seatsByP.get(s.p) ?? { a: s.a, n: 0 }; e.n++; seatsByP.set(s.p, e) })
    const keys = new Set([...seatsByP.keys(), ...shareMap.keys()])
    return [...keys].map(p => ({ p, a: seatsByP.get(p)?.a ?? simActive.find(s => s.q === p)?.a ?? null, seats: seatsByP.get(p)?.n ?? 0, share: shareMap.get(p) ?? 0 }))
      .filter(x => x.seats > 0 || x.share >= 2).sort((a, b) => b.seats - a.seats || b.share - a.share).slice(0, 12)
  }, [simActive, shareMap])
  // region+election identity for the "default once" guards (election key alone is arena|year, which
  // does NOT change when the region switches — that would keep a stale all-India selection).
  const simKey = simEl ? `${isState ? st : 'ALL'}|${simEl.key}` : ''

  // ── Party SWOT ──
  const [swotParty, setSwotParty] = useState<string>('')
  const [openPlay, setOpenPlay] = useState<string | null>(null)
  const swotDefaultedFor = useRef('')
  useEffect(() => {
    if (!simKey || !simParties.length) return
    if (swotDefaultedFor.current === simKey) return
    swotDefaultedFor.current = simKey
    // keep the analysed party across an election switch if it still runs there; else the new leader
    setSwotParty(prev => (prev && simParties.some(x => x.p === prev) ? prev : simParties[0].p)); setOpenPlay(null)
  }, [simKey, simParties])
  const swot = useMemo(() =>
    (view === 'swot' && simEl && swotParty && simActive.length) ? partyStrategy({ party: swotParty, seats: simActive, allRows: simScopeRows, partyRows: simPartyRows, vy: simEl.year, isState, arena: simEl.arena }) : null,
  [view, simEl, swotParty, simActive, simScopeRows, simPartyRows, isState])

  // ── Alliance simulator ──
  const [bloc, setBloc] = useState<string[]>([])
  const [transfer, setTransfer] = useState(70)
  const [simOpen, setSimOpen] = useState(false)
  const blocDefaultedFor = useRef('')
  useEffect(() => {
    if (!simKey || simParties.length < 2) return
    if (blocDefaultedFor.current === simKey) return
    blocDefaultedFor.current = simKey
    const leader = simParties[0].p
    const opp = simParties.filter(x => x.p !== leader).sort((a, b) => b.share - a.share || b.seats - a.seats)
    setBloc((opp.length >= 2 ? opp.slice(0, 2) : simParties.slice(0, 2)).map(x => x.p)); setSimOpen(false)
  }, [simKey, simParties])
  const toggleBloc = (p: string) => setBloc(prev => (prev.includes(p) ? prev.filter(x => x !== p) : prev.length < 4 ? [...prev, p] : prev))
  const hasShares = shareMap.size > 0
  const sim = useMemo<AllianceSim | null>(() =>
    (view === 'alliance' && simEl && hasShares && bloc.length >= 2 && simActive.length) ? simulateAlliance(simActive, p => shareMap.get(p) ?? 0, bloc, transfer / 100) : null,
  [view, simEl, hasShares, bloc, transfer, simActive, shareMap])
  const simHouse = simEl ? (simEl.arena === 'AE' ? isState : !isState) : false
  const simN = simActive.length
  const simMaj = simHouse && simN ? Math.floor(simN / 2) + 1 : null
  const blocColor = bloc.length ? colorFor(bloc[0], simParties.find(x => x.p === bloc[0])?.a ?? null) : '#059669'   // fallback deepened to read on cream
  const pct = (n: number) => (simN ? (n / simN) * 100 : 0)
  const crosses = simMaj != null && sim != null && sim.projected >= simMaj && sim.now < simMaj
  const shortBy = simMaj != null && sim != null ? Math.max(0, simMaj - sim.projected) : 0

  const cols: Col<Seat>[] = [
    { key: 'c', label: 'Constituency', get: r => r.c, render: r => tc(r.c) },
    ...(isState ? [] : [{ key: 's', label: 'State', get: (r: Seat) => r.s } as Col<Seat>]),
    { key: 'p', label: 'Winner', get: r => r.p, render: r => <span><Dot color={colorFor(r.p, r.a)} />{r.p}</span> },
    { key: 'q', label: 'Runner-up', get: r => r.q, render: r => r.q ? <span><Dot color={colorFor(r.q)} />{r.q}</span> : '–' },
    { key: 'm', label: 'Margin%', get: r => r.m, align: 'right', render: r => r.m?.toFixed(1) },
    { key: 'v', label: 'Win share%', get: r => r.v, align: 'right', render: r => r.v?.toFixed(1) ?? '–' },
  ]
  const drillRows = simEl ? (simEl.arena === 'AE' ? ae : ge) : ae

  const Group = ({ label, ar, years }: { label: string; ar: 'AE' | 'GE'; years: number[] }) => (
    /* shrink-0 on phones so the row above scrolls horizontally instead of squashing the chips */
    <div className="flex items-center gap-1.5 flex-wrap shrink-0 sm:shrink">
      <span className="text-[11px] text-muted uppercase tracking-wide">{label}</span>
      {years.map(y => {
        const key = `${ar}|${y}`, on = sel.includes(key)
        return (
          <button key={key} onClick={() => (view === 'patterns' ? toggle(key) : selectOne(key))}
            className={`px-3 py-1.5 min-h-[32px] inline-flex items-center rounded-full text-[11px] tabular-nums transition-colors border ${on ? 'bg-gold text-black border-gold font-semibold' : 'text-muted border-white/10 hover:text-ink hover:border-white/25 bg-white/[0.03]'}`}>{y}</button>
        )
      })}
      {view === 'patterns' && years.length > 1 && <button onClick={() => toggleAll(ar, years)} className="text-[11px] text-muted hover:text-ink ml-0.5 px-2 py-1.5 min-h-[32px] inline-flex items-center underline decoration-dotted">all</button>}
    </div>
  )
  const PartyChip = ({ p, a, n, on, onClick }: { p: string; a: string | null; n: number; on: boolean; onClick: () => void }) => (
    <button onClick={onClick} className={`px-3 py-1.5 min-h-[32px] rounded-full text-[11px] border transition-colors flex items-center gap-1.5 ${on ? 'border-gold/60 bg-gold/15 text-ink font-semibold' : 'border-white/10 text-muted hover:text-ink hover:border-white/25 bg-white/[0.03]'}`}>
      <span className="w-2 h-2 rounded-full" style={{ background: colorFor(p, a) }} />{p}<span className="tabular-nums text-[10.5px] text-muted">{n || '·'}</span>
    </button>
  )

  const renderCard = (sig: Tagged) => {
    const sv = SEV[sig.severity]
    const isOpen = open === sig.id
    const accent = sig.party ? colorFor(sig.party, sig.a) : undefined
    return (
      <div key={sig.id} className={`card p-0 overflow-hidden border-l-4 ${sv.ring}`}>
        <div className="p-4">
          <div className="flex items-start gap-2 flex-wrap sm:flex-nowrap sm:gap-3">
            <span className={`shrink-0 mt-0.5 text-[10px] font-bold tracking-wide px-2 py-1 rounded-md border ${sv.badge}`}>{sv.label}</span>
            {multi && <span className="shrink-0 mt-0.5 text-[10px] font-medium px-2 py-1 rounded-md border border-white/10 bg-white/[0.04] text-slate-300 whitespace-nowrap">{elFull(sig.election)}</span>}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {sig.party && <Dot color={accent!} />}
                <span className="text-[14.5px] font-bold text-ink leading-tight">{sig.title}</span>
              </div>
              <div className="text-[11.5px] text-muted mt-0.5 leading-snug">{sig.caption}</div>
            </div>
            <div className="w-full text-left sm:w-36 sm:text-right shrink-0 mt-1 sm:mt-0">
              <div className="text-[13px] font-bold tabular-nums leading-tight" style={accent ? { color: readable(accent, mode) } : undefined}>{sig.metric}</div>
              {sig.metricSub && <div className="text-[11px] text-muted mt-0.5">{sig.metricSub}</div>}
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {sig.rows.map((r, i) => <Bar key={i} row={r} />)}
            {sig.rowsNote && <div className="text-[11px] text-muted pl-5">{sig.rowsNote}</div>}
          </div>
          <div className="mt-3 pt-2.5 border-t border-white/[0.05] text-[12px] text-muted leading-relaxed">
            <span className="text-gold/90 font-bold">▸ </span>{sig.soWhat}
          </div>
          {sig.seats.length > 0 && (
            <button onClick={() => setOpen(isOpen ? null : sig.id)}
              className="mt-2.5 inline-flex items-center min-h-[32px] py-1 text-xs text-gold hover:text-gold underline decoration-dotted decoration-gold/40 underline-offset-2 transition-colors">
              {isOpen ? 'Hide seats' : `Show the ${sig.seats.length} seats →`}
            </button>
          )}
        </div>
        {isOpen && sig.seats.length > 0 && (
          <div className="border-t border-white/[0.06] px-4 py-3 bg-white/[0.015] overflow-x-auto">
            <div className="text-[11px] text-muted mb-2">The last mile — {elFull(sig.election)} · click any seat for its full constituency report.</div>
            {/* min-w keeps the 6-column table readable and scrolling INSIDE the card, not the page */}
            <div className="min-w-[520px]">
              <SortTable rows={sig.seats} cols={cols} defaultSort="m" initialDir="asc" maxH={320}
                search searchIn={r => `${r.c} ${r.s} ${r.p} ${r.q ?? ''}`} onRowClick={s => setPicked({ seat: s, rows: sig.arenaRows, arena: sig.election.arena })} />
            </div>
          </div>
        )}
      </div>
    )
  }

  // Accents are used as 13px BOLD TEXT (the playbook headings), so they carry the same
  // both-canvases mid-tone rule as TONE/SEV above — #10b981/#f43f5e failed on the cream theme.
  const PLAYS = [
    { key: 'win', title: (p: string) => `To make ${p} WIN`, sub: 'the offensive plan', accent: '#059669', arrow: '▲' },
    { key: 'lose', title: (p: string) => `To make ${p} LOSE`, sub: 'how a rival beats them', accent: '#e11d48', arrow: '▼' },
  ] as const

  return (
    <div>
      <StickyControls>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold leading-tight tracking-tight">Signals · {isState ? st : 'All India'}</h2>
            <div className="kicker">a strategist's read — party SWOT &amp; playbook · alliance what-ifs · auto-flagged patterns</div>
          </div>
          {/* the three labels total ~330px — wider than a 390px phone's sticky bar, so shorten them
              there (useIsPhone is reactive) and keep a scroll container as the belt-and-braces */}
          <div className="w-full overflow-x-auto sm:w-auto sm:overflow-visible">
            <Seg options={[{ v: 'swot', label: isPhone ? 'SWOT' : 'Party SWOT' }, { v: 'alliance', label: isPhone ? 'Alliance' : 'Alliance simulator' }, { v: 'patterns', label: 'Patterns' }]} value={view} onChange={v => setView(v as ViewKey)} />
          </div>
          {view === 'patterns' && (
            <span className="text-sm text-muted ml-auto">
              {signals.length} signal{signals.length !== 1 ? 's' : ''}{nCrit ? <span className="text-red-500"> · {nCrit} critical</span> : null}{multi ? <span className="text-muted"> · {selectedEls.length} elections</span> : null}
            </span>
          )}
        </div>
        <div className="flex items-center gap-x-3 sm:gap-x-4 gap-y-1.5 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible mt-2.5 pt-2.5 border-t border-white/[0.05]">
          <div className="shrink-0">
            <Seg options={[{ v: 'AE', label: 'Assemblies' }, { v: 'GE', label: 'Parliaments' }, { v: 'BOTH', label: 'Both' }]} value={scope} onChange={v => setScope(v as ScopeArena)} />
          </div>
          <span className="kicker text-[11px] text-muted ml-1 shrink-0">{view === 'patterns' ? 'Elections' : 'Election'}</span>
          {scope !== 'GE' && aeYears.length > 0 && <Group label="Assembly" ar="AE" years={aeYears} />}
          {scope !== 'AE' && geYears.length > 0 && <Group label="Lok Sabha" ar="GE" years={geYears} />}
          {view === 'patterns' && sel.length > 0 && <button onClick={() => setSel([])} className="text-[11px] text-muted hover:text-ink underline decoration-dotted ml-1 px-2 py-1.5 min-h-[32px] inline-flex items-center shrink-0">clear</button>}
        </div>
      </StickyControls>

      {/* ~11 lines of prose at 390px would push every card below the fold — desktop keeps it */}
      <p className="hidden sm:block text-[12.5px] text-muted mb-4 leading-relaxed max-w-3xl">
        Verdix reads this election the way a senior strategist would. <b className="text-ink">Party SWOT</b> — pick a party for its strengths, weaknesses, opportunities and threats, plus a playbook to make it <b className="text-ink">win</b> and one to make it <b className="text-ink">lose</b>. <b className="text-ink">Alliance simulator</b> — what changes if parties contest as one bloc, at a chosen vote transfer. <b className="text-ink">Patterns</b> — the auto-flagged signals across the whole field. The what-if views use the most recent election picked above; region is set in the Focus bar.
      </p>

      {!sel.length ? (
        <div className="h-[160px] grid place-items-center text-muted text-sm text-center px-8">Pick an election above to begin.</div>
      ) : view === 'swot' ? (
        /* ── Party SWOT ── */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="kicker text-[11px] text-muted mr-1">Analyse party · {simEl ? elFull(simEl) : ''}</span>
            {simParties.map(x => <PartyChip key={x.p} p={x.p} a={x.a} n={x.seats} on={swotParty === x.p} onClick={() => { setSwotParty(x.p); setOpenPlay(null) }} />)}
          </div>
          {swot && simEl ? (
            <>
              <div className="card p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Dot color={colorFor(swot.party, swot.a)} />
                  <h3 className="text-[17px] font-bold text-ink">{swot.party}</h3>
                  <span className="text-[11px] text-muted">· {elFull(simEl)}{isState ? ` · ${st}` : ' · all India'}</span>
                </div>
                <p className="text-[14px] text-muted mt-1.5 leading-snug max-w-3xl"><span className="text-gold/90 font-bold">▸ </span>{swot.verdict}</p>
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
                  {swot.scorecard.map((s, i) => (
                    <div key={i}>
                      <div className="kicker">{s.label}</div>
                      {/* mid-tones, not #34d399/#fb7185: these scorecard numbers must read on cream too */}
                      <div className="text-[16px] font-bold tabular-nums leading-none" style={{ color: s.tone === 'pos' ? readable('#059669', mode) : s.tone === 'neg' ? readable('#e11d48', mode) : undefined }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3 items-start">
                {/* accents are also the 13px bold quadrant titles → mid-tones that clear both canvases
                    (the old #10b981 / #38bdf8 / #f59e0b were ~2:1 on the cream light theme) */}
                <SwotQuad title="Strengths" sub="what's working" accent="#059669" items={swot.strengths} />
                <SwotQuad title="Weaknesses" sub="what's exposed" accent="#e11d48" items={swot.weaknesses} />
                <SwotQuad title="Opportunities" sub="where to gain" accent="#0284c7" items={swot.opportunities} />
                <SwotQuad title="Threats" sub="what can go wrong" accent="#b45309" items={swot.threats} />
              </div>

              <div className="grid lg:grid-cols-2 gap-3 items-start">
                {PLAYS.map(col => {
                  const plays = col.key === 'win' ? swot.winPlan : swot.losePlan
                  return (
                    <div key={col.key} className="card p-0 overflow-hidden border-t-2" style={{ borderTopColor: col.accent }}>
                      <div className="px-4 pt-3 pb-2">
                        <div className="text-[13px] font-bold tracking-wide flex items-center gap-1.5" style={{ color: readable(col.accent, mode) }}><span>{col.arrow}</span>{col.title(swot.party)}</div>
                        <div className="text-[11px] text-muted uppercase tracking-wide">{col.sub}</div>
                      </div>
                      <div className="divide-y divide-white/[0.05]">
                        {plays.length ? plays.map(pl => {
                          const k = `${col.key}-${pl.n}`, isO = openPlay === k
                          return (
                            <div key={k} className="px-4 py-2.5">
                              <div className="flex gap-2.5">
                                <span className="shrink-0 w-5 h-5 grid place-items-center rounded-full text-[11px] font-bold text-black" style={{ background: col.accent }}>{pl.n}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] font-semibold text-ink">{pl.move}</div>
                                  <div className="text-[12px] text-muted mt-0.5 leading-relaxed">{pl.why}</div>
                                  {pl.seats && pl.seats.length > 0 && (
                                    <button onClick={() => setOpenPlay(isO ? null : k)} className="mt-1.5 inline-flex items-center min-h-[32px] py-1 text-[11px] text-gold hover:text-gold underline decoration-dotted decoration-gold/40">{isO ? 'Hide seats' : `Show the ${pl.seats.length} seats →`}</button>
                                  )}
                                  {isO && pl.seats && (
                                    <div className="mt-2 -mr-4 overflow-x-auto"><div className="min-w-[520px] pr-4"><SortTable rows={pl.seats} cols={cols} defaultSort="m" initialDir="asc" maxH={260} search searchIn={r => `${r.c} ${r.s} ${r.p} ${r.q ?? ''}`} onRowClick={s => setPicked({ seat: s, rows: drillRows, arena: simEl.arena })} /></div></div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        }) : <div className="px-4 py-3 text-muted text-[12px]">No clear moves from this election's data.</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="h-[160px] grid place-items-center text-muted text-sm text-center px-8">Pick a party above to analyse.</div>
          )}
        </div>
      ) : view === 'alliance' ? (
        /* ── Alliance simulator ── */
        simEl ? (
          <div className="card p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-[15px] font-bold text-ink flex items-center gap-2"><span className="text-gold">⚯</span> Alliance simulator</h3>
                <div className="kicker">if these parties contested as one bloc — {elFull(simEl)}{isState ? '' : ' · all India'}</div>
              </div>
              {hasShares && bloc.length >= 2 && (
                <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                  <span className="text-[11px] text-muted shrink-0">Vote transfer</span>
                  <input type="range" min={0} max={100} step={5} value={transfer} onChange={e => setTransfer(+e.target.value)} className="flex-1 min-w-0 sm:flex-none sm:w-52 accent-gold" />
                  <span className="text-base font-bold tabular-nums w-11 text-right" style={{ color: blocColor }}>{transfer}%</span>
                </div>
              )}
            </div>
            {!hasShares ? (
              <div className="text-muted text-[13px] mt-3 leading-relaxed">The simulator needs vote-share data — pick a <b className="text-muted">state</b>, or a <b className="text-muted">Lok Sabha</b> election. (All-India assembly has no national vote-share series to transfer.)</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  <span className="text-[11px] text-muted uppercase tracking-wide mr-1">Bloc</span>
                  {simParties.map(x => <PartyChip key={x.p} p={x.p} a={x.a} n={x.seats} on={bloc.includes(x.p)} onClick={() => toggleBloc(x.p)} />)}
                  <span className="text-[11px] text-muted ml-1">pick 2–4</span>
                </div>
                {bloc.length < 2 ? (
                  <div className="text-muted text-[13px] mt-4">Pick at least two parties to simulate an alliance.</div>
                ) : sim && (
                  <div className="mt-4">
                    <div className="flex items-end gap-5 flex-wrap">
                      <SimStat label="Win apart (now)" value={sim.now} />
                      <span className="text-2xl text-muted pb-1.5">→</span>
                      <SimStat label="As one bloc" value={sim.projected} color={blocColor} delta={sim.gains.length} />
                      {simMaj != null && <SimStat label="Majority" value={simMaj} sub={`of ${simN}`} />}
                    </div>
                    <div className="relative mt-6">
                      <div className="h-7 rounded-lg bg-white/[0.04] overflow-hidden ring-1 ring-white/10">
                        <div className="absolute inset-y-0 left-0" style={{ width: `${pct(sim.now)}%`, background: blocColor }} />
                        <div className="absolute inset-y-0" style={{ left: `${pct(sim.now)}%`, width: `${pct(sim.gains.length)}%`, background: blocColor, opacity: 0.42 }} />
                      </div>
                      {simMaj != null && <div className="absolute top-0 bottom-0 w-px bg-white/80" style={{ left: `${pct(simMaj)}%` }} />}
                      {simMaj != null && <div className="absolute -top-4 text-[10.5px] text-muted font-medium whitespace-nowrap" style={{ left: `${pct(simMaj)}%`, transform: 'translateX(-50%)' }}>majority {simMaj}</div>}
                    </div>
                    <div className="text-[12.5px] text-muted mt-3 leading-relaxed">
                      <span className="text-gold/90 font-bold">▸ </span>
                      At <b className="text-ink">{transfer}%</b> transfer, <b style={{ color: blocColor }}>{bloc.join(' + ')}</b> would hold <b style={{ color: blocColor }}>{sim.projected}</b> of {simN} —{' '}
                      {sim.gains.length > 0 ? <><b className="text-emerald-600">+{sim.gains.length}</b> over the {sim.now} they win apart</> : <>no gain over the {sim.now} they win apart</>}
                      {sim.friendlyFights > 0 ? <>; {sim.friendlyFights} internal contest{sim.friendlyFights !== 1 ? 's' : ''} consolidated</> : null}
                      {crosses ? <b className="text-emerald-600"> — crosses the majority line</b> : simMaj != null && shortBy > 0 ? <> — still {shortBy} short of majority</> : null}.{' '}
                      <span className="text-muted">Reachable ceiling: {sim.contestable} runner-up seats.</span>
                    </div>
                    {sim.gains.length > 0 && (
                      <button onClick={() => setSimOpen(o => !o)} className="mt-2.5 inline-flex items-center min-h-[32px] py-1 text-xs text-gold hover:text-gold underline decoration-dotted decoration-gold/40 underline-offset-2 transition-colors">
                        {simOpen ? 'Hide flip seats' : `Show the ${sim.gains.length} flip seats →`}
                      </button>
                    )}
                    {simOpen && sim.gains.length > 0 && (
                      <div className="mt-2 -mx-4 px-4 overflow-x-auto"><div className="min-w-[520px]"><SortTable rows={sim.gains} cols={cols} defaultSort="m" initialDir="asc" maxH={300} search searchIn={r => `${r.c} ${r.s} ${r.p} ${r.q ?? ''}`} onRowClick={s => setPicked({ seat: s, rows: drillRows, arena: simEl.arena })} /></div></div>
                    )}
                    <div className="text-[11px] text-muted mt-2.5 leading-relaxed">Uniform model: a non-bloc seat flips in when {transfer}% of the other bloc members' statewide vote share covers the losing margin. Seats where the bloc ran third can't be judged from top-two data, so this is a <b className="text-muted">floor</b> on the gain, not a forecast.</div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null
      ) : (
        /* ── Patterns (segmented auto-flags) ── */
        signals.length ? (
          <div className="space-y-6">
            {grouped.map(g => (
              <div key={g.key}>
                <div className="flex items-baseline gap-2 mb-2.5">
                  <h3 className="text-[12.5px] font-bold uppercase tracking-wide text-ink">{g.label}</h3>
                  <span className="text-[11px] text-muted">{g.caption}</span>
                  <span className="text-[11px] text-muted ml-auto tabular-nums">{g.items.length}</span>
                </div>
                <div className="grid xl:grid-cols-2 gap-3 items-start">
                  {g.items.map(renderCard)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-[160px] grid place-items-center text-muted text-sm text-center px-8">
            No strong signals in the {selectedEls.length === 1 ? elFull(selectedEls[0]).toLowerCase() : `${selectedEls.length} selected elections`} for {isState ? st : 'All India'}. Try another election, add more, or pick a region with a real contest (vote-efficiency and momentum flags need vote-share data).
          </div>
        )
      )}

      {picked && <SeatDrawer seat={picked.seat} all={picked.rows} arena={picked.arena} onClose={() => setPicked(null)} />}
    </div>
  )
}
