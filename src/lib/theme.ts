// Chart styling. Axis/grid/tooltip colors live in the registered ECharts theme
// objects below (light + dark) so charts flip with the app theme — the option
// helpers only describe structure, never colors. Series colors (party colors)
// stay in the options since they're theme-independent.
import type { Theme } from '../store'

// neutral mid-greys used for inline series labels / reference lines — legible on both themes
export const AXIS = '#8ba3a0'
export const MUTED = '#6e857c'
export const GRID = 'rgba(140,170,165,0.32)'
export const TXT = '#8ba3a0'
export const pctFmt = '{value}%'

const NUM = '"Plus Jakarta Sans", Outfit, sans-serif'
const SANS = 'Outfit, ui-sans-serif, sans-serif'

export const baseOpt = {
  backgroundColor: 'transparent',
  textStyle: { fontFamily: SANS },
  tooltip: { confine: true },
  grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
  legend: { icon: 'roundRect', itemWidth: 12, itemHeight: 8, top: 0 },
} as const

export const catAxis = (data: (string | number)[], extra: Record<string, unknown> = {}) => ({
  type: 'category', data,
  axisTick: { show: false },
  axisLabel: { fontFamily: NUM, fontSize: 11 },
  ...extra,
})
export const valAxis = (formatter?: string | ((v: number) => string), extra: Record<string, unknown> = {}) => ({
  type: 'value',
  axisLabel: { fontFamily: NUM, fontSize: 11, ...(formatter ? { formatter } : {}) },
  ...extra,
})

const mk = (ink: string, label: string, line: string, split: string, tipBg: string, tipBorder: string, tipInk: string) => ({
  textStyle: { color: ink, fontFamily: SANS },
  categoryAxis: { axisLine: { lineStyle: { color: line } }, axisLabel: { color: label }, axisTick: { show: false }, splitLine: { show: false } },
  valueAxis: { axisLine: { show: false }, axisLabel: { color: label }, splitLine: { lineStyle: { color: split, type: 'dashed', width: 1 } } },
  legend: { textStyle: { color: label } },
  tooltip: {
    backgroundColor: tipBg, borderColor: tipBorder, borderWidth: 1,
    textStyle: { color: tipInk, fontFamily: NUM },
    extraCssText: 'border-radius:10px; padding:8px 12px; box-shadow:0 12px 32px rgba(0,0,0,.4); backdrop-filter:blur(6px);',
  },
})

export const DARK_ECHARTS = mk('#c8e0dd', '#84a5a2', '#1d3b3d', '#123033', 'rgba(6,20,22,0.94)', 'rgba(0,168,181,0.28)', '#eafaf8')
export const LIGHT_ECHARTS = mk('#26463f', '#5a736a', '#c6d4cd', '#dde6df', 'rgba(255,255,255,0.97)', 'rgba(15,58,52,0.14)', '#0f3a34')
export const echartsTheme = (mode: Theme) => (mode === 'light' ? LIGHT_ECHARTS : DARK_ECHARTS)
// for inline chart labels/gridlines that the registered theme can't reach (Sankey labels, pie labels…)
export const labelColor = (mode: Theme) => (mode === 'light' ? '#4a6c63' : '#c8e0dd')
export const faintLine = (mode: Theme) => (mode === 'light' ? '#dde6df' : '#123033')

// vertical gradient fill for premium-looking columns (hex colour → faded foot)
export const vgrad = (c: string) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c }, { offset: 1, color: c + '55' }] })

/** Dual-axis "conversion" chart: each party's SEATS WON (gradient columns, left axis)
 *  and its VOTE SHARE % (line, right axis) on one election timeline. Multi-series — one
 *  entry per selected party; bars group, lines overlay. Colours stay here. */
