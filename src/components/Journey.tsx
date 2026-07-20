import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MODULES, moduleAt } from '../lib/nav'

/** Slim "you are here" line at the top of every page — names the step in plain language. */
export function PageTagline() {
  const { pathname } = useLocation()
  const idx = moduleAt(pathname)
  if (idx < 0) return null
  const m = MODULES[idx]
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="font-display font-bold text-[22px] tracking-tight leading-none flex items-baseline gap-2">
        <span className="text-gold text-base leading-none">✦</span>{m.tab}
      </h2>
      <span className="text-sm text-muted">{m.tagline}</span>
    </div>
  )
}

/** Dismissible "start here" band on the landing — the whole journey at a glance. */
export function JourneyHome() {
  const [open, setOpen] = useState(true)
  const nav = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => { try { setOpen(localStorage.getItem('verdix-guide') !== 'hidden') } catch { /* ignore */ } }, [])
  const hide = () => { setOpen(false); try { localStorage.setItem('verdix-guide', 'hidden') } catch { /* ignore */ } }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-4 text-xs text-faint hover:text-ink underline decoration-dotted transition-colors">
        How to read this dashboard →
      </button>
    )
  }
  return (
    <div className="card p-4 mb-5 animate-fadeUp">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-bold text-[15px] tracking-tight">New here? Read India’s elections in seven steps</h2>
          <p className="text-xs text-muted mt-0.5">Set a <b className="text-ink">region</b> and <b className="text-ink">arena</b> once in the bar above — it follows you through every step. Press <kbd className="font-sans text-[10px] px-1 py-0.5 rounded bg-white/[0.07] border border-white/10">⌘K</kbd> to jump anywhere.</p>
        </div>
        <button onClick={hide} title="Hide" className="text-faint hover:text-ink text-xl leading-none shrink-0">×</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {MODULES.map((m, i) => (
          <button key={m.to} onClick={() => nav(m.to)}
            className={`text-left p-2.5 rounded-xl border transition-all hover:-translate-y-[1px] ${m.to === pathname ? 'border-gold/40 bg-gold/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}>
            <div className="w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold bg-white/10 mb-1.5 tabular-nums">{i + 1}</div>
            <div className="text-[12.5px] font-semibold leading-tight">{m.tab}</div>
            <div className="text-[11px] text-faint leading-snug mt-0.5">{m.blurb}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Guided Prev / Next at the foot of every page — the actual "flow" between modules. */
export function JourneyNav() {
  const { pathname } = useLocation()
  const nav = useNavigate()
  const idx = moduleAt(pathname)
  if (idx < 0) return null
  const prev = MODULES[idx - 1], next = MODULES[idx + 1]
  return (
    <div className="mt-8 pt-5 border-t border-white/[0.07] flex items-stretch justify-between gap-3">
      {prev ? (
        <button onClick={() => nav(prev.to)} className="group flex flex-col items-start px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.02] hover:border-white/25 transition-colors text-left">
          <span className="kicker text-faint">← Previous</span>
          <span className="text-sm font-semibold text-muted group-hover:text-ink transition-colors">{prev.tab}</span>
        </button>
      ) : <span />}
      {next ? (
        <button onClick={() => nav(next.to)} className="group flex flex-col items-end px-4 py-2.5 rounded-xl border border-gold/30 bg-gold/[0.06] hover:bg-gold/[0.12] hover:border-gold/50 transition-colors text-right max-w-md">
          <span className="kicker text-gold/80">Next step →</span>
          <span className="text-sm font-semibold">{next.tab}</span>
          <span className="text-[11px] text-muted leading-snug hidden sm:block">{next.tagline}</span>
        </button>
      ) : (
        <button onClick={() => nav('/')} className="flex flex-col items-end px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.02] hover:border-white/25 transition-colors text-right">
          <span className="kicker text-faint">End of the journey</span>
          <span className="text-sm font-semibold text-muted">↺ Back to Overview</span>
        </button>
      )}
    </div>
  )
}
