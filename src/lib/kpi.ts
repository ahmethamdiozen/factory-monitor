import type { DataSource } from '@/data/DataSource'
import { DAY_START_HOUR, REASON_BY_ID } from '@/data/registry'
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
      quality: Math.max(0, idealSecSum - valueSecSum),
    },
  }
}

export function machineKpi(s: MachineSeries, m: Machine, i0: number, i1: number): Kpi {
  void m
  const a: Acc = { runSec: 0, plannedStopSec: 0, totalSec: 0, total: 0, ok: 0, nok: 0, idealRate: m.idealRate, stopByCat: {} }
  const lo = Math.max(0, i0)
  const hi = Math.min(s.length, i1)
  // Performans, tamamlanan parça sayısından değil ideal çevrime göre ilerleme hızından hesaplanır:
  // saatler süren parçalarda adet bazlı hesap vardiya içinde %0 ile %200 arasında salınır.
  let work = 0
  for (let i = lo; i < hi; i++) {
    a.totalSec += BUCKET_SEC
    const st = s.state[i]
    if (st === STATE.RUNNING) {
      a.runSec += BUCKET_SEC
      work += Math.min(1.2, s.speed[i]) * BUCKET_SEC
    } else {
      const r = REASON_BY_ID[s.downReason[i]]
      if (r?.planned) a.plannedStopSec += BUCKET_SEC
      else {
        const cat = r?.category ?? 'breakdown'
        a.stopByCat[cat] = (a.stopByCat[cat] ?? 0) + BUCKET_SEC
      }
    }
  }
  // Parçalar (kalite) çalışma durumundan bağımsız sayılır: fırın şarjı yükleme anında biter
  for (let i = lo; i < hi; i++) {
    a.ok += s.ok[i]
    a.nok += s.nok[i]
  }
  a.total = a.ok + a.nok
  const q = a.total > 0 ? a.ok / a.total : 1
  return ratios(a, work, work * q)
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

export interface CycleInfo {
  /** İçinde bulunulan parçanın (fırında şarjın) ilerlemesi 0–1 */
  progress: number
  /** Kalan süre tahmini (sn); makine uzun süredir duruyorsa null */
  remainingSec: number | null
  /** Son parça/şarj tamamlanma zamanı */
  lastDoneAt: number | null
}

/**
 * Şu anki parçanın ilerlemesi: son tamamlanmadan bu yana yapılan iş (çalışma süresi × hız)
 * ideal çevrim süresine bölünür. Uzun çevrimli (saatler süren) parçalar için anlamlı gösterge.
 */
export function cycleInfo(s: MachineSeries, m: Machine): CycleInfo {
  const cycleSec = m.batchSize / m.idealRate
  const limit = Math.max(0, s.length - Math.ceil((cycleSec * 3) / BUCKET_SEC))
  let work = 0
  let lastDoneAt: number | null = null
  let recentSpeed = 0
  let recentN = 0
  for (let i = s.length - 1; i >= limit; i--) {
    if (s.ok[i] + s.nok[i] > 0) {
      lastDoneAt = s.startT + (i + 1) * BUCKET_MS
      break
    }
    if (s.state[i] === STATE.RUNNING) {
      work += s.speed[i] * BUCKET_SEC
      if (recentN < 180) {
        recentSpeed += s.speed[i]
        recentN++
      }
    }
  }
  const progress = Math.min(0.99, work / cycleSec)
  const speed = recentN >= 6 ? recentSpeed / recentN : null
  return { progress, remainingSec: speed && speed > 0.1 ? ((1 - progress) * cycleSec) / speed : null, lastDoneAt }
}

/** Son `hours` saatte çalışma etkinliği: Σ(hız × çalışma süresi) / pencere süresi */
function effectiveness(s: MachineSeries, iFrom: number, iTo: number): number {
  let w = 0
  for (let i = Math.max(0, iFrom); i < iTo; i++) if (s.state[i] === STATE.RUNNING) w += s.speed[i]
  return iTo > iFrom ? w / (iTo - iFrom) : 0
}

export function projection(s: MachineSeries, m: Machine, now: number): ProjectionInfo {
  const dayStart = dayStartOf(now)
  const dayEnd = dayStart + 24 * 3600 * 1000
  const iEnd = s.length
  const iDay = Math.max(0, Math.round((dayStart - s.startT) / BUCKET_MS))
  let okProduced = 0
  let total = 0
  for (let i = iDay; i < iEnd; i++) {
    okProduced += s.ok[i]
    total += s.ok[i] + s.nok[i]
  }
  // Uzun çevrimlerde son 1 saatte hiç parça bitmeyebilir; hız, son 4 saatin çalışma etkinliğinden
  const eff = effectiveness(s, iEnd - (4 * 3600) / BUCKET_SEC, iEnd)
  const okShare = total > 0 ? okProduced / total : 1
  const avgRate = m.idealRate * eff * okShare
  const inProgress = cycleInfo(s, m).progress * m.batchSize
  const remainingDaySec = Math.max(0, (dayEnd - now) / 1000)
  const remaining = Math.max(0, m.dailyTarget - okProduced - inProgress)
  const etaSec = okProduced >= m.dailyTarget ? 0 : avgRate > 0 ? remaining / avgRate : null
  const projected = okProduced + inProgress + avgRate * remainingDaySec
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

/** Parça sayısını gösterir: tam sayıysa "3", değilse "2,3" */
export const parts = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1).replace('.', ','))

/** Saat cinsinden süre: "3 sa", "2,5 sa", "45 dk" */
export function hoursLabel(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} dk`
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} sa`
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
