import { BUCKET_MS } from '@/lib/types'
import type { DataSource } from '@/data/DataSource'
import type { MachineSeries, SlowEvent, SpcPoint, StopEvent } from '@/lib/types'
import { createSeries, putBuckets } from '@/data/series'
import { MACHINES, PEOPLE, shiftOf } from '@/sim/factoryDef'
import { MachineSim, toolLifeCycles } from '@/sim/machineSim'
import { PlcRecorder, emptyRows } from '@/sim/plcRecorder'
import { MachineTransformer, emptyOutput } from './transform'
import type { TransformOutput } from './transform'

/**
 * SQL Server olmadan tüm hattı bellekte çalıştırır: simülatör → PLC satırları → dönüştürücü.
 * Testlerde ve hızlı doğrulamada kullanılır; üretimde aynı parçalar server/ altında SQL ile bağlanır.
 */
export interface LocalPipelineResult {
  source: DataSource
  output: TransformOutput
  /** makine → dilim indeksi → simülatörün gerçek yavaşlık nedeni */
  truth: Map<string, Uint8Array>
}

export function experienceFromDefs(machineId: string, t: number): number | null {
  const p = PEOPLE.find((x) => x.role === 'operator' && x.machineId === machineId && x.shiftId === shiftOf(t))
  return p ? p.experienceYears : null
}

export function runLocalPipeline(startT: number, endT: number, t0: number): LocalPipelineResult {
  const n = Math.round((endT - startT) / BUCKET_MS)
  const out = emptyOutput()
  const truth = new Map<string, Uint8Array>()
  const series = new Map<string, MachineSeries>()
  const spc = new Map<string, SpcPoint[]>()

  MACHINES.forEach((m, idx) => {
    const sim = new MachineSim(m, idx, t0)
    const rec = new PlcRecorder(m)
    const tr = new MachineTransformer({ id: m.id, idealCycleMs: 1000 / m.idealRate, toolLife: toolLifeCycles(m) }, { experienceAt: experienceFromDefs })
    const rows = emptyRows()
    const tv = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const s = sim.step(i, startT + i * BUCKET_MS)
      tv[i] = s.truthSlow
      rec.record(s, rows)
    }
    truth.set(m.id, tv)
    const mo = emptyOutput()
    rows.events.forEach((e) => tr.addEvent(e))
    const pv = new Map(rows.process.map((p) => [p.sampleT, p]))
    rows.counters.forEach((c) => tr.addCounter(c, pv.get(c.sampleT), mo))
    rows.quality.forEach((q) => tr.addQuality(q, mo))
    out.buckets.push(...mo.buckets)
    out.stops.push(...mo.stops)
    out.slows.push(...mo.slows)
    out.spc.push(...mo.spc)
    const ser = putBuckets(createSeries(startT, n), mo.buckets)
    ser.length = n
    series.set(m.id, ser)
    spc.set(m.id, mo.spc.map((g) => ({ t: g.t, mean: g.mean, range: g.range })))
  })

  // Olay çıktıları "upsert" akışıdır: aynı başlangıçlı son kayıt geçerli
  const dedupe = <T extends { machineId: string; start: number }>(list: T[]) => [...new Map(list.map((e) => [`${e.machineId}|${e.start}`, e])).values()]
  let id = 1
  const stops: StopEvent[] = dedupe(out.stops).map((e) => ({ id: id++, machineId: e.machineId, state: e.state as StopEvent['state'], reasonId: e.reasonId, start: e.start, end: e.end }))
  const slows: SlowEvent[] = dedupe(out.slows).map((e) => ({ id: id++, machineId: e.machineId, reasonId: e.reasonId, start: e.start, end: e.end, minSpeed: e.minSpeed }))

  const source: DataSource = {
    kind: 'mock',
    startT,
    now: () => startT + n * BUCKET_MS,
    machineSeries: (mid) => series.get(mid)!,
    stopEvents: () => stops,
    slowEvents: () => slows,
    spc: (mid) => spc.get(mid) ?? [],
    subscribe: () => () => {},
  }
  return { source, output: out, truth }
}
