import { BUCKET_MS, BUCKET_SEC, STATE } from '@/lib/types'
import type { Machine, MachineType, StateCode } from '@/lib/types'
import { between, gaussian, mulberry32 } from '@/lib/rng'
import type { Rng } from '@/lib/rng'
import { shiftOf } from './factoryDef'
import { MODES_OF_TYPE } from '@/lib/failureModes'
import type { ModeId } from '@/lib/failureModes'
import { furnaceSetpoint, tagBaselines } from './tags'
import type { Baseline } from './tags'

/**
 * Tek bir makinenin "fiziksel" simülasyonu. Her 10 sn'lik dilim için tezgâh kontrolörünün ve
 * sensörlerin (historian) kaydedeceği ham sinyalleri üretir. Yavaşlık NEDENİNİ yazmaz; nedenler
 * sinyal desenlerine gömülüdür ve analiz katmanı (src/lib/rules.ts) tarafından çıkarılır.
 *
 * Arıza fiziği (P-F eğrisi): makine tipinin her arıza türü (src/lib/failureModes.ts) için ayrı bir
 * gizli bozulma vardır. Bozulma rastgele bir anda başlar (P noktası), çalıştıkça d = ilerleme^1,5
 * ile büyür ve kendine özgü belirti izi bırakır (ör. rulmanda önce yüksek frekans titreşim, sonra
 * RMS titreşim, en son sıcaklık). d > 0,6'dan sonra arıza (F) olasılığı keskin artar. Planlı bakım
 * ilerlemiş bir bozulmayı ancak bir olasılıkla bulur; onarım sadece o türü sıfırlar. Kontrol /
 * elektrik arızaları ve takım kırılması belirtisizdir — hiçbir model bunları önceden göremez.
 *
 * Sensörler kusursuz değildir: kablosuz titreşim sensörü ara sıra kopar (satır yazılmaz), nadiren
 * sıçrama yapar; sıcaklıklar gece/gündüz değişir; program değişiminde iş mili yükü kayar.
 * Bozulma seviyesi SQL'e yazılmaz; öngörücü model onu belirtilerden çıkarır.
 */

const MIN = 60 * 1000
const HOUR = 60 * MIN
export const SPC_N = 5
const WARMUP_BUCKETS = 36 // 6 dk

/** Simülatörün gerçek nedeni (SQL'e yazılmaz; sadece testlerde doğrulama için). */
export const TRUTH = { NONE: 0, WEAR: 1, MATERIAL: 2, OPERATOR: 3, TEMP: 4, WARMUP: 5, FEED: 6 } as const

interface ForcedSegment {
  fromMin: number
  toMin: number
  kind: 'stop' | 'slow'
  state?: Exclude<StateCode, 0>
  reasonId: number
  factor?: number
}

interface Story {
  eff?: number
  wear?: boolean
  rookieInB?: boolean
  forced?: ForcedSegment[]
  /** Bozulma hikâyesi: fromH'de (t0'a göre saat) başlar, failAtH'de arızaya varır */
  degrade?: { mode: ModeId; fromH: number; failAtH: number }
}

/** Demo için bilinçli gömülmüş "hikâyeler" (dakikalar simülatörün başladığı ana, t0'a göre). */
export const STORIES: Record<string, Story> = {
  // TRN-02: kesici uç aşınıyor → yavaşlama ve göbek çapı SPC'de kayıyor
  M02: { eff: 0.98, wear: true },
  // TRN-03: program / fikstür değişimi sürüyor
  M03: { forced: [{ fromMin: -18, toMin: 9, kind: 'stop', state: STATE.CHANGEOVER, reasonId: 4 }] },
  // TAS-01: soğutma sıvısı ısındı
  M04: { forced: [{ fromMin: -50, toMin: 30, kind: 'slow', reasonId: TRUTH.TEMP, factor: 0.84 }] },
  // FRZ-01: iş mili rulmanı ~4 gündür bozuluyor; ~3 saat sonra arıza (öngörücü bakım önceden uyarır)
  M05: { degrade: { mode: 'bearing', fromH: -93, failAtH: 3 }, forced: [{ fromMin: 180, toMin: 480, kind: 'stop', state: STATE.STOPPED, reasonId: 13 }] },
  // FRZ-02: planlı bakımda
  M06: { forced: [{ fromMin: -35, toMin: 40, kind: 'stop', state: STATE.MAINTENANCE, reasonId: 8 }] },
  // FRZ-03: titreşim (chatter) yüzünden ilerleme düşürüldü
  M07: { forced: [{ fromMin: -45, toMin: 25, kind: 'slow', reasonId: TRUTH.FEED, factor: 0.8 }] },
  // FRZ-04: B vardiyasında yeni operatör
  M08: { eff: 0.97, rookieInB: true },
  // FRN-01: yeni şarj bekliyor; ısıtıcı eleman zayıflıyor → son şarjlar set değerinin altında kalıyor
  // (AMS 2750 reçete dışı riski) ve öngörücü bakım ısıtıcıyı işaret ediyor; arıza ~2 gün sonra
  M09: {
    degrade: { mode: 'heater', fromH: -100, failAtH: 50 },
    forced: [{ fromMin: -22, toMin: 14, kind: 'stop', state: STATE.STOPPED, reasonId: 6 }],
  },
  // FRN-02: ~3 saat önce vakum pompası arızalandı; model önceden uyarmıştı
  M10: { degrade: { mode: 'vacuum', fromH: -110, failAtH: -170 / 60 }, forced: [{ fromMin: -170, toMin: -50, kind: 'stop', state: STATE.STOPPED, reasonId: 17 }] },
  // KPL-01: toz besleme dalgalanıyor
  M11: { forced: [{ fromMin: -40, toMin: 20, kind: 'slow', reasonId: TRUTH.FEED, factor: 0.8 }] },
}

