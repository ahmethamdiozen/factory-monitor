import { AlertOctagon, AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { baseOption, hhmm, timeAxisStyle, useChartTokens, valueAxisStyle } from '@/components/charts/theme'
import { EChart } from '@/components/charts/EChart'
import { MachineCard } from '@/components/machine/MachineCard'
import { STATE_STYLE } from '@/components/machine/StatusBadge'
import { Card, CardHeader } from '@/components/ui/card'
import { Meter } from '@/components/ui/meter'
import { StatTile } from '@/components/ui/stat-tile'
import { hourlyKpi, machinesOfLine } from '@/data/aggregate'
import { LINES, MACHINES } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'
import type { Severity } from '@/data/snapshot'
import { OEE_WORLD_CLASS, dayStartOf, num, pct } from '@/lib/kpi'
import { STATE_KEYS, STATE_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'

const SEV: Record<Severity, { Icon: typeof Info; cls: string; label: string }> = {
  critical: { Icon: OctagonAlert, cls: 'text-critical-text bg-critical/15', label: 'Kritik' },
  serious: { Icon: AlertOctagon, cls: 'text-serious-text bg-serious/20', label: 'Ciddi' },
  warning: { Icon: AlertTriangle, cls: 'text-warning-text bg-warning/20', label: 'Uyarı' },
  info: { Icon: Info, cls: 'text-fg-2 bg-wash', label: 'Bilgi' },
}

function AqpRow({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-[86px] shrink-0 text-fg-2">{label}</span>
      <Meter value={v} className="flex-1" height={5} />
      <span className="tnum w-11 text-right font-medium">{pct(v, 1)}</span>
    </div>
  )
}

export default function Overview() {
  const snap = useSnapshot()
  const tokens = useChartTokens()
  const { factoryDay: f, now } = snap

  const elapsed = (now - dayStartOf(now)) / 86400e3
  const targetTotal = MACHINES.reduce((a, m) => a + m.dailyTarget, 0)
  const projectedTotal = snap.machines.reduce((a, l) => a + l.proj.projected, 0)
  const okTotal = f.ok
  const slowCount = snap.machines.filter((m) => m.slow).length

  const trend = useMemo(
    () =>
      LINES.map((l) => ({
        line: l,
        data: hourlyKpi(machinesOfLine(l.id), now, 12, 2).map((h) => [h.t0 + 3600e3, h.kpi.oee]),
      })),
    [now],
  )

  const trendOption = useMemo(() => {
    const t = tokens
    return {
      ...baseOption(t),
      grid: { left: 40, right: 12, top: 28, bottom: 24 },
      legend: { top: 0, left: 0, data: LINES.map((l) => l.short), icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { color: t.fg2 } },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: 'axis',
        valueFormatter: (v: number) => `%${(v * 100).toFixed(1)}`,
      },
      xAxis: { ...timeAxisStyle(t), min: now - 24 * 3600e3, max: now, axisLabel: { color: t.fg3, formatter: (v: number) => hhmm(v), hideOverlap: true } },
      yAxis: { ...valueAxisStyle(t), min: 0.4, max: 1, axisLabel: { color: t.fg3, formatter: (v: number) => `%${Math.round(v * 100)}` } },
      series: [
        ...trend.map((d, i) => ({
          name: d.line.short,
          type: 'line',
          data: d.data,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: false,
          lineStyle: { width: 2 },
          itemStyle: { color: t.series[i] },
          emphasis: { focus: 'series' },
        })),
        {
          name: 'Dünya standardı',
          type: 'line',
          data: [],
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: t.fg3, type: 'dashed', width: 1 },
            label: { color: t.fg3, formatter: 'Dünya standardı %85', position: 'insideEndTop' },
            data: [{ yAxis: OEE_WORLD_CLASS }],
          },
        },
      ],
    }
  }, [tokens, trend, now])

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <section className="grid grid-cols-6 gap-4" aria-label="Fabrika özeti">
        <StatTile className="col-span-2" label="OEE · bugün" value={pct(f.oee, 1)} valueClass={f.oee >= OEE_WORLD_CLASS ? 'text-good-text' : ''} sub={`Dünya standardı %85 · fark ${f.oee >= OEE_WORLD_CLASS ? '+' : '−'}${Math.abs((f.oee - OEE_WORLD_CLASS) * 100).toFixed(1).replace('.', ',')} puan`}>
          <div className="mt-1 space-y-1.5">
            <AqpRow label="Kullanılabilirlik" v={f.availability} />
            <AqpRow label="Performans" v={f.performance} />
            <AqpRow label="Kalite" v={f.quality} />
          </div>
        </StatTile>

        <StatTile label="Günlük hedef" value={pct(okTotal / targetTotal, 0)} sub={<>Gün sonu tahmini <b className="tnum text-fg">{pct(projectedTotal / targetTotal, 0)}</b></>}>
          <Meter value={okTotal / targetTotal} marker={elapsed} className="mt-1" color={projectedTotal < targetTotal * 0.98 ? 'var(--serious)' : 'var(--series-1)'} />
        </StatTile>

        <StatTile label="Üretim · bugün" value={num(okTotal)} unit="parça" sub={<>Uygunsuz <b className="tnum text-fg">{num(f.nok)}</b> · ilk geçiş verimi <b className="tnum text-fg">{pct(f.quality, 1)}</b></>} />

        <StatTile label="Makine durumu" value={`${snap.counts.running}/${MACHINES.length}`} unit="çalışıyor">
          <div className="mt-1 flex h-2 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Makine durum dağılımı">
            {STATE_KEYS.map((k) => (snap.counts[k] > 0 ? <div key={k} className={STATE_STYLE[k].dot} style={{ flex: snap.counts[k] }} /> : null))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-fg-2">
            {STATE_KEYS.map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={cn('size-1.5 rounded-full', STATE_STYLE[k].dot)} />
                {STATE_LABEL[k]} <b className="tnum text-fg">{snap.counts[k]}</b>
              </span>
            ))}
          </div>
        </StatTile>

        <StatTile label="Dikkat gerektiren" value={String(slowCount + snap.behindCount)} unit="uyarı" sub={<>{slowCount} yavaş · {snap.behindCount} hedefte geride</>} />
      </section>

      <section className="flex flex-col gap-4" aria-label="Makineler">
        {LINES.map((l) => {
          const lk = snap.lineDay[l.id]
          const list = snap.machines.filter((m) => m.machine.lineId === l.id)
          return (
            <div key={l.id}>
              <div className="mb-2 flex items-baseline gap-3">
                <h2 className="text-[13px] font-semibold">{l.name}</h2>
                <span className="text-xs text-fg-2">
                  Hücre OEE <b className="tnum text-fg">{pct(lk.oee, 1)}</b> · {list.filter((m) => m.state === 0).length}/{list.length} çalışıyor
                </span>
              </div>
              <div className="grid grid-cols-4 gap-4">
                {list.map((m) => (
                  <MachineCard key={m.machine.id} live={m} now={now} />
                ))}
              </div>
            </div>
          )
        })}
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader title="Hücre bazlı OEE trendi" subtitle="Son 24 saat · 2 saatlik dilimler" />
          <div className="px-2 pb-2 pt-1">
            <EChart option={trendOption} height={250} label="Hücrelere göre OEE çizgi grafiği" />
          </div>
        </Card>
        <Card className="flex flex-col">
          <CardHeader title="Canlı uyarılar" subtitle={`${snap.alerts.length} kayıt`} />
          <ul className="mt-2 max-h-[290px] flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {snap.alerts.slice(0, 14).map((a) => {
              const s = SEV[a.severity]
              return (
                <li key={a.id}>
                  <Link to={`/makine/${a.machineId}`} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-wash focus-visible:outline-2 focus-visible:outline-s1">
                    <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md', s.cls)} title={s.label}>
                      <s.Icon className="size-3" />
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-xs font-medium">{a.title}</span>
                      <span className="block truncate text-[11px] text-fg-2">{a.detail}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
            {snap.alerts.length === 0 && <li className="px-2 py-6 text-center text-xs text-fg-2">Aktif uyarı yok</li>}
          </ul>
        </Card>
      </section>
    </div>
  )
}
