// One source of truth for the modules — used by the nav, the per-page "what you're looking at"
// line, and the guided Prev/Next journey. Order = the intended narrative flow:
// macro picture → one state → what changed there → compare any two → trends → midterm signals → what's next.
export type ModuleDef = {
  to: string
  tab: string        // short, plain-language nav label
  tagline: string    // the question this module answers, in one line
  blurb: string      // even shorter, for the "start here" journey cards
}

export const MODULES: ModuleDef[] = [
  { to: '/', tab: 'Overview', tagline: 'Who holds India right now — the national map, seats and turnout.', blurb: 'The big picture across every state.' },
  { to: '/state', tab: 'State', tagline: 'One state in depth — its seats, swings, strongholds and turnout.', blurb: 'Zoom into a single state’s story.' },
  { to: '/change', tab: 'What changed', tagline: 'Which seats flipped since the previous election, and where.', blurb: 'The seats that changed hands.' },
  { to: '/compare', tab: 'Compare', tagline: 'Put any two elections head-to-head and read what shifted.', blurb: 'Assembly vs Lok Sabha, or any two years.' },
  { to: '/matchup', tab: 'Matchup', tagline: 'Two or three parties head-to-head — strengths, the direct battleground, and the strategic play.', blurb: 'Compare parties and get the play.' },
  { to: '/trends', tab: 'Trends', tagline: 'How parties rose and fell over the years — votes and seats.', blurb: 'Each party’s arc over time.' },
  { to: '/bypolls', tab: 'Bypolls', tagline: 'By-elections — the midterm signals between the big votes.', blurb: 'Who’s defending, who’s gaining.' },
  { to: '/battleground', tab: 'Battlegrounds', tagline: 'Where the next election is winnable — the close, flippable seats.', blurb: 'Each party’s realistic targets.' },
  { to: '/story', tab: 'Story', tagline: 'The whole story — a narrated deck of a state or the nation, assembly and Lok Sabha together.', blurb: 'The complete story as a slideshow.' },
]

export const moduleAt = (pathname: string) => MODULES.findIndex(m => m.to === pathname)
