// One source of truth for the modules — used by the grouped header nav, the per-page
// "what you're looking at" line, and the guided Prev/Next journey.
//
// NOMENCLATURE (standardised): every tab label is ONE word, Title case, no sentence
// fragments ("What changed" → "Change"), and the pair National/States reads as a set.
// Group names are plain nouns: Results · Analysis · Strategy.
//
// ORDER = the intended narrative flow, and it matches the group order so Prev/Next walks
// the groups in sequence: where things stand → what moved → what to act on.
export type GroupName = 'Results' | 'Analysis' | 'Strategy'

export type ModuleDef = {
  to: string
  tab: string        // short, plain-language nav label (ONE word)
  group: GroupName   // which header menu it lives under
  tagline: string    // the question this module answers, in one line
  blurb: string      // even shorter, for menus + the "start here" journey cards
}

export const MODULES: ModuleDef[] = [
  // ── Results: where things stand right now ──
  { to: '/', group: 'Results', tab: 'National', tagline: 'Who holds India right now — the national map, seats and turnout.', blurb: 'The big picture across every state.' },
  { to: '/state', group: 'Results', tab: 'States', tagline: 'One state in depth — its seats, swings, strongholds and turnout.', blurb: 'Zoom into a single state’s story.' },
  // ── Analysis: what moved, and how it compares ──
  { to: '/change', group: 'Analysis', tab: 'Change', tagline: 'Which seats flipped since the previous election, and where.', blurb: 'The seats that changed hands.' },
  { to: '/trends', group: 'Analysis', tab: 'Trends', tagline: 'How parties rose and fell over the years — votes and seats.', blurb: 'Each party’s arc over time.' },
  { to: '/compare', group: 'Analysis', tab: 'Compare', tagline: 'Two elections, or two–three parties, head-to-head — toggle Elections / Parties.', blurb: 'Two elections, or two–three parties.' },
  { to: '/bypolls', group: 'Analysis', tab: 'Bypolls', tagline: 'By-elections — the midterm signals between the big votes.', blurb: 'Who’s defending, who’s gaining.' },
  // ── Strategy: what to act on ──
  { to: '/signals', group: 'Strategy', tab: 'Signals', tagline: 'The patterns that change a decision — auto-flagged with the numbers, drill to the seats.', blurb: 'What to act on, flagged for you.' },
  { to: '/battleground', group: 'Strategy', tab: 'Targets', tagline: 'Where the next election is winnable — the close, flippable seats.', blurb: 'Each party’s realistic targets.' },
]

export const GROUP_ORDER: GroupName[] = ['Results', 'Analysis', 'Strategy']

/** The header menus: one entry per group, in order, each holding its modules. */
export const NAV_GROUPS = GROUP_ORDER.map(label => ({
  label,
  items: MODULES.filter(m => m.group === label),
}))

export const moduleAt = (pathname: string) => MODULES.findIndex(m => m.to === pathname)
export const groupOf = (pathname: string): GroupName | null => MODULES[moduleAt(pathname)]?.group ?? null
