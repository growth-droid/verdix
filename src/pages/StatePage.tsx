import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  loadSeats, loadPartyAE, loadPartyGEState, loadPartyGENat, loadStateTurnout,
  type Seat, type PartyAgg, type StateTurnout,
} from '../lib/data'
import { colorFor, ALLIANCE_COLORS, readable, inkOn } from '../lib/colors'
import { useFilters, useTheme } from '../store'
import ChoroplethMap from '../components/ChoroplethMap'
import SeatDrawer from '../components/SeatDrawer'
import WinnerMatrix from '../components/WinnerMatrix'
import PositionsTable from '../components/PositionsTable'
import { Chart, ChartCard, Dot, Info, Seg, Select, SortTable, StickyControls, VoteSeatChart, type Col } from '../components/ui'
import { baseOpt, catAxis, valAxis, pctFmt, AXIS, MUTED } from '../lib/theme'
import { comparableAE } from '../lib/joins'
import { swing, classifyState, allianceBase, type SeatClass } from '../lib/analysis'

const tc = (s: string | null) => (s ? s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()) : '–')
const SAFE = '#16a34a', LEAN = '#f59e0b', SWING = '#ef4444'

export default function StatePage() {
  const navTo = useNavigate()
  const { state, arena, year, setYear, setState } = useFilters()
  const mode = useTheme()
  const [rows, setRows] = useState<Seat[]>([])
  const [partyAE, setPartyAE] = useState<PartyAgg[]>([])
  const [partyGE, setPartyGE] = useState<PartyAgg[]>([])
  const [natGE, setNatGE] = useState<PartyAgg[]>([])
  const [turn, setTurn] = useState<StateTurnout>({ AE: {}, GE: {} })
  const [band, setBand] = useState(3)
  const [mapColor, setMapColor] = useState<'winner' | 'alliance' | 'security'>('winner')
  const [seatGroup, setSeatGroup] = useState<'party' | 'alliance'>('party')
  const [holdTab, setHoldTab] = useState<'hold' | 'swing'>('hold')
  const [battleSel, setBattleSel] = useState<{ a: string; b: string } | null>(null)   // close-seat matchup → filters the table
  const [contestSel, setContestSel] = useState<{ w: string; r: string } | null>(null)  // "who beats whom" cell → seat list
  const [picked, setPicked] = useState<Seat | null>(null)  // clicked seat → constituency report drawer
  // the winner matrix can open a seat from EITHER arena, so it carries its own rows + arena
  const [mPick, setMPick] = useState<{ seat: Seat; all: Seat[]; arena: 'AE' | 'GE' } | null>(null)
  useEffect(() => { loadSeats(arena).then(setRows) }, [arena])
  useEffect(() => {
    loadPartyAE().then(setPartyAE); loadPartyGEState().then(setPartyGE); loadPartyGENat().then(setNatGE)
    loadStateTurnout().then(setTurn)
  }, [])
  const party = arena === 'AE' ? partyAE : partyGE

  const states = useMemo(() => [...new Set(rows.map(r => r.s))].sort(), [rows])
  // The State page lands on a single state (default Andhra Pradesh) but ALSO supports an
  // "All India" national rollup when the user explicitly picks it in the Focus bar (state→null).
  const allIndia = !state
  const st = allIndia ? 'All India' : (states.includes(state!) ? state! : 'Andhra Pradesh')
  // Default to Andhra Pradesh on first arrival, so the landing view is a state, not all-India.
  useEffect(() => { if (!state) setState('Andhra Pradesh') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPicked(null) }, [arena, st])  // close the report when the subject changes
  const mine = useMemo(() => (allIndia ? rows : rows.filter(r => r.s === st)), [rows, st, allIndia])
  // national vote share only exists for Lok Sabha (party_ge_nat); assembly has no national aggregate
  const myParty = useMemo(() => (allIndia ? (arena === 'GE' ? natGE : []) : party.filter(r => r.s === st)), [party, st, allIndia, arena, natGE])
  const years = useMemo(() => [...new Set(mine.map(r => r.y))].sort((a, b) => a - b), [mine])
  const latest = years[years.length - 1]
  // the global year drives the whole page (map, swing, alliance, close seats, grid),
  // clamped to an election this state actually held in the current arena
  const vy = years.includes(year) ? year : latest
  const vIdx = years.indexOf(vy)
  const prevY = vIdx > 0 ? years[vIdx - 1] : null
  const selected = useMemo(() => mine.filter(r => r.y === vy), [mine, vy])
  // a few recent assembly elections shipped winners-only (seats, but no candidate votes in
  // the source) → no vote share at all for that election. Flag it so charts don't fake it.
  const voteShareMissing = useMemo(() => {
    const ry = myParty.filter(r => r.y === vy)
    return ry.length > 0 && ry.every(r => r.v == null)
  }, [myParty, vy])

  // ── State scorecard: this state's most-recent Assembly AND Lok Sabha standing, side by side —
  // "how does each party do across BOTH arenas here", in one table (split-ticket at a glance).
  const scorecard = useMemo(() => {
    if (allIndia) return null
    const ae = partyAE.filter(r => r.s === st), ge = partyGE.filter(r => r.s === st)
    const aeY = ae.length ? Math.max(...ae.map(r => r.y)) : null
    const geY = ge.length ? Math.max(...ge.map(r => r.y)) : null
    if (aeY == null && geY == null) return null
    const aeRows = ae.filter(r => r.y === aeY), geRows = ge.filter(r => r.y === geY)
    type SRow = { p: string; a: string | null; aeS: number | null; aeV: number | null; geS: number | null; geV: number | null }
    const map = new Map<string, SRow>()
    const up = (p: string, a: string | null) => { let e = map.get(p); if (!e) { e = { p, a, aeS: null, aeV: null, geS: null, geV: null }; map.set(p, e) } return e }
    aeRows.forEach(r => { const e = up(r.p, r.a); e.aeS = r.wo ?? 0; e.aeV = r.v })
    geRows.forEach(r => { const e = up(r.p, r.a); e.geS = r.wo ?? 0; e.geV = r.v })
    const rows = [...map.values()]
      .filter(e => (e.aeS ?? 0) > 0 || (e.geS ?? 0) > 0 || (e.aeV ?? 0) >= 1 || (e.geV ?? 0) >= 1)
      .sort((x, y) => Math.max(y.geS ?? 0, y.aeS ?? 0) - Math.max(x.geS ?? 0, x.aeS ?? 0) || ((y.geV ?? 0) + (y.aeV ?? 0)) - ((x.geV ?? 0) + (x.aeV ?? 0)))
      .slice(0, 12)
    const aeTot = aeRows.reduce((s2, r) => s2 + (r.wo ?? 0), 0), geTot = geRows.reduce((s2, r) => s2 + (r.wo ?? 0), 0)
    const aeLead = [...map.values()].filter(e => (e.aeS ?? 0) > 0).sort((x, y) => (y.aeS ?? 0) - (x.aeS ?? 0))[0]
    const geLead = [...map.values()].filter(e => (e.geS ?? 0) > 0).sort((x, y) => (y.geS ?? 0) - (x.geS ?? 0))[0]
    return { aeY, geY, aeTot, geTot, rows, aeLead, geLead }
  }, [partyAE, partyGE, st, allIndia])

  // seats won + vote share % together, one party (or alliance) at a time.
  // seats come from the constituency rows (mine); vote share is pooled to the same key.
  const voteSeat = useMemo(() => {
    const alli = seatGroup === 'alliance'
    const keyOf = (a: string | null, p: string) => (alli ? allianceBase(a) : p)
    const colOf = (k: string, a: string | null) => (alli ? (ALLIANCE_COLORS[k] ?? '#64748b') : colorFor(k, a))
    const seatMap = new Map<string, Map<number, number>>()
    const aOf = new Map<string, string | null>()
    mine.forEach(r => {
      const k = keyOf(r.a, r.p); if (!aOf.has(k)) aOf.set(k, r.a)
      const m = seatMap.get(k) ?? new Map<number, number>(); m.set(r.y, (m.get(r.y) || 0) + 1); seatMap.set(k, m)
    })
    const shareMap = new Map<string, Map<number, number>>()
    myParty.forEach(r => {
      if (r.v == null) return
      const k = keyOf(r.a, r.p)
      const m = shareMap.get(k) ?? new Map<number, number>(); m.set(r.y, +((m.get(r.y) || 0) + r.v).toFixed(1)); shareMap.set(k, m)
    })
    const parties = [...seatMap.keys()]
      .map(k => ({ k, peak: Math.max(0, ...[...seatMap.get(k)!.values()]) }))
      .sort((a, b) => b.peak - a.peak).slice(0, alli ? 6 : 8)
      .map(({ k }) => ({ p: k, a: aOf.get(k) ?? null, color: colOf(k, aOf.get(k) ?? null) }))
    const seatsOf = (k: string) => years.map(y => seatMap.get(k)?.get(y) ?? (shareMap.get(k)?.has(y) ? 0 : null))
    const shareOf = (k: string) => years.map(y => shareMap.get(k)?.get(y) ?? null)
    return { parties, seatsOf, shareOf }
  }, [mine, myParty, years, seatGroup])

  // map slice: this state's selected election — or, for All India, every state that year
  const mapByState = useMemo(() => allIndia
    ? new Map(states.map(s => [s, mine.filter(r => r.s === s && r.y === vy)]))
    : new Map([[st, selected]]), [allIndia, states, mine, vy, st, selected])

  // ── Stronghold ↔ Swing classification (TN-deck targeting logic) ──
  const classed = useMemo(() => classifyState(rows, st, arena), [rows, st, arena])
  const classByJ = useMemo(() => {
    const m = new Map<number, SeatClass>()
    classed.seats.forEach(c => m.set(c.cur.j, c))
    return m
  }, [classed])
  const security = useMemo(() => {
    let safe = 0, lean = 0, swingN = 0
    const byParty = new Map<string, { a: string | null; n: number }>()
    classed.seats.forEach(c => {
      if (c.status === 'swing') { swingN++; return }
      if (c.status === 'safe') safe++; else lean++
      const e = byParty.get(c.party!) ?? { a: c.a, n: 0 }
      e.n++; byParty.set(c.party!, e)
    })
    const holds = [...byParty.entries()].map(([p, e]) => ({ p, a: e.a, n: e.n })).sort((x, y) => y.n - x.n)
    return { safe, lean, swingN, holds, total: classed.seats.length }
  }, [classed])
  const securityColorOf = useCallback((r: Seat) => {
    const c = classByJ.get(r.j)
    return !c ? '#64748b' : c.status === 'safe' ? SAFE : c.status === 'lean' ? LEAN : SWING
  }, [classByJ])
  const securitySubOf = useCallback((r: Seat) => {
    const c = classByJ.get(r.j)
    if (!c) return r.s
    if (c.status === 'swing') return `Swing seat — no party owns it (${classed.window.length} elections)`
    return `${c.party} ${c.status === 'safe' ? 'stronghold' : 'lean'} — won ${c.wins}/${c.total} of the last ${classed.window.length} elections`
  }, [classByJ, classed.window.length])
  const securityLegend = useMemo(() => [
    { label: 'Safe — one party always wins', color: SAFE, n: security.safe },
    { label: 'Lean — usually one party', color: LEAN, n: security.lean },
    { label: 'Swing — changes hands', color: SWING, n: security.swingN },
  ], [security])
  const swingSeats = useMemo(() => classed.seats.filter(c => c.status === 'swing'), [classed])
  // the actual stronghold seats (safe / lean), grouped by the holding party (largest first)
  const strongholdSeats = useMemo(() => {
    const rank = new Map(security.holds.map((h, i) => [h.p, i]))
    return classed.seats.filter(c => c.status !== 'swing' && c.party)
      .sort((a, b) => (rank.get(a.party!) ?? 99) - (rank.get(b.party!) ?? 99) || b.wins - a.wins || a.cur.c.localeCompare(b.cur.c))
  }, [classed, security])
  // contest matrix — who beats whom (winner × runner-up) in the selected election
  const contest = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    const involve = new Map<string, number>(); const aOf = new Map<string, string | null>()
    selected.forEach(s => {
      if (!s.q) return
      aOf.set(s.p, s.a)
      involve.set(s.p, (involve.get(s.p) || 0) + 1); involve.set(s.q, (involve.get(s.q) || 0) + 1)
      if (!m.has(s.p)) m.set(s.p, new Map())
      m.get(s.p)!.set(s.q, (m.get(s.p)!.get(s.q) || 0) + 1)
    })
    const ps = [...involve.keys()].sort((a, b) => (involve.get(b) || 0) - (involve.get(a) || 0)).slice(0, 7)
    const get = (w: string, r: string) => m.get(w)?.get(r) || 0
    const maxCell = Math.max(1, ...ps.flatMap(w => ps.map(r => (w === r ? 0 : get(w, r)))))
    let rival: { a: string; b: string; n: number } | null = null
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const n = get(ps[i], ps[j]) + get(ps[j], ps[i]); if (n && (!rival || n > rival.n)) rival = { a: ps[i], b: ps[j], n }
    }
    return { ps, get, aOf, maxCell, rival, rowTotal: (w: string) => ps.reduce((s, r) => s + get(w, r), 0), total: selected.filter(s => s.q).length }
  }, [selected])

  // ── Performance by reservation category (GEN / SC / ST) for the selected year ──
  const reservation = useMemo(() => {
    // reservation is back-filled in the extract; show every category present (incl. Sikkim's
    // BL and any residual 'NA') so none are silently dropped.
    const ORDER = ['GEN', 'SC', 'ST', 'BL', 'SAN', 'NA']
    const present = [...new Set(selected.map(r => r.r ?? 'NA'))]
    const cats = [...ORDER.filter(c => present.includes(c)), ...present.filter(c => !ORDER.includes(c)).sort()]
    const byParty = new Map<string, { a: string | null; byCat: Record<string, number> }>()
    selected.forEach(r => {
      const cat = r.r ?? 'NA'
      const e = byParty.get(r.p) ?? { a: r.a, byCat: {} }
      e.byCat[cat] = (e.byCat[cat] || 0) + 1
      byParty.set(r.p, e)
    })
    const top = [...byParty.entries()]
      .map(([p, e]) => ({ p, a: e.a, byCat: e.byCat, total: Object.values(e.byCat).reduce((s2, x) => s2 + x, 0) }))
      .sort((x, y) => y.total - x.total).slice(0, 6)
    const catTotals = Object.fromEntries(cats.map(c => [c, selected.filter(r => (r.r ?? 'NA') === c).length]))
    return {
      cats, catTotals,
      option: {
        ...baseOpt,
        tooltip: { ...baseOpt.tooltip, trigger: 'axis' },
        legend: { ...baseOpt.legend, data: top.map(t => t.p) },
        grid: { ...baseOpt.grid, top: 28 },
        xAxis: catAxis(cats.map(c => `${c} (${catTotals[c]})`)),
        yAxis: valAxis(),
        series: top.map(t => ({
          name: t.p, type: 'bar', barMaxWidth: 26,
          data: cats.map(c => t.byCat[c] || 0),
          itemStyle: { color: colorFor(t.p, t.a), borderRadius: [3, 3, 0, 0] },
        })),
      },
    }
  }, [selected])


  // swing vs previous election (change in vote share)
  const swingData = useMemo(() => {
    if (!prevY) return null
    if (arena === 'AE' && !comparableAE(st, prevY, vy)) return 'incomparable' as const
    const sw = swing(party, st, vy, prevY, 1.5).filter(r => Math.abs(r.d) >= 0.3).slice(0, 14)
    if (!sw.length) return null
    // axis padding so the from→to labels at each bar's end never clip
    const ds = sw.map(r => +r.d.toFixed(1))
    const lo = Math.min(0, ...ds), hi = Math.max(0, ...ds), pad = Math.max(6, (hi - lo) * 0.32)
    type SwDatum = { value: number; from: number | null; to: number | null; clr: string }
    const arenaLbl = arena === 'GE' ? 'Lok Sabha' : 'Assembly'
    return {
      ...baseOpt, legend: undefined,
      tooltip: {
        ...baseOpt.tooltip, trigger: 'item', confine: true,
        backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0, padding: 0,
        extraCssText: 'box-shadow:none;',
        formatter: (q: { name: string; value: number; data: SwDatum }) => {
          const c = q.data.clr, d = q.value, up = d > 0.05, down = d < -0.05
          const arrow = up ? '▲' : down ? '▼' : '▬', word = up ? 'gained' : down ? 'lost' : 'held'
          const f = q.data.from != null ? q.data.from.toFixed(1) : '–', t = q.data.to != null ? q.data.to.toFixed(1) : '–'
          const pct = '<span style="font-size:11px;font-weight:600;color:rgb(var(--s400));">%</span>'
          return `<div style="min-width:212px;padding:13px 15px 12px;border-radius:14px;font-family:Outfit,sans-serif;`
            + `background:linear-gradient(158deg,rgb(var(--s800)),rgb(var(--s900)));border:1px solid rgb(var(--s500) / .28);box-shadow:0 20px 46px -14px rgb(0 0 0 / .6);">`
            + `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px;">`
            +   `<div style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;border-radius:3px;background:${c};box-shadow:0 0 9px ${c}aa;"></span>`
            +   `<span style="font-size:14px;font-weight:700;color:rgb(var(--s50));">${q.name}</span></div>`
            +   `<span style="font-size:9.5px;font-weight:600;letter-spacing:.7px;text-transform:uppercase;color:rgb(var(--s300));padding:2px 8px;border-radius:999px;background:rgb(var(--s500) / .2);">${arenaLbl}</span>`
            + `</div>`
            + `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;">`
            +   `<div><div style="font-size:10px;color:rgb(var(--s400));margin-bottom:3px;">${prevY}</div><div style="font-size:19px;font-weight:700;line-height:1;color:rgb(var(--s200));font-family:'Plus Jakarta Sans',sans-serif;">${f}${pct}</div></div>`
            +   `<div style="font-size:14px;color:rgb(var(--s500));padding-bottom:3px;">→</div>`
            +   `<div style="text-align:right;"><div style="font-size:10px;color:rgb(var(--s400));margin-bottom:3px;">${vy}</div><div style="font-size:19px;font-weight:700;line-height:1;color:rgb(var(--s50));font-family:'Plus Jakarta Sans',sans-serif;">${t}${pct}</div></div>`
            + `</div>`
            + `<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgb(var(--s500) / .22);display:flex;align-items:center;gap:8px;">`
            +   `<span style="display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:700;font-family:'Plus Jakarta Sans',sans-serif;color:${c};background:${c}1f;border:1px solid ${c}3d;padding:3px 9px;border-radius:999px;"><span style="font-size:8px;">${arrow}</span>${d > 0 ? '+' : ''}${d.toFixed(1)}%</span>`
            +   `<span style="font-size:11px;color:rgb(var(--s400));">${word} vote share</span>`
            + `</div></div>`
        },
      },
      grid: { left: 8, right: 16, top: 8, bottom: 4, containLabel: true },
      xAxis: valAxis((v: number) => v + '%', { min: Math.floor(lo - pad), max: Math.ceil(hi + pad) }),
      yAxis: catAxis(sw.map(r => r.p).reverse()),
      series: [{
        type: 'bar', barWidth: 12,
        data: sw.map(r => { const clr = colorFor(r.p, r.a); return {
          value: +r.d.toFixed(1), from: r.from, to: r.to, clr,
          itemStyle: { color: clr, borderRadius: 3 },
          label: { position: r.d >= 0 ? 'right' : 'left' as const },
        } }).reverse(),
        label: {
          show: true, fontSize: 10,
          formatter: (q: { value: number; data: SwDatum }) =>
            (q.data.from != null && q.data.to != null ? `{s|${q.data.from.toFixed(1)}→${q.data.to.toFixed(1)}  }` : '') + `{d|${q.value > 0 ? '+' : ''}${q.value}%}`,
          rich: { d: { color: AXIS, fontSize: 10, fontWeight: 700 }, s: { color: MUTED, fontSize: 9 } },
        },
      }],
    }
  }, [party, st, vy, prevY, arena])

  // turnout per election — prefer official state-level turnout (full coverage incl. 2023-26),
  // fall back to mean of seat turnouts. Selected year highlighted.
  const turnout = useMemo(() => {
    const src = turn[arena] ?? {}
    const t = years.map(y => {
      const official = src[`${st}|${y}`]
      if (official != null) return official
      const v = mine.filter(r => r.y === y && r.t != null)
      return v.length ? +(v.reduce((s2, r) => s2 + (r.t ?? 0), 0) / v.length).toFixed(1) : null
    })
    return {
      ...baseOpt, legend: undefined,
      tooltip: { ...baseOpt.tooltip, trigger: 'axis', valueFormatter: (v: number) => (v == null ? 'n/a' : v + '%') },
      xAxis: catAxis(years), yAxis: valAxis(pctFmt, { scale: true }),
      series: [{
        name: 'Turnout', type: 'line', symbolSize: 6, connectNulls: true, data: t,
        lineStyle: { width: 2.5, color: '#38bdf8' }, itemStyle: { color: '#38bdf8' },
        areaStyle: { color: 'rgba(56,189,248,0.08)' },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: '#c99a2e', type: 'dashed', width: 1 }, data: [{ xAxis: String(vy) }], label: { show: false } },
        label: { show: true, color: AXIS, fontSize: 10, formatter: '{c}' },
      }],
    }
  }, [mine, years, vy, turn, arena, st])

  const close = useMemo(() => selected.filter(r => r.m != null && r.m < band), [selected, band])
  // close-seat battlegrounds: who is edging out whom among the seats inside the margin band
  const closeBattles = useMemo(() => {
    const pair = new Map<string, { a: string; b: string; aw: number; bw: number }>()
    close.forEach(s => {
      if (!s.q) return
      const [a, b] = s.p < s.q ? [s.p, s.q] : [s.q, s.p]
      const e = pair.get(a + '|' + b) ?? { a, b, aw: 0, bw: 0 }
      if (s.p === a) e.aw++; else e.bw++
      pair.set(a + '|' + b, e)
    })
    const rows = [...pair.values()].map(e => ({ ...e, n: e.aw + e.bw })).sort((x, y) => y.n - x.n).slice(0, 8)
    const max = Math.max(1, ...rows.flatMap(r => [r.aw, r.bw]))
    return { rows, top: rows[0], max }
  }, [close])
  // clicking a battleground bar filters the close-seats table to just that matchup
  const closeShown = useMemo(() => !battleSel ? close
    : close.filter(s => s.q && ((s.p === battleSel.a && s.q === battleSel.b) || (s.p === battleSel.b && s.q === battleSel.a))), [close, battleSel])
  // clicking a "who beats whom" cell lists the seats where that winner beat that runner-up
  const contestSeats = useMemo(() => contestSel ? selected.filter(s => s.p === contestSel.w && s.q === contestSel.r) : [], [selected, contestSel])
  useEffect(() => { setBattleSel(null); setContestSel(null) }, [st, vy, arena])   // reset selections when the election changes
  const closeCols: Col<Seat>[] = [
    { key: 'n', label: '#', get: r => r.n, align: 'right', width: '36px' },
    { key: 'c', label: 'Constituency', get: r => r.c, render: r => tc(r.c) },
    { key: 'p', label: 'Winner', get: r => r.p, render: r => <span><Dot color={colorFor(r.p, r.a)} />{r.p}</span> },
    { key: 'q', label: 'Runner-up', get: r => r.q, render: r => r.q ? <span><Dot color={colorFor(r.q)} />{r.q}</span> : '–' },
    { key: 'm', label: 'Margin%', get: r => r.m, align: 'right', render: r => r.m?.toFixed(1) },
    { key: 't', label: 'Turnout%', get: r => r.t, align: 'right', render: r => r.t?.toFixed(1) ?? '–' },
  ]

  return (
    <div>
      <StickyControls>
        <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold leading-tight tracking-tight truncate">{st}</h2>
            {/* the strapline just repeats the Focus bar + breadcrumb on a phone */}
            <div className="kicker hidden sm:block">{arena === 'AE' ? 'Assembly' : 'Lok Sabha'} deep dive · change region/arena above</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="hidden sm:inline">Election</span>
            <Select value={String(vy)} onChange={v => setYear(+v)} options={[...years].reverse().map(String)} width="w-24" />
          </div>
          <span className="hidden sm:inline text-sm text-muted">{years.length} elections · {selected.length} seats</span>
          {!allIndia && <button onClick={() => navTo('/change')} className="ml-auto inline-flex items-center min-h-[32px] py-1.5 sm:min-h-0 sm:py-0 text-xs text-gold hover:text-gold underline decoration-dotted decoration-gold/40 underline-offset-2 transition-colors"><span className="sm:hidden">Changes →</span><span className="hidden sm:inline">What changed in {st} →</span></button>}
        </div>
      </StickyControls>

      {/* pale amber-200 vanished on the light canvas — readable() keeps the hue and clears AA on both themes */}
      {voteShareMissing && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-2.5 text-[12.5px]" style={{ color: readable('#f59e0b', mode) }}>
          <span className="shrink-0">⚠</span>
          <span><b>{st} {vy}</b> shipped as a winners-only result — its candidate votes aren’t in the source data, so <b>vote share isn’t available for this election</b>. Seat counts, the map and reservation splits are complete; the vote-share line and the swing chart skip {vy}. Pick an earlier election above to see vote share.</span>
        </div>
      )}

      {/* State scorecard — Assembly + Lok Sabha side by side (the "both arenas at one place" view) */}
      {!allIndia && scorecard && (
        <ChartCard className="mb-4"
          title={<>State scorecard · Assembly {scorecard.aeY ?? '–'} vs Lok Sabha {scorecard.geY ?? '–'} <Info>Each party's most recent Assembly result beside its most recent Lok Sabha result in {st} — seats and vote share in BOTH arenas at once, whatever the toggle above is set to. The “LS − AE” gap exposes split-ticket voting: many people back a national party for Parliament and a regional one for the Assembly.</Info></>}
          note={`${st}: latest Assembly (${scorecard.aeY ?? '–'} · ${scorecard.aeTot} seats) beside latest Lok Sabha (${scorecard.geY ?? '–'} · ${scorecard.geTot} seats). “LS − AE” = Lok Sabha vote share minus Assembly vote share (＋ green = the party runs stronger nationally than in the state).`}>
          {scorecard.aeLead && scorecard.geLead && (
            <div className="text-[12.5px] text-muted mb-3">
              {scorecard.aeLead.p === scorecard.geLead.p
                ? <><b style={{ color: readable(colorFor(scorecard.aeLead.p, scorecard.aeLead.a), mode) }}>{scorecard.aeLead.p}</b> leads {st} in <b className="text-ink">both</b> arenas — the Assembly (<b className="text-ink">{scorecard.aeLead.aeS}</b> seats) and Lok Sabha (<b className="text-ink">{scorecard.geLead.geS}</b>).</>
                : <><b style={{ color: readable(colorFor(scorecard.aeLead.p, scorecard.aeLead.a), mode) }}>{scorecard.aeLead.p}</b> leads the Assembly (<b className="text-ink">{scorecard.aeLead.aeS}</b> seats) while <b style={{ color: readable(colorFor(scorecard.geLead.p, scorecard.geLead.a), mode) }}>{scorecard.geLead.p}</b> leads Lok Sabha (<b className="text-ink">{scorecard.geLead.geS}</b>) — a split-ticket state.</>}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px] min-w-[420px] sm:text-[12.5px] sm:min-w-[560px]">
              <thead>
                <tr className="text-muted">
                  <th className="text-left font-medium py-1 pr-2 align-bottom" rowSpan={2}>Party</th>
                  <th className="text-center font-semibold px-2 pb-1 text-muted border-b border-white/[0.08]" colSpan={2}>Assembly · {scorecard.aeY ?? '–'}</th>
                  <th className="text-center font-semibold px-2 pb-1 text-muted border-b border-white/[0.08]" colSpan={2}>Lok Sabha · {scorecard.geY ?? '–'}</th>
                  <th className="text-right font-medium pl-2 align-bottom" rowSpan={2} title="Lok Sabha vote share minus Assembly vote share">LS − AE</th>
                </tr>
                <tr className="text-muted text-[11px] uppercase tracking-wide">
                  <th className="text-right font-medium px-2 pb-1">Seats</th><th className="text-right font-medium px-2 pb-1">Vote%</th>
                  <th className="text-right font-medium px-2 pb-1">Seats</th><th className="text-right font-medium px-2 pb-1">Vote%</th>
                </tr>
              </thead>
              <tbody>
                {scorecard.rows.map(r => {
                  const gap = (r.geV != null && r.aeV != null) ? +(r.geV - r.aeV).toFixed(1) : null
                  return (
                    <tr key={r.p} className="border-t border-white/[0.05] hover:bg-white/[0.03] transition-colors">
                      <td className="py-1.5 pr-2 whitespace-nowrap"><Dot color={colorFor(r.p, r.a)} /><b className="text-ink">{r.p}</b></td>
                      <td className="text-right px-2 tabular-nums text-ink font-semibold">{r.aeS != null ? r.aeS : '–'}</td>
                      <td className="text-right px-2 tabular-nums text-ink">{r.aeV != null ? r.aeV.toFixed(1) : '–'}</td>
                      <td className="text-right px-2 tabular-nums text-ink font-semibold">{r.geS != null ? r.geS : '–'}</td>
                      <td className="text-right px-2 tabular-nums text-ink">{r.geV != null ? r.geV.toFixed(1) : '–'}</td>
                      <td className="text-right pl-2 tabular-nums font-semibold" style={{ color: gap == null ? 'rgb(var(--s500))' : readable(gap > 0.3 ? '#16a34a' : gap < -0.3 ? '#dc2626' : '#64748b', mode) }}>
                        {gap == null ? '–' : (gap > 0 ? '+' : '') + gap}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}

      {/* Winner matrix — every constituency × every election, filled with the winning party's colour */}
      {!allIndia && (
        <ChartCard className="mb-4"
          title={<>{st} deep dive · winner matrix <Info>Each row is one constituency, each column one election, and every cell is painted the winning party's colour — so a seat's entire history reads as a colour band. Switch between assembly (AC) and parliamentary (PC) seats, and search for any constituency.</Info></>}>
          <WinnerMatrix state={st} onPick={(seat, all, arena) => setMPick({ seat, all, arena })} />
        </ChartCard>
      )}

      {/* Candidate positions — top 5 per seat, filterable to one parliament seat */}
      {!allIndia && (
        <ChartCard className="mb-4"
          title={<>Who stood, and where they finished · {st} <Info>The top five candidates in every constituency — name, party, votes and vote share. Choose a parliament seat to narrow it to just the assembly seats inside it, and hover any candidate for the margin, deposit status and turnout behind the number.</Info></>}>
          <PositionsTable state={st} />
        </ChartCard>
      )}

      {/* Big seat map on the left; swing + strongholds stacked on the right (map stretches to match) */}
      {allIndia ? (
        <ChartCard className="mb-4" title={`Seat map · All India · ${vy}`}>
          <ChoroplethMap key={arena + st + vy + 'w'} byState={mapByState} arena={arena} activeYear={vy} height="h-[280px] sm:h-[460px]"
            onPick={seat => { if (seat) setPicked(seat) }} />
          <div className="mt-1.5 text-[11.5px] text-muted">Click any seat for its full constituency report.</div>
        </ChartCard>
      ) : (
      <div className="grid lg:grid-cols-2 gap-4 mb-4 lg:items-stretch">
        <ChartCard className="flex flex-col" title={`Seat map · ${mapColor === 'security' ? `safe vs swing (${classed.window.length} elections)` : mapColor === 'alliance' ? `${vy} · by alliance` : vy}`}
          note={mapColor === 'security'
            ? <>Green = a party always wins here (stronghold). Red = the seat changes hands (swing — where the contest is live). <Info>Computed over this state's comparable elections in the current arena.</Info></>
            : undefined}>
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
            Colour
            <Seg options={[{ v: 'winner', label: 'Winner' }, { v: 'alliance', label: 'Alliance' }, { v: 'security', label: 'Safe vs Swing' }]} value={mapColor} onChange={v => setMapColor(v as 'winner' | 'alliance' | 'security')} />
          </div>
          <div className="flex-1 min-h-[260px] lg:min-h-[400px]">
            <ChoroplethMap key={arena + st + vy + mapColor} byState={mapByState} arena={arena} activeYear={vy} focusState={st} height="h-full"
              mode={mapColor === 'alliance' ? 'alliance' : 'winner'}
              colorOf={mapColor === 'security' ? securityColorOf : undefined}
              subOf={mapColor === 'security' ? securitySubOf : undefined}
              legendTitle={mapColor === 'security' ? 'Seat security' : undefined}
              legendItems={mapColor === 'security' ? securityLegend : undefined}
              onPick={seat => { if (seat) setPicked(seat) }} />
          </div>
          <div className="mt-1.5 text-[11.5px] text-muted">Click any seat for its full constituency report.</div>
        </ChartCard>

        <div className="flex flex-col gap-4 min-w-0">
          <ChartCard title={`Swing ${prevY ?? '–'} → ${vy} · change in vote share`}
            note={swingData === 'incomparable' ? undefined : `Each bar = ${vy} vote share − ${prevY} vote share (e.g. 44.0% → 46.2% = +2.2%). Positive = gained share. Parties under 1.5% both times hidden.`}>
            {swingData === 'incomparable'
              ? <div className="h-[150px] sm:h-[280px] flex items-center justify-center text-sm text-center px-8" style={{ color: readable('#f59e0b', mode) }}>
                  ⚠ {prevY} and {vy} are on different delimitations in {st} — swing is not defined (metrics catalog caveat 4).
                </div>
              : swingData
                ? <Chart option={swingData} style={{ height: 280 }} notMerge />
                : voteShareMissing
                  ? <div className="h-[150px] sm:h-[280px] flex items-center justify-center text-sm text-center px-8" style={{ color: readable('#f59e0b', mode) }}>Vote share isn’t in the source for {st} {vy} (winners-only), so swing vs {prevY} can’t be computed. Select an earlier election above.</div>
                  : <div className="h-[150px] sm:h-[280px] flex items-center justify-center text-muted text-sm">No earlier election before {vy}</div>}
          </ChartCard>

          {/* Stronghold ↔ Swing: which seats are locked up and which are actually in play */}
          <ChartCard
            title={<>Stronghold &amp; swing seats <Info>A stronghold is a seat one party keeps winning; a swing seat changes hands. Swing seats are where elections are decided.</Info></>}
            note={`Based on this state's last ${classed.window.length} ${arena === 'AE' ? 'assembly' : 'Lok Sabha'} elections (${classed.window.join(', ') || '—'}).`}>
            {security.total ? (
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2.5">
                  {/* emerald-200/red-200 are unreadable on the cream canvas — readable() clears AA on both themes */}
                  <span className="px-2.5 py-1 rounded-lg border border-emerald-400/25 bg-white/[0.03] text-[11.5px]" style={{ color: readable(SAFE, mode) }}>{security.safe + security.lean} stronghold</span>
                  <span className="px-2.5 py-1 rounded-lg border border-red-400/25 bg-white/[0.03] text-[11.5px]" style={{ color: readable('#dc2626', mode) }}>{security.swingN} swing</span>
                  {security.holds.length > 0 && <span className="text-muted text-[11px]">held by</span>}
                  {security.holds.map(h => (
                    <span key={h.p} className="text-[11.5px] text-muted whitespace-nowrap"><Dot color={colorFor(h.p, h.a)} />{h.p} <b className="text-ink tabular-nums">{h.n}</b></span>
                  ))}
                </div>
                <div className="mb-2">
                  <Seg options={[{ v: 'hold', label: `Stronghold seats (${security.safe + security.lean})` }, { v: 'swing', label: `Swing seats (${security.swingN})` }]} value={holdTab} onChange={v => setHoldTab(v as 'hold' | 'swing')} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-0.5 max-h-[360px] overflow-auto pr-1 content-start">
                  {holdTab === 'swing' ? <>
                    {swingSeats.map(c => (
                      <div key={c.cur.j} className="flex items-center gap-2 text-[11px] border-b border-white/[0.05] py-1">
                        <span className="w-28 shrink-0 truncate">{tc(c.cur.c)}</span>
                        <span className="flex items-center gap-1 flex-wrap">
                          {c.seq.map((w, i) => (
                            <span key={i} title={`${w.y}: ${w.p}`} className="inline-flex items-center"><Dot color={colorFor(w.p, w.a)} /></span>
                          ))}
                        </span>
                        <span className="ml-auto text-muted">now {c.cur.p}</span>
                      </div>
                    ))}
                    {!swingSeats.length && <div className="text-muted text-xs py-4 text-center">No swing seats — every seat has a clear owner.</div>}
                  </> : <>
                    {strongholdSeats.map(c => (
                      <div key={c.cur.j} className="flex items-center gap-2 text-[11px] border-b border-white/[0.05] py-1">
                        <Dot color={colorFor(c.party!, c.a)} />
                        <span className="w-28 shrink-0 truncate">{tc(c.cur.c)}</span>
                        <span className="text-muted">{c.party}</span>
                        <span className="ml-auto text-muted tabular-nums">won {c.wins}/{c.total} · {c.status === 'safe' ? 'safe' : 'lean'}</span>
                      </div>
                    ))}
                    {!strongholdSeats.length && <div className="text-muted text-xs py-4 text-center">No strongholds — every seat is competitive.</div>}
                  </>}
                </div>
              </div>
            ) : (
              <div className="h-[120px] flex items-center justify-center text-muted text-sm">Need at least two comparable elections to classify seats.</div>
            )}
          </ChartCard>
        </div>
      </div>
      )}

      <ChartCard className="mb-4"
        title={<>Vote share % + seats won — who is rising, who is fading <Info>Columns are the seats a party (or alliance) won; the line is its {allIndia ? 'national' : 'statewide'} vote share. Reading them together shows whether votes are turning into seats.</Info></>}
        note={allIndia && arena === 'AE'
          ? 'National assembly view — columns = seats won across every state that held an election that year. Assembly vote share is recorded per state, not nationally, so there is no vote line here; switch to Lok Sabha for the national vote line.'
          : 'Columns = seats won (left axis); line = vote share % (right axis), on one timeline. All parties show by default — click a chip to hide/show it (or All / None); switch Party / Alliance to pool pre-poll allies. A few recent winners-only elections have no candidate votes in the source, so the vote line skips those years.'}>
        <VoteSeatChart years={years} parties={voteSeat.parties} seatsOf={voteSeat.seatsOf} shareOf={voteSeat.shareOf} height={360}
          extra={<Seg options={[{ v: 'party', label: 'Party' }, { v: 'alliance', label: 'Alliance' }]} value={seatGroup} onChange={v => setSeatGroup(v as 'party' | 'alliance')} />} />
      </ChartCard>

      {/* Who beats whom — the rivalry / "which party impacts which" matrix */}
      <ChartCard className="mb-4"
        title={<>Who beats whom · {vy} <Info>Each cell counts the seats where the row party won and the column party was the runner-up (the challenger it beat). The biggest off-diagonal pair is the state's main contest — i.e. which party is directly impacting which.</Info></>}
        note="Row = winner, column = runner-up. Cell colour is the winner's colour (deeper = more seats). Read across a row to see who a party beats; read down a column to see who keeps beating that party.">
        {contest.ps.length > 1 ? (
          <div>
            {contest.rival && (
              <div className="text-[12.5px] text-muted mb-3">
                Main contest: <b style={{ color: readable(colorFor(contest.rival.a), mode) }}>{contest.rival.a}</b> vs <b style={{ color: readable(colorFor(contest.rival.b), mode) }}>{contest.rival.b}</b> — they finished 1-2 in <b className="text-ink">{contest.rival.n}</b> of {contest.total} decided seats.
              </div>
            )}
            <div className="flex flex-col xl:flex-row gap-4 xl:items-start">
              <div className="overflow-auto xl:shrink-0">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="p-2 text-left text-muted font-medium whitespace-nowrap">won ↓ / runner-up →</th>
                      {contest.ps.map(r => <th key={r} className="p-2 text-center font-medium whitespace-nowrap"><Dot color={colorFor(r)} />{r}</th>)}
                      <th className="p-2 text-right text-muted font-medium">won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contest.ps.map(w => (
                      <tr key={w}>
                        <td className="p-2 whitespace-nowrap font-medium"><Dot color={colorFor(w, contest.aOf.get(w))} />{w}</td>
                        {contest.ps.map(r => {
                          const n = w === r ? 0 : contest.get(w, r)
                          const isSel = !!contestSel && contestSel.w === w && contestSel.r === r
                          const frac = n ? 0.14 + 0.62 * (n / contest.maxCell) : 0
                          const alpha = n ? Math.round(frac * 255).toString(16).padStart(2, '0') : ''
                          const cellHue = colorFor(w, contest.aOf.get(w))
                          return <td key={r} onClick={() => { if (n > 0) setContestSel(isSel ? null : { w, r }) }}
                            className={`p-2 text-center tabular-nums ${n > 0 ? 'cursor-pointer' : ''} ${isSel ? 'ring-2 ring-inset ring-white/80' : n > 0 ? 'hover:ring-2 hover:ring-inset hover:ring-white/30' : ''}`}
                            style={{
                              background: n ? cellHue + alpha : (w === r ? 'rgba(148,163,184,0.05)' : undefined),
                              // the count sits ON the party tint, so pick ink by the blended fill, not the card
                              color: n ? inkOn(cellHue, frac, mode) : undefined,
                            }}>{w === r ? '·' : (n || '')}</td>
                        })}
                        <td className="p-2 text-right tabular-nums text-muted">{contest.rowTotal(w)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="xl:flex-1 xl:min-w-0 xl:self-stretch xl:border-l xl:border-white/[0.06] xl:pl-4">
                {contestSel ? (
                  <div className="border-t border-white/[0.06] pt-3 xl:border-t-0 xl:pt-0">
                    <div className="text-[12.5px] mb-2"><b style={{ color: readable(colorFor(contestSel.w, contest.aOf.get(contestSel.w)), mode) }}>{contestSel.w}</b> beat <b style={{ color: readable(colorFor(contestSel.r), mode) }}>{contestSel.r}</b> in <b className="text-ink">{contestSeats.length}</b> seat{contestSeats.length !== 1 ? 's' : ''} · {vy} <button onClick={() => setContestSel(null)} className="ml-1 text-muted underline decoration-dotted hover:text-ink">clear</button></div>
                    <div className="overflow-x-auto -mx-1 px-1">
                      <SortTable rows={contestSeats} cols={closeCols} defaultSort="m" initialDir="asc" maxH={320} />
                    </div>
                  </div>
                ) : <div className="text-[11.5px] text-muted pt-1 xl:pt-2">Click any coloured cell to list the seats where that party beat that runner-up.</div>}
              </div>
            </div>
          </div>
        ) : <div className="h-[120px] grid place-items-center text-muted text-sm">Not enough contested seats to map rivalries here.</div>}
      </ChartCard>

      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Turnout by election" note="Official state turnout (assembly: full coverage incl. 2023–26); falls back to mean of seat turnouts where unavailable. Dashed line = selected election.">
          <Chart option={turnout} style={{ height: 280 }} notMerge />
        </ChartCard>

        <ChartCard title={<>Seats won by reservation category · {vy} <Info>Some seats are reserved for Scheduled Castes (SC) or Tribes (ST); the rest are General (GEN). Parties often perform very differently across these.</Info></>}
          note="Grouped bars (not stacked): how each party's wins split across General / SC / ST seats this election.">
          {reservation.cats.length > 1
            ? <Chart option={reservation.option} style={{ height: 280 }} notMerge />
            : <div className="h-[280px] flex items-center justify-center text-muted text-sm">All seats are the same category here.</div>}
        </ChartCard>

        <ChartCard className="lg:col-span-2" title={`Close seats · ${vy}`} note={`${close.length} seats decided by under ${band}% — the live battleground.`}>
          <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
            Margin band
            <Seg options={[{ v: '1', label: '<1%' }, { v: '2', label: '<2%' }, { v: '3', label: '<3%' }, { v: '5', label: '<5%' }]}
              value={String(band)} onChange={v => setBand(+v)} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <div>
              <div className="text-xs text-muted mb-2 flex items-center gap-1">Who’s edging out whom in the close seats <Info>Among the seats above (margin under {band}%), the head-to-head pairs that decided the most knife-edge contests. The wider bar won more of those tight seats.</Info></div>
              {closeBattles.rows.length ? (
                <div>
                  {closeBattles.top && (
                    <div className="text-[12px] text-muted mb-3">Tightest battleground: <b style={{ color: readable(colorFor(closeBattles.top.a), mode) }}>{closeBattles.top.a}</b> vs <b style={{ color: readable(colorFor(closeBattles.top.b), mode) }}>{closeBattles.top.b}</b> — <b className="text-ink">{closeBattles.top.n}</b> seats under {band}%.</div>
                  )}
                  <div className="space-y-2">
                    {closeBattles.rows.map(r => {
                      const aLead = r.aw >= r.bw
                      const sel = !!battleSel && ((battleSel.a === r.a && battleSel.b === r.b) || (battleSel.a === r.b && battleSel.b === r.a))
                      return (
                        <div key={r.a + r.b} onClick={() => setBattleSel(sel ? null : { a: r.a, b: r.b })}
                          className={`grid grid-cols-[3.5rem_1fr_3.5rem] sm:grid-cols-[5.25rem_1fr_5.25rem] items-center gap-1.5 text-[11px] cursor-pointer rounded-md px-1.5 py-2 sm:py-1 -mx-1.5 transition-colors ${sel ? 'bg-white/[0.08] ring-1 ring-white/25' : 'hover:bg-white/[0.04]'}`}
                          title={`${r.a} ${r.aw} – ${r.bw} ${r.b} · click to filter the table`}>
                          <div className="flex items-center justify-end gap-1.5 min-w-0">
                            <span className="truncate font-semibold" style={{ color: readable(colorFor(r.a), mode) }}>{r.a}</span>
                            <span className={`tabular-nums w-4 text-right ${aLead ? 'font-bold text-ink' : 'text-muted'}`}>{r.aw}</span>
                          </div>
                          <div className="flex items-center">
                            <div className="flex-1 flex justify-end"><div className="h-4 rounded-l-md transition-all" style={{ width: `${(r.aw / closeBattles.max) * 100}%`, background: colorFor(r.a), opacity: aLead ? 1 : 0.5 }} /></div>
                            <div className="w-px self-stretch bg-white/20" />
                            <div className="flex-1 flex justify-start"><div className="h-4 rounded-r-md transition-all" style={{ width: `${(r.bw / closeBattles.max) * 100}%`, background: colorFor(r.b), opacity: !aLead ? 1 : 0.5 }} /></div>
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`tabular-nums w-4 ${!aLead ? 'font-bold text-ink' : 'text-muted'}`}>{r.bw}</span>
                            <span className="truncate font-semibold" style={{ color: readable(colorFor(r.b), mode) }}>{r.b}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 text-[11.5px] text-muted leading-snug">Each row = a head-to-head in the close seats. The longer, brighter bar won more of those knife-edge seats; the centre line is the tie point. <b className="text-muted">Click a bar</b> to filter the table to that matchup.</div>
                </div>
              ) : <div className="h-[160px] grid place-items-center text-muted text-sm">No close seats in this band — widen it above.</div>}
            </div>
            <div>
              {battleSel && (
                <div className="text-[11px] text-muted mb-2">Showing only <b style={{ color: readable(colorFor(battleSel.a), mode) }}>{battleSel.a}</b> ⟷ <b style={{ color: readable(colorFor(battleSel.b), mode) }}>{battleSel.b}</b> · {closeShown.length} of {close.length} close seats <button onClick={() => setBattleSel(null)} className="ml-1 text-muted underline decoration-dotted hover:text-ink">clear</button></div>
              )}
              <div className="overflow-x-auto -mx-1 px-1">
                <SortTable rows={closeShown} cols={closeCols} defaultSort="m" initialDir="asc" maxH={360} />
              </div>
            </div>
          </div>
        </ChartCard>
      </div>
      {picked && <SeatDrawer seat={picked} all={rows} arena={arena} onClose={() => setPicked(null)} />}
      {mPick && <SeatDrawer seat={mPick.seat} all={mPick.all} arena={mPick.arena} onClose={() => setMPick(null)} />}
    </div>
  )
}
