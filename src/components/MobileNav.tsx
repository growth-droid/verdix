// App-style bottom navigation for phones (hidden from lg: up, where the header nav takes over).
// One thumb-reachable tab per group; tapping opens a compact sheet with that group's pages.
// Fixed 56px bar + safe-area inset — the only chrome that costs vertical space on mobile.
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { NAV_GROUPS, groupOf, type GroupName } from '../lib/nav'

const ICONS: Record<GroupName, JSX.Element> = {
  Results: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 20l-5.4 2.3a1 1 0 0 1-1.4-.9V5.6a1 1 0 0 1 .6-.9L9 2m0 18l6 2m-6-2V2m6 22l5.4-2.3a1 1 0 0 0 .6-.9V4.6a1 1 0 0 0-1.4-.9L15 6m0 18V6" />
    </svg>
  ),
  Analysis: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M7 15l3.5-4 3 2.5L20 7" />
    </svg>
  ),
  Strategy: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  ),
}

export default function MobileNav() {
  const { pathname } = useLocation()
  const nav = useNavigate()
  const [sheet, setSheet] = useState<GroupName | null>(null)
  const active = groupOf(pathname)

  useEffect(() => { setSheet(null) }, [pathname])
  useEffect(() => {
    if (!sheet) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheet])

  return (
    <>
      {/* sheet */}
      {sheet && (
        <div className="lg:hidden fixed inset-0 z-[70]" onClick={() => setSheet(null)}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] animate-fadeUp" />
          <div onClick={e => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-white/10 bg-slate-900 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-pop animate-fadeUp">
            <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-white/20" />
            <div className="px-2.5 pb-1.5 text-[11px] uppercase tracking-[0.14em] font-semibold text-gold">{sheet}</div>
            {NAV_GROUPS.find(g => g.label === sheet)?.items.map(m => {
              const on = pathname === m.to
              return (
                <button key={m.to} onClick={() => nav(m.to)}
                  className={`w-full text-left px-2.5 py-2.5 rounded-xl transition-colors ${on ? 'bg-gold/10' : 'active:bg-white/[0.08]'}`}>
                  <div className={`text-[14px] font-semibold ${on ? 'text-gold' : 'text-ink'}`}>{m.tab}</div>
                  <div className="text-[11.5px] text-muted leading-snug mt-0.5">{m.blurb}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* bottom tab bar */}
      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-slate-950/92 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {NAV_GROUPS.map(g => {
            const on = active === g.label
            return (
              <button key={g.label} onClick={() => setSheet(sheet === g.label ? null : (g.label as GroupName))}
                aria-label={g.label}
                className={`flex-1 h-14 flex flex-col items-center justify-center gap-0.5 transition-colors ${on ? 'text-gold' : 'text-muted'}`}>
                {ICONS[g.label as GroupName]}
                <span className="text-[10.5px] font-medium leading-none">{g.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
