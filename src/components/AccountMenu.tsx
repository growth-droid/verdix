// Header account controls (right side of the app bar): the signed-in email, a "Manage users"
// link for the admin only, and Sign out. Renders nothing until access is granted.
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function AccountMenu() {
  const { status, email, isAdmin, signOut } = useAuth()
  if (status !== 'allowed') return null

  return (
    <div className="flex items-center gap-2">
      {isAdmin && (
        <NavLink
          to="/admin"
          className={({ isActive }) =>
            `px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-colors ${
              isActive
                ? 'border-gold/40 text-gold bg-gold/10'
                : 'border-white/10 text-muted hover:text-ink hover:border-white/25'
            }`
          }>
          Manage users
        </NavLink>
      )}
      <span className="hidden md:inline text-[11px] text-faint max-w-[170px] truncate" title={email ?? ''}>
        {email}
      </span>
      <button
        onClick={signOut}
        title="Sign out"
        className="h-8 px-2.5 rounded-lg border border-white/10 text-muted hover:text-ink hover:border-white/25 text-[12px] font-medium transition-colors">
        Sign out
      </button>
    </div>
  )
}
