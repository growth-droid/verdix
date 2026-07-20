import { create } from 'zustand'
// Single source of truth for the dimensions that the whole product shares:
// which arena (Assembly vs Lok Sabha), which year, which region (state), and which
// party is in focus. Every page reads/writes THESE — so a subject chosen in one
// module carries into every other module (the "flow" / continuity of the dashboard).
type S = {
  arena: 'AE'|'GE'; year: number; state: string|null; party: string|null
  setArena: (a:'AE'|'GE')=>void; setYear:(y:number)=>void; setState:(s:string|null)=>void; setParty:(p:string|null)=>void
}
export const useFilters = create<S>((set)=>({
  arena:'AE', year:2026, state:null, party:null,
  setArena:(arena)=>set({arena}), setYear:(year)=>set({year}), setState:(state)=>set({state}), setParty:(party)=>set({party})
}))

// Theme (TND design system ships BOTH light + dark). Persisted to localStorage; `data-theme`
// on <html> drives every CSS-var value in index.css. Default = dark (matches the data-heavy maps).
export type Theme = 'dark' | 'light'
const THEME_KEY = 'verdix-theme'
const readTheme = (): Theme => {
  try { const t = localStorage.getItem(THEME_KEY); if (t === 'light' || t === 'dark') return t } catch { /* SSR/denied */ }
  return 'dark'
}
const applyTheme = (m: Theme) => {
  try { document.documentElement.dataset.theme = m } catch { /* no document */ }
  try { localStorage.setItem(THEME_KEY, m) } catch { /* denied */ }
}
export const useThemeStore = create<{ mode: Theme; toggle: () => void; setMode: (m: Theme) => void }>((set, get) => ({
  mode: readTheme(),
  toggle: () => { const m: Theme = get().mode === 'dark' ? 'light' : 'dark'; applyTheme(m); set({ mode: m }) },
  setMode: (m) => { applyTheme(m); set({ mode: m }) },
}))
export const useTheme = (): Theme => useThemeStore(s => s.mode)
