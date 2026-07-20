// Admin panel (/admin) — visible only to the super-admin. Add or remove who can open Verdix,
// writing live to the Firestore `allowed_users` collection (doc id = lower-cased email). No redeploy.
// The Firestore rules enforce that ONLY the admin can write here, so this UI guard is defence-in-depth.
import { useEffect, useState } from 'react'
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import type { Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth, SUPER_ADMIN } from '../lib/auth'

type Row = { email: string; addedBy?: string; addedAt?: Timestamp }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function fmtDate(t?: Timestamp) {
  try { return t?.toDate ? t.toDate().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '' }
  catch { return '' }
}

export default function AdminPage() {
  const { isAdmin, email: me } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    if (!db) return
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'allowed_users'))
      const list = snap.docs.map((d) => ({ ...(d.data() as Omit<Row, 'email'>), email: d.id }))
      list.sort((a, b) => a.email.localeCompare(b.email))
      setRows(list)
    } catch {
      setErr('Could not load the user list. Check your access and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (isAdmin) void load() }, [isAdmin])

  if (!isAdmin) {
    return <div className="card p-6 text-sm text-muted">You don’t have permission to manage users.</div>
  }

  const add = async () => {
    const e = input.trim().toLowerCase()
    setErr(null)
    if (!EMAIL_RE.test(e)) { setErr('Enter a valid email address.'); return }
    if (e === SUPER_ADMIN) { setErr('That address is the permanent admin — it already has access.'); return }
    if (rows.some((r) => r.email === e)) { setErr('That user is already on the list.'); return }
    if (!db) return
    setBusy(true)
    try {
      await setDoc(doc(db, 'allowed_users', e), { email: e, addedBy: me, addedAt: serverTimestamp() })
      setInput('')
      await load()
    } catch {
      setErr('Could not add the user. Check your access and try again.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (e: string) => {
    if (!db) return
    setBusy(true); setErr(null)
    try { await deleteDoc(doc(db, 'allowed_users', e)); await load() }
    catch { setErr('Could not remove the user.') }
    finally { setBusy(false) }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Manage access</h1>
        <p className="text-sm text-muted mt-1">
          Add or remove who can open Verdix. Changes take effect the next time that person signs in.
        </p>
      </div>

      {/* Invite */}
      <div className="card p-4">
        <label className="kicker">Invite a user</label>
        <div className="flex gap-2 mt-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
            type="email"
            placeholder="name@themindshare.in"
            className="flex-1 h-10 px-3 rounded-lg bg-slate-900/50 border border-white/10 text-sm text-ink placeholder:text-faint focus:border-gold/50 outline-none transition-colors"
          />
          <button
            onClick={() => void add()}
            disabled={busy}
            className="h-10 px-4 rounded-lg bg-gradient-to-br from-[#d1a842] to-[#b0812a] text-white font-semibold text-sm disabled:opacity-50 hover:brightness-110 transition">
            Add
          </button>
        </div>
        {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
        <p className="text-[11px] text-faint mt-2">They sign in with Google — no password to set. Only invited accounts can get in.</p>
      </div>

      {/* List */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-1">
          <label className="kicker">Who can access</label>
          <span className="text-[11px] text-faint tabular-nums">{rows.length + 1} {rows.length + 1 === 1 ? 'person' : 'people'}</span>
        </div>

        {/* Permanent admin — always allowed, never removable */}
        <div className="flex items-center justify-between py-2.5 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="text-sm text-ink truncate">{SUPER_ADMIN}</div>
            <div className="text-[11px] text-faint">Administrator · permanent access</div>
          </div>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-gold/80 border border-gold/25 rounded-full px-2 py-0.5">Admin</span>
        </div>

        {loading ? (
          <p className="text-sm text-muted py-4">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted py-4">No one added yet. Invite your first user above.</p>
        ) : (
          rows.map((r) => (
            <div key={r.email} className="flex items-center justify-between py-2.5 border-b border-white/[0.06] last:border-0">
              <div className="min-w-0">
                <div className="text-sm text-ink truncate">{r.email}</div>
                <div className="text-[11px] text-faint truncate">
                  {r.addedBy ? `Added by ${r.addedBy}` : 'Added'}{fmtDate(r.addedAt) ? ` · ${fmtDate(r.addedAt)}` : ''}
                </div>
              </div>
              <button
                onClick={() => void remove(r.email)}
                disabled={busy}
                className="shrink-0 h-8 px-3 rounded-lg border border-white/10 text-muted hover:text-red-300 hover:border-red-500/40 text-[12px] font-medium disabled:opacity-50 transition-colors">
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
