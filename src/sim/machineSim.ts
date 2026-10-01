import { BUCKET_MS, BUCKET_SEC, STATE } from '@/lib/types'
import type { Machine, MachineType, StateCode } from '@/lib/types'
import { between, gaussian, mulberry32 } from '@/lib/rng'
import type { Rng } from '@/lib/rng'
import { shiftOf } from './factoryDef'

/**
 * Tek bir makinenin "fiziksel" simülasyonu. Her 10 sn'lik dilim için bir PLC/SCADA
 * sisteminin kaydedeceği ham sinyalleri üretir. Yavaşlık NEDENİNİ yazmaz; nedenler
 * sinyal desenlerine gömülüdür ve analiz katmanı (src/lib/rules.ts) tarafından çıkarılır.
 *
 * Yıpranma fiziği: her makinenin gizli bir yıpranma seviyesi (0→1) vardır. Çalıştıkça artar,
 * motor akımını, titreşimi, mikro duruşları ve çevrim süresi oynaklığını yükseltir; yüksek
 * yıpranma arızaya yol açar. Planlı bakım yıpranmayı azaltır, arıza onarımı sıfırlar.
 * Arızaların bir kısmı (sensör/PLC gibi) belirtisiz "ani" arızadır — hiçbir model bunları
 * önceden göremez. Yıpranma seviyesi SQL'e yazılmaz; öngörücü model onu belirtilerden çıkarır.
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
  /** Yıpranma hikâyesi: fromH'den failAtH'ye (saat, t0'a göre) yıpranma 0,05→1 yükselir; failAtH'de arıza */
  degrade?: { fromH: number; failAtH: number }
}

/** Demo için bilinçli gömülmüş "hikâyeler" (dakikalar simülatörün başladığı ana, t0'a göre). */
export const STORIES: Record<string, Story> = {
  // TRN-02: kesici uç aşınıyor → yavaşlama ve göbek çapı SPC'de kayıyor
  M02: { eff: 0.98, wear: true },
  // TRN-03: program / fikstür değişimi sürüyor
  M03: { forced: [{ fromMin: -18, toMin: 9, kind: 'stop', state: STATE.CHANGEOVER, reasonId: 4 }] },
  // TAS-01: soğutma sıvısı ısındı
  M04: { forced: [{ fromMin: -50, toMin: 30, kind: 'slow', reasonId: TRUTH.TEMP, factor: 0.84 }] },
  // FRZ-01: iş mili bozuluyor; ~3 saat sonra arıza (öngörücü bakım önceden uyarır)
  M05: { degrade: { fromH: -30, failAtH: 3 }, forced: [{ fromMin: 180, toMin: 228, kind: 'stop', state: STATE.STOPPED, reasonId: 1 }] },
  // FRZ-02: planlı bakımda
  M06: { forced: [{ fromMin: -35, toMin: 40, kind: 'stop', state: STATE.MAINTENANCE, reasonId: 8 }] },
  // FRZ-03: titreşim (chatter) yüzünden ilerleme düşürüldü
  M07: { forced: [{ fromMin: -45, toMin: 25, kind: 'slow', reasonId: TRUTH.FEED, factor: 0.8 }] },
  // FRZ-04: B vardiyasında yeni operatör
  M08: { eff: 0.97, rookieInB: true },
  // FRN-01: yeni şarj bekliyor (önceki operasyonlardan parça gelmedi)
  M09: { forced: [{ fromMin: -22, toMin: 14, kind: 'stop', state: STATE.STOPPED, reasonId: 6 }] },
  // FRN-02: ~3 saat önceki arızası yıpranma kaynaklıydı; model önceden uyarmıştı
  M10: { degrade: { fromH: -30, failAtH: -170 / 60 }, forced: [{ fromMin: -170, toMin: -122, kind: 'stop', state: STATE.STOPPED, reasonId: 1 }] },
  // KPL-01: toz besleme dalgalanıyor
  M11: { forced: [{ fromMin: -40, toMin: 20, kind: 'slow', reasonId: TRUTH.FEED, factor: 0.8 }] },
}

