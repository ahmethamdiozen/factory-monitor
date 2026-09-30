import { Crown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EChart } from '@/components/charts/EChart'
import { baseOption, categoryAxisStyle, useChartTokens, valueAxisStyle } from '@/components/charts/theme'
import { Avatar } from '@/components/machine/OperatorChip'
import { Card, CardHeader } from '@/components/ui/card'
import { Meter } from '@/components/ui/meter'
import { Segmented } from '@/components/ui/segmented'
import { LINES, MACHINES, PEOPLE, SHIFTS, foremanFor, operatorFor, shiftOf } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'
import { source } from '@/data/store'
import { fmtDuration, idxOf, machineKpi, num, pct, sumKpi } from '@/lib/kpi'
import type { Kpi } from '@/lib/kpi'
import type { ShiftId } from '@/lib/types'
import { cn } from '@/lib/utils'

const HOUR = 3600e3

/** Bir vardiyanın "şimdi"ye göre en son örneği (devam ediyorsa yarım). */
function lastInstance(now: number, id: ShiftId): { start: number; end: number; ongoing: boolean } {
  const sh = SHIFTS.find((s) => s.id === id)!
  const d0 = new Date(now)
  d0.setHours(0, 0, 0, 0)
  for (let back = 0; back < 4; back++) {
    const start = d0.getTime() - back * 24 * HOUR + sh.startHour * HOUR
    if (start <= now) return { start, end: Math.min(start + 8 * HOUR, now), ongoing: start + 8 * HOUR > now }
  }
  return { start: now, end: now, ongoing: false }
}

function shiftLabel(inst: { start: number }, now: number) {
  const d = new Date(inst.start)
  const dn = new Date(now)
  const day = d.getDate() === dn.getDate() ? 'bugün' : 'dün'
  return `${day} ${String(d.getHours()).padStart(2, '0')}:00`
}

