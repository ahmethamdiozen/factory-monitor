import { source } from '@/data/store'
import { MACHINES } from '@/data/mock/factory'
import { idxOf, machineKpi, sumKpi } from '@/lib/kpi'
import type { Kpi } from '@/lib/kpi'
import type { Machine } from '@/lib/types'

const HOUR = 3600 * 1000

/** Saat başlarına hizalı son n dilim (sonuncusu içinde bulunulan saat). */
export function hourSlices(now: number, n: number): { t0: number; t1: number }[] {
  const cur = Math.floor(now / HOUR) * HOUR
  const out: { t0: number; t1: number }[] = []
  for (let k = n - 1; k >= 0; k--) {
    const t0 = cur - k * HOUR
    out.push({ t0, t1: Math.min(t0 + HOUR, now) })
  }
  return out
}

export function kpiFor(machines: Machine[], t0: number, t1: number): Kpi {
  const i0 = Math.max(0, idxOf(source, t0))
  const i1 = idxOf(source, t1)
  return sumKpi(machines.map((m) => machineKpi(source.machineSeries(m.id), m, i0, i1)))
}

export function hourlyKpi(machines: Machine[], now: number, n: number): { t0: number; t1: number; kpi: Kpi }[] {
  return hourSlices(now, n).map((s) => ({ ...s, kpi: kpiFor(machines, s.t0, s.t1) }))
}

export const machinesOfLine = (lineId: string) => MACHINES.filter((m) => m.lineId === lineId)
