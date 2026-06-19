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