export default function People() {
  const snap = useSnapshot()
  const t = useChartTokens()
  const now = snap.now
  const [sel, setSel] = useState<ShiftId>(snap.shiftId)

  const data = useMemo(() => {
    const kpiFor = (ids: string[], inst: { start: number; end: number }): Kpi =>
      sumKpi(ids.map((id) => machineKpi(source.machineSeries(id), MACHINES.find((m) => m.id === id)!, Math.max(0, idxOf(source, inst.start)), idxOf(source, inst.end))))
    const all = MACHINES.map((m) => m.id)
    const shifts = SHIFTS.map((s) => {
      const inst = lastInstance(now, s.id)
      return { shift: s, inst, kpi: kpiFor(all, inst) }
    })
    const inst = lastInstance(now, sel)
    const ops = MACHINES.map((m) => {
      const k = machineKpi(source.machineSeries(m.id), m, Math.max(0, idxOf(source, inst.start)), idxOf(source, inst.end))
      return { m, person: operatorFor(m.id, sel)!, k }
    })
    const bestOee = Math.max(...ops.map((o) => o.k.oee))
    const foremen = LINES.map((l) => ({ l, person: foremanFor(l.id, sel)!, k: kpiFor(MACHINES.filter((m) => m.lineId === l.id).map((m) => m.id), inst) }))
    return { shifts, inst, ops, bestOee, foremen }
  }, [now, sel])

  const compareOption = useMemo(() => {
    const metrics = ['OEE', 'Kullanılabilirlik', 'Performans', 'Kalite']
    const pick = (k: Kpi) => [k.oee, k.availability, k.performance, k.quality]
    return {
      ...baseOption(t),
      grid: { left: 44, right: 14, top: 30, bottom: 26 },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: t.fg2 } },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => pct(v, 1) },
      xAxis: categoryAxisStyle(t, metrics),
      yAxis: { ...valueAxisStyle(t), min: 0, max: 1, axisLabel: { color: t.fg3, formatter: (v: number) => `%${Math.round(v * 100)}` } },
      series: data.shifts.map((s, i) => ({
        name: `${s.shift.name} (${shiftLabel(s.inst, now)}${s.inst.ongoing ? ' · devam ediyor' : ''})`,
        type: 'bar',
        data: pick(s.kpi),
        barMaxWidth: 34,
        barGap: '12%',
        itemStyle: { color: t.series[i], borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', color: t.fg2, fontSize: 11, formatter: (p: { value: number }) => `${(p.value * 100).toFixed(0)}` },
      })),
    }
  }, [data.shifts, t, now])

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <section className="grid grid-cols-5 gap-4">
        <Card className="col-span-3">
          <CardHeader title="Vardiya karşılaştırması" subtitle="Her vardiyanın en son örneği · tüm fabrika" />
          <div className="px-2 pb-2 pt-1"><EChart option={compareOption} height={280} label="Vardiyalara göre OEE, kullanılabilirlik, performans ve kalite" /></div>
        </Card>
        <Card className="col-span-2">
          <CardHeader title="Vardiya özeti" />
          <table className="mt-2 w-full text-xs">
            <thead className="text-fg-2">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">Vardiya</th>
                <th className="px-2 py-2 text-right font-medium">OK</th>
                <th className="px-2 py-2 text-right font-medium">Hurda</th>
                <th className="px-2 py-2 text-right font-medium">Arıza dk</th>
                <th className="px-4 py-2 text-right font-medium">OEE</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {data.shifts.map((s, i) => (
                <tr key={s.shift.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 rounded-sm" style={{ background: `var(--series-${i + 1})` }} />
                      <div className="leading-tight">
                        <div className="font-medium">{s.shift.name}</div>
                        <div className="text-[11px] text-fg-2">{shiftLabel(s.inst, now)}{s.inst.ongoing ? ' · devam ediyor' : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 text-right">{num(s.kpi.ok)}</td>
                  <td className="px-2 text-right">{pct(1 - s.kpi.quality, 2)}</td>
                  <td className="px-2 text-right">{Math.round(s.kpi.loss.breakdown / 60)}</td>
                  <td className="px-4 text-right font-semibold">{pct(s.kpi.oee, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 pt-1 text-[11px] leading-snug text-fg-2">Vardiya farkları çoğunlukla makine kaynaklı duruşları ve iş yükünü yansıtır; kişi bazlı performans değerlendirmesi için tek başına kullanılmamalıdır.</p>
        </Card>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={sel} onChange={setSel} options={SHIFTS.map((s) => ({ value: s.id, label: `${s.id} · ${String(s.startHour).padStart(2, '0')}–${String(s.endHour).padStart(2, '0')}` }))} label="Vardiya" />
        <span className="text-xs text-fg-2">
          {SHIFTS.find((s) => s.id === sel)!.name} · {shiftLabel(data.inst, now)}
          {sel === shiftOf(now) && ' · şu an başında'}
        </span>
      </div>

      <section className="grid grid-cols-3 gap-4">
        {data.foremen.map((f) => (
          <Card key={f.l.id} className="flex items-center gap-3 px-4 py-3.5">
            <Avatar person={f.person} size={48} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-sm font-semibold">{f.person.name}</div>
              <div className="text-xs text-fg-2">Foreman · {f.l.name} · {f.person.experienceYears} yıl</div>
              <div className="mt-2 flex items-center gap-2">
                <Meter value={f.k.oee} className="flex-1" height={5} />
                <span className="tnum text-xs font-semibold">OEE {pct(f.k.oee, 0)}</span>
              </div>
            </div>
            <div className="text-right text-xs text-fg-2">
              <div className="tnum text-base font-semibold text-fg">{num(f.k.ok)}</div>
              adet
            </div>
          </Card>
        ))}
      </section>

      <section aria-label="Operatörler" className="grid grid-cols-4 gap-4">
        {data.ops.map(({ m, person, k }) => {
          const best = k.oee === data.bestOee
          return (
            <Link key={m.id} to={`/makine/${m.id}`} className="group flex flex-col gap-3 rounded-xl border bg-card p-3.5 hover:bg-wash focus-visible:outline-2 focus-visible:outline-s1">
              <div className="flex items-center gap-3">
                <Avatar person={person} size={44} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{person.name}</span>
                    {best && <Crown className="size-3.5 shrink-0 text-warning-text" aria-label="Vardiyanın en yüksek OEE'si" />}
                  </div>
                  <div className="text-xs text-fg-2">{m.code} · {person.experienceYears < 1 ? `${Math.round(person.experienceYears * 12)} aylık` : `${String(person.experienceYears).replace('.', ',')} yıl`}</div>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="text-fg-2">OEE</span>
                  <span className={cn('tnum text-sm font-semibold', k.oee < 0.65 && 'text-critical-text')}>{pct(k.oee, 1)}</span>
                </div>
                <Meter value={k.oee} marker={0.85} height={5} color={k.oee < 0.65 ? 'var(--serious)' : 'var(--series-1)'} />
              </div>
              <dl className="grid grid-cols-3 gap-2 text-[11px]">
                <div><dt className="text-fg-2">Üretim</dt><dd className="tnum text-xs font-medium">{num(k.ok)}</dd></div>
                <div><dt className="text-fg-2">NOK</dt><dd className="tnum text-xs font-medium">{pct(k.total ? k.nok / k.total : 0, 1)}</dd></div>
                <div><dt className="text-fg-2">Duruş</dt><dd className="tnum text-xs font-medium">{fmtDuration(k.totalSec - k.runSec - k.plannedStopSec)}</dd></div>
              </dl>
            </Link>
          )
        })}
      </section>
      <p className="text-[11px] text-fg-2">Toplam kadro (yer tutucu): {PEOPLE.filter((p) => p.role === 'operator').length} operatör · {PEOPLE.filter((p) => p.role === 'foreman').length} foreman. Fotoğraflar cihazda üretilen yer tutucu avatarlardır.</p>
    </div>
  )
}
