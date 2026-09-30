import { useMemo } from 'react'
import { EChart } from '@/components/charts/EChart'
import { baseOption, hhmm, useChartTokens } from '@/components/charts/theme'
import { REASON_BY_ID, SLOW_REASONS } from '@/data/registry'
import type { Segment, SlowSegment } from '@/data/machineView'
import { fmtDuration } from '@/lib/kpi'
import { STATE_KEYS, STATE_LABEL } from '@/lib/types'

/** Durum zaman çizgisi (Gantt benzeri): üst şerit makine durumu, alt şerit yavaşlık. */
export function StateTimeline({ segments, slow, from, to, height = 130 }: { segments: Segment[]; slow: SlowSegment[]; from: number; to: number; height?: number }) {
  const t = useChartTokens()
  const option = useMemo(() => {
    const colors = [t.good, t.critical, t.maint, t.warning]
    const stateData = segments.map((s) => {
      const label = s.state === 0 ? 'Çalışıyor' : `${STATE_LABEL[STATE_KEYS[s.state]]} · ${REASON_BY_ID[s.reasonId]?.label}`
      return { value: [0, s.start, s.end, label, fmtDuration((s.end - s.start) / 1000)], itemStyle: { color: colors[s.state] } }
    })
    const slowData = slow.map((s) => ({
      value: [1, s.start, s.end, `Yavaş %${Math.round(s.avgSpeed * 100)} · ${SLOW_REASONS[s.reasonId]?.label}`, fmtDuration((s.end - s.start) / 1000)],
      itemStyle: { color: t.serious },
    }))
    return {
      ...baseOption(t),
      grid: { left: 64, right: 12, top: 6, bottom: 22 },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        formatter: (p: { value: (number | string)[] }) => `<b>${p.value[3]}</b><br/>${hhmm(p.value[1] as number)} – ${hhmm(p.value[2] as number)} · ${p.value[4]}`,
      },
      xAxis: {
        type: 'time',
        min: from,
        max: to,
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.fg3, formatter: (v: number) => hhmm(v), hideOverlap: true },
        splitLine: { show: true, lineStyle: { color: t.grid } },
      },
      yAxis: {
        type: 'category',
        data: ['Durum', 'Yavaşlık'],
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.fg2 },
      },
      series: [
        {
          type: 'custom',
          renderItem: (_: unknown, api: any) => {
            const lane = api.value(0)
            const a = api.coord([api.value(1), lane])
            const b = api.coord([api.value(2), lane])
            const h = api.size([0, 1])[1] * 0.62
            return {
              type: 'rect',
              shape: { x: a[0], y: a[1] - h / 2, width: Math.max(1, b[0] - a[0] - 1), height: h, r: 3 },
              style: { fill: api.visual('color') },
            }
          },
          encode: { x: [1, 2], y: 0 },
          data: [...stateData, ...slowData],
        },
      ],
    }
  }, [t, segments, slow, from, to])
  return <EChart option={option} height={height} label="Makine durum zaman çizgisi" />
}
