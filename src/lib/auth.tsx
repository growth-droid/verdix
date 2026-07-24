// Auth context — resolves the Google session, checks the Firestore allow-list, and exposes a
// simple {status, email, isAdmin, signIn, signOut} to the whole app. The <LoginGate> reads `status`
// to decide what to render; nothing in the dashboard mounts until status === 'allowed'.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  onAuthStateChanged, signInWithRedirect, getRedirectResult, signOut as fbSignOut, type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, googleProvider, firebaseReady } from './firebase'

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
  const [status, setStatus] = useState<AuthStatus>(firebaseReady ? 'loading' : 'unconfigured')
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!firebaseReady || !auth) return
    // If we're returning from the full-page Google redirect, finish it (surfaces any error).
    // The onAuthStateChanged listener below is what actually sets the signed-in state.
    getRedirectResult(auth).catch(() => setError('Sign-in could not be completed. Please try again.'))
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
      // Full-page redirect, NOT a popup: modern browsers partition firebaseapp.com's third-party
      // storage, which leaves the popup handler blank/stuck. Redirect runs in the app's own tab and
      // uses first-party storage, so it completes. (The page navigates away, so this await won't
      // resolve here — any real failure surfaces via getRedirectResult on return.)
      await signInWithRedirect(auth, googleProvider)
    } catch {
      setError('Sign-in failed. Please try again.')
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
