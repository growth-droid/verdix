// Full-screen / focus mode.
//
// Two independent things, deliberately kept separate:
//   1. FOCUS   — hides the app's own chrome (header + module rail) so the dashboard owns the window.
//   2. FULLSCREEN — asks the browser to drop its tab strip and address bar (the Fullscreen API).
// requestFullscreen needs a user gesture and can be refused by policy or an embedding frame; when it
// is refused, focus mode still applies on its own, which is most of the win. Leaving fullscreen by
// any route (Esc, F11, the OS) switches focus back off, so the two never drift apart on screen.
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { MODULES, NAV_GROUPS } from '../lib/nav'
import { useFocusStore } from '../store'

const Expand = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
)
const Collapse = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3" />
  </svg>
)
const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="opacity-60">
    <path d="M6 9l6 6 6-6" />
  </svg>
)

/** Keeps our `focus` flag in step with the browser's real fullscreen state, however it changed. */
export function useFullscreenSync() {
  const set = useFocusStore(s => s.set)
  useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) set(false) }
    // Esc is handled HERE as well, not left to the browser: when requestFullscreen was refused
    // there is no fullscreen for the browser's own Esc to leave, and the user would be stuck in
    // chrome-less focus mode with only the corner button as a way out.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !useFocusStore.getState().on) return
      set(false)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* already out */ })
    }
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('fullscreenchange', sync); document.removeEventListener('keydown', onKey) }
  }, [set])
}

/** Header button that enters focus mode. */
export function FocusButton() {
  const toggle = useFocusStore(s => s.toggle)
  const enter = async () => {
    toggle()
    try { await document.documentElement.requestFullscreen?.() } catch { /* refused — focus mode alone still applies */ }
  }
  return (
    <button onClick={enter} title="Full screen — hide the browser bar and the app chrome (Esc to leave)"
      aria-label="Enter full screen"
      className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:text-ink hover:bg-white/[0.06] transition-colors">
      <Expand />
    </button>
  )
}

/** The only chrome left on screen in focus mode: which module you're in, a way to switch, and a way out. */
export function FocusBar() {
  const { pathname } = useLocation()
  const set = useFocusStore(s => s.set)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = MODULES.find(m => m.to === pathname)

  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const leave = async () => {
    set(false)
    try { if (document.fullscreenElement) await document.exitFullscreen() } catch { /* already out */ }
  }

  return (
    <div ref={ref} className="fixed top-2 right-2 z-40 flex items-center gap-1">
      <div className="relative">
        <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
          className="glass rounded-lg pl-2.5 pr-2 py-1.5 text-[12px] text-muted hover:text-ink flex items-center gap-1.5 transition-colors">
          {current?.tab ?? 'Menu'}<Chevron />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 mt-1 w-44 glass rounded-xl p-1.5 shadow-pop">
            {NAV_GROUPS.map(g => (
              <div key={g.label}>
                <div className="px-2 pt-1.5 pb-0.5 text-[9.5px] uppercase tracking-[0.13em] font-semibold text-faint">{g.label}</div>
                {g.items.map(m => (
                  <NavLink key={m.to} to={m.to} end
                    className={({ isActive }) => `block px-2 py-1.5 rounded-lg text-[12.5px] transition-colors ${
                      isActive ? 'bg-gold/10 text-gold font-semibold' : 'text-muted hover:text-ink hover:bg-white/[0.05]'}`}>
                    {m.tab}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <button onClick={leave} title="Leave full screen (Esc)" aria-label="Leave full screen"
        className="glass w-8 h-8 grid place-items-center rounded-lg text-muted hover:text-ink transition-colors">
        <Collapse />
      </button>
    </div>
  )
}
