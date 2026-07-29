// Party + alliance colours — single source of colour truth.
// Tuned to read well on BOTH the dark and light canvases: the previously faded
// neon-light tones (yellow/lime/light-cyan/light-slate) are deepened to mid-tones
// that stay vivid on dark yet keep enough contrast on white.
export const PARTY_COLORS: Record<string, string> = {
  BJP: '#f97316', INC: '#3b82f6', AITC: '#22c55e', DMK: '#dc2626', AIADMK: '#16a34a',
  SP: '#ef4444', BSP: '#1d4ed8', CPM: '#b91c1c', CPI: '#dc2626', 'CPI(ML)L': '#991b1b',
  TDP: '#eab308', YSRCP: '#0284c7', JSP: '#e11d48', BRS: '#db2777', TRS: '#db2777',
  SHS: '#ea580c', 'SHS(UBT)': '#9a3412', NCP: '#0d9488', 'NCP(SP)': '#0f766e',
  'JD(U)': '#0e7490', RJD: '#15803d', JMM: '#065f46', BJD: '#65a30d', AAP: '#0891b2',
  TVK: '#a21caf', SKM: '#7c3aed', SDF: '#6d28d9', JKNC: '#b45309', JKPDP: '#3f6212',
  AIMIM: '#047857', IUML: '#059669', INLD: '#4d7c0f', JJP: '#a16207', AGP: '#ca8a04',
  NPP: '#be185d', NDPP: '#be123c', NPF: '#9f1239', MNF: '#0369a1', ZPM: '#075985',
  AINRC: '#d97706', IND: '#475569', NOTA: '#64748b',
}
export const ALLIANCE_COLORS: Record<string, string> = {
  'BJP Alliance': '#f97316', 'INC Alliance': '#3b82f6', 'LDF': '#dc2626',
  'Left Front': '#b91c1c', 'TVK+': '#a21caf', 'AITC+': '#16a34a',
  'Unaligned': '#6b7280', 'Independent/Unaligned': '#64748b',
}
export const colorFor = (party: string, alliance?: string | null): string => {
  if (PARTY_COLORS[party]) return PARTY_COLORS[party]
  if (alliance) { const base = alliance.replace(/ \(.*\)$/, ''); if (ALLIANCE_COLORS[base]) return ALLIANCE_COLORS[base] }
  return '#475569'
}

// ── Contrast / legibility ───────────────────────────────────────────────────
// World-class rule (dataviz): TEXT wears an ink token; a party colour lives in a
// swatch/mark beside it. Where a colour must BE text (KPI values, coloured party
// labels), `readable()` nudges it toward the theme's text pole just until it clears
// WCAG AA (~4.5:1) on that theme's card surface — preserving hue, fixing e.g. bright
// orange/yellow that vanish on the cream light theme. Compute it; never eyeball it.
type Mode = 'light' | 'dark'
// representative card surfaces (light ≈ white-on-cream card; dark ≈ teal card face)
const CARD_SURFACE: Record<Mode, RGB> = { light: [244, 245, 240], dark: [12, 34, 36] }
const TEXT_POLE: Record<Mode, RGB> = { light: [10, 30, 26], dark: [236, 250, 248] }
type RGB = [number, number, number]

const toRgb = (h: string): RGB => {
  const s = h.replace('#', '')
  const n = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const relLum = ([r, g, b]: RGB) => {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: RGB, b: RGB) => { const l1 = relLum(a), l2 = relLum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }

/** A version of `hex` that meets `min` contrast on the theme's card surface, hue preserved. */
export function readable(hex: string, mode: Mode, min = 4.5): string {
  const surface = CARD_SURFACE[mode], pole = TEXT_POLE[mode], base = toRgb(hex)
  if (contrast(base, surface) >= min) return hex
  for (let t = 0.12; t <= 1.0001; t += 0.12) {
    const mix: RGB = [base[0] + (pole[0] - base[0]) * t, base[1] + (pole[1] - base[1]) * t, base[2] + (pole[2] - base[2]) * t]
    if (contrast(mix, surface) >= min) return toHex(...mix)
  }
  return toHex(...pole)
}
