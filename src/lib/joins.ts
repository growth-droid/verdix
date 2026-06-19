// Delimitation knowledge shared by the map and all cross-election analysis.
// Metrics-catalog caveat 4: J&K 2014↔2024 and Assam pre/post-2023 are different
// delimitations — swing/flip/seat-history must never join across these breaks.
export const DELIM_BREAK_AE: Record<string, number> = { 'Jammu & Kashmir': 2020, Assam: 2023 }

// Are two AE election years of a state on the same seat map?
export const comparableAE = (state: string, y1: number, y2: number): boolean => {
  const b = DELIM_BREAK_AE[state]
  return b === undefined || (y1 < b) === (y2 < b)
}

export const comparable = (arena: 'AE' | 'GE', state: string, y1: number, y2: number): boolean =>
  arena === 'GE' ? true : comparableAE(state, y1, y2) // GE continuity handled by the j domain
