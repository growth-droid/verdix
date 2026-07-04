// Firebase init — Google Sign-In (Auth) + the allow-list store (Firestore).
//
// Everything here is the PUBLIC Firebase web config (apiKey / authDomain / projectId / appId).
// These are safe to ship in the browser bundle: access is governed by Firestore SECURITY RULES
// (see firestore.rules), never by keeping these secret. They still live in .env.local (gitignored)
// so the repo stays key-free and each environment supplies its own. Copy .env.example → .env.local
// and paste the config from Firebase console → Project settings → Your apps → Web app → SDK config.
//
// NOTE: this is the CLIENT ID side of Google OAuth only. The OAuth *client secret* is never used
// here — a static SPA can't hold a secret. Keep the secret for the future Cloud Run / BigQuery API.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// True once the essential config is present. When false the app shows a friendly "not configured
// yet" screen (LoginGate) instead of crashing on a bad init — so a fresh checkout still builds/runs.
export const firebaseReady = Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId)

let app: FirebaseApp | undefined
let authInst: Auth | undefined
let dbInst: Firestore | undefined
if (firebaseReady) {
  app = initializeApp(cfg)
  authInst = getAuth(app)
  dbInst = getFirestore(app)
}

export const auth = authInst
export const db = dbInst

export const googleProvider = new GoogleAuthProvider()
// Prefer the Mindshare Workspace and always let the user choose the account (avoids silently
// re-using the wrong Google identity). `hd` is a UX hint only — real access is the allow-list.
googleProvider.setCustomParameters({ hd: 'themindshare.in', prompt: 'select_account' })