/** Arıza türlerinin zaman ölçekleri (gün): bozulmanın başlama aralığı ve P-F süresi */
const MODE_TIMING: Record<ModeId, { onsetDays: [number, number]; pfDays: [number, number] }> = {
  bearing: { onsetDays: [30, 60], pfDays: [3, 18] },
  axis: { onsetDays: [40, 80], pfDays: [3, 14] },
  coolant: { onsetDays: [30, 60], pfDays: [2, 9] },
  heater: { onsetDays: [20, 40], pfDays: [3, 12] },
  vacuum: { onsetDays: [15, 30], pfDays: [2, 10] },
  gun: { onsetDays: [20, 40], pfDays: [2, 8] },
  feeder: { onsetDays: [25, 50], pfDays: [1, 6] },
}

/** Belirti şiddeti: her bozulma aynı belirginlikte iz bırakmaz; ~%25'i zayıf izle ilerler */
function drawSeverity(r: Rng): number {
  return r() < 0.25 ? between(r, 0.15, 0.4) : between(r, 0.5, 1.3)
}

/** Makine tipine göre duruş ve üretim profili (aralıklar: ortalama olay aralığı) */
interface TypeProfile {
  /** kısa duruş (talaş temizleme / kısa alarm) aralığı (dk) ve süresi (sn) */
  micro: { everyMin: [number, number]; durSec: [number, number] } | null
  changeover: { everyH: [number, number]; durMin: [number, number]; reasons: number[] } | null
  material: { everyH: [number, number]; durMin: [number, number] } | null
  qualityEveryH: number | null
  staffingEveryH: number | null
  /** temizlik / 5S aralığı (saat) */
  cleanEveryH: [number, number]
  /** planlı bakım aralığı (gün) */
  maintEveryDays: [number, number]
  /** belirtisiz ani arıza nedenleri ve ortalama aralığı (gün) */
  suddenReasons: number[]
  suddenEveryDays: [number, number]
  /** rastgele yavaşlama türleri */
  slowPool: number[]
  /** kalite ölçümü: dakika başı (null = çevrim/şarj sonunda) */
  spcEveryMin: number | null
  nok: [number, number]
}

const PROFILES: Record<MachineType, TypeProfile> = {
  cnc: {
    micro: { everyMin: [45, 90], durSec: [20, 180] },
    changeover: { everyH: [12, 24], durMin: [30, 60], reasons: [4, 4, 5] },
    material: { everyH: [16, 30], durMin: [10, 40] },
    qualityEveryH: 20,
    staffingEveryH: 60,
    cleanEveryH: [24, 48],
    maintEveryDays: [7, 14],
    suddenReasons: [2, 2, 3, 1],
    suddenEveryDays: [60, 100],
    slowPool: [TRUTH.MATERIAL, TRUTH.TEMP, TRUTH.FEED],
    spcEveryMin: 30,
    nok: [0.01, 0.03],
  },
  grinder: {
    micro: { everyMin: [30, 60], durSec: [20, 120] },
    changeover: { everyH: [16, 30], durMin: [20, 40], reasons: [4, 5] },
    material: { everyH: [12, 24], durMin: [10, 30] },
    qualityEveryH: 24,
    staffingEveryH: 60,
    cleanEveryH: [24, 48],
    maintEveryDays: [7, 14],
    suddenReasons: [2, 1],
    suddenEveryDays: [70, 110],
    slowPool: [TRUTH.TEMP, TRUTH.MATERIAL],
    spcEveryMin: 20,
    nok: [0.005, 0.015],
  },
  furnace: {
    micro: null,
    changeover: null, // şarj yükleme/boşaltma çevrim sonunda kendiliğinden
    material: null,
    qualityEveryH: null,
    staffingEveryH: null,
    cleanEveryH: [96, 160],
    maintEveryDays: [10, 20],
    suddenReasons: [2],
    suddenEveryDays: [70, 110],
    slowPool: [],
    spcEveryMin: null,
    nok: [0.002, 0.008],
  },
  coating: {
    micro: { everyMin: [30, 60], durSec: [30, 180] },
    changeover: { everyH: [8, 14], durMin: [20, 40], reasons: [5] },
    material: { everyH: [10, 20], durMin: [10, 30] },
    qualityEveryH: 24,
    staffingEveryH: 60,
    cleanEveryH: [24, 48],
    maintEveryDays: [7, 14],
    suddenReasons: [2, 1],
    suddenEveryDays: [60, 100],
    slowPool: [TRUTH.FEED, TRUTH.TEMP],
    spcEveryMin: 30,
    nok: [0.015, 0.03],
  },
  cmm: {
    micro: { everyMin: [120, 240], durSec: [60, 300] },
    changeover: null,
    material: { everyH: [3, 6], durMin: [20, 60] },
    qualityEveryH: null,
    staffingEveryH: 80,
    cleanEveryH: [48, 96],
    maintEveryDays: [14, 28],
    suddenReasons: [2],
    suddenEveryDays: [40, 70],
    slowPool: [],
    spcEveryMin: 120,
    nok: [0.002, 0.006],
  },
}

