import { BUCKET_SEC, STATE } from '@/lib/types'

/**
 * Öngörücü bakım modelinin girdileri. TEK KAYNAK: hem eğitim verisi üretiminde
 * (server/ml/exportDataset.ts) hem canlı tahminde (collector, web demo) aynı kod çalışır;
 * böylece model eğitildiği veriyle birebir aynı şekilde beslenir.
 *
 * Girdi: collector'ın ürettiği 10 sn'lik dilimler (durum, neden, hız, sıcaklık, titreşim, motor akımı).
 */

export const FEATURE_NAMES = [
  'cur_ratio_1h',
  'cur_slope_24h',
  'vib_1h',
  'vib_slope_24h',
  'temp_dev_1h',
  'micro_6h',
  'micro_24h',
  'speed_cv_1h',
  'run_h_since_maint',
  'line_L1',
  'line_L2',
  'line_L3',
] as const

export type FeatureName = (typeof FEATURE_NAMES)[number]

/** Arayüzde gösterilecek kısa adlar */
export const FEATURE_LABEL: Record<FeatureName, string> = {
  cur_ratio_1h: 'Motor akımı (normale göre)',
  cur_slope_24h: 'Motor akımı eğilimi (24 sa)',
  vib_1h: 'Titreşim',
  vib_slope_24h: 'Titreşim eğilimi (24 sa)',
  temp_dev_1h: 'Sıcaklık (normale göre)',
  micro_6h: 'Mikro duruşlar (6 sa)',
  micro_24h: 'Mikro duruşlar (24 sa)',
  speed_cv_1h: 'Çevrim süresi düzensizliği',
  run_h_since_maint: 'Son bakımdan beri çalışma',
  line_L1: 'Hat 1',
  line_L2: 'Hat 2',
  line_L3: 'Hat 3',
}

export interface FeatureBucket {
  t: number
  state: number
  downReason: number
  speed: number
  temp: number
  vib: number
  cur: number
}

const HOUR = 3600 * 1000
const RUN_WINDOW = 360 // son ~1 saatlik çalışma (10 sn'lik dilim)
const HOURS_KEPT = 168 // 7 gün
const MICRO_REASON = 10
/** Bakım/onarım sayılan duruşlar: arızalar (1–3) ve planlı bakım (8) */
const INTERVENTION_REASONS = new Set([1, 2, 3, 8])

interface HourAgg {
  h: number
  n: number
  cur: number
  vib: number
  temp: number
}

function percentile(values: number[], q: number): number {
  const a = [...values].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]
}

/** Saatlik ortalamaların doğrusal eğimi (saat başına) */
function slopePerHour(points: { h: number; v: number }[]): number {
  if (points.length < 6) return 0
  const mx = points.reduce((a, p) => a + p.h, 0) / points.length
  const my = points.reduce((a, p) => a + p.v, 0) / points.length
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.h - mx) * (p.v - my)
    den += (p.h - mx) ** 2
  }
  return den > 0 ? num / den : 0
}

export class FeatureTracker {
  readonly machineId: string
  readonly lineId: string
  private run: { cur: number; vib: number; temp: number; speed: number }[] = []
  private hours: HourAgg[] = []
  private microStarts: number[] = []
  private prevState = -1
  private prevReason = -1
  private runSecSinceMaint = 0
  lastT = 0

  constructor(machineId: string, lineId: string) {
    this.machineId = machineId
    this.lineId = lineId
  }

  add(b: FeatureBucket): void {
    this.lastT = b.t
    const running = b.state === STATE.RUNNING
    if (b.state === STATE.STOPPED && b.downReason === MICRO_REASON && !(this.prevState === STATE.STOPPED && this.prevReason === MICRO_REASON)) {
      this.microStarts.push(b.t)
    }
    if (!running && INTERVENTION_REASONS.has(b.downReason)) {
      // Onarım/bakım: kısa pencerelerdeki eski belirtiler artık bu makinenin durumunu anlatmaz
      this.runSecSinceMaint = 0
      this.run = []
      this.microStarts = []
    }
    this.prevState = b.state
    this.prevReason = b.downReason
    while (this.microStarts.length && this.microStarts[0] < b.t - 24 * HOUR) this.microStarts.shift()
    if (!running) return

    this.runSecSinceMaint += BUCKET_SEC
    this.run.push({ cur: b.cur, vib: b.vib, temp: b.temp, speed: b.speed })
    if (this.run.length > RUN_WINDOW) this.run.shift()

    const h = Math.floor(b.t / HOUR)
    let last = this.hours[this.hours.length - 1]
    if (!last || last.h !== h) {
      last = { h, n: 0, cur: 0, vib: 0, temp: 0 }
      this.hours.push(last)
      while (this.hours.length && this.hours[0].h < h - HOURS_KEPT) this.hours.shift()
    }
    last.n++
    last.cur += b.cur
    last.vib += b.vib
    last.temp += b.temp
  }

  /** Yeterli geçmiş yoksa null (ilk ~12 çalışma saati) */
  features(t: number): number[] | null {
    const full = this.hours.filter((x) => x.n >= 60)
    if (full.length < 12 || this.run.length < 60) return null
    const mean = (k: 'cur' | 'vib' | 'temp' | 'speed') => this.run.reduce((a, r) => a + r[k], 0) / this.run.length
    const curBase = percentile(full.map((x) => x.cur / x.n), 0.1)
    const tempBase = percentile(full.map((x) => x.temp / x.n), 0.1)
    const nowH = Math.floor(t / HOUR)
    const last24 = full.filter((x) => x.h > nowH - 24)
    const speedMean = mean('speed')
    const speedSd = Math.sqrt(this.run.reduce((a, r) => a + (r.speed - speedMean) ** 2, 0) / this.run.length)
    const micro6 = this.microStarts.filter((s) => s > t - 6 * HOUR).length
    return [
      curBase > 0 ? mean('cur') / curBase : 1,
      curBase > 0 ? (slopePerHour(last24.map((x) => ({ h: x.h, v: x.cur / x.n }))) * 24) / curBase : 0,
      mean('vib'),
      slopePerHour(last24.map((x) => ({ h: x.h, v: x.vib / x.n }))) * 24,
      mean('temp') - tempBase,
      micro6,
      this.microStarts.length,
      speedMean > 0 ? speedSd / speedMean : 0,
      this.runSecSinceMaint / 3600,
      this.lineId === 'L1' ? 1 : 0,
      this.lineId === 'L2' ? 1 : 0,
      this.lineId === 'L3' ? 1 : 0,
    ]
  }
}
