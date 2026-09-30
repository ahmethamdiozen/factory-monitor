import { useMemo } from 'react'
import { EChart } from '@/components/charts/EChart'
import { baseOption, useChartTokens } from '@/components/charts/theme'
import type { HourBar } from '@/data/shiftView'
import { num } from '@/lib/kpi'

/** Vardiya boyunca saat saat üretim: hedefte mavi, hedef altında turuncu, kesik çizgi hedef. */
export function HourBars({ bars, height = 200, big = false }: { bars: HourBar[]; height?: number; big?: boolean }) {
  const t = useChartTokens()
  const option = useMemo(() => {
    const labels = bars.map((b) => `${String(new Date(b.start).getHours()).padStart(2, '0')}`)
    const full = bars.find((b) => !b.partial && !b.future)?.target ?? bars[0]?.target ?? 0
    return {
      ...baseOption(t),
      grid: { left: big ? 8 : 44, right: 8, top: big ? 26 : 16, bottom: 24, containLabel: big },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const b = bars[p[0].dataIndex]
          if (b.future) return `${labels[p[0].dataIndex]}:00 · henüz başlamadı`
          return `<b>${labels[p[0].dataIndex]}:00</b><br/>Üretilen ${num(b.ok)} · hedef ${num(b.target)}${b.partial ? ' (saat sürüyor)' : ''}`
        },
      },
      xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.fg2, fontSize: big ? 15 : 12 } },
      yAxis: { type: 'value', show: !big, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.fg3 } },
      series: [
        {
          type: 'bar',
          barWidth: '62%',
          data: bars.map((b) => ({
            value: b.future ? null : b.ok,
            itemStyle: { color: b.ok >= b.target * 0.95 ? t.series[0] : t.series[1], borderRadius: [4, 4, 0, 0], opacity: b.partial ? 0.7 : 1 },
          })),
          label: { show: big, position: 'top', color: t.fg2, fontSize: 12, formatter: (p: { value: number | null }) => (p.value == null ? '' : num(p.value)) },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: t.fg3, type: 'dashed', width: 1.5 },
            label: { color: t.fg3, formatter: `Saatlik hedef ${num(full)}`, position: 'insideEndTop', fontSize: big ? 13 : 11 },
            data: [{ yAxis: full }],
          },
        },
      ],
    }
  }, [bars, t, big])
  return <EChart option={option} height={height} label="Saat saat üretim ve hedef" />
}