export function voteSeatOption(o: {
  years: (number | string)[]
  series: { label: string; color: string; seats: (number | null)[]; share: (number | null)[] }[]
  seatMax?: number
  shareMax?: number
  glow?: boolean
}) {
  const { years, series, seatMax, shareMax, glow } = o
  const one = series.length === 1
  const bars = series.map(s => ({
    name: `${s.label} · seats`, type: 'bar', yAxisIndex: 0, z: 1,
    barMaxWidth: one ? 38 : 22, barGap: '10%', barCategoryGap: '32%',
    itemStyle: { color: vgrad(s.color), borderRadius: [4, 4, 0, 0] }, data: s.seats,
    ...(one ? { label: { show: true, position: 'top', color: AXIS, fontSize: 10, fontWeight: 600, formatter: (q: { value: number | null }) => (q.value != null ? String(q.value) : '') } } : {}),
  }))
  const lines = series.map(s => ({
    name: `${s.label} · vote %`, type: 'line', yAxisIndex: 1, smooth: 0.4, symbol: 'circle', symbolSize: one ? 7 : 5, z: 3, connectNulls: true,
    lineStyle: { width: one ? 3 : 2.5, color: s.color, ...(glow ? { shadowBlur: 11, shadowColor: s.color + '55' } : {}) },
    itemStyle: { color: s.color }, data: s.share,
    emphasis: { focus: 'series' }, blur: { lineStyle: { opacity: 0.18 }, itemStyle: { opacity: 0.18 } },
  }))
  return {
    ...baseOpt,
    tooltip: {
      ...baseOpt.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0, padding: 0,
      extraCssText: 'box-shadow:none;', confine: true,
      formatter: (ps: { axisValue: string; seriesName: string; data: number | null; color: string }[]) => {
        if (!ps?.length) return ''
        type Row = { name: string; seats?: number | null; share?: number | null; color?: string }
        const by: Record<string, Row> = {}
        ps.forEach(p => {
          const m = /^(.*) · (seats|vote %)$/.exec(p.seriesName); if (!m) return
          const e = by[m[1]] || (by[m[1]] = { name: m[1] })
          if (m[2] === 'seats') e.seats = p.data; else { e.share = p.data; e.color = p.color }
        })
        const rows = Object.values(by).sort((a, b) => (b.seats ?? -1) - (a.seats ?? -1) || (b.share ?? -1) - (a.share ?? -1))
        const body = rows.map(e => {
          const c = e.color || '#888'
          const seats = e.seats != null ? String(e.seats) : '–'
          const share = e.share != null ? e.share + '%' : '–'
          return `<div style="display:flex;align-items:center;gap:9px;padding:2.5px 0;">`
            + `<span style="width:9px;height:9px;border-radius:50%;background:${c};box-shadow:0 0 7px ${c}99;flex:none;"></span>`
            + `<span style="flex:1;font-size:12.5px;font-weight:600;color:rgb(var(--s100));white-space:nowrap;">${e.name}</span>`
            + `<span style="width:40px;text-align:right;font-size:12.5px;font-weight:700;color:rgb(var(--s50));font-family:'Plus Jakarta Sans',sans-serif;">${seats}</span>`
            + `<span style="width:52px;text-align:right;font-size:12px;font-weight:600;color:${e.share != null ? c : 'rgb(var(--s400))'};font-family:'Plus Jakarta Sans',sans-serif;">${share}</span>`
            + `</div>`
        }).join('')
        return `<div style="min-width:238px;padding:12px 14px 11px;border-radius:14px;font-family:Outfit,sans-serif;`
          + `background:linear-gradient(158deg,rgb(var(--s800)),rgb(var(--s900)));border:1px solid rgb(var(--s500) / .28);box-shadow:0 20px 46px -14px rgb(0 0 0 / .6);">`
          + `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:9px;padding-bottom:8px;border-bottom:1px solid rgb(var(--s500) / .22);">`
          +   `<span style="font-size:16px;font-weight:700;color:rgb(var(--s50));font-family:'Plus Jakarta Sans',sans-serif;">${ps[0].axisValue}</span>`
          +   `<span style="font-size:9px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:rgb(var(--s400));">seats · vote share</span>`
          + `</div>`
          + `<div style="display:flex;flex-direction:column;gap:1px;">${body}</div></div>`
      },
    },
    legend: { show: false },
    grid: { left: 8, right: 18, top: 14, bottom: 8, containLabel: true },
    xAxis: catAxis(years.map(String), { boundaryGap: true }),
    yAxis: [
      { ...valAxis(undefined, seatMax != null ? { max: seatMax } : {}), name: 'seats', nameGap: 12, nameTextStyle: { color: AXIS, fontSize: 10 }, splitLine: { lineStyle: { type: 'dashed' } } },
      { ...valAxis(pctFmt, { ...(shareMax != null ? { max: shareMax } : {}), position: 'right' }), name: 'vote %', nameGap: 12, nameTextStyle: { color: AXIS, fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [...bars, ...lines],
  }
}
