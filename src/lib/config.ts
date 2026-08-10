// ── Access control master switch ──────────────────────────────────────────────
// false  → OPEN: anyone can use the dashboard, no sign-in (Firebase is not even loaded).
// true   → invite-only Google sign-in + Firestore allow-list (see auth.tsx / firestore.rules).
//
// Flip this to `true` to restore the login gate. When you do, also re-add the Firebase/Google
// domains to the Content-Security-Policy in netlify.toml (they're listed there in a comment).
export const AUTH_ENABLED = false
