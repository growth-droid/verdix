import { useEffect, useRef } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import MapPage from './pages/MapPage'
import SignalsPage from './pages/SignalsPage'
import StatePage from './pages/StatePage'
import TrajectoryPage from './pages/TrajectoryPage'
import ChangePage from './pages/ChangePage'
import CompareHub from './pages/CompareHub'
import BypollsPage from './pages/BypollsPage'
import BattlegroundPage from './pages/BattlegroundPage'
import AdminPage from './pages/AdminPage'
import FilterBar from './components/FilterBar'
import SideNav from './components/SideNav'
import MobileNav from './components/MobileNav'
import AccountMenu from './components/AccountMenu'
import ThemeToggle from './components/ThemeToggle'
import ErrorBoundary from './components/ErrorBoundary'
import { PageTagline, JourneyNav } from './components/Journey'
import { FocusButton, FocusBar, useFullscreenSync } from './components/FocusMode'
import { useFocus } from './store'

export default function App() {
  const loc = useLocation()
  const focus = useFocus()
  useFullscreenSync()
  // /admin is chrome-free: no filter bar, page tagline or journey nav (it isn't a data module).
  const isModulePage = loc.pathname !== '/admin'
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
      {!focus && <header className="relative z-20 border-b border-white/[0.07] bg-slate-950/70 backdrop-blur-xl px-3 sm:px-5 py-2 sm:py-2.5 flex items-center gap-3 sm:gap-6">
        <h1 className="font-display font-extrabold text-[17px] sm:text-[19px] tracking-tight shrink-0 flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-gradient-to-br from-[#e5c15a] to-[#b0812a] shadow-glow" />
          Verdix
          <span className="font-quote italic hidden xl:inline text-[13px] font-medium tracking-wide text-gold/80">voter verdict intelligence</span>
        </h1>
        {/* modules live in the left rail (SideNav) now, not in the header */}
        <div className="ml-auto shrink-0 flex items-center gap-2">
          <FocusButton />
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>}
      {isModulePage && <FilterBar />}
     </div>
      {/* rail + content, FULL BLEED. A max-w cap here left 200px unused at 1920px and 840px at
          2560px while the header ran edge to edge — on a dashboard of maps and wide tables that
          width is the product. min-w-0 on <main> is load-bearing: it is a flex child, so without it
          a wide table inside would stretch the whole document instead of scrolling in its own card. */}
      <div className="flex-1 w-full flex items-start">
      <SideNav />
      <main className="flex-1 min-w-0 px-3 sm:px-5 py-3 sm:py-4 pb-24 lg:pb-6">
        {isModulePage && <PageTagline />}
        <ErrorBoundary resetKey={loc.pathname}>
          <div key={loc.pathname} className="animate-fadeUp">
            <Routes>
              <Route path="/story" element={<Navigate to="/" replace />} />
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
      {focus && <FocusBar />}
      <MobileNav />
    </div>
  )
}
