import { BUCKET_SEC, STATE } from '@/lib/types'
import type { MachineType } from '@/lib/types'
import type { Channel } from '@/sim/tags'

/**
 * Öngörücü bakım modelinin girdileri. TEK KAYNAK: hem eğitim verisi üretiminde
 * (server/ml/exportDataset.ts) hem canlı tahminde (collector, web demo) aynı kod çalışır;
 * böylece model eğitildiği veriyle birebir aynı şekilde beslenir.
 *
 * Girdi: collector'ın ürettiği 10 sn'lik dilimler (durum, neden, hız ve ortak kanallar).
 * Her kanal makinenin devreye alma referansına göre yorumlanır (oran veya fark), böylece farklı
 * makineler ve tipler aynı modelle değerlendirilebilir. Ölçülmeyen (NaN) değerler atlanır:
 * kablosuz sensör koptuğunda son bilinen değer kullanılır.
 */

export const FEATURE_NAMES = [
  'load_ratio_1h',
  'load_slope_24h',
  'vib_ratio_1h',
  'vib_slope_24h',
  'hf_ratio_1h',
  'hf_slope_24h',
  'temp_dev_1h',
  'temp_slope_24h',
  'cur_ratio_1h',
  'cur_slope_24h',
  'aux_ratio_1h',
  'aux_slope_24h',
  'feed_sd_1h',
  'micro_6h',
  'micro_24h',
  'speed_cv_1h',
  'run_h_since_maint',
  'h_since_changeover',
  'type_cnc',
  'type_grinder',
  'type_furnace',
  'type_coating',
] as const

export type FeatureName = (typeof FEATURE_NAMES)[number]

/** Arayüzde gösterilecek kısa adlar (tipten bağımsız) */
export const FEATURE_LABEL: Record<FeatureName, string> = {
  load_ratio_1h: 'Yük / güç (referansa göre)',
  load_slope_24h: 'Yük / güç eğilimi (24 sa)',
  vib_ratio_1h: 'Titreşim (referansa göre)',
  vib_slope_24h: 'Titreşim eğilimi (24 sa)',
  hf_ratio_1h: 'Rulman titreşimi (HF)',
  hf_slope_24h: 'Rulman titreşimi eğilimi (24 sa)',
  temp_dev_1h: 'Sıcaklık (referansa göre)',
  temp_slope_24h: 'Sıcaklık eğilimi (24 sa)',
  cur_ratio_1h: 'Eksen akımı (referansa göre)',
  cur_slope_24h: 'Eksen akımı eğilimi (24 sa)',
  aux_ratio_1h: 'Soğutma basıncı / vakum',
  aux_slope_24h: 'Soğutma basıncı / vakum eğilimi',
  feed_sd_1h: 'Besleme dalgalanması',
  micro_6h: 'Kısa duruşlar (6 sa)',
  micro_24h: 'Kısa duruşlar (24 sa)',
  speed_cv_1h: 'Çevrim süresi düzensizliği',
  run_h_since_maint: 'Son bakımdan beri çalışma',
  h_since_changeover: 'Son program değişiminden beri',
  type_cnc: 'Tip: CNC',
  type_grinder: 'Tip: taşlama',
  type_furnace: 'Tip: fırın',
  type_coating: 'Tip: kaplama',
}

/** Açıklamada kullanılmayan (makinenin durumunu değil kimliğini anlatan) özellikler */
export const STATIC_FEATURES = new Set<FeatureName>(['type_cnc', 'type_grinder', 'type_furnace', 'type_coating'])

export interface FeatureBucket {
  t: number
  state: number
  downReason: number
  speed: number
  temp: number
  vib: number
  hf: number
  load: number
  cur: number
  aux: number
  feed: number
}

const HOUR = 3600 * 1000
const RUN_WINDOW = 360 // son ~1 saatlik çalışma (10 sn'lik dilim)
const HOURS_KEPT = 48
const MICRO_REASON = 10
/** Bakım/onarım sayılan duruşlar: tüm arızalar ve planlı bakım */
const INTERVENTION_REASONS = new Set([1, 2, 3, 8, 13, 14, 15, 16, 17, 18, 19])
/** Program / ayar değişimi */
const CHANGEOVER_REASONS = new Set([4, 5])
/** Oran olarak yorumlanan kanallar (sıcaklık fark olarak) */
const RATIO_CH = ['load', 'vib', 'hf', 'cur', 'aux'] as const
const ALL_CH: Channel[] = ['temp', 'vib', 'hf', 'load', 'cur', 'aux', 'feed']
/** Fırında sadece tutma (reçete sıcaklığında bekleme) anındaki değerler anlamlıdır */
const SOAK_BAND_C = 15

type Sums = Record<Channel, { s: number; n: number }>
const emptySums = (): Sums => Object.fromEntries(ALL_CH.map((c) => [c, { s: 0, n: 0 }])) as Sums

