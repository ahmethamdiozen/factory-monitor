import type { DataSource } from '@/data/DataSource'
import { DAY_START_HOUR, REASON_BY_ID } from '@/data/mock/factory'
import { BUCKET_MS, BUCKET_SEC, STATE } from '@/lib/types'
import type { Machine, MachineSeries, StopEvent, WindowKey } from '@/lib/types'

export interface LossSec {
  breakdown: number
  changeover: number
  microstop: number
  waiting: number
  speed: number
  quality: number
}

export interface Kpi {
  /** Pencere süresi (sn) */
  totalSec: number
  plannedStopSec: number
  /** Planlı üretim süresi = totalSec − plannedStopSec */
  plannedSec: number
  runSec: number
  total: number
  ok: number
  nok: number
  availability: number
  performance: number
  quality: number
  oee: number
  /** Takvim süresine göre (planlı duruşlar dahil) */
  teep: number
  loss: LossSec
}

export const OEE_WORLD_CLASS = 0.85

const emptyLoss = (): LossSec => ({ breakdown: 0, changeover: 0, microstop: 0, waiting: 0, speed: 0, quality: 0 })

interface Acc {
  runSec: number
  plannedStopSec: number
  totalSec: number
  total: number
  ok: number
  nok: number
  idealRate: number
  stopByCat: Record<string, number>
}

function ratios(a: Acc, idealSecSum: number, valueSecSum: number): Kpi {
  const plannedSec = a.totalSec - a.plannedStopSec
  const availability = plannedSec > 0 ? a.runSec / plannedSec : 0
  const performance = a.runSec > 0 ? Math.min(1, idealSecSum / a.runSec) : 0
  const quality = a.total > 0 ? a.ok / a.total : 1
  const oee = plannedSec > 0 ? Math.min(1, valueSecSum / plannedSec) : 0
  const teep = a.totalSec > 0 ? valueSecSum / a.totalSec : 0
  return {
    totalSec: a.totalSec,
    plannedStopSec: a.plannedStopSec,
    plannedSec,
    runSec: a.runSec,
    total: a.total,
    ok: a.ok,
    nok: a.nok,
    availability,
    performance,
    quality,
    oee,
    teep,
    loss: {
      breakdown: a.stopByCat.breakdown ?? 0,
      changeover: a.stopByCat.changeover ?? 0,
      microstop: a.stopByCat.microstop ?? 0,
      waiting: (a.stopByCat.material ?? 0) + (a.stopByCat.staffing ?? 0) + (a.stopByCat.quality ?? 0),
      speed: Math.max(0, a.runSec - idealSecSum),
      quality: a.total > 0 ? a.nok / a.idealRate : 0,
    },
  }
}

export function machineKpi(s: MachineSeries, m: Machine, i0: number, i1: number): Kpi {
  const a: Acc = { runSec: 0, plannedStopSec: 0, totalSec: 0, total: 0, ok: 0, nok: 0, idealRate: m.idealRate, stopByCat: {} }
  const lo = Math.max(0, i0)
  const hi = Math.min(s.length, i1)
  for (let i = lo; i < hi; i++) {
    a.totalSec += BUCKET_SEC
    const st = s.state[i]
    if (st === STATE.RUNNING) {
      a.runSec += BUCKET_SEC
      a.ok += s.ok[i]
      a.nok += s.nok[i]
    } else {
      const r = REASON_BY_ID[s.downReason[i]]
      if (r?.planned) a.plannedStopSec += BUCKET_SEC
      else {
        const cat = r?.category ?? 'breakdown'
        a.stopByCat[cat] = (a.stopByCat[cat] ?? 0) + BUCKET_SEC
      }
    }
  }
  a.total = a.ok + a.nok
  const idealSec = a.total / m.idealRate
  const valueSec = a.ok / m.idealRate
  return ratios(a, idealSec, valueSec)
}

/** Birden çok makinenin KPI'larını (zaman ağırlıklı) birleştirir. */
export function sumKpi(list: Kpi[]): Kpi {
  const a: Acc = { runSec: 0, plannedStopSec: 0, totalSec: 0, total: 0, ok: 0, nok: 0, idealRate: 1, stopByCat: {} }
  let idealSec = 0
  let valueSec = 0
  let speedLoss = 0
  let qualityLoss = 0
  for (const k of list) {
    a.runSec += k.runSec
    a.plannedStopSec += k.plannedStopSec
    a.totalSec += k.totalSec
    a.total += k.total
    a.ok += k.ok
    a.nok += k.nok
    a.stopByCat.breakdown = (a.stopByCat.breakdown ?? 0) + k.loss.breakdown
    a.stopByCat.changeover = (a.stopByCat.changeover ?? 0) + k.loss.changeover
    a.stopByCat.microstop = (a.stopByCat.microstop ?? 0) + k.loss.microstop
    a.stopByCat.material = (a.stopByCat.material ?? 0) + k.loss.waiting
    speedLoss += k.loss.speed
    qualityLoss += k.loss.quality
    // makine başına: idealSec = runSec − hız kaybı ; valueSec = idealSec − kalite kaybı
    idealSec += k.runSec - k.loss.speed
    valueSec += k.runSec - k.loss.speed - k.loss.quality
  }
  const out = ratios(a, idealSec, valueSec)
  out.loss.speed = speedLoss
  out.loss.quality = qualityLoss
  return out
}