/** Bozulmaya bağlı arıza olasılığı (saat başına): d 0,6 altında yok, 1'de saatte ~0,8. */
export function degradationHazardPerHour(d: number): number {
  return d < 0.6 ? 0 : 0.8 * Math.pow((d - 0.6) / 0.4, 2)
}

/** Takım ömrü (parça): ~12 saatlik kesme süresi. TRN-02 hikâyesinde kesici uç bu döngüyle değişir. */
export function toolLifeCycles(m: Machine): number {
  return Math.max(1, Math.round(m.idealRate * 12 * 3600))
}

export interface RawSample {
  machineId: string
  /** Dilim başlangıcı (ms) */
  t: number
  status: StateCode
  reasonId: number
  produced: number
  rejects: number
  /** Ortalama çevrim süresi (ms); makine çalışmıyorsa 0 */
  cycleTimeMs: number
  toolCycles: number
  materialLot: string
  /** Ara kalite ölçümü (5'li) */
  quality: number[] | null
  /** Sensör etiketleri (historian); kopuk sensörün etiketi yoktur */
  tags: Record<string, number>
  /** Sadece doğrulama için: simülatörün uyguladığı baskın yavaşlama nedeni */
  truthSlow: number
  /** Sadece doğrulama / analiz için: en ilerlemiş gizli bozulma (SQL'e yazılmaz) */
  truthDegradation: number
  /** Sadece analiz için: en ilerlemiş bozulmanın türü */
  truthMode: ModeId | ''
}

interface Params {
  eff: number
  baseNok: number
  suddenDays: number
  microMin: number
  changeoverH: number
  cleanH: number
  maintDays: number
  materialH: number
  spcBias: number
  spcOffset: number
  spcEvery: number
}

/** Bir arıza türünün gizli bozulması */
interface ModeState {
  id: ModeId
  active: boolean
  /** P noktasından bu yana çalışma saati */
  progH: number
  pfH: number
  d: number
  /** belirti şiddeti (bkz. drawSeverity) */
  k: number
}

interface Seg {
  state: Exclude<StateCode, 0>
  reasonId: number
  remaining: number
  /** Bozulma kaynaklı arıza ise türü (onarım o türü sıfırlar) */
  mode?: ModeId
}

interface SlowEp {
  cause: number
  factor: number
  remaining: number
}

export class MachineSim {
  readonly machine: Machine
  private readonly rng: Rng
  private readonly p: Params
  private readonly story: Story
  private readonly t0: number
  private readonly prof: TypeProfile
  private readonly base: Baseline
  /** Fırın: içinde bulunulan şarjın ilerlemesi (0→1) */
  private batchProgress = 0
  private seg: Seg | null = null
  private warmup = 0
  private slow: SlowEp | null = null
  private forcedWasActive = false
  private noise = 0
  private acc = 0
  private temp: number
  private toolCycles = 0
  private lastWearAge = 0
  private lotNo = 1
  private started = false
  /** Bozulma için ayrı rastgele sayı akışı (olay dizisini bozmamak için) */
  private readonly drng: Rng
  /** Sensör gürültüsü, kopma ve sıçramalar için ayrı akış */
  private readonly srng: Rng
  private readonly modes: ModeState[]
  private storyDone = false
  private quietEntered = false
  /** Program değişiminde iş mili yükü kayar (yeni program, yeni kesme koşulları) */
  private loadShift = 1
  /** Kablosuz sensör kopukluğu: kalan dilim */
  private dropout = 0
  // Arızaya benzeyen ama arıza olmayan durumlar (gerçek hayatta boş alarmların kaynağı)
  /** Ağır kesim: titreşim geçici olarak yükselir */
  private heavyCut = 0
  private heavyAmp = 1
  /** Soğutma filtresi tıkanması (0→1): basınç düşer; temizlikte açılır */
  private clog = 0
  private clogging = false
  /** Fırın: şarj ağırlığı (ısıtıcı gücü buna bağlı) ve kapı contası kaçağı */
  private batchMass = 1
  private sealLeak = 1
  /** Kaplama: gaz tüpü değişimiyle tabanca gerilimi kayar */
  private gasShift = 1