/** Makine tipine göre duruş ve üretim profili (aralıklar: ortalama olay aralığı) */
interface TypeProfile {
  /** kısa duruş (talaş temizleme / kısa alarm) aralığı (dk) ve süresi (sn) */
  micro: { everyMin: [number, number]; durSec: [number, number] } | null
  changeover: { everyH: [number, number]; durMin: [number, number]; reasons: number[] } | null
  material: { everyH: [number, number]; durMin: [number, number] } | null
  qualityEveryH: number | null
  staffingEveryH: number | null
  plannedEveryH: [number, number]
  /** belirtisiz ani arıza nedenleri */
  suddenReasons: number[]
  /** yıpranma kaynaklı arıza nedenleri */
  degradeReasons: number[]
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
    plannedEveryH: [24, 44],
    suddenReasons: [2, 2, 3, 1],
    degradeReasons: [1, 3],
    slowPool: [TRUTH.MATERIAL, TRUTH.TEMP, TRUTH.FEED],
    spcEveryMin: 30,
    nok: [0.005, 0.02],
  },
  grinder: {
    micro: { everyMin: [30, 60], durSec: [20, 120] },
    changeover: { everyH: [16, 30], durMin: [20, 40], reasons: [4, 5] },
    material: { everyH: [12, 24], durMin: [10, 30] },
    qualityEveryH: 24,
    staffingEveryH: 60,
    plannedEveryH: [24, 44],
    suddenReasons: [2, 1],
    degradeReasons: [1],
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
    plannedEveryH: [72, 120],
    suddenReasons: [2, 1],
    degradeReasons: [1],
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
    plannedEveryH: [30, 50],
    suddenReasons: [2, 1],
    degradeReasons: [1],
    slowPool: [TRUTH.FEED, TRUTH.TEMP],
    spcEveryMin: 30,
    nok: [0.008, 0.02],
  },
  cmm: {
    micro: { everyMin: [120, 240], durSec: [60, 300] },
    changeover: null,
    material: { everyH: [3, 6], durMin: [20, 60] },
    qualityEveryH: null,
    staffingEveryH: 80,
    plannedEveryH: [48, 96],
    suddenReasons: [2],
    degradeReasons: [2],
    slowPool: [],
    spcEveryMin: 120,
    nok: [0.002, 0.006],
  },
}

/** Hat bazında motorun nominal akımı (A) */
const BASE_CURRENT: Record<string, number> = { L1: 30, L2: 9, L3: 15 }

/** Yıpranmaya bağlı arıza olasılığı (saat başına). 0,55 altında yok, 1'de saatte ~0,5. */
export function degradationHazardPerHour(d: number): number {
  return d < 0.55 ? 0 : 0.5 * Math.pow((d - 0.55) / 0.45, 3)
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
  temperatureC: number
  vibrationMmS: number
  feedPct: number
  toolCycles: number
  materialLot: string
  /** 15 dk'da bir 5'li kalite ölçümü */
  quality: number[] | null
  /** Motor akımı (A); makine dururken boşta akımı */
  motorCurrentA: number
  /** Sadece doğrulama için: simülatörün uyguladığı baskın yavaşlama nedeni */
  truthSlow: number
  /** Sadece doğrulama / analiz için: gizli yıpranma seviyesi (SQL'e yazılmaz) */
  truthDegradation: number
}

interface Params {
  eff: number
  baseNok: number
  mtbfMin: number
  microMin: number
  changeoverH: number
  plannedH: number
  materialH: number
  spcBias: number
  spcOffset: number
  spcEvery: number
  baseTemp: number
  /** Sıfırdan tam yıpranmaya kaç çalışma günü */
  degDays: number
  baseCurrent: number
}

interface Seg {
  state: Exclude<StateCode, 0>
  reasonId: number
  remaining: number
  /** Yıpranma kaynaklı arıza mı (onarım yıpranmayı sıfırlar) */
  deg?: boolean
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
  /** Yıpranma için ayrı rastgele sayı akışı (mevcut olayların dizisini bozmamak için) */
  private readonly drng: Rng
  private deg: number
  private degStoryDone = false

