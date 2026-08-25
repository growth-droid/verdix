// Left rail navigation: every module visible at once, one below the other, instead of folded into
// three header dropdowns. The group names stay as quiet section labels — they carry the standardised
// nomenclature (Results · Analysis · Strategy) without costing a click to reach anything.
//
// Desktop only. Below `lg` the bottom tab bar (MobileNav) is still the right pattern on a phone,
// and a permanent rail would eat the width the tables need.
import { NavLink } from 'react-router-dom'
import { NAV_GROUPS } from '../lib/nav'

export default function SideNav() {
  return (
    <aside
      className="hidden lg:block shrink-0 w-[176px] xl:w-[190px] border-r border-white/[0.07]
                 sticky self-start overflow-y-auto"
      // pins directly under the sticky header + FilterBar, which publish their height as --app-top
      style={{ top: 'var(--app-top, 0px)', maxHeight: 'calc(100vh - var(--app-top, 0px))' }}>
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
    </aside>
  )
}
