// ── Access control master switch ──────────────────────────────────────────────
// false  → OPEN: anyone can use the dashboard, no sign-in (Firebase is not even loaded).
// true   → invite-only Google sign-in + Firestore allow-list (see auth.tsx / firestore.rules).
//
// Currently TRUE — invite-only. Turning it back off is one edit here; turning it ON also requires
// (a) the Firebase/Google domains in the Caddyfile's Content-Security-Policy — already there — and
// (b) verdix-elections.fly.dev listed under Firebase → Authentication → Settings → Authorized
// domains, which is a console setting, not code.
export const AUTH_ENABLED = true
