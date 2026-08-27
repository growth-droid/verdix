// Left rail navigation: every module visible at once, one below the other, instead of folded into
// three header dropdowns. The group names stay as quiet section labels — they carry the standardised
// nomenclature (Results · Analysis · Strategy) without costing a click.
//
// The rail is a full-height flex column: nav at the top, a coverage panel pushed to the BOTTOM by
// `mt-auto`. Below eight items the rail was mostly empty black, so the tail of it now answers the
// question a reader actually has at the edge of a dashboard — how much data is behind this? Those
// numbers are COUNTED from the loaded extracts, never hardcoded, so they can't rot when the data
// refreshes. ⚠ `ae` counts distinct STATE-YEAR views, not polls held: undivided Andhra 2004
// back-maps to both Andhra Pradesh and Telangana, so it is one election but two things you can
// open. That is why this reads 115 where the docs' "112 assembly elections" counts polls. loadSeats is promise-cached in data.ts, so on every page that already reads seats this
// costs nothing.
//
// Desktop only. Below `lg` the bottom tab bar (MobileNav) is still the right pattern on a phone,
// and a permanent rail would eat the width the tables need.
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { MODULES, NAV_GROUPS } from '../lib/nav'
import { loadSeats } from '../lib/data'

type Coverage = { from: number; to: number; ae: number; ge: number; rows: number }

export default function SideNav() {
  const { pathname } = useLocation()
  const active = MODULES.find(m => m.to === pathname)
  const [cov, setCov] = useState<Coverage | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([loadSeats('AE'), loadSeats('GE')]).then(([ae, ge]) => {
      if (!live) return
      const years = [...ae, ...ge].map(r => r.y)
      if (!years.length) return
      setCov({
        from: Math.min(...years), to: Math.max(...years),
        ae: new Set(ae.map(r => `${r.s}|${r.y}`)).size,
        ge: new Set(ge.map(r => r.y)).size,
        rows: ae.length + ge.length,
      })
    }).catch(() => { /* the rail is navigation first — a failed count just leaves the panel out */ })
    return () => { live = false }
  }, [])

  return (
    <aside
      className="hidden lg:flex flex-col shrink-0 w-[176px] xl:w-[190px] border-r border-white/[0.07]
                 sticky self-start overflow-y-auto"
      // pins directly under the sticky header + FilterBar, which publish their height as --app-top
      style={{ top: 'var(--app-top, 0px)', height: 'calc(100vh - var(--app-top, 0px))' }}>

      <nav className="py-3 pl-3 pr-2.5 flex flex-col gap-3">
        {NAV_GROUPS.map(g => (
          <div key={g.label}>
            <div className="px-2.5 pb-1 text-[9.5px] uppercase tracking-[0.13em] font-semibold text-faint">
              {g.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {g.items.map(m => (
                <NavLink
                  key={m.to}
                  to={m.to}
                  end
                  title={m.tagline}
                  className={({ isActive }) =>
                    `group relative px-2.5 py-[7px] rounded-lg text-[13px] leading-tight transition-colors duration-150 ${
                      isActive
                        ? 'bg-gold/10 text-gold font-semibold'
                        : 'text-muted hover:text-ink hover:bg-white/[0.05]'
                    }`
                  }>
                  {({ isActive }) => (
                    <>
                      {/* the active marker sits ON the rail's border, so the row itself never shifts */}
                      <span
                        className={`absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full transition-opacity ${
                          isActive ? 'bg-gold opacity-100' : 'opacity-0'
                        }`}
                      />
                      {m.tab}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Foot of the rail. mt-auto anchors it to the bottom however tall the window is. */}
      <div className="mt-auto pl-3 pr-2.5 pb-4 pt-5 flex flex-col gap-3">
        {active && (
          <div className="px-2.5">
            <div className="text-[9.5px] uppercase tracking-[0.13em] font-semibold text-faint mb-1">
              You’re looking at
            </div>
            <div className="text-[11.5px] leading-snug text-muted">{active.blurb}</div>
          </div>
        )}

        {cov && (
          <div className="px-2.5 pt-3 border-t border-white/[0.07]">
            <div className="text-[9.5px] uppercase tracking-[0.13em] font-semibold text-faint mb-1.5">
              Data behind it
            </div>
            <div className="text-[12.5px] font-num font-semibold text-ink tabular-nums">
              {cov.from}–{cov.to}
            </div>
            <div className="text-[11px] leading-snug text-muted mt-0.5">
              <span className="tabular-nums">{cov.ae}</span> state polls ·{' '}
              <span className="tabular-nums">{cov.ge}</span> Lok Sabha
            </div>
            <div className="text-[11px] leading-snug text-muted">
              <span className="tabular-nums">{cov.rows.toLocaleString('en-IN')}</span> seat results
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
