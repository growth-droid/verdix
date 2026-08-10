// Auth context — resolves the Google session, checks the Firestore allow-list, and exposes a
// simple {status, email, isAdmin, signIn, signOut} to the whole app. The <LoginGate> reads `status`
// to decide what to render; nothing in the dashboard mounts until status === 'allowed'.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, googleProvider, firebaseReady } from './firebase'
import { AUTH_ENABLED } from './config'

// The permanent super-admin: can ALWAYS sign in, ALWAYS sees the admin panel, and is the only
// email allowed to edit the allow-list. Hardcoded so a fresh deploy can bootstrap (he's never on
// the list yet) and so he can never lock himself out. MUST match isAdmin() in firestore.rules.
export const SUPER_ADMIN = 'sai.prasanth@themindshare.in'

export type AuthStatus =
  | 'loading'       // resolving the session / allow-list
  | 'unconfigured'  // Firebase env vars not set yet (fresh checkout)
  | 'signed-out'    // no Google session
  | 'denied'        // signed in, but not on the allow-list
  | 'allowed'       // signed in AND permitted

type Ctx = {
  status: AuthStatus
  user: User | null
  email: string | null
  isAdmin: boolean
  error: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthCtx = createContext<Ctx | null>(null)

export function useAuth(): Ctx {
  const c = useContext(AuthCtx)
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>')
  return c
}

const norm = (e: string | null | undefined) => (e || '').trim().toLowerCase()

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(!AUTH_ENABLED ? 'allowed' : firebaseReady ? 'loading' : 'unconfigured')
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!AUTH_ENABLED) return                 // open mode: no sign-in, everyone allowed
    if (!firebaseReady || !auth) return
    const unsub = onAuthStateChanged(auth, async (u) => {
      setError(null)
      setUser(u)
      if (!u) { setStatus('signed-out'); return }

      const email = norm(u.email)
      // The super-admin is allowed without a list entry (so he can create the first entries).
      if (email === SUPER_ADMIN) { setStatus('allowed'); return }

      // Everyone else must have an allow-list doc (id = their lower-cased email).
      try {
        setStatus('loading')
        const snap = await getDoc(doc(db!, 'allowed_users', email))
        setStatus(snap.exists() ? 'allowed' : 'denied')
      } catch {
        // Rules rejection / offline: fail closed, but tell the user it was a lookup problem.
        setStatus('denied')
        setError('We could not verify your access. Check your connection and try again.')
      }
    })
    return unsub
  }, [])

  const signIn = async () => {
    if (!firebaseReady || !auth) return
    setError(null)
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (e) {
      const code = (e as { code?: string })?.code || ''
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return // user dismissed
      if (code === 'auth/unauthorized-domain') {
        setError(`This site (${window.location.hostname}) isn’t authorized in Firebase → Authentication → Settings → Authorized domains.`)
      } else if (code === 'auth/popup-blocked') {
        setError('Your browser blocked the sign-in popup — allow popups for this site and try again.')
      } else {
        setError(code ? `Sign-in failed (${code}). Please try again.` : 'Sign-in failed. Please try again.')
      }
    }
  }

  const signOut = async () => { if (auth) await fbSignOut(auth) }

  const email = user?.email ?? null
  const isAdmin = norm(user?.email) === SUPER_ADMIN

  return (
    <AuthCtx.Provider value={{ status, user, email, isAdmin, error, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}