  constructor(machine: Machine, idx: number, t0: number) {
    this.machine = machine
    this.t0 = t0
    this.rng = mulberry32(1000 + idx * 7919)
    this.story = STORIES[machine.id] ?? {}
    this.prof = PROFILES[machine.type]
    const r = this.rng
    const pr = this.prof
    const spcEvery = Math.round(((pr.spcEveryMin ?? 30) * 60) / BUCKET_SEC)
    this.p = {
      eff: this.story.eff ?? between(r, 0.93, 0.985),
      baseNok: between(r, pr.nok[0], pr.nok[1]),
      mtbfMin: between(r, 420, 900),
      microMin: pr.micro ? between(r, pr.micro.everyMin[0], pr.micro.everyMin[1]) : 0,
      changeoverH: pr.changeover ? between(r, pr.changeover.everyH[0], pr.changeover.everyH[1]) : 0,
      plannedH: between(r, pr.plannedEveryH[0], pr.plannedEveryH[1]),
      materialH: pr.material ? between(r, pr.material.everyH[0], pr.material.everyH[1]) : 0,
      spcBias: gaussian(r) * 0.15,
      spcOffset: Math.floor(r() * spcEvery),
      spcEvery,
      baseTemp: 40 + idx * 0.6,
      degDays: 0,
      baseCurrent: 0,
    }
    this.temp = this.p.baseTemp
    this.toolCycles = Math.floor(r() * toolLifeCycles(machine) * 0.3)
    this.drng = mulberry32(5000 + idx * 7919)
    this.p.degDays = between(this.drng, 3, 8)
    this.p.baseCurrent = (BASE_CURRENT[machine.lineId] ?? 12) * between(this.drng, 0.92, 1.08)
    this.deg = this.drng() * 0.4
  }

  /** Hikâyeli makinede yıpranma rampası etkin mi? */
  private storyRamp(t: number): number | null {
    const d = this.story.degrade
    if (!d) return null
    const from = this.t0 + d.fromH * HOUR
    const to = this.t0 + d.failAtH * HOUR
    if (t < from || t >= to) return null
    return 0.05 + 0.95 * ((t - from) / (to - from))
  }

  private forcedAt(t: number): ForcedSegment | undefined {
    return this.story.forced?.find((s) => t >= this.t0 + s.fromMin * MIN && t < this.t0 + s.toMin * MIN)
  }

