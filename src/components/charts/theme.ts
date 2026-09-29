import type { EChartsCoreOption } from 'echarts/core'
import { useMemo } from 'react'
import { useFactory } from '@/data/store'

export interface ChartTokens {
  fg: string
  fg2: string
  fg3: string
  grid: string
  axis: string
  card: string
  border: string
  series: string[]
  good: string
  warning: string
  serious: string
  critical: string
  maint: string
  seqRamp: string[]
  neutral: string
}

const SEQ_LIGHT_TO_DARK = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b']

export function readTokens(): ChartTokens {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  const dark = document.documentElement.dataset.theme === 'dark'
  return {
    fg: v('--fg'),
    fg2: v('--fg-2'),
    fg3: v('--fg-3'),
    grid: v('--grid'),
    axis: v('--axis'),
    card: v('--card'),
    border: v('--border'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`)),
    good: v('--good'),
    warning: v('--warning'),
    serious: v('--serious'),
    critical: v('--critical'),
    maint: v('--maint'),
    neutral: v('--neutral'),
    // İlk basamak "sıfır" için nötr yüzey tonu; koyu yüzeyde artan değer parlar, açıkta koyulaşır.
    seqRamp: [v('--grid'), ...(dark ? [...SEQ_LIGHT_TO_DARK.slice(2)].reverse() : SEQ_LIGHT_TO_DARK.slice(2))],
  }
}

/** Tema değişince yeniden okunan token'lar. */
export function useChartTokens(): ChartTokens {
  const theme = useFactory((s) => s.theme)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readTokens(), [theme])
}

export function baseOption(t: ChartTokens): EChartsCoreOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { color: t.fg2, fontFamily: 'Inter Variable, system-ui, sans-serif', fontSize: 12 },
    tooltip: {
      backgroundColor: t.card,
      borderColor: t.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.fg, fontSize: 12 },
      extraCssText: 'box-shadow: 0 6px 20px rgba(0,0,0,.25); border-radius: 8px;',
    },
  }
}

export function timeAxisStyle(t: ChartTokens) {
  return {
    type: 'time' as const,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.fg3, hideOverlap: true, formatter: '{HH}:{mm}' },
    splitLine: { show: false },
  }
}

export function valueAxisStyle(t: ChartTokens) {
  return {
    type: 'value' as const,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.fg3 },
    splitLine: { lineStyle: { color: t.grid } },
  }
}

export function categoryAxisStyle(t: ChartTokens, data: string[]) {
  return {
    type: 'category' as const,
    data,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.fg2 },
  }
}

export const hhmm = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