  constructor(machine: Machine, idx: number, t0: number) {
    this.machine = machine
    this.t0 = t0
    this.rng = mulberry32(1000 + idx * 7919)
    this.story = STORIES[machine.id] ?? {}
    this.prof = PROFILES[machine.type]
    this.base = tagBaselines(machine, idx)
    const r = this.rng
    const pr = this.prof
    const spcEvery = Math.round(((pr.spcEveryMin ?? 30) * 60) / BUCKET_SEC)
    this.p = {
      eff: this.story.eff ?? between(r, 0.93, 0.985),
      baseNok: between(r, pr.nok[0], pr.nok[1]),
      suddenDays: between(r, pr.suddenEveryDays[0], pr.suddenEveryDays[1]),
      microMin: pr.micro ? between(r, pr.micro.everyMin[0], pr.micro.everyMin[1]) : 0,
      changeoverH: pr.changeover ? between(r, pr.changeover.everyH[0], pr.changeover.everyH[1]) : 0,
      cleanH: between(r, pr.cleanEveryH[0], pr.cleanEveryH[1]),
      maintDays: between(r, pr.maintEveryDays[0], pr.maintEveryDays[1]),
      materialH: pr.material ? between(r, pr.material.everyH[0], pr.material.everyH[1]) : 0,
      spcBias: gaussian(r) * 0.15,
      spcOffset: Math.floor(r() * spcEvery),
      spcEvery,
    }
    this.temp = this.base.SpindleTempC ?? this.base.CoolingWaterTempC ?? 24
    this.toolCycles = Math.floor(r() * toolLifeCycles(machine) * 0.3)
    this.drng = mulberry32(5000 + idx * 7919)
    this.srng = mulberry32(9000 + idx * 7919)
    // Başlangıçta bazı bozulmalar zaten sürüyor olabilir (uzun dönem ortalamasıyla tutarlı)
    this.modes = MODES_OF_TYPE[machine.type].map((id) => {
      const tm = MODE_TIMING[id]
      const pfH = between(this.drng, tm.pfDays[0], tm.pfDays[1]) * 24
      const onsetMean = ((tm.onsetDays[0] + tm.onsetDays[1]) / 2) * 24
      const active = !this.story.degrade && this.drng() < pfH / (onsetMean + pfH)
      const progH = active ? this.drng() * pfH * 0.7 : 0
      return { id, active, progH, pfH, d: active ? Math.pow(progH / pfH, 1.5) : 0, k: drawSeverity(this.drng) }
    })
  }

  /**
   * Hikâye penceresi: hikâyeli makinede rampadan 3 gün önce ve arızaya kadar kendiliğinden yeni
   * bozulma veya bozulma arızası olmaz (senaryo temiz kalsın). Eğitim verisinde hikâye anı
   * veri döneminin dışında kaldığı için bu makineler de normal davranır.
   */
  private storyQuiet(t: number): boolean {
    const d = this.story.degrade
    return !!d && t >= this.t0 + (d.fromH - 72) * HOUR && t < this.t0 + d.failAtH * HOUR + HOUR
  }

  /** Hikâyeli makinede bozulma rampası etkin mi? (0→1) */
  private storyRamp(t: number): number | null {
    const d = this.story.degrade
    if (!d) return null
    const from = this.t0 + d.fromH * HOUR
    const to = this.t0 + d.failAtH * HOUR
    if (t < from || t >= to) return null
    return (t - from) / (to - from)
  }

  private forcedAt(t: number): ForcedSegment | undefined {
    return this.story.forced?.find((s) => t >= this.t0 + s.fromMin * MIN && t < this.t0 + s.toMin * MIN)
  }

  private get lot(): string {
    return `L${this.machine.id.slice(1)}-${String(this.lotNo).padStart(4, '0')}`
  }

  private mode(id: ModeId): number {
    return this.modes.find((m) => m.id === id)?.d ?? 0
  }

  /** Belirtiye yansıyan bozulma (gerçek bozulma × şiddet) — sinyaller bunu görür, arıza gerçeğini değil */
  private sym(id: ModeId): number {
    const m = this.modes.find((x) => x.id === id)
    return m ? Math.min(1, m.d * m.k) : 0
  }

  private resetMode(m: ModeState): void {
    m.active = false
    m.progH = 0
    m.d = 0
    const tm = MODE_TIMING[m.id]
    m.pfH = between(this.drng, tm.pfDays[0], tm.pfDays[1]) * 24
    m.k = drawSeverity(this.drng)
  }