interface HourAgg {
  h: number
  n: number
  ch: Sums
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
  readonly type: MachineType
  private readonly ref: Partial<Record<Channel, number>>
  private run: FeatureBucket[] = []
  private hours: HourAgg[] = []
  private microStarts: number[] = []
  private prevState = -1
  private prevReason = -1
  private runSecSinceMaint = 0
  private runSecSinceChangeover = 0
  /** Sensör koptuğunda son bilinen 1 saatlik değer */
  private lastKnown: Partial<Record<Channel, number>> = {}
  lastT = 0

  constructor(machineId: string, type: MachineType, ref: Partial<Record<Channel, number>>) {
    this.machineId = machineId
    this.type = type
    this.ref = ref
  }

  /** Bu dilimin kanal değerleri model için anlamlı mı? (fırında sadece tutma) */
  private steady(b: FeatureBucket): boolean {
    return this.type !== 'furnace' || Math.abs(b.temp) < SOAK_BAND_C
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
      this.hours = []
      this.microStarts = []
      this.lastKnown = {}
    }
    if (!running && CHANGEOVER_REASONS.has(b.downReason)) this.runSecSinceChangeover = 0
    this.prevState = b.state
    this.prevReason = b.downReason
    while (this.microStarts.length && this.microStarts[0] < b.t - 24 * HOUR) this.microStarts.shift()
    if (!running) return

    this.runSecSinceMaint += BUCKET_SEC
    this.runSecSinceChangeover += BUCKET_SEC
    if (!this.steady(b)) return
    this.run.push(b)
    if (this.run.length > RUN_WINDOW) this.run.shift()

    const h = Math.floor(b.t / HOUR)
    let last = this.hours[this.hours.length - 1]
    if (!last || last.h !== h) {
      last = { h, n: 0, ch: emptySums() }
      this.hours.push(last)
      while (this.hours.length && this.hours[0].h < h - HOURS_KEPT) this.hours.shift()
    }
    last.n++
    for (const c of ALL_CH) {
      const v = b[c]
      if (!Number.isNaN(v)) {
        last.ch[c].s += v
        last.ch[c].n++
      }
    }
  }

  /** Son 1 saatin geçerli ölçümlerinin ortalaması; hiç yoksa son bilinen değer */
  private mean1h(c: Channel): number | null {
    let s = 0
    let n = 0
    for (const b of this.run) {
      const v = b[c]
      if (!Number.isNaN(v)) {
        s += v
        n++
      }
    }
    if (n >= 30) {
      this.lastKnown[c] = s / n
      return s / n
    }
    return this.lastKnown[c] ?? null
  }

  /** Yeterli geçmiş yoksa null (ilk ~12 çalışma saati) */
  features(t: number): number[] | null {
    const full = this.hours.filter((x) => x.n >= 60)
    if (full.length < 12 || this.run.length < 60) return null
    const nowH = Math.floor(t / HOUR)
    const last24 = full.filter((x) => x.h > nowH - 24)
    const ref = this.ref
    const slope = (c: Channel) => slopePerHour(last24.filter((x) => x.ch[c].n >= 30).map((x) => ({ h: x.h, v: x.ch[c].s / x.ch[c].n }))) * 24

    const ratio: Record<string, [number, number]> = {}
    for (const c of RATIO_CH) {
      const r = ref[c]
      const m = this.mean1h(c)
      ratio[c] = r && m !== null ? [m / r, slope(c) / r] : [1, 0]
    }
    const tm = this.mean1h('temp')
    const tempDev = ref.temp !== undefined && tm !== null ? tm - ref.temp : 0
    const tempSlope = ref.temp !== undefined ? slope('temp') : 0

    const feeds = this.run.map((b) => b.feed).filter((v) => !Number.isNaN(v))
    const fm = feeds.reduce((a, v) => a + v, 0) / (feeds.length || 1)
    const feedSd = feeds.length >= 30 ? Math.sqrt(feeds.reduce((a, v) => a + (v - fm) ** 2, 0) / feeds.length) : 0

    const speedMean = this.run.reduce((a, b) => a + b.speed, 0) / this.run.length
    const speedSd = Math.sqrt(this.run.reduce((a, b) => a + (b.speed - speedMean) ** 2, 0) / this.run.length)
    const micro6 = this.microStarts.filter((s) => s > t - 6 * HOUR).length
    return [
      ratio.load[0],
      ratio.load[1],
      ratio.vib[0],
      ratio.vib[1],
      ratio.hf[0],
      ratio.hf[1],
      tempDev,
      tempSlope,
      ratio.cur[0],
      ratio.cur[1],
      ratio.aux[0],
      ratio.aux[1],
      feedSd,
      micro6,
      this.microStarts.length,
      speedMean > 0 ? speedSd / speedMean : 0,
      this.runSecSinceMaint / 3600,
      Math.min(720, this.runSecSinceChangeover / 3600),
      this.type === 'cnc' ? 1 : 0,
      this.type === 'grinder' ? 1 : 0,
      this.type === 'furnace' ? 1 : 0,
      this.type === 'coating' ? 1 : 0,
    ]
  }
}
