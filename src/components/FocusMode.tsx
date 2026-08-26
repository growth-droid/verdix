// Full-screen / focus mode.
//
// Two independent things, deliberately kept separate:
//   1. FOCUS   — hides the app HEADER (wordmark, theme, account) so the dashboard owns the window.
//                The left rail and the phone tab bar STAY: they are navigation, not chrome.
//   2. FULLSCREEN — asks the browser to drop its tab strip and address bar (the Fullscreen API).
// requestFullscreen needs a user gesture and can be refused by policy or an embedding frame; when it
// is refused, focus mode still applies on its own, which is most of the win. Leaving fullscreen by
// any route (Esc, F11, the OS) switches focus back off, so the two never drift apart on screen.
import { useEffect } from 'react'
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

/** The way out of focus mode. Navigation is NOT here — the left rail stays visible in focus mode,
 *  so a second module switcher in the corner would only duplicate it. */
export function FocusBar() {
  const set = useFocusStore(s => s.set)
  const leave = async () => {
    set(false)
    try { if (document.fullscreenElement) await document.exitFullscreen() } catch { /* already out */ }
  }
  return (
    <button onClick={leave} title="Leave full screen (Esc)" aria-label="Leave full screen"
      className="fixed top-2 right-2 z-40 glass w-8 h-8 grid place-items-center rounded-lg text-muted hover:text-ink transition-colors">
      <Collapse />
    </button>
  )
}