export interface WindowRange {
  i0: number
  i1: number
  startT: number
  endT: number
}

export function dayStartOf(t: number): number {
  const d = new Date(t)
  d.setHours(DAY_START_HOUR, 0, 0, 0)
  if (d.getTime() > t) d.setDate(d.getDate() - 1)
  return d.getTime()
}

export function shiftStartOf(t: number): number {
  const d = new Date(t)
  const h = d.getHours()
  const startH = h >= 6 && h < 14 ? 6 : h >= 14 && h < 22 ? 14 : 22
  d.setHours(startH, 0, 0, 0)
  if (d.getTime() > t) d.setDate(d.getDate() - 1)
  return d.getTime()
}

export function idxOf(ds: DataSource, t: number): number {
  return Math.round((t - ds.startT) / BUCKET_MS)
}

export function windowRange(ds: DataSource, key: WindowKey): WindowRange {
  const now = ds.now()
  const endT = now
  const startT = key === 'shift' ? shiftStartOf(now) : key === 'day' ? dayStartOf(now) : now - 24 * 3600 * 1000
  const i0 = Math.max(0, idxOf(ds, startT))
  const i1 = idxOf(ds, endT)
  return { i0, i1, startT: ds.startT + i0 * BUCKET_MS, endT }
}

export interface ProjectionInfo {
  produced: number
  target: number
  progress: number
  /** Son 60 dk ortalama OK üretim hızı (ürün/sn), duruşlar dahil */
  avgRate: number
  remainingDaySec: number
  /** Hedefe kalan süre (sn); hız 0 ise null */
  etaSec: number | null
  projected: number
  verdict: 'done' | 'ontrack' | 'behind'
  shortfall: number
}

export function projection(s: MachineSeries, m: Machine, now: number): ProjectionInfo {
  const dayStart = dayStartOf(now)
  const dayEnd = dayStart + 24 * 3600 * 1000
  const iEnd = s.length
  const iDay = Math.max(0, Math.round((dayStart - s.startT) / BUCKET_MS))
  let okProduced = 0
  for (let i = iDay; i < iEnd; i++) okProduced += s.ok[i]
  // Son 60 dk (duruşlar dahil) OK üretim hızı — projeksiyon bu hızla yapılır
  const win = 360
  const iRecent = Math.max(iDay, iEnd - win)
  let recentOk = 0
  for (let i = iRecent; i < iEnd; i++) recentOk += s.ok[i]
  const avgRate = iEnd > iRecent ? recentOk / ((iEnd - iRecent) * BUCKET_SEC) : 0
  const remainingDaySec = Math.max(0, (dayEnd - now) / 1000)
  const remaining = Math.max(0, m.dailyTarget - okProduced)
  const etaSec = remaining === 0 ? 0 : avgRate > 0 ? remaining / avgRate : null
  const projected = okProduced + avgRate * remainingDaySec
  const verdict = okProduced >= m.dailyTarget ? 'done' : projected >= m.dailyTarget * 0.98 ? 'ontrack' : 'behind'
  return {
    produced: okProduced,
    target: m.dailyTarget,
    progress: Math.min(1, okProduced / m.dailyTarget),
    avgRate,
    remainingDaySec,
    etaSec,
    projected,
    verdict,
    shortfall: Math.max(0, m.dailyTarget - projected),
  }
}

export interface FailureStats {
  failures: number
  mtbfSec: number | null
  mttrSec: number | null
}

export function failureStats(stops: StopEvent[], machineIds: Set<string>, startT: number, endT: number, runSec: number): FailureStats {
  const bd = stops.filter((e) => machineIds.has(e.machineId) && e.start >= startT && e.start < endT && REASON_BY_ID[e.reasonId]?.category === 'breakdown')
  if (bd.length === 0) return { failures: 0, mtbfSec: null, mttrSec: null }
  const dur = bd.reduce((a, e) => a + ((e.end ?? endT) - e.start) / 1000, 0)
  return { failures: bd.length, mtbfSec: runSec / bd.length, mttrSec: dur / bd.length }
}

/** Pencereyi step bucket'lık dilimlere bölüp her dilim için KPI döndürür. */
export function slicedKpi(s: MachineSeries, m: Machine, i0: number, i1: number, step: number): { t: number; kpi: Kpi }[] {
  const out: { t: number; kpi: Kpi }[] = []
  for (let a = i0; a < i1; a += step) {
    out.push({ t: s.startT + a * BUCKET_MS, kpi: machineKpi(s, m, a, Math.min(a + step, i1)) })
  }
  return out
}

export function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} sa ${m} dk`
  if (m > 0) return `${m} dk`
  return `${s} sn`
}

export const pct = (x: number, d = 1) => `%${(x * 100).toFixed(d).replace('.', ',')}`
export const num = (x: number, d = 0) => x.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })

export { emptyLoss }
