import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useFilters } from '../store'
import { loadSeats } from '../lib/data'
import { Seg, Select } from './ui'

const ALL = 'All India'
// Pages whose view is driven by the Assembly/Lok-Sabha arena toggle.
// (Signals owns its own Assemblies/Parliaments/Both + multi-election picker, so it's NOT here.)
const ARENA_PAGES = new Set(['/', '/state', '/change', '/battleground'])
// Pages that already render a single chosen region (so picking one updates them in place).
// '/change' is region-aware too: All-India shows the national change, a region scopes to it.
const STATE_CENTRIC = new Set(['/signals', '/state', '/compare', '/trends', '/bypolls', '/battleground', '/change'])

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

  return (
    <div className="border-b border-white/[0.05] bg-slate-950/50 backdrop-blur-xl px-3 sm:px-5 py-1.5 sm:py-2 flex items-center gap-2 sm:gap-3 flex-wrap">
      <span className="kicker text-muted shrink-0 hidden sm:inline">Focus</span>
      <Select value={state ?? ALL} onChange={onRegion} options={[ALL, ...states]} width="w-[9.5rem] sm:w-52" />
      {showArena && (
        <Seg options={[{ v: 'AE', label: 'Assembly' }, { v: 'GE', label: 'Lok Sabha' }]} value={arena} onChange={v => setArena(v as 'AE' | 'GE')} />
      )}
      {/* Global scope readout — hidden on phones, where it would cost a whole row to repeat what the
          dropdown and the arena toggle already show (and picking "All India" is the same as `clear`). */}
      <span className="ml-auto hidden md:inline text-[11px] text-muted">
        {state ? <>Focus: <span className="text-ink font-medium">{state}</span></> : <>Focus: <span className="text-ink font-medium">all of India</span></>}
        {showArena ? <span className="hidden md:inline"> · {arena === 'AE' ? 'Assembly' : 'Lok Sabha'}</span> : null}
        {state ? <> — <button onClick={() => { setState(null); if (pathname !== '/') nav('/') }} className="underline decoration-dotted hover:text-ink transition-colors inline-flex items-center min-h-[32px] px-1.5 -mx-1.5 md:inline md:min-h-0 md:px-0 md:mx-0">clear</button></> : null}
      </span>
    </div>
  )
}