  private startSeg(t: number): void {
    const r = this.rng
    // Demo anı çevresinde rastgele planlı/ayar duruşu başlatma (hikâye senaryosu bozulmasın)
    const nearNow = t > this.t0 - 90 * MIN && t < this.t0 + 120 * MIN
    const b = (sec: number) => Math.max(1, Math.round(sec / BUCKET_SEC))
    const p = this.p
    const per = (meanSec: number) => BUCKET_SEC / meanSec
    const sh = shiftOf(t)
    const hazard = sh === 'C' ? 1.6 : sh === 'B' ? 1.05 : 1
    const pr = this.prof
    const pickR = (list: number[], rnd: Rng) => list[Math.floor(rnd() * list.length)]
    // Bozulma kaynaklı arıza (hikâye penceresinde arıza zamanı hikâyece belirlenir)
    if (!this.storyQuiet(t)) {
      for (const m of this.modes) {
        const h = m.progH > 1.25 * m.pfH ? 3 : degradationHazardPerHour(m.d)
        if (h > 0 && this.drng() < (h * BUCKET_SEC) / 3600) {
          const reasonId = { bearing: 13, axis: 14, coolant: 15, heater: 16, vacuum: 17, gun: 18, feeder: 19 }[m.id]
          this.seg = { state: STATE.STOPPED, reasonId, remaining: b(between(this.drng, 2, 6) * 3600), mode: m.id }
          return
        }
      }
    }
    const u = r()
    // Ani (belirtisiz) arızalar: kontrol / elektrik, takım kırılması
    let c = per(p.suddenDays * 86400) * hazard
    if (u < c) {
      this.seg = { state: STATE.STOPPED, reasonId: pickR(pr.suddenReasons, r), remaining: b(between(r, 20, 120) * 60) }
      return
    }
    if (pr.micro) {
      c += per(p.microMin * 60) * (1 + 1.5 * this.sym('axis') ** 2 + 4 * this.sym('feeder') ** 2)
      if (u < c) {
        this.seg = { state: STATE.STOPPED, reasonId: 10, remaining: b(between(r, pr.micro.durSec[0], pr.micro.durSec[1])) }
        return
      }
    }
    if (pr.changeover && !nearNow) {
      c += per(p.changeoverH * 3600)
      if (u < c) {
        const co = pr.changeover
        this.seg = { state: STATE.CHANGEOVER, reasonId: pickR(co.reasons, r), remaining: b(between(r, co.durMin[0], co.durMin[1]) * 60) }
        return
      }
    }
    // Fırında bakım / temizlik şarj ortasında başlamaz; şarj aralarında karar verilir (endSeg)
    if (!nearNow && this.machine.type !== 'furnace') {
      c += per(p.cleanH * 3600)
      if (u < c) {
        this.seg = { state: STATE.MAINTENANCE, reasonId: 11, remaining: b(between(r, 15, 30) * 60) }
        return
      }
      c += per(p.maintDays * 86400)
      if (u < c) {
        this.seg = { state: STATE.MAINTENANCE, reasonId: 8, remaining: b(between(r, 2, 4) * 3600) }
        return
      }
    }
    if (pr.material) {
      c += per(p.materialH * 3600)
      if (u < c) {
        this.seg = { state: STATE.STOPPED, reasonId: 6, remaining: b(between(r, pr.material.durMin[0], pr.material.durMin[1]) * 60) }
        return
      }
    }
    if (pr.staffingEveryH) {
      c += per(pr.staffingEveryH * 3600)
      if (u < c) {
        this.seg = { state: STATE.STOPPED, reasonId: 7, remaining: b(between(r, 10, 25) * 60) }
        return
      }
    }
    if (pr.qualityEveryH) {
      c += per(pr.qualityEveryH * 3600)
      if (u < c) this.seg = { state: STATE.STOPPED, reasonId: 9, remaining: b(between(r, 15, 40) * 60) }
    }
  }

  /** Bir segment bittiğinde: onarım, bakım, program değişimi */
  private endSeg(seg: Seg, t: number): void {
    if (seg.reasonId !== 10) this.warmup = WARMUP_BUCKETS
    if (seg.reasonId === 12 && !(t > this.t0 - 90 * MIN && t < this.t0 + 120 * MIN)) {
      // Şarj yükleme / boşaltma bitti: sıradaki şarjdan önce temizlik veya planlı bakım zamanı mı?
      const cycleH = this.machine.batchSize / this.machine.idealRate / 3600
      const r = this.rng
      if (r() < cycleH / (this.p.maintDays * 24)) {
        this.seg = { state: STATE.MAINTENANCE, reasonId: 8, remaining: Math.round(between(r, 2, 4) * 360) }
        return
      }
      if (r() < cycleH / this.p.cleanH) {
        this.seg = { state: STATE.MAINTENANCE, reasonId: 11, remaining: Math.round(between(r, 15, 30) * 6) }
        return
      }
    }
    if (seg.reasonId === 4) {
      // Program değişimi: yeni malzeme partisi; takım da değişir (aşınma hikâyesindeki makinede
      // takım kendi 12 saatlik döngüsüyle değişir, sayaç ona bağlıdır); iş mili yükü kayar
      if (!this.story.wear) this.toolCycles = 0
      this.lotNo++
      this.loadShift = 1 + Math.max(-0.12, Math.min(0.12, gaussian(this.srng) * 0.06))
    }
    if ((seg.reasonId === 11 || seg.reasonId === 8) && this.srng() < 0.8) {
      this.clog = 0
      this.clogging = false
    }
    if (seg.mode) {
      const m = this.modes.find((x) => x.id === seg.mode)
      if (m) this.resetMode(m) // onarım
    } else if (seg.reasonId === 8) {
      // Planlı bakım ilerlemiş bir bozulmayı ancak bir olasılıkla bulur
      for (const m of this.modes) if (m.active && m.d > 0.35 && this.drng() < 0.5) this.resetMode(m)
    }
  }

  /** Bozulmaların ilerlemesi (sadece çalışırken) ve hikâye rampası */
  private advanceModes(t: number, running: boolean): void {
    const story = this.story.degrade
    const ramp = this.storyRamp(t)
    if (this.storyQuiet(t) && !this.quietEntered) {
      // Hikâye penceresine girerken diğer bozulmalar temizlenir (tek, net bir senaryo)
      this.quietEntered = true
      for (const m of this.modes) if (m.id !== story?.mode) this.resetMode(m)
    }
    for (const m of this.modes) {
      if (story && m.id === story.mode) {
        if (ramp !== null) {
          m.active = true
          m.k = 1
          m.d = Math.pow(ramp, 1.5)
          m.progH = ramp * m.pfH
        } else if (!this.storyDone && t >= this.t0 + story.failAtH * HOUR) {
          this.storyDone = true
          this.resetMode(m) // hikâyedeki arıza onarıldı
        }
        continue
      }
      if (!running) continue
      const hours = BUCKET_SEC / 3600
      if (!m.active) {
        const tm = MODE_TIMING[m.id]
        const onsetH = ((tm.onsetDays[0] + tm.onsetDays[1]) / 2) * 24
        if (!this.storyQuiet(t) && this.drng() < hours / onsetH) m.active = true
        continue
      }
      m.progH += hours
      m.d = Math.min(1, Math.pow(m.progH / m.pfH, 1.5))
    }
  }

