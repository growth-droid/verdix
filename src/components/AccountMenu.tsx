// Gmail-style account menu: a circular avatar (Google photo, or the email initial on gold)
// that opens a dropdown with the account, an admin-only "Manage users" link, and Sign out.
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const UsersIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
const SignOutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
)

function Avatar({ photo, initial, size }: { photo?: string | null; initial: string; size: number }) {
  return (
    <span className="rounded-full overflow-hidden grid place-items-center shrink-0" style={{ width: size, height: size }}>
      {photo
        ? <img src={photo} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        : <span className="w-full h-full grid place-items-center font-semibold text-black bg-gradient-to-br from-[#e8c766] to-[#b0812a]" style={{ fontSize: size * 0.42 }}>{initial}</span>}
    </span>
  )
}

export default function AccountMenu() {
  const { status, user, email, isAdmin, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (status !== 'allowed') return null

  const name = user?.displayName || email || ''
  const initial = (name || 'U').trim().charAt(0).toUpperCase()
  const photo = user?.photoURL

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={email ?? 'Account'}
        aria-label="Account menu"
        aria-expanded={open}
        className="w-9 h-9 rounded-full grid place-items-center ring-1 ring-white/10 hover:ring-gold/50 transition-all">
        <Avatar photo={photo} initial={initial} size={34} />
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-64 rounded-xl border border-white/10 bg-slate-900 shadow-pop p-1.5 z-50 animate-fadeUp">
          <div className="flex items-center gap-2.5 px-2.5 py-2.5">
            <Avatar photo={photo} initial={initial} size={36} />
            <div className="min-w-0">
              {user?.displayName && <div className="text-[13px] font-semibold text-ink truncate">{user.displayName}</div>}
              <div className="text-[11px] text-muted truncate">{email}</div>
              {isAdmin && <div className="text-[10px] uppercase tracking-wider font-semibold text-gold/80 mt-0.5">Administrator</div>}
            </div>
          </div>
          <div className="h-px bg-white/[0.08] mx-1 my-1" />
          {isAdmin && (
            <NavLink
              to="/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted hover:text-ink hover:bg-white/[0.06] transition-colors">
              <UsersIcon /> Manage users
            </NavLink>
          )}
          <button
            onClick={() => { setOpen(false); void signOut() }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted hover:text-ink hover:bg-white/[0.06] transition-colors text-left">
            <SignOutIcon /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
