import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useFilters } from '../store'
import { loadSeats } from '../lib/data'
import { Seg, Select } from './ui'

const ALL = 'All India'
// Pages whose view is driven by the Assembly/Lok-Sabha arena toggle.
const ARENA_PAGES = new Set(['/', '/state', '/change', '/battleground', '/matchup'])
// Pages that already render a single chosen region (so picking one updates them in place).
// '/change' is region-aware too: All-India shows the national change, a region scopes to it.
const STATE_CENTRIC = new Set(['/story', '/state', '/compare', '/trends', '/bypolls', '/battleground', '/change', '/matchup'])

/** Persistent global context bar: one Region + Arena selection that the whole
 *  product shares, so analysis flows from module to module instead of resetting. */
export default function FilterBar() {
  const { state, setState, arena, setArena } = useFilters()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [states, setStates] = useState<string[]>([])
  useEffect(() => { loadSeats('AE').then(rows => setStates([...new Set(rows.map(r => r.s))].sort())) }, [])

  const onRegion = (v: string) => {
    const next = v === ALL ? null : v
    setState(next)
    // From a national-only view, choosing a region opens its deep dive — the spine of the flow.
    if (next && !STATE_CENTRIC.has(pathname)) nav('/state')
  }
  const showArena = ARENA_PAGES.has(pathname)
  // The State deep-dive is single-state only: drop "All India" there and default to Andhra Pradesh.
  const onStatePage = pathname === '/state'
  const dispState = state ?? (onStatePage ? 'Andhra Pradesh' : null)

  return (
    <div className="border-b border-white/[0.05] bg-slate-950/50 backdrop-blur-xl px-6 py-2 flex items-center gap-3 flex-wrap">
      <span className="kicker text-faint shrink-0">Focus</span>
      <Select value={dispState ?? ALL} onChange={onRegion} options={onStatePage ? states : [ALL, ...states]} width="w-52" />
      {showArena && (
        <Seg options={[{ v: 'AE', label: 'Assembly' }, { v: 'GE', label: 'Lok Sabha' }]} value={arena} onChange={v => setArena(v as 'AE' | 'GE')} />
      )}
      <span className="ml-auto text-[11px] text-faint hidden md:inline">
        {dispState ? <>Focus: <span className="text-muted font-medium">{dispState}</span></> : <>Focus: <span className="text-muted font-medium">all of India</span></>}
        {showArena ? <> · {arena === 'AE' ? 'Assembly' : 'Lok Sabha'}</> : null}
        {state ? <> — <button onClick={() => { setState(null); if (pathname !== '/') nav('/') }} className="underline decoration-dotted hover:text-ink transition-colors">clear</button></> : null}
      </span>
    </div>
  )
}