  /** Aşınma yaşı (saat): 12 saatte bir takım değişir, t0'da yaş 8 sa. */
  private wearAgeH(t: number): number {
    const since = t - (this.t0 - 8 * HOUR)
    const cycle = 12 * HOUR
    return (((since % cycle) + cycle) % cycle) / HOUR
  }

  /** Gün içi ortam sıcaklığı farkı (°C): öğleden sonra sıcak, gece serin */
  private ambient(t: number): number {
    const h = new Date(t).getHours() + new Date(t).getMinutes() / 60
    return Math.sin(((h - 9) / 24) * 2 * Math.PI)
  }

  /** Dilim indeksi i (seri başından), dilim başlangıcı t. Sırayla çağrılmalı. */
  step(i: number, t: number): RawSample {
    const r = this.rng
    const m = this.machine
    const sh = shiftOf(t)
    const forced = this.forcedAt(t)
    let state: StateCode = STATE.RUNNING
    let reasonId = 0

    if (forced && forced.kind === 'stop') {
      // Fırında parça / malzeme beklemesi şarj arasıdır: yarım şarj yoktur
      if (m.type === 'furnace' && forced.reasonId === 6 && !this.forcedWasActive) this.batchProgress = 0
      state = forced.state!
      reasonId = forced.reasonId
      this.seg = null
      this.forcedWasActive = true
    } else {
      if (this.forcedWasActive) {
        this.forcedWasActive = false
        this.warmup = WARMUP_BUCKETS
      }
      if (this.seg) {
        this.seg.remaining -= 1
        if (this.seg.remaining < 0) {
          const ended = this.seg
          this.seg = null
          this.endSeg(ended, t)
        }
      }
      if (!this.seg && this.started) this.startSeg(t)
      if (this.seg) {
        state = this.seg.state
        reasonId = this.seg.reasonId
      }
    }
    this.started = true

    this.advanceModes(t, state === STATE.RUNNING)
    let top: ModeState | null = null
    for (const x of this.modes) if (x.d > (top?.d ?? 0)) top = x
    const dMax = top?.d ?? 0

    // Aşınma hikâyesi: takım yaşı başa sararsa takım değişmiştir
    let wearLoss = 0
    if (this.story.wear) {
      const age = this.wearAgeH(t)
      // İlk adımda takım sayacı takımın yaşıyla tutarlı başlar
      if (i === 0) this.toolCycles = Math.round(age * m.idealRate * 3600 * 0.9)
      else if (age < this.lastWearAge) this.toolCycles = 0
      this.lastWearAge = age
      wearLoss = 0.1 * Math.pow(age / 8, 1.3)
    }

    if (this.dropout > 0) this.dropout--
    else if (this.srng() < BUCKET_SEC / (14 * 86400)) this.dropout = Math.round(between(this.srng, 30, 90) * 6)

    const truth = { truthDegradation: dMax, truthMode: (top?.id ?? '') as ModeId | '' }
    if (state !== STATE.RUNNING) {
      this.slow = null
      return {
        machineId: m.id,
        t,
        status: state,
        reasonId,
        produced: 0,
        rejects: 0,
        cycleTimeMs: 0,
        toolCycles: this.toolCycles,
        materialLot: this.lot,
        quality: null,
        tags: this.tags(t, false, { slowCause: 0, slowFactor: 1, wearLoss: 0 }),
        truthSlow: TRUTH.NONE,
        ...truth,
      }
    }

    // Yavaşlama bölümleri (hikâye veya rastgele)
    let slowFactor = 1
    let slowCause = 0
    if (forced && forced.kind === 'slow') {
      slowFactor = forced.factor! + gaussian(r) * 0.01
      slowCause = forced.reasonId
      this.slow = null
    } else {
      if (this.slow) {
        this.slow.remaining -= 1
        if (this.slow.remaining < 0) this.slow = null
      }
      if (!this.slow && r() < BUCKET_SEC / (7 * 3600) && this.prof.slowPool.length) {
        const pool = this.prof.slowPool
        const cause = pool[Math.floor(r() * pool.length)]
        this.slow = { cause, factor: between(r, 0.72, 0.86), remaining: Math.round(between(r, 20, 60) * 6) }
        if (cause === TRUTH.MATERIAL) this.lotNo++
      }
      if (this.slow) {
        slowFactor = this.slow.factor
        slowCause = this.slow.cause
      }
    }

    let warmFactor = 1
    if (this.warmup > 0) {
      warmFactor = 0.72 + 0.28 * (1 - this.warmup / WARMUP_BUCKETS)
      this.warmup -= 1
    }
    const rookieFactor = this.story.rookieInB && sh === 'B' ? 0.85 : 1
    const shiftEff = sh === 'C' ? 0.965 : sh === 'B' ? 0.99 : 1

    this.noise = this.noise * 0.9 + gaussian(r) * 0.009
    const base = (this.p.eff + this.noise) * shiftEff

    const factors: [number, number][] = [
      [slowFactor, slowCause],
      [warmFactor, TRUTH.WARMUP],
      [1 - wearLoss, TRUTH.WEAR],
      [rookieFactor, TRUTH.OPERATOR],
    ]
    let minF = 1
    let truthSlow = 0
    let prod = 1
    for (const [f, c] of factors) {
      prod *= f
      if (f < minF) {
        minF = f
        truthSlow = c
      }
    }
    // Fırında ısıtıcı / vakum bozulması çevrimi uzatır; diğerlerinde bozulma hafif yavaşlatır
    const degSlow = m.type === 'furnace' ? 1 - 0.15 * this.mode('heater') ** 1.5 - 0.06 * this.mode('vacuum') ** 2 : 1 - 0.04 * dMax * dMax
    const speed = Math.max(0.05, base * prod * degSlow)

    let total: number
    let batchDone = false
    if (m.type === 'furnace') {
      // Şarj: çevrim bitince tüm parçalar birden çıkar, ardından yükleme/boşaltma
      this.batchProgress += (BUCKET_SEC * speed * m.idealRate) / m.batchSize
      total = 0
      if (this.batchProgress >= 1) {
        this.batchProgress = 0
        this.batchMass = between(this.srng, 0.85, 1.15)
        this.sealLeak = this.srng() < 0.15 ? between(this.srng, 1.5, 3) : 1
        total = m.batchSize
        batchDone = true
        this.seg = { state: STATE.CHANGEOVER, reasonId: 12, remaining: Math.round(between(r, 30, 60) * 6) }
      }
    } else {
      this.acc += m.idealRate * BUCKET_SEC * speed
      total = Math.floor(this.acc)
      this.acc -= total
    }

    let pNok = this.p.baseNok
    pNok += Math.max(0, 0.93 - warmFactor) * 0.2
    pNok += wearLoss * 0.35
    pNok += 0.02 * this.mode('bearing') ** 2
    if (slowCause === TRUTH.MATERIAL) pNok += 0.02
    if (slowFactor < 0.9) pNok += 0.004
    pNok = Math.min(0.2, pNok)
    // Her parça ayrı ayrı uygun / uygunsuz (az adetli üretim)
    let nok = 0
    for (let k = 0; k < total; k++) if (r() < pNok) nok++
    this.toolCycles += total

    const cycleJitter = 1 + gaussian(this.drng) * (0.004 + 0.03 * this.sym('axis') ** 2)

    let quality: number[] | null = null
    const spcDue = this.prof.spcEveryMin === null ? batchDone : (i + this.p.spcOffset) % this.p.spcEvery === 0
    if (spcDue) {
      const spec = m.spec
      const drift = this.story.wear ? 0.2 * spec.sigma * this.wearAgeH(t) : 0
      quality = []
      for (let k = 0; k < SPC_N; k++) quality.push(round(spec.nominal + this.p.spcBias * spec.sigma + drift + gaussian(r) * spec.sigma, 4))
    }

    return {
      machineId: m.id,
      t,
      status: state,
      reasonId,
      produced: total,
      rejects: nok,
      cycleTimeMs: Math.round((1000 / (m.idealRate * speed)) * cycleJitter),
      toolCycles: this.toolCycles,
      materialLot: this.lot,
      quality,
      tags: this.tags(t, true, { slowCause, slowFactor, wearLoss }),
      truthSlow: minF < 0.93 ? truthSlow : TRUTH.NONE,
      ...truth,
    }
  }

