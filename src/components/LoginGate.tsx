// The access gate. Wraps the entire app: only status === 'allowed' renders the dashboard.
// Every other state gets a Verdix-branded full-screen card (loading / sign-in / no-access /
// not-configured). Styled with the app's dark glossy theme (.card, brand-orange, text-* aliases).
import type { ReactNode } from 'react'
import { useAuth, SUPER_ADMIN } from '../lib/auth'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center px-6 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="inline-block w-3 h-3 rounded-full bg-gradient-to-br from-[#e5c15a] to-[#b0812a] shadow-glow" />
          <span className="font-display font-extrabold text-2xl tracking-tight">Verdix</span>
          <span className="font-quote italic text-sm tracking-wide text-gold/80 mt-0.5">voter verdict intelligence</span>
        </div>
        {children}
      </div>
    </div>
  )
}

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
  </svg>
)

const Lock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export default function LoginGate({ children }: { children: ReactNode }) {
  const { status, email, error, signIn, signOut } = useAuth()

  if (status === 'allowed') return <>{children}</>

  if (status === 'loading') {
    return (
      <Shell>
        <div className="card p-8 grid place-items-center gap-3">
          <div className="w-6 h-6 rounded-full border-2 border-white/15 border-t-gold animate-spin" />
          <p className="text-sm text-muted">Checking your access…</p>
        </div>
      </Shell>
    )
  }

  if (status === 'unconfigured') {
    return (
      <Shell>
        <div className="card p-6 space-y-3">
          <h1 className="font-bold text-lg">Login isn’t configured yet</h1>
          <p className="text-sm text-muted leading-relaxed">
            Copy <code className="text-ink bg-white/5 px-1 py-0.5 rounded">.env.example</code> to{' '}
            <code className="text-ink bg-white/5 px-1 py-0.5 rounded">.env.local</code> in{' '}
            <code className="text-ink bg-white/5 px-1 py-0.5 rounded">product/app</code>, paste your Firebase
            web config, then rebuild. See the setup notes in the project docs.
          </p>
        </div>
      </Shell>
    )
  }

  if (status === 'signed-out') {
    return (
      <Shell>
        <div className="card p-7 space-y-5 text-center">
          <div>
            <h1 className="font-bold text-lg">Sign in to continue</h1>
            <p className="text-sm text-muted mt-1">Verdix is private. Use your Mindshare Google account.</p>
          </div>
          <button
            onClick={signIn}
            className="w-full h-11 rounded-xl bg-white text-slate-900 font-semibold text-sm flex items-center justify-center gap-2.5 hover:bg-white/90 active:scale-[0.99] transition">
            <GoogleG /> Continue with Google
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-[11px] text-faint leading-relaxed">
            Access is invite-only. If you can’t get in, ask your administrator to add you.
          </p>
        </div>
      </Shell>
    )
  }

  // status === 'denied'
  const mailto =
    `mailto:${SUPER_ADMIN}` +
    `?subject=${encodeURIComponent('Verdix access request')}` +
    `&body=${encodeURIComponent(`Hi Sai,\n\nPlease grant me access to Verdix.\n\nMy Google account: ${email ?? ''}\n\nThanks.`)}`

  return (
    <Shell>
      <div className="card p-7 space-y-4 text-center">
        <div className="w-11 h-11 mx-auto rounded-full bg-red-500/10 border border-red-500/30 grid place-items-center text-red-400">
          <Lock />
        </div>
        <div>
          <h1 className="font-bold text-lg">You don’t have access yet</h1>
          <p className="text-sm text-muted mt-1 leading-relaxed">
            You’re signed in as <span className="text-ink font-medium break-all">{email}</span>, but this account
            isn’t on the allow-list.
          </p>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <a
          href={mailto}
          className="w-full h-10 rounded-xl bg-gradient-to-br from-[#d1a842] to-[#b0812a] text-white font-semibold text-sm grid place-items-center hover:brightness-110 transition">
          Request access from the admin
        </a>
        <button
          onClick={signOut}
          className="w-full h-9 rounded-lg border border-white/10 text-muted hover:text-ink hover:border-white/25 text-[13px] font-medium transition-colors">
          Sign out
        </button>
      </div>
    </Shell>
  )
}
