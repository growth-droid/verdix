import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { Seat } from '../lib/data'
import { seatHistories, seatKey } from '../lib/analysis'
import { comparable } from '../lib/joins'
import { colorFor, readable } from '../lib/colors'
import { baseOpt, catAxis, valAxis } from '../lib/theme'
import { useFilters, useTheme } from '../store'
import { Chart, Dot } from './ui'

const tc = (s: string | null) => (s ? s.toLowerCase().replace(/(^|[\s(\-./])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()) : null)

/**
 * Full-screen constituency / parliament briefing — a consultant-grade strategic read of a single
 * seat: executive summary, KPI band, the mandate, competitive structure, multi-chart trajectory,
 * volatility + incumbency, swing-to-flip math, full history, and a computed recommendation.
 * Neutral BLACK canvas (not blue) per owner preference; rendered through a portal so `fixed` anchors
 * to the viewport (the route's animate-fadeUp transform would otherwise trap it).
 */
export default function SeatDrawer({ seat, all, arena, onClose }:
  { seat: Seat; all: Seat[]; arena: 'AE' | 'GE'; onClose: () => void }) {
  const nav = useNavigate()
  const setFocus = useFilters(s => s.setState)
  const mode = useTheme()
  const hist = useMemo(() => seatHistories(all).get(seatKey(seat)) ?? [seat], [all, seat])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

  // ── neutral palette (black in dark, white in light — never blue) ──
  // light: faint/eyebrow/axis lifted to zinc-600 (#52525b) — the pale #a1a1aa/#71717a greys
  // failed contrast on the white panel for eyebrows, KPI labels and 9–10px chart labels.
  const C = mode === 'light'
    ? { bg: '#ffffff', panel: '#ffffff', panel2: '#f7f7f8', line: 'rgba(0,0,0,0.10)', text: '#0a0a0a', sub: '#3f3f46', faint: '#52525b', eyebrow: '#52525b', axis: '#52525b', split: 'rgba(0,0,0,0.06)', warn: '#a16207' }
    : { bg: '#000000', panel: '#0c0c0e', panel2: '#141417', line: 'rgba(255,255,255,0.09)', text: '#fafafa', sub: '#a1a1aa', faint: '#71717a', eyebrow: '#71717a', axis: '#a1a1aa', split: 'rgba(255,255,255,0.06)', warn: '#fbbf24' }

  const A = useMemo(() => {
    const yrs = hist.map(h => h.y)
    const wins = new Map<string, { n: number; a: string | null; years: number[] }>()
    const runs = new Map<string, number>()
    const shareIn = (party: string, h: Seat) => h.p === party ? h.v : (h.q === party ? (h.v != null && h.m != null ? +(h.v - h.m).toFixed(1) : null) : null)
    hist.forEach(h => {
      if (h.p) { const e = wins.get(h.p) ?? { n: 0, a: h.a, years: [] }; e.n++; e.years.push(h.y); wins.set(h.p, e) }
      if (h.q) runs.set(h.q, (runs.get(h.q) ?? 0) + 1)
    })
    const tally = [...wins.entries()].map(([p, e]) => ({ p, ...e })).sort((a, b) => b.n - a.n)
    const contenders = [...new Set(hist.flatMap(h => [h.p, h.q].filter(Boolean) as string[]))]
      .map(p => ({ p, a: hist.find(h => h.p === p || h.q === p)?.a ?? null, first: wins.get(p)?.n ?? 0, second: runs.get(p) ?? 0, peak: Math.max(...hist.map(h => shareIn(p, h) ?? -1)) }))
      .sort((a, b) => b.first - a.first || b.second - a.second || b.peak - a.peak)
    let flips = 0, retained = 0, decided = 0
    for (let i = 1; i < hist.length; i++) if (hist[i].p && hist[i - 1].p) { decided++; if (hist[i].p !== hist[i - 1].p) flips++; else retained++ }
    const pair = new Map<string, number>()
    hist.forEach(h => { if (h.p && h.q) { const k = [h.p, h.q].sort().join(' ⇄ '); pair.set(k, (pair.get(k) ?? 0) + 1) } })
    const rivalry = [...pair.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
    const withM = hist.filter(h => h.m != null)
    const mv = withM.map(h => h.m as number)
    const closest = withM.length ? withM.reduce((a, b) => (b.m! < a.m! ? b : a)) : null
    const safest = withM.length ? withM.reduce((a, b) => (b.m! > a.m! ? b : a)) : null
    const meanM = mv.length ? mv.reduce((s, v) => s + v, 0) / mv.length : null
    const volat = mv.length ? Math.max(...mv) - Math.min(...mv) : null
    const withT = hist.filter(h => h.t != null)
    const meanT = withT.length ? withT.reduce((s, h) => s + (h.t as number), 0) / withT.length : null
    const firstT = withT[0]?.t ?? null, lastT = withT[withT.length - 1]?.t ?? null
    const top2 = hist.filter(h => h.v != null && h.m != null).map(h => (h.v as number) + ((h.v as number) - (h.m as number)))
    const bipolar = top2.length ? top2.reduce((s, v) => s + v, 0) / top2.length : null
    return { yrs, tally, contenders, flips, retained, decided, rivalry, closest, safest, meanM, volat, withMargin: withM.length, meanT, firstT, lastT, bipolar, N: hist.length, shareIn }
  }, [hist])

  // How this seat sits among its state peers THIS election — turns generic reads into sharp
  // comparative insight ("#3 closest of 175", turnout/share vs the state average).
  const stateCtx = useMemo(() => {
    const peers = all.filter(h => h.s === seat.s && h.y === seat.y)
    if (peers.length < 4) return null
    const cm = seat.m
    const wm = peers.filter(h => h.m != null).map(h => h.m as number)
    const rank = cm != null && wm.length ? wm.filter(m => m < cm).length + 1 : null
    const wt = peers.filter(h => h.t != null).map(h => h.t as number)
    const avgT = wt.length ? +(wt.reduce((s, v) => s + v, 0) / wt.length).toFixed(1) : null
    const wv = peers.filter(h => h.v != null).map(h => h.v as number)
    const avgV = wv.length ? +(wv.reduce((s, v) => s + v, 0) / wv.length).toFixed(1) : null
    return { mCount: wm.length, rank, avgT, avgV }
  }, [all, seat])

  const N = A.N, dom = A.tally[0]
  const fortress = A.tally.length === 1 && N > 1
  const allDiff = A.tally.length === N && N > 1
  const swingy = A.flips >= Math.ceil((N - 1) / 2) && N > 1
  const curM = seat.m
  const runnerShare = seat.v != null && seat.m != null ? +(seat.v - seat.m).toFixed(1) : null
  const othersShare = seat.v != null && runnerShare != null ? Math.max(0, +(100 - seat.v - runnerShare).toFixed(1)) : null
  const safety = curM == null ? 'Unknown' : curM >= 15 ? 'Safe' : curM >= 5 ? 'Lean' : 'Marginal'
  const classKind = N <= 1 ? 'Single contest' : fortress ? 'Fortress seat' : (allDiff || swingy) ? 'Swing seat' : `Leans ${dom?.p}`
  const swingToFlip = curM != null ? +(curM / 2).toFixed(1) : null
  const chips = [
    { t: classKind, c: fortress ? '#10b981' : (allDiff || swingy) ? '#f43f5e' : N <= 1 ? C.faint : '#38bdf8' },
    A.bipolar != null ? { t: A.bipolar >= 82 ? 'Bipolar contest' : A.bipolar >= 68 ? 'Triangular tilt' : 'Fragmented field', c: '#a78bfa' } : null,
    A.meanT != null ? { t: A.meanT >= 72 ? 'High turnout' : A.meanT >= 62 ? 'Moderate turnout' : 'Low turnout', c: '#fbbf24' } : null,
    seat.r && seat.r !== 'GEN' ? { t: `${seat.r} reserved`, c: '#22d3ee' } : null,
  ].filter(Boolean) as { t: string; c: string }[]

  // recommendation banner
  const rec = N <= 1 ? { k: 'THIN RECORD', c: C.faint, t: 'only one election on file — read with caution.' }
    : fortress ? { k: 'SAFE HOLD', c: '#10b981', t: `${dom.p} fortress — defend efficiently, redeploy resources elsewhere.` }
      : safety === 'Marginal' ? { k: 'PRIME BATTLEGROUND', c: '#f43f5e', t: `a ${swingToFlip}% swing decides it — top-priority target or must-defend.` }
        : (allDiff || swingy) ? { k: 'LIVE TARGET', c: '#f59e0b', t: 'volatile and genuinely winnable — worth contesting hard.' }
          : { k: 'LEAN HOLD', c: '#38bdf8', t: `${dom.p} favoured but not locked — keep it resourced.` }

  // strategist bullets
  const reads: string[] = []
  if (dom) reads.push(fortress ? `${dom.p} has won all ${N} elections here — a locked seat.`
    : allDiff ? `No party has held this seat twice across ${N} elections — genuinely volatile.`
      : swingy ? `A true swing seat — it has changed hands ${A.flips} times in ${N} elections; ${dom.p} won most (${dom.n}).`
        : `${dom.p} holds the edge (${dom.n} of ${N}), but the seat is not locked.`)
  const isLatest = seat.y === hist[hist.length - 1]?.y
  if (curM != null) reads.push(`${seat.p} ${isLatest ? 'holds the seat on' : `took ${seat.y} on`} a ${safety.toLowerCase()} ${curM.toFixed(1)}% margin${curM < 5 ? ' — exposed to even a modest swing.' : curM >= 15 ? ' — hard to dislodge.' : '.'}`)
  const before = hist.filter(h => h.y < seat.y)
  const prev = before[before.length - 1]   // the election immediately BEFORE the clicked year (not overall-latest)
  if (prev && prev.m != null && curM != null) { const d = +(curM - prev.m).toFixed(1); reads.push(`The winning margin ${d >= 0 ? 'widened' : 'narrowed'} from ${prev.m.toFixed(1)}% (${prev.y}) to ${curM.toFixed(1)}% (${seat.y}).`) }
  if (A.decided > 0) reads.push(A.retained >= A.flips ? `Incumbents tend to hold here — ${A.retained} of ${A.decided} defences survived.` : `Anti-incumbency runs strong — sitting parties were beaten ${A.flips} of ${A.decided} times.`)
  const hasRivalry = !!A.rivalry && A.rivalry[1] >= 2
  if (hasRivalry) reads.push(`The defining contest is ${A.rivalry![0]} (top-two in ${A.rivalry![1]} of ${N} elections).`)
  else if (N > 2) reads.push('No single recurring matchup — a rotating cast of challengers has reached the top two.')
  if (A.meanT != null) reads.push(`Turnout averages ${A.meanT.toFixed(1)}%${A.firstT != null && A.lastT != null && Math.abs(A.lastT - A.firstT) >= 3 ? `, ${A.lastT > A.firstT ? 'up' : 'down'} from ${A.firstT.toFixed(1)}% to ${A.lastT.toFixed(1)}% across the series` : ''}.`)

  // ── charts (neutral axes) ──
  const ax = { axisLabel: { color: C.axis, fontSize: 10 }, axisLine: { lineStyle: { color: C.line } } }
  const trajOpt = useMemo(() => ({
    ...baseOpt, legend: { show: false },
    grid: { left: 4, right: 12, top: 10, bottom: 4, containLabel: true },
    tooltip: { ...baseOpt.tooltip, trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '–' : v + '%') },
    xAxis: { ...catAxis(A.yrs.map(String)), ...ax },
    yAxis: { ...valAxis((v: number) => v + '%'), ...ax, splitLine: { lineStyle: { color: C.split } } },
    series: A.contenders.slice(0, 5).map(c => ({
      name: c.p, type: 'line', smooth: 0.3, connectNulls: true, symbol: 'circle', symbolSize: 6,
      lineStyle: { width: 2.5, color: colorFor(c.p, c.a) }, itemStyle: { color: colorFor(c.p, c.a) },
      data: A.yrs.map(y => { const h = hist.find(x => x.y === y); return h ? A.shareIn(c.p, h) : null }),
    })),
  }), [A, hist, C.axis, C.split, C.line])

  const marginOpt = useMemo(() => ({
    ...baseOpt,
    grid: { left: 4, right: 8, top: 22, bottom: 4, containLabel: true },
    tooltip: { ...baseOpt.tooltip, trigger: 'item', formatter: (q: { dataIndex: number }) => { const h = hist[q.dataIndex]; return `<b>${h.y}</b> · ${h.p ?? '–'}<br/>won by ${h.m != null ? h.m.toFixed(1) + '%' : '–'}` } },
    xAxis: { ...catAxis(hist.map(h => String(h.y))), ...ax },
    yAxis: { ...valAxis((v: number) => v + '%'), ...ax, splitLine: { lineStyle: { color: C.split } } },
    series: [{ type: 'bar', barMaxWidth: 28, data: hist.map(h => ({ value: h.m, itemStyle: { color: colorFor(h.p, h.a), borderRadius: [3, 3, 0, 0] } })), label: { show: true, position: 'top', fontSize: 10, color: C.axis, formatter: (q: { value: number | null }) => (q.value != null ? q.value + '%' : '') } }],
  }), [hist, C.axis, C.split, C.line])

  const turnoutOpt = useMemo(() => ({
    ...baseOpt,
    grid: { left: 4, right: 10, top: 12, bottom: 4, containLabel: true },
    tooltip: { ...baseOpt.tooltip, trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? '–' : v + '%') },
    xAxis: { ...catAxis(hist.map(h => String(h.y))), ...ax },
    yAxis: { ...valAxis((v: number) => v + '%', { scale: true }), ...ax, splitLine: { lineStyle: { color: C.split } } },
    series: [{ name: 'Turnout', type: 'line', smooth: 0.3, symbolSize: 6, connectNulls: true, lineStyle: { width: 2.5, color: '#fbbf24' }, itemStyle: { color: '#fbbf24' }, areaStyle: { color: 'rgba(251,191,36,0.10)' }, data: hist.map(h => h.t) }],
  }), [hist, C.axis, C.split, C.line])

  // ── reusable bits ──
  const card: CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14 }
  const Section = ({ eyebrow, title, children, style }: { eyebrow: string; title?: string; children: ReactNode; style?: CSSProperties }) => (
    <section style={{ ...card, padding: 16, ...style }}>
      <div style={{ fontSize: 10, letterSpacing: '.9px', textTransform: 'uppercase', color: C.eyebrow, fontWeight: 600 }}>{eyebrow}</div>
      {title ? <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 3 }}>{title}</h3> : null}
      <div style={{ marginTop: 10 }}>{children}</div>
    </section>
  )
  const Metric = ({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) => (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.5px', textTransform: 'uppercase', color: C.sub }}>{label}</div>
      <div className="font-num" style={{ fontSize: 19, fontWeight: 800, color: tone ?? C.text, lineHeight: 1.15, marginTop: 2 }}>
        {value}{sub != null && sub !== '' ? <span style={{ fontSize: 11, fontWeight: 500, color: C.sub, marginLeft: 5 }}>{sub}</span> : null}
      </div>
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto" style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="animate-fadeUp"
        style={{ background: C.bg, color: C.text, border: `1px solid ${C.line}`, borderRadius: 18, width: '96vw', maxWidth: 1080, margin: '3vh 0 5vh', boxShadow: '0 40px 120px -30px rgba(0,0,0,0.8)', fontFamily: 'DM Sans, ui-sans-serif, sans-serif' }}>
        {/* header */}
        <div style={{ padding: '18px 22px 16px', borderBottom: `1px solid ${C.line}` }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div style={{ fontSize: 10.5, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#c99a2e', fontWeight: 700 }}>{arena === 'AE' ? 'Assembly' : 'Parliament'} constituency briefing</div>
              <h1 style={{ fontSize: 27, fontWeight: 800, color: C.text, lineHeight: 1.05, marginTop: 4 }}>{tc(seat.c)}</h1>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 5 }}>
                {seat.s} · {arena === 'AE' ? 'AC' : 'PC'} {seat.n} · {N > 1 ? `${N} elections, ${A.yrs[0]}–${A.yrs[N - 1]}` : `${A.yrs[0]}`}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {chips.map((ch, i) => <span key={`${ch.t}${i}`} style={{ fontSize: 10.5, fontWeight: 600, color: ch.c, background: ch.c + '1f', border: `1px solid ${ch.c}44`, padding: '2px 9px', borderRadius: 999 }}>{ch.t}</span>)}
              </div>
            </div>
            <button onClick={onClose} style={{ color: C.faint, fontSize: 26, lineHeight: 1 }} className="hover:opacity-70 transition-opacity w-11 h-11 -mr-2 -mt-2 shrink-0 grid place-items-center">×</button>
          </div>
          {/* recommendation banner */}
          <div className="mt-3.5 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3" style={{ background: rec.c + '14', border: `1px solid ${rec.c}3a`, borderRadius: 12, padding: '9px 13px' }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.6px', color: rec.c, whiteSpace: 'nowrap' }}>{rec.k}</span>
            <span className="hidden sm:block" style={{ width: 1, alignSelf: 'stretch', background: rec.c + '44' }} />
            <span style={{ fontSize: 12.5, color: C.sub }}>{rec.t}</span>
          </div>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* KPI band */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <Metric label="Current margin" value={curM != null ? curM.toFixed(1) + '%' : '–'} tone={curM != null ? (curM < 5 ? '#f43f5e' : curM >= 15 ? '#10b981' : C.text) : C.text} />
            <Metric label="Winner share" value={seat.v != null ? seat.v.toFixed(1) + '%' : '–'} />
            <Metric label="Turnout" value={seat.t != null ? seat.t.toFixed(1) + '%' : '–'} />
            <Metric label="Holder safety" value={safety} tone={safety === 'Safe' ? '#10b981' : safety === 'Marginal' ? '#f43f5e' : safety === 'Lean' ? '#38bdf8' : C.faint} />
            <Metric label="Times flipped" value={N > 1 ? `${A.flips}` : '–'} sub={N > 1 ? `of ${A.decided}` : ''} />
            <Metric label="Margin range" value={A.volat != null ? A.volat.toFixed(0) + '%' : '–'} sub="high–low" />
          </div>

          {/* how this seat sits in the state */}
          {stateCtx && (
            <Section eyebrow={`In ${seat.s} · ${seat.y}`}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <Metric label="Closeness rank" value={stateCtx.rank != null ? `#${stateCtx.rank}` : '–'} sub={stateCtx.rank != null ? `of ${stateCtx.mCount}` : ''} tone={stateCtx.rank != null && stateCtx.rank <= Math.max(1, Math.ceil(stateCtx.mCount * 0.1)) ? '#f43f5e' : undefined} />
                <Metric label="Turnout vs state" value={seat.t != null && stateCtx.avgT != null ? `${seat.t - stateCtx.avgT >= 0 ? '+' : ''}${(seat.t - stateCtx.avgT).toFixed(1)}` : '–'} sub={stateCtx.avgT != null ? `avg ${stateCtx.avgT}%` : ''} tone={seat.t != null && stateCtx.avgT != null ? (seat.t >= stateCtx.avgT ? '#10b981' : '#f59e0b') : undefined} />
                <Metric label="Win share vs state" value={seat.v != null && stateCtx.avgV != null ? `${seat.v - stateCtx.avgV >= 0 ? '+' : ''}${(seat.v - stateCtx.avgV).toFixed(1)}` : '–'} sub={stateCtx.avgV != null ? `avg ${stateCtx.avgV}%` : ''} />
              </div>
              {stateCtx.rank != null && (
                <div style={{ fontSize: 12, color: C.sub, marginTop: 9 }}>
                  {stateCtx.rank <= Math.max(1, Math.ceil(stateCtx.mCount * 0.1))
                    ? `Among the tightest seats in ${seat.s} this election — a genuine battleground.`
                    : stateCtx.rank >= Math.floor(stateCtx.mCount * 0.9)
                      ? `One of the safest seats in ${seat.s} — hold it efficiently and redeploy resources.`
                      : `The #${stateCtx.rank} closest of ${stateCtx.mCount} decided seats in ${seat.s}.`}
                </div>
              )}
            </Section>
          )}

          {/* executive read */}
          <Section eyebrow="Executive read">
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {reads.map((r, i) => (
                <li key={i} className="flex gap-2.5" style={{ fontSize: 13, color: C.sub, lineHeight: 1.45 }}>
                  <span style={{ color: '#c99a2e', flex: 'none', marginTop: 1 }}>▸</span><span>{r}</span>
                </li>
              ))}
            </ul>
          </Section>

          {/* mandate + competitive structure */}
          <div className="grid lg:grid-cols-2 gap-3.5">
            <Section eyebrow={`The mandate · ${seat.y}`}>
              <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
                <span className="flex items-center gap-2"><Dot color={colorFor(seat.p, seat.a)} /><b style={{ color: C.text }}>{seat.p}</b>{seat.a ? <span style={{ color: C.sub, fontSize: 11 }}>· {seat.a}</span> : null}</span>
                <span className="font-num" style={{ fontWeight: 800, color: C.text }}>{seat.v != null ? seat.v.toFixed(1) + '%' : '–'}</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>{tc(seat.w) ?? '—'}</div>
              {/* share bars: winner / runner / others */}
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[{ lab: seat.p, v: seat.v, c: colorFor(seat.p, seat.a), n: tc(seat.w) },
                { lab: seat.q, v: runnerShare, c: seat.q ? colorFor(seat.q) : C.faint, n: tc(seat.qn) },
                othersShare != null ? { lab: 'Others', v: othersShare, c: C.faint, n: 'all other candidates' } : null]
                  .filter(Boolean).map((r, i) => { const row = r as { lab: string | null; v: number | null; c: string; n: string | null }; return (
                    <div key={i}>
                      <div className="flex items-center justify-between" style={{ fontSize: 11, color: C.sub, marginBottom: 3 }}>
                        <span className="flex items-center gap-1.5"><span style={{ width: 8, height: 8, borderRadius: 2, background: row.c }} /><b style={{ color: C.text }}>{row.lab ?? '–'}</b>{i === 0 ? ' · won' : i === 1 ? ' · runner-up' : ''}</span>
                        <span className="font-num">{row.v != null ? row.v.toFixed(1) + '%' : '–'}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: C.panel2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${row.v ?? 0}%`, background: row.c, borderRadius: 999 }} /></div>
                    </div>
                  ) })}
              </div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 11, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
                Won by <b style={{ color: C.text }}>{curM != null ? curM.toFixed(1) + '%' : '–'}</b> over {seat.q ?? 'the field'}{runnerShare != null && curM != null ? ` — a ${swingToFlip}% swing would flip it.` : '.'}
              </div>
            </Section>

            <Section eyebrow="Competitive structure">
              <div style={{ fontSize: 12.5, color: C.sub }}>
                Average top-two share <b style={{ color: C.text }}>{A.bipolar != null ? A.bipolar.toFixed(0) + '%' : '–'}</b> — {A.bipolar == null ? 'unknown' : A.bipolar >= 82 ? 'a straight two-party fight.' : A.bipolar >= 68 ? 'mostly two-cornered with a live third force.' : 'a fragmented, multi-cornered field.'}
              </div>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 7 }}>{hasRivalry ? <>Defining rivalry · <b style={{ color: C.text }}>{A.rivalry![0]}</b> <span style={{ color: C.sub }}>({A.rivalry![1]} of {N})</span></> : <span style={{ color: C.sub }}>No recurring matchup — challengers rotate.</span>}</div>
              <div style={{ fontSize: 10, letterSpacing: '.5px', textTransform: 'uppercase', color: C.faint, marginTop: 12, marginBottom: 5 }}>Who contests here</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {A.contenders.slice(0, 6).map(c => (
                  <div key={c.p} className="flex items-center justify-between" style={{ fontSize: 12 }}>
                    <span className="flex items-center gap-1.5"><Dot color={colorFor(c.p, c.a)} /><b style={{ color: C.text }}>{c.p}</b></span>
                    <span style={{ color: C.sub }}>{c.first ? `${c.first}× won` : ''}{c.first && c.second ? ' · ' : ''}{c.second ? `${c.second}× 2nd` : ''}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* trajectory charts */}
          <Section eyebrow="Trajectory" title="How the seat has moved">
            <div className="grid lg:grid-cols-3 gap-4">
              <div>
                <div style={{ fontSize: 11, color: C.sub, marginBottom: 4 }}>Contenders’ vote share</div>
                <Chart option={trajOpt} h={158} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.sub, marginBottom: 4 }}>Winning margin <span style={{ color: C.faint }}>· colour = winner</span></div>
                {A.withMargin > 0 ? <Chart option={marginOpt} h={158} /> : <div style={{ height: 158, fontSize: 12, color: C.sub }} className="grid place-items-center">No margin data</div>}
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.sub, marginBottom: 4 }}>Turnout</div>
                {A.meanT != null ? <Chart option={turnoutOpt} h={158} /> : <div style={{ height: 158, fontSize: 12, color: C.sub }} className="grid place-items-center">No turnout data</div>}
              </div>
            </div>
          </Section>

          {/* volatility + swing math */}
          <div className="grid lg:grid-cols-2 gap-3.5">
            <Section eyebrow="Volatility & incumbency">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Metric label="Classification" value={<span style={{ color: fortress ? '#10b981' : (allDiff || swingy) ? '#f43f5e' : '#38bdf8' }}>{classKind}</span>} />
                <Metric label="Closest win" value={A.closest?.m != null ? A.closest.m.toFixed(1) + '%' : '–'} sub={A.closest ? `’${String(A.closest.y).slice(2)}` : ''} />
                <Metric label="Safest win" value={A.safest?.m != null ? A.safest.m.toFixed(1) + '%' : '–'} sub={A.safest ? `’${String(A.safest.y).slice(2)}` : ''} />
                <Metric label="Avg margin" value={A.meanM != null ? A.meanM.toFixed(1) + '%' : '–'} />
              </div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 10 }}>
                Win sequence:&nbsp;
                {hist.map((h, i) => <span key={i} title={`${h.y}: ${h.p}`} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: colorFor(h.p, h.a), marginRight: 3, verticalAlign: 'middle' }} />)}
                <span style={{ color: C.faint, marginLeft: 4 }}>{A.yrs[0]}→{A.yrs[N - 1]}</span>
              </div>
              {A.decided > 0 && <div style={{ fontSize: 12, color: C.sub, marginTop: 7 }}>{A.retained >= A.flips ? `Incumbency holds — ${A.retained} of ${A.decided} defences survived.` : `Anti-incumbency — sitting parties lost ${A.flips} of ${A.decided}.`}</div>}
            </Section>

            <Section eyebrow="The swing math" title={swingToFlip != null ? `A ${swingToFlip}% swing flips this seat` : 'Margin not available'}>
              {curM != null && seat.q ? (
                <>
                  <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
                    {seat.p} leads {seat.q} by <b style={{ color: C.text }}>{curM.toFixed(1)}%</b>. A uniform swing of <b style={{ color: '#f43f5e' }}>{swingToFlip}%</b> from <b style={{ color: readable(colorFor(seat.p, seat.a), mode) }}>{seat.p}</b> to <b style={{ color: readable(colorFor(seat.q), mode) }}>{seat.q}</b> would level it.
                  </div>
                  <div style={{ marginTop: 12 }}>
                    {[{ lab: seat.p, v: seat.v, c: colorFor(seat.p, seat.a) }, { lab: seat.q, v: runnerShare, c: colorFor(seat.q) }].map((r, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <div className="flex justify-between" style={{ fontSize: 11, color: C.sub, marginBottom: 3 }}><b style={{ color: C.text }}>{r.lab}</b><span className="font-num">{r.v != null ? r.v.toFixed(1) + '%' : '–'}</span></div>
                        <div style={{ height: 8, borderRadius: 999, background: C.panel2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${(r.v ?? 0) * 1.6}%`, maxWidth: '100%', background: r.c, borderRadius: 999 }} /></div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.sub, marginTop: 8 }}>{safety === 'Marginal' ? 'Within reach of a single bad cycle.' : safety === 'Lean' ? 'A competitive but not knife-edge hold.' : 'A cushion that absorbs normal swings.'}</div>
                </>
              ) : <div style={{ fontSize: 12.5, color: C.sub }}>No margin/runner-up data for the latest election.</div>}
            </Section>
          </div>

          {/* full history */}
          <Section eyebrow="Full record" title="Election history">
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full min-w-[560px]" style={{ fontSize: 12 }}>
                <thead><tr style={{ color: C.sub, textAlign: 'left' }}>
                  <th style={{ padding: '5px 6px', fontWeight: 600 }}>Year</th><th style={{ fontWeight: 600 }}>Winner</th><th style={{ fontWeight: 600 }}>Party</th>
                  <th style={{ fontWeight: 600 }}>Runner-up</th><th style={{ textAlign: 'right', fontWeight: 600 }}>Share</th><th style={{ textAlign: 'right', fontWeight: 600 }}>Margin</th><th style={{ textAlign: 'right', fontWeight: 600 }}>Turnout</th>
                </tr></thead>
                <tbody>
                  {[...hist].reverse().map((h, idx, arr) => {
                    const nxt = arr[idx + 1]
                    const brk = nxt && !comparable(arena, h.s, nxt.y, h.y)
                    return (
                      <tr key={h.y} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ padding: '6px', color: C.text }}>{h.y}{brk ? <span title="New delimitation — boundaries redrawn" style={{ color: C.warn }}> ⚠</span> : ''}</td>
                        <td style={{ color: C.sub, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tc(h.w) ?? '–'}</td>
                        <td style={{ color: C.text }}><Dot color={colorFor(h.p, h.a)} />{h.p}</td>
                        <td style={{ color: C.sub }}>{h.q ?? '–'}</td>
                        <td className="font-num" style={{ textAlign: 'right', color: C.sub }}>{h.v != null ? h.v.toFixed(1) : '–'}</td>
                        <td className="font-num" style={{ textAlign: 'right', color: C.text }}>{h.m != null ? h.m.toFixed(1) : '–'}</td>
                        <td className="font-num" style={{ textAlign: 'right', color: C.sub }}>{h.t != null ? h.t.toFixed(1) : '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {hist.some((h, i) => i > 0 && !comparable(arena, h.s, hist[i - 1].y, h.y)) && <div style={{ fontSize: 10.5, color: C.warn, marginTop: 8 }}>⚠ boundaries were redrawn (delimitation); rows across that line aren’t directly comparable.</div>}
          </Section>

          <button onClick={() => { setFocus(seat.s); nav('/state'); onClose() }}
            style={{ background: 'linear-gradient(180deg,#e5c15a,#b0812a)', color: '#000', fontWeight: 700, fontSize: 13.5, padding: '11px', borderRadius: 12 }} className="hover:brightness-110 transition-all">
            Open {seat.s} deep-dive →
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
