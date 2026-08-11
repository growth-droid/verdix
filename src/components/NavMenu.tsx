// Grouped header navigation: the nine modules folded into four menus
// (Results · Analysis · Strategy · Story) instead of one long row of tabs.
// A group with a single module renders as a plain link; the rest open a dropdown.
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { NAV_GROUPS, groupOf } from '../lib/nav'

const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-60">
    <path d="M6 9l6 6 6-6" />
  </svg>
)

export default function NavMenu() {
  const { pathname } = useLocation()
  const nav = useNavigate()
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)
  const activeGroup = groupOf(pathname)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  useEffect(() => { setOpen(null) }, [pathname])   // close after navigating

  const btn = (isActive: boolean) =>
    `px-3 py-1.5 rounded-lg text-[13px] whitespace-nowrap transition-colors duration-150 flex items-center gap-1.5 ${
      isActive ? 'bg-gold/10 text-gold ring-1 ring-gold/30' : 'text-muted hover:text-ink hover:bg-white/[0.05]'
    }`

  return (
    <nav ref={ref} className="flex gap-1 items-center">
      {NAV_GROUPS.map(g => {
        // single-module group → plain link (no dropdown)
        if (g.items.length === 1) {
          const m = g.items[0]
          return (
            <NavLink key={g.label} to={m.to} end title={m.tagline} className={({ isActive }) => btn(isActive)}>
              {m.tab}
            </NavLink>
          )
        }
        const isOpen = open === g.label
        return (
          <div key={g.label} className="relative">
            <button
              onClick={() => setOpen(isOpen ? null : g.label)}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              className={btn(activeGroup === g.label)}>
              {g.label}<Chevron />
            </button>
            {isOpen && (
              <div role="menu"
                className="absolute left-0 top-10 w-[268px] rounded-xl border border-white/10 bg-slate-900 shadow-pop p-1.5 z-50 animate-fadeUp">
                {g.items.map(m => {
                  const on = pathname === m.to
                  return (
                    <button key={m.to} role="menuitem" onClick={() => nav(m.to)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors ${on ? 'bg-gold/10' : 'hover:bg-white/[0.06]'}`}>
                      <div className={`text-[13px] font-semibold ${on ? 'text-gold' : 'text-ink'}`}>{m.tab}</div>
                      <div className="text-[11px] text-muted leading-snug mt-0.5">{m.blurb}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