  private get lot(): string {
    return `L${this.machine.id.slice(1)}-${String(this.lotNo).padStart(4, '0')}`
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
    // Yıpranma kaynaklı arıza (hikâye rampasındayken arıza zamanı hikâyece belirlenir)
    if (this.storyRamp(t) === null && this.drng() < (degradationHazardPerHour(this.deg) * BUCKET_SEC) / 3600) {
      this.seg = { state: STATE.STOPPED, reasonId: pickR(pr.degradeReasons, this.drng), remaining: b(between(this.drng, 40, 120) * 60), deg: true }
      return
    }
    const u = r()
    // Ani (belirtisiz) arızalar: çoğunlukla kontrol / elektrik
    let c = per(p.mtbfMin * 60 * 30) * hazard
    if (u < c) {
      this.seg = { state: STATE.STOPPED, reasonId: pickR(pr.suddenReasons, r), remaining: b(between(r, 20, 90) * 60) }
      return
    }
    if (pr.micro) {
      c += per(p.microMin * 60) * (1 + 2.5 * this.deg * this.deg)
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
    if (!nearNow) {
      c += per(p.plannedH * 3600)
      if (u < c) {
        const clean = r() < 0.35
        this.seg = { state: STATE.MAINTENANCE, reasonId: clean ? 11 : 8, remaining: b((clean ? between(r, 15, 30) : between(r, 45, 120)) * 60) }
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

  /** Aşınma yaşı (saat): 12 saatte bir takım değişir, t0'da yaş 8 sa. */
  private wearAgeH(t: number): number {
    const since = t - (this.t0 - 8 * HOUR)
    const cycle = 12 * HOUR
    return (((since % cycle) + cycle) % cycle) / HOUR
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
          if (this.seg.reasonId !== 10) this.warmup = WARMUP_BUCKETS
          if (this.seg.reasonId === 4) {
            // Ürün değişimi: yeni hammadde lotu; takım da değişir (aşınma hikâyesindeki makinede
            // takım kendi 12 saatlik döngüsüyle değişir, sayaç ona bağlıdır)
            if (!this.story.wear) this.toolCycles = 0
            this.lotNo++
          }
          if (this.seg.deg) this.deg = 0.05 + 0.05 * this.drng() // onarım
          else if (this.seg.reasonId === 8) this.deg *= 0.6 // planlı bakım yıpranmayı azaltır
          this.seg = null
        }
      }
      if (!this.seg && this.started) this.startSeg(t)
      if (this.seg) {
        state = this.seg.state
        reasonId = this.seg.reasonId
      }
    }
    this.started = true

    // Yıpranma: hikâye rampası ya da doğal artış (sadece çalışırken)
    const ramp = this.storyRamp(t)
    if (ramp !== null) this.deg = ramp
    else if (this.story.degrade && !this.degStoryDone && t >= this.t0 + this.story.degrade.failAtH * HOUR) {
      this.degStoryDone = true
      this.deg = 0.05 // hikâyedeki arıza onarıldı
    } else if (state === STATE.RUNNING) {
      this.deg = Math.min(1, this.deg + Math.max(0, 1 + 0.8 * gaussian(this.drng)) / (this.p.degDays * 8640))
    }
    const d = this.deg

    // Aşınma hikâyesi: takım yaşı başa sararsa takım değişmiştir
    let wearLoss = 0
    if (this.story.wear) {
      const age = this.wearAgeH(t)
      // İlk adımda takım sayacı takımın yaşıyla tutarlı başlar; yaş başa sararsa takım değişmiştir
      if (i === 0) this.toolCycles = Math.round(age * m.idealRate * 3600 * 0.9)
      else if (age < this.lastWearAge) this.toolCycles = 0
      this.lastWearAge = age
      wearLoss = 0.1 * Math.pow(age / 8, 1.3)
    }

    const ambient = 26
    if (state !== STATE.RUNNING) {
      this.slow = null
      this.temp += (ambient - this.temp) * 0.004
      return {
        machineId: m.id,
        t,
        status: state,
        reasonId,
        produced: 0,
        rejects: 0,
        cycleTimeMs: 0,
        temperatureC: round(this.temp + gaussian(r) * 0.2, 1),
        vibrationMmS: round(0.1 + Math.abs(gaussian(r)) * 0.05, 2),
        feedPct: 0,
        toolCycles: this.toolCycles,
        materialLot: this.lot,
        quality: null,
        motorCurrentA: round(this.p.baseCurrent * 0.08 + Math.abs(gaussian(this.drng)) * 0.1, 1),
        truthSlow: TRUTH.NONE,
        truthDegradation: d,
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
    let truth = 0
    let prod = 1
    for (const [f, c] of factors) {
      prod *= f
      if (f < minF) {
        minF = f
        truth = c
      }
    }
    const speed = Math.max(0.05, base * prod * (1 - 0.04 * d * d))

    let total: number
    let batchDone = false
    if (m.type === 'furnace') {
      // Şarj: çevrim bitince tüm parçalar birden çıkar, ardından yükleme/boşaltma
      this.batchProgress += (BUCKET_SEC * speed * m.idealRate) / m.batchSize
      total = 0
      if (this.batchProgress >= 1) {
        this.batchProgress = 0
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
    if (slowCause === TRUTH.MATERIAL) pNok += 0.02
    if (slowFactor < 0.9) pNok += 0.004
    pNok = Math.min(0.2, pNok)
    // Her parça ayrı ayrı uygun / uygunsuz (az adetli üretim)
    let nok = 0
    for (let k = 0; k < total; k++) if (r() < pNok) nok++
    this.toolCycles += total

    // Sinyaller
    const tempTarget = slowCause === TRUTH.TEMP ? 59 : this.p.baseTemp + 3 * d
    this.temp += (tempTarget - this.temp) * (slowCause === TRUTH.TEMP ? 0.25 : 0.05)
    const feed = slowCause === TRUTH.FEED ? 100 * slowFactor + gaussian(r) * 2.5 : 100 + gaussian(r) * 1.2
    const vib = 1.8 + 12 * wearLoss + 0.35 * d * d + Math.abs(gaussian(r)) * 0.15
    const current = this.p.baseCurrent * (1 + 0.22 * Math.pow(d, 1.5)) * (1 + gaussian(this.drng) * 0.012)
    const cycleJitter = 1 + gaussian(this.drng) * (0.004 + 0.04 * d * d)

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
      temperatureC: round(this.temp + gaussian(r) * 0.3, 1),
      vibrationMmS: round(vib, 2),
      feedPct: round(feed, 1),
      toolCycles: this.toolCycles,
      materialLot: this.lot,
      quality,
      motorCurrentA: round(current, 1),
      truthSlow: minF < 0.93 ? truth : TRUTH.NONE,
      truthDegradation: d,
    }
  }
}

function round(v: number, d: number): number {
  const f = 10 ** d
  return Math.round(v * f) / f
}

/** Dilim sınırına hizalar. */
export const alignBucket = (t: number) => Math.floor(t / BUCKET_MS) * BUCKET_MS
