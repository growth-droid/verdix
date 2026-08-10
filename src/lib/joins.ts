// Delimitation knowledge shared by the map and all cross-election analysis.
// Metrics-catalog caveat 4: J&K 2014↔2024 and Assam pre/post-2023 are different
// delimitations — swing/flip/seat-history must never join across these breaks.
export const DELIM_BREAK_AE: Record<string, number> = { 'Jammu & Kashmir': 2020, Assam: 2023 }

// The 2008 national delimitation: every 2004-cycle assembly election (the 2004 overlay) is on
// the OLD map — never seat-comparable with 2008+ elections of the same state.
const DELIM_2008 = new Set(['Andhra Pradesh', 'Telangana', 'Karnataka', 'Maharashtra', 'Odisha', 'Sikkim', 'Arunachal Pradesh'])

// Are two AE election years of a state on the same seat map?
export const comparableAE = (state: string, y1: number, y2: number): boolean => {
  if (DELIM_2008.has(state) && (y1 < 2008) !== (y2 < 2008)) return false
  const b = DELIM_BREAK_AE[state]
  return b === undefined || (y1 < b) === (y2 < b)
}

export const comparable = (arena: 'AE' | 'GE', state: string, y1: number, y2: number): boolean =>
  arena === 'GE' ? true : comparableAE(state, y1, y2) // GE continuity handled by the j domain