  /** Makine tipine göre sensör etiketleri */
  private tags(t: number, running: boolean, x: { slowCause: number; slowFactor: number; wearLoss: number }): Record<string, number> {
    const g = () => gaussian(this.srng)
    const B = this.base
    const amb = this.ambient(t)
    const out: Record<string, number> = {}
    const m = this.machine
    const feedNow = x.slowCause === TRUTH.FEED ? 100 * x.slowFactor + g() * 2.5 : 100 + g() * 1.2

    if (m.type === 'cnc' || m.type === 'grinder') {
      if (running) {
        if (this.heavyCut > 0) this.heavyCut--
        else if (this.srng() < BUCKET_SEC / (5 * 86400)) {
          this.heavyCut = Math.round(between(this.srng, 1, 4) * 360)
          this.heavyAmp = between(this.srng, 0.4, 1.1)
        }
        if (!this.clogging && this.srng() < BUCKET_SEC / (10 * 86400)) this.clogging = true
        if (this.clogging) this.clog = Math.min(1, this.clog + BUCKET_SEC / (between(this.srng, 2, 4) * 86400))
      }
      const heavy = this.heavyCut > 0 ? this.heavyAmp : 0
      const dB = this.sym('bearing')
      const dA = this.sym('axis')
      const dC = this.sym('coolant')
      // Sıcaklık: rulman en geç, soğutma arızası belirgin şekilde yükseltir
      const target = running
        ? x.slowCause === TRUTH.TEMP
          ? B.SpindleTempC + 15
          : B.SpindleTempC + 1.5 * amb + 7 * Math.pow(Math.max(0, (dB - 0.65) / 0.35), 1.5) + 6 * Math.pow(dC, 1.5) + 2.5 * this.clog
        : B.SpindleTempC - 8 + 1.5 * amb
      this.temp += (target - this.temp) * (running ? (x.slowCause === TRUTH.TEMP ? 0.25 : 0.05) : 0.004)
      const feed = running ? feedNow : 0
      out.SpindleLoadPct = round(running ? B.SpindleLoadPct * this.loadShift * Math.pow(feed / 100, 0.7) * (1 + 0.6 * x.wearLoss) * (1 + g() * 0.03) : 1 + Math.abs(g()) * 0.3, 1)
      if (this.dropout === 0) {
        let vib = running
          ? B.SpindleVibMmS * (1 + 7 * x.wearLoss) * (1 + 0.9 * Math.pow(Math.max(0, (dB - 0.4) / 0.6), 1.3)) * (1 + 0.12 * dA * dA) * (1 + 0.35 * heavy) * (1 + Math.abs(g()) * 0.14)
          : B.SpindleVibMmS * 0.08 * (1 + Math.abs(g()) * 0.3)
        let hf = running ? B.SpindleVibHfG * (1 + 3 * Math.pow(dB, 1.2)) * (1 + heavy) * (1 + Math.abs(g()) * 0.18) : B.SpindleVibHfG * 0.15 * (1 + Math.abs(g()) * 0.3)
        // Kablosuz sensör nadiren sıçrama yapar (darbe, sinyal hatası)
        if (this.srng() < 1 / 30000) vib *= between(this.srng, 3, 6)
        if (this.srng() < 1 / 30000) hf *= between(this.srng, 3, 6)
        out.SpindleVibMmS = round(vib, 3)
        out.SpindleVibHfG = round(hf, 3)
      }
      out.SpindleTempC = round(this.temp + g() * 0.25, 1)
      out.CoolantPressBar = round(running ? B.CoolantPressBar * (1 - 0.35 * Math.pow(dC, 1.3)) * (1 - 0.18 * this.clog) * (1 + g() * 0.02) : 0, 1)
      out.FeedOverridePct = round(feed, 1)
      // Eksen akımı programa (parça ağırlığı, kesme) göre de değişir
      if (m.type === 'cnc') out.AxisCurrentA = round(running ? B.AxisCurrentA * (1 + 0.28 * Math.pow(dA, 1.5)) * (1 + (this.loadShift - 1) * 0.8) * Math.sqrt(feed / 100) * (1 + g() * 0.02) : B.AxisCurrentA * 0.1, 2)
    } else if (m.type === 'furnace') {
      const sp = furnaceSetpoint(m)
      const dH = this.sym('heater')
      const dV = this.sym('vacuum')
      const vacOk = B.VacuumMbar * (1 + 12 * dV * dV) * this.sealLeak
      let temp = 40
      let power = 0
      let vac = 1013 // yükleme / boşaltmada fırın açık
      if (running) {
        const p = this.batchProgress
        if (p < 0.04) {
          vac = Math.pow(10, -1 + (p / 0.04) * (Math.log10(vacOk) + 1)) // pompalama
        } else if (p < 0.28) {
          // ısınma rampası: set değerinin ~20 °C altına kadar tam güç, sonra tutmaya geçilir
          temp = 40 + (sp - 60) * ((p - 0.04) / 0.24)
          power = 92 + g() * 1.5
          vac = vacOk * 1.5 * (1 + g() * 0.05)
        } else if (p < 0.85) {
          // tutma (reçete sıcaklığı): zayıflayan ısıtıcı set değerini tutturamaz → AMS 2750 toleransını aşabilir
          temp = sp - 8 * Math.pow(dH, 1.5) + g() * 1.2
          power = B.HeaterPowerPct * (1 + 0.45 * Math.pow(dH, 1.3)) * Math.pow(this.batchMass, 0.6) * (1 + g() * 0.025)
          vac = vacOk * (1 + g() * 0.06)
        } else {
          temp = sp - 40 - (sp - 190) * ((p - 0.85) / 0.15) // gazla hızlı soğutma
          vac = 900
        }
      }
      out.FurnaceTempC = round(temp, 1)
      out.SetpointC = sp
      out.VacuumMbar = Number(vac.toPrecision(3))
      out.HeaterPowerPct = round(Math.max(0, power), 1)
    } else if (m.type === 'coating') {
      if (running && this.srng() < BUCKET_SEC / (3 * 86400)) this.gasShift = 1 + gaussian(this.srng) * 0.03
      const dG = this.sym('gun')
      const dF = this.sym('feeder')
      const target = running ? B.CoolingWaterTempC + 3 + amb + (x.slowCause === TRUTH.TEMP ? 12 : 0) : B.CoolingWaterTempC + amb
      this.temp += (target - this.temp) * 0.05
      out.GunVoltageV = round(running ? B.GunVoltageV * this.gasShift * (1 - 0.09 * Math.pow(dG, 1.3)) * (1 + g() * (0.008 + 0.03 * dG)) : 0, 1)
      out.PowderFeedPct = round(running ? (x.slowCause === TRUTH.FEED ? feedNow : 100 + g() * (1 + 7 * Math.pow(dF, 1.5))) : 0, 1)
      out.CoolingWaterTempC = round(this.temp + g() * 0.2, 1)
    } else {
      out.RoomTempC = round(B.RoomTempC + 0.4 * amb + g() * 0.05, 2)
    }
    return out
  }
}

function round(v: number, d: number): number {
  const f = 10 ** d
  return Math.round(v * f) / f
}

/** Dilim sınırına hizalar. */
export const alignBucket = (t: number) => Math.floor(t / BUCKET_MS) * BUCKET_MS
