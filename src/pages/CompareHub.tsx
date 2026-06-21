import { useState } from 'react'
import { Seg } from '../components/ui'
import CompareElections from './ComparePage'
import CompareParties from './MatchupPage'

// The "Compare" tab hosts two modes behind one toggle:
//   • Elections — put any two elections head-to-head (ComparePage)
//   • Parties   — two or three parties head-to-head (MatchupPage)
// The toggle is rendered inside each view's sticky control bar (passed as `modeToggle`),
// so switching swaps the whole view, controls and all, with no stacked control rows.
export default function CompareHub() {
  const [mode, setMode] = useState<'elections' | 'parties'>('elections')
  const toggle = (
    <Seg options={[{ v: 'elections', label: 'Elections' }, { v: 'parties', label: 'Parties' }]}
      value={mode} onChange={v => setMode(v as 'elections' | 'parties')} />
  )
  return mode === 'elections'
    ? <CompareElections modeToggle={toggle} />
    : <CompareParties modeToggle={toggle} />
}
