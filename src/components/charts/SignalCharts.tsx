import { useMemo } from 'react'
import { EChart } from './EChart'
import { baseOption, hhmm, timeAxisStyle, useChartTokens, valueAxisStyle } from './theme'
import { source } from '@/data/store'
import type { ChannelInfo, Machine } from '@/lib/types'

/**
 * Süreç sinyalleri (5 dk ortalama) ve devreye alma referansı. Her kanal ayrı küçük grafik:
 * öngörücü bakımın baktığı belirtiler (ör. rulman titreşiminin referansın kaç katı olduğu) burada görülür.
 */

const HOUR = 3600e3

export function fmtSignal(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  if (v !== 0 && Math.abs(v) < 0.01) return v.toExponential(1).replace('.', ',')
  return v.toLocaleString('tr-TR', { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 })
}

/** Son ölçülen değer (fırında son tutma anı; makine dururken son çalışma anı) */
function lastValue(points: { v: number | null }[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].v !== null) return points[i].v
  return null
}

function SignalChart({ c, data, now }: { c: ChannelInfo; data: { t: number; v: number | null }[]; now: number }) {
  const t = useChartTokens()
  const cur = lastValue(data)
  const ratio = c.ref && cur !== null && c.ref > 0 ? cur / c.ref : null
  const off = c.ref === 0 ? cur !== null && Math.abs(cur) > 5 : ratio !== null && (ratio > 1.3 || ratio < 0.8)
  const option = useMemo(
    () => ({
      ...baseOption(t),
      grid: { left: 48, right: 10, top: 10, bottom: 22 },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', valueFormatter: (v: number) => `${fmtSignal(v)} ${c.unit}` },
      xAxis: { ...timeAxisStyle(t), min: now - 48 * HOUR, max: now, axisLabel: { color: t.fg3, fontSize: 10, formatter: (v: number) => hhmm(v), hideOverlap: true } },
      yAxis: {
        ...valueAxisStyle(t),
        scale: true,
        // referans çizgisi her zaman görünsün
        min: (v: { min: number }) => (c.ref !== null ? Math.min(v.min, c.ref) : v.min),
        max: (v: { max: number }) => (c.ref !== null ? Math.max(v.max, c.ref) : v.max),
        axisLabel: { color: t.fg3, fontSize: 10, formatter: (v: number) => fmtSignal(v) } },
      series: [
        {
          type: 'line',
          name: c.label,
          data: data.map((p) => [p.t, p.v]),
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.5, color: off ? t.critical : t.series[0] },
          itemStyle: { color: off ? t.critical : t.series[0] },
          markLine:
            c.ref !== null
              ? { silent: true, symbol: 'none', data: [{ yAxis: c.ref, lineStyle: { color: t.fg3, type: 'dashed', width: 1 }, label: { formatter: 'referans', color: t.fg3, position: 'insideEndTop', fontSize: 10 } }] }
              : undefined,
        },
      ],
    }),
    [t, c, data, now, off],
  )
  return (
    <div className="rounded-lg border px-2 pb-1 pt-2">
      <div className="flex items-baseline justify-between gap-2 px-1 text-xs">
        <span className="truncate font-medium">{c.label}</span>
        <span className={off ? 'tnum shrink-0 font-semibold text-critical-text' : 'tnum shrink-0 text-fg-2'}>
          {fmtSignal(cur)} {c.unit}
          {ratio !== null && <span className="font-normal text-fg-3"> · {ratio.toFixed(1).replace('.', ',')}×</span>}
        </span>
      </div>
      <EChart option={option} height={120} label={`${c.label} son 48 saat`} />
    </div>
  )
}

export function SignalCharts({ m, now }: { m: Machine; now: number }) {
  const points = source.signals(m.id)
  const channels = m.channels ?? []
  if (!channels.length) return <p className="px-4 py-6 text-center text-xs text-fg-2">Bu makine için süreç sinyali tanımlı değil</p>
  return (
    <div className="grid grid-cols-4 gap-3 px-4 pb-4 pt-3">
      {channels.map((c) => (
        <SignalChart key={c.channel} c={c} now={now} data={points.filter((p) => p.t > now - 48 * HOUR).map((p) => ({ t: p.t, v: p[c.channel] }))} />
      ))}
    </div>
  )
}
