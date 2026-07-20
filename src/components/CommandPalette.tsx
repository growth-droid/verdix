import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFilters, useThemeStore } from '../store'
import { loadSeats } from '../lib/data'
import { MODULES } from '../lib/nav'

type Item = { id: string; label: string; hint: string; run: () => void }

/** ⌘K / Ctrl-K quick switcher: jump to any state, module, or action.
 *  Premium-dashboard staple, and it doubles as the keyboard spine for the
 *  global focus — picking a state here sets the shared filter everywhere. */
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const [states, setStates] = useState<string[]>([])
  const nav = useNavigate()
  const { setState, setArena } = useFilters()
  const toggleTheme = useThemeStore(s => s.toggle)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadSeats('AE').then(r => setStates([...new Set(r.map(x => x.s))].sort())) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && /^(input|textarea|select)$/i.test(t.tagName)
      if ((e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault(); setOpen(o => !o)
      } else if (e.key === 'Escape') setOpen(false)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('verdix:cmdk', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('verdix:cmdk', onOpen) }
  }, [])
  useEffect(() => { if (open) { setQ(''); setI(0); const id = setTimeout(() => inputRef.current?.focus(), 30); return () => clearTimeout(id) } }, [open])

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => { nav(to); setOpen(false) }
    return [
      ...MODULES.map(m => ({ id: 'm' + m.to, label: m.tab, hint: 'Module', run: () => go(m.to) })),
      { id: 'all', label: 'All India', hint: 'Region', run: () => { setState(null); go('/') } },
      ...states.map(s => ({ id: 's' + s, label: s, hint: 'Deep-dive', run: () => { setState(s); go('/state') } })),
      { id: 'ae', label: 'Switch to Assembly', hint: 'Arena', run: () => { setArena('AE'); setOpen(false) } },
      { id: 'ge', label: 'Switch to Lok Sabha', hint: 'Arena', run: () => { setArena('GE'); setOpen(false) } },
      { id: 'theme', label: 'Toggle light / dark theme', hint: 'Appearance', run: () => { toggleTheme(); setOpen(false) } },
    ]
  }, [states, nav, setState, setArena, toggleTheme])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items
    return items.filter(it => it.label.toLowerCase().includes(s) || it.hint.toLowerCase().includes(s))
  }, [items, q])
  useEffect(() => { setI(0) }, [q])
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' }) }, [i])

  if (!open) return null
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(filtered.length - 1, x + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[i]?.run() }
  }
  return (
    <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div onClick={e => e.stopPropagation()}
        className="absolute left-1/2 top-[14vh] -translate-x-1/2 w-[580px] max-w-[94vw] glass overflow-hidden animate-fadeUp">
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Jump to a state, module, or action…"
          className="w-full bg-transparent px-4 py-3.5 text-sm outline-none border-b border-white/[0.08] placeholder:text-faint" />
        <div ref={listRef} className="max-h-[52vh] overflow-auto py-1">
          {filtered.length === 0 && <div className="px-4 py-10 text-center text-faint text-sm">No matches for “{q}”</div>}
          {filtered.map((it, idx) => (
            <button key={it.id} data-idx={idx} onMouseMove={() => setI(idx)} onClick={() => it.run()}
              className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors ${idx === i ? 'bg-gold/15 text-ink' : 'text-muted'}`}>
              <span className="truncate">{it.label}</span>
              <span className="kicker shrink-0">{it.hint}</span>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-white/[0.08] flex gap-4 text-[10px] text-faint">
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
          <span className="ml-auto font-semibold">⌘K · Ctrl K · /</span>
        </div>
      </div>
    </div>
  )
}
