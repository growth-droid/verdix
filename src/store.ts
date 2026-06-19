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

// Light theme removed — the app is always dark. `useThemeStore`/`toggle` are kept (no-op) so any
// remaining importer compiles; `useTheme()` is a constant 'dark'.
export type Theme = 'dark' | 'light'
export const useThemeStore = create<{ mode: Theme; toggle: () => void }>(() => ({ mode: 'dark', toggle: () => {} }))
export const useTheme = (): Theme => 'dark'
