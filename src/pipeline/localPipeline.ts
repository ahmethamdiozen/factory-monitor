import { BUCKET_MS } from '@/lib/types'
import type { DataSource } from '@/data/DataSource'
import type { MachineSeries, SlowEvent, SpcPoint, StopEvent } from '@/lib/types'
import { createSeries, putBuckets } from '@/data/series'
import { EMPLOYEE_NO, FURNACE_RECIPES, LINES, MACHINES, PEOPLE, shiftOf } from '@/sim/factoryDef'
import { PredictiveSession } from '@/ml/session'
import { MachineSim, toolLifeCycles } from '@/sim/machineSim'
import { PlcRecorder, emptyRows } from '@/sim/plcRecorder'
import { MachineTransformer, emptyOutput } from './transform'
import type { MachineInfo, TransformOutput } from './transform'
import type { TagRow } from './rows'
import type { Machine } from '@/lib/types'
import type { NotifyMachine } from '@/ml/notify'
import { channelBaselines, tagDefsOf } from '@/sim/tags'
import { SignalAggregator } from '@/data/signals'
import { SerialRouter } from '@/sim/serialRouter'
import type { RouterRows } from '@/sim/serialRouter'
import { TraceStore } from './trace'
import type { SignalPoint } from '@/data/signals'

/**
 * SQL Server olmadan tüm hattı bellekte çalıştırır: simülatör → PLC satırları → dönüştürücü.
 * Testlerde ve hızlı doğrulamada kullanılır; üretimde aynı parçalar server/ altında SQL ile bağlanır.
 */
export interface LocalPipelineResult {
  source: DataSource
  output: TransformOutput
  /** makine → dilim indeksi → simülatörün gerçek yavaşlık nedeni */
  truth: Map<string, Uint8Array>
  /** MES satırları (seri no yönlendiricisinin yazdıkları) */
  routed: RouterRows
}

export function experienceFromDefs(machineId: string, t: number): number | null {
  const p = PEOPLE.find((x) => x.role === 'operator' && x.machineId === machineId && x.shiftId === shiftOf(t))
  return p ? p.experienceYears : null
}

/** Statik tanımdan dönüştürücü bilgisi (gerçekte collector bunu SQL Server'daki referans tablolarından kurar) */
export function machineInfoOf(m: Machine, idx: number): MachineInfo {
  const tags = tagDefsOf(m, idx)
  const recipe = FURNACE_RECIPES.find((r) => r.machineId === m.id)
  return { id: m.id, type: m.type, idealCycleMs: 1000 / m.idealRate, toolLife: toolLifeCycles(m), tags, ref: channelBaselines(tags), recipe }
}

/** t anında makinenin operatörünün sicil numarası (statik tanımdan) */
export function operatorNoFromDefs(machineId: string, t: number): string | null {
  const p = PEOPLE.find((x) => x.role === 'operator' && x.machineId === machineId && x.shiftId === shiftOf(t))
  return p ? EMPLOYEE_NO[p.id] : null
}

export function notifyMachinesFromDefs(): NotifyMachine[] {
  return MACHINES.map((m, idx) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    lineId: m.lineId,
    lineShort: LINES.find((l) => l.id === m.lineId)!.short,
    type: m.type,
    ref: machineInfoOf(m, idx).ref!,
  }))
}

/** Etiket satırlarını okuma anına göre gruplar */
export function tagsBySample(rows: TagRow[]): Map<number, TagRow[]> {
  const out = new Map<number, TagRow[]>()
  for (const r of rows) {
    const list = out.get(r.sampleT)
    if (list) list.push(r)
    else out.set(r.sampleT, [r])
  }
  return out
}

export function runLocalPipeline(startT: number, endT: number, t0: number): LocalPipelineResult {
  const n = Math.round((endT - startT) / BUCKET_MS)
  const out = emptyOutput()
  const truth = new Map<string, Uint8Array>()
  const series = new Map<string, MachineSeries>()
  const spc = new Map<string, SpcPoint[]>()
  const signals = new Map<string, SignalPoint[]>()

  const predictive = new PredictiveSession(notifyMachinesFromDefs())
  const allBuckets: TransformOutput['buckets'] = []
  // Makineler aynı zaman sırasıyla ilerler (seri numarası yönlendiricisi bunu gerektirir)
  const units = MACHINES.map((m, idx) => ({ m, sim: new MachineSim(m, idx, t0), rec: new PlcRecorder(m), rows: emptyRows(), tv: new Uint8Array(n) }))
  const router = new SerialRouter(MACHINES, t0, { operatorAt: operatorNoFromDefs })
  const routed: RouterRows = { opEvents: [], ncrs: [], mrb: [] }
  router.init(startT, routed)
  for (let i = 0; i < n; i++) {
    const t = startT + i * BUCKET_MS
    for (const u of units) {
      const s = u.sim.step(i, t)
      u.tv[i] = s.truthSlow
      u.rec.record(s, u.rows)
      router.setLot(u.m.id, s.materialLot)
      router.complete(u.m.id, t + BUCKET_MS, s.produced, s.rejects, routed)
    }
    router.tick(t + BUCKET_MS, routed)
  }
  const trace = new TraceStore()
  routed.opEvents.forEach((e) => trace.addOpEvent(e))
  routed.ncrs.forEach((e) => trace.addNcr(e))
  routed.mrb.forEach((e) => trace.addMrb(e))

  units.forEach(({ m, rows, tv }, idx) => {
    const tr = new MachineTransformer(machineInfoOf(m, idx), { experienceAt: experienceFromDefs })
    truth.set(m.id, tv)
    const mo = emptyOutput()
    rows.events.forEach((e) => tr.addEvent(e))
    const pv = new Map(rows.process.map((p) => [p.sampleT, p]))
    const tags = tagsBySample(rows.tags)
    rows.counters.forEach((c) => tr.addCounter(c, pv.get(c.sampleT), mo, tags.get(c.sampleT)))
    rows.quality.forEach((q) => tr.addQuality(q, mo))
    const agg = new SignalAggregator(m.type, endT - startT)
    for (const b of mo.buckets) agg.add(b)
    signals.set(m.id, agg.list())
    out.buckets.push(...mo.buckets)
    allBuckets.push(...mo.buckets)
    out.stops.push(...mo.stops)
    out.slows.push(...mo.slows)
    out.spc.push(...mo.spc)
    out.cycles.push(...mo.cycles)
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
  const cycles = [...out.cycles].sort((a, b) => a.end - b.end)

  // Öngörücü bakım: tüm makinelerin dilimleri zaman sırasıyla
  allBuckets.sort((a, b) => a.t - b.t || a.machineId.localeCompare(b.machineId))
  for (const b of allBuckets) predictive.add(b.machineId, b)

  const source: DataSource = {
    kind: 'mock',
    startT,
    now: () => startT + n * BUCKET_MS,
    machineSeries: (mid) => series.get(mid)!,
    stopEvents: () => stops,
    slowEvents: () => slows,
    spc: (mid) => spc.get(mid) ?? [],
    signals: (mid) => signals.get(mid) ?? [],
    partOps: () => trace.partOps(),
    ncrs: () => trace.ncrs(),
    furnaceCycles: () => cycles,
    riskSeries: (mid) => predictive.riskSeries(mid),
    notifications: () => predictive.notifications(),
    setNotificationStatus: (id, st) => predictive.setStatus(id, st, startT + n * BUCKET_MS),
    subscribe: () => () => {},
  }
  return { source, output: out, truth, routed }
}
