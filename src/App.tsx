import { useEffect, useRef } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import MapPage from './pages/MapPage'
import SignalsPage from './pages/SignalsPage'
import StoryPage from './pages/StoryPage'
import StatePage from './pages/StatePage'
import TrajectoryPage from './pages/TrajectoryPage'
import ChangePage from './pages/ChangePage'
import CompareHub from './pages/CompareHub'
import BypollsPage from './pages/BypollsPage'
import BattlegroundPage from './pages/BattlegroundPage'
import AdminPage from './pages/AdminPage'
import FilterBar from './components/FilterBar'
import AccountMenu from './components/AccountMenu'
import ThemeToggle from './components/ThemeToggle'
import ErrorBoundary from './components/ErrorBoundary'
import { PageTagline, JourneyNav } from './components/Journey'
import { MODULES } from './lib/nav'

export default function App() {
  const loc = useLocation()
  // /admin is chrome-free: no filter bar, page tagline or journey nav (it isn't a data module).
  const isModulePage = loc.pathname !== '/story' && loc.pathname !== '/admin'
  const topRef = useRef<HTMLDivElement>(null)
  // publish the sticky header+FilterBar height so page-level StickyControls can pin just below it
  useEffect(() => {
    const el = topRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const set = () => document.documentElement.style.setProperty('--app-top', el.offsetHeight + 'px')
    set()
    const ro = new ResizeObserver(set); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="min-h-screen flex flex-col">
     <div ref={topRef} className="sticky top-0 z-30">
      <header className="relative z-20 border-b border-white/[0.07] bg-slate-950/70 backdrop-blur-xl px-6 py-2.5 flex items-center gap-6">
        <h1 className="font-display font-extrabold text-[19px] tracking-tight shrink-0 flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-gradient-to-br from-[#e5c15a] to-[#b0812a] shadow-glow" />
          Verdix
          <span className="font-quote italic hidden xl:inline text-[13px] font-medium tracking-wide text-gold/80">voter verdict intelligence</span>
        </h1>
        <nav className="flex gap-1 text-[13px] overflow-x-auto">
          {MODULES.map((m, i) => (
            <NavLink key={m.to} to={m.to} end title={m.tagline} className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors duration-150 flex items-center gap-1.5 ${
                isActive
                  ? 'bg-gold/10 text-gold ring-1 ring-gold/30'
                  : 'text-muted hover:text-ink hover:bg-white/[0.05]'
              }`}>
              <span className="text-[10px] text-faint tabular-nums">{i + 1}</span>{m.tab}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto shrink-0 flex items-center gap-2.5">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>
      {isModulePage && <FilterBar />}
     </div>
      <main className={`flex-1 w-full mx-auto ${loc.pathname === '/story' ? 'px-4 sm:px-6 pt-2 pb-2 max-w-[1800px]' : 'px-5 py-4 max-w-[1720px]'}`}>
        {isModulePage && <PageTagline />}
        <ErrorBoundary resetKey={loc.pathname}>
          <div key={loc.pathname} className={loc.pathname === '/story' ? '' : 'animate-fadeUp'}>
            <Routes>
              <Route path="/story" element={<StoryPage />} />
              <Route path="/" element={<MapPage />} />
              <Route path="/signals" element={<SignalsPage />} />
              <Route path="/state" element={<StatePage />} />
              <Route path="/change" element={<ChangePage />} />
              <Route path="/compare" element={<CompareHub />} />
              <Route path="/matchup" element={<Navigate to="/compare" replace />} />
              <Route path="/trends" element={<TrajectoryPage />} />
              <Route path="/bypolls" element={<BypollsPage />} />
              <Route path="/battleground" element={<BattlegroundPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </div>
        </ErrorBoundary>
        {isModulePage && <JourneyNav />}
      </main>
    </div>
  )
}
