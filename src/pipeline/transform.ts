import { inferSlowReason, RULE, UNEXPLAINED_THRESHOLD } from '@/lib/rules'
import { BUCKET_MS, STATE } from '@/lib/types'
import { stateFromSqlStatus } from './rows'
import type { CounterRow, EventRow, ProcessRow, QualityRow, TagRow } from './rows'
import type { Channel, TagMap } from '@/sim/tags'
import type { FurnaceCycle } from './trace'

/**
 * Collector'ın "anlamlandırma" katmanı (saf, testli). Bir makinenin SQL satırlarını
 * zaman sırasıyla alır ve bizim iç modelimizi üretir:
 *   kümülatif sayaç → 10 sn'lik OK/NOK, olaylar → dilim durumu + duruş kayıtları,
 *   çevrim süresi → hız %, historian etiketleri → ortak kanallar (sıcaklık, titreşim, yük…),
 *   kanallar + kurallar → yavaşlık nedeni, ölçümler → SPC alt grubu.
 */

export interface MachineInfo {
  id: string
  /** Makine tipi: fırın ve ölçüm makinesinde yavaşlık kuralları (takım, ilerleme…) anlamsızdır */
  type?: string
  idealCycleMs: number
  toolLife: number
  /** Etiket → kanal eşlemesi (dbo.MachineTags) */
  tags?: TagMap[]
  /** Kanal referansları (devreye alma değerleri) */
  ref?: Partial<Record<Channel, number>>
  /** Fırın reçetesi (dbo.FurnaceRecipes): tutma süresi ve sıcaklık toleransı */
  recipe?: { setpointC: number; holdMin: number; toleranceC: number; furnaceClass: number }
}

export interface TransformContext {
  /** t anında makinenin başındaki operatörün tecrübesi (yıl); bilinmiyorsa null */
  experienceAt(machineId: string, t: number): number | null
}

export interface BucketOut {
  machineId: string
  t: number
  state: number
  downReason: number
  slowReason: number
  speed: number
  ok: number
  nok: number
  /** Kanallar (makine tipine göre anlamı değişir, bkz. src/sim/tags.ts); ölçüm yoksa NaN */
  temp: number
  vib: number
  hf: number
  load: number
  cur: number
  aux: number
  feed: number
}

export interface StopOut {
  machineId: string
  state: number
  reasonId: number
  start: number
  end: number | null
}

export interface SlowOut {
  machineId: string
  reasonId: number
  start: number
  end: number | null
  minSpeed: number
}

export interface SpcOut {
  machineId: string
  t: number
  mean: number
  range: number
}

export interface TransformOutput {
  buckets: BucketOut[]
  stops: StopOut[]
  slows: SlowOut[]
  spc: SpcOut[]
  /** Biten fırın çevrimlerinin reçete uyumu */
  cycles: FurnaceCycle[]
}

export const emptyOutput = (): TransformOutput => ({ buckets: [], stops: [], slows: [], spc: [], cycles: [] })

/** Fırında set değerine bu kadar yakın sıcaklık "tutma" sayılır (rampa ve soğutma hariç) */
const SOAK_BAND_C = 15

const SPEED_WINDOW = 6
const MICROSTOP_REASON = 10

interface State {
  prevTotal: number | null
  prevReject: number | null
  state: number
  reason: number
  openStop: StopOut | null
  openSlow: SlowOut | null
  restartAt: number | null
  lot: string | null
  lotChangedAt: number | null
  speeds: number[]
  quality: { subgroupNo: number; t: number; values: number[] } | null
  /** Fırın: süren tutma */
  soak?: { start: number; end: number; min: number; max: number } | null
}

export class MachineTransformer {
  readonly info: MachineInfo
  private readonly ctx: TransformContext
  private events: EventRow[] = []
  private s: State = {
    prevTotal: null,
    prevReject: null,
    state: STATE.RUNNING,
    reason: 0,
    openStop: null,
    openSlow: null,
    restartAt: null,
    lot: null,
    lotChangedAt: null,
    speeds: [],
    quality: null,
  }

  constructor(info: MachineInfo, ctx: TransformContext) {
    this.info = info
    this.ctx = ctx
  }

  /** Olaylar sayaçlardan önce verilmeli (aynı sorgu turunda). */
  addEvent(e: EventRow): void {
    this.events.push(e)
  }

  private applyEventsUntil(t: number, out: TransformOutput): void {
    if (this.events.length > 1) this.events.sort((a, b) => a.t - b.t)
    while (this.events.length && this.events[0].t <= t) {
      const e = this.events.shift()!
      const state = stateFromSqlStatus(e.status)
      const reason = e.reasonCode ?? 0
      if (state === this.s.state && reason === this.s.reason) continue
      const s = this.s
      if (s.openStop) {
        s.openStop.end = e.t
        out.stops.push({ ...s.openStop })
        s.openStop = null
      }
      if (state === STATE.RUNNING && s.state !== STATE.RUNNING && s.reason !== MICROSTOP_REASON) s.restartAt = e.t
      if (state !== STATE.RUNNING) {
        s.openStop = { machineId: this.info.id, state, reasonId: reason, start: e.t, end: null }
        out.stops.push({ ...s.openStop })
        s.speeds = []
      }
      s.state = state
      s.reason = reason
    }
  }

  /** Etiket satırlarından kanallar */
  private channels(tags: TagRow[] | undefined): Record<Channel, number> {
    const ch: Record<Channel, number> = { temp: NaN, vib: NaN, hf: NaN, load: NaN, cur: NaN, aux: NaN, feed: NaN }
    if (!tags?.length || !this.info.tags) return ch
    const v: Record<string, number> = {}
    for (const r of tags) v[r.tag] = r.value
    for (const d of this.info.tags) {
      if (!d.channel || v[d.tag] === undefined) continue
      if (d.relativeTo) {
        if (v[d.relativeTo] !== undefined) ch[d.channel] = v[d.tag] - v[d.relativeTo]
      } else ch[d.channel] = v[d.tag]
    }
    return ch
  }

  addCounter(c: CounterRow, pv: ProcessRow | undefined, out: TransformOutput, tags?: TagRow[]): void {
    const s = this.s
    if (s.prevTotal === null || s.prevReject === null) {
      // İlk okuma: sadece taban değer
      s.prevTotal = c.totalCount
      s.prevReject = c.rejectCount
      return
    }
    let dTotal = c.totalCount - s.prevTotal
    let dReject = c.rejectCount - s.prevReject
    if (dTotal < 0 || dReject < 0) {
      // Sayaç sıfırlandı (gün başı veya PLC yeniden başlatma)
      dTotal = c.totalCount
      dReject = c.rejectCount
    }
    s.prevTotal = c.totalCount
    s.prevReject = c.rejectCount

    const t = c.sampleT - BUCKET_MS
    this.applyEventsUntil(t, out)

    const running = s.state === STATE.RUNNING
    let speed = 0
    if (running) {
      speed = pv && pv.cycleTimeMs > 0 ? this.info.idealCycleMs / pv.cycleTimeMs : dTotal / ((BUCKET_MS / this.info.idealCycleMs) || 1)
      s.speeds.push(speed)
      if (s.speeds.length > SPEED_WINDOW) s.speeds.shift()
    }

    if (pv) {
      if (s.lot !== null && pv.materialLot !== s.lot) s.lotChangedAt = t
      s.lot = pv.materialLot
    }

    const ch = this.channels(tags)
    const ref = this.info.ref ?? {}
    if (this.info.recipe) this.trackSoak(t, running, ch.temp, out)
    let slowReason = 0
    const rulesApply = this.info.type !== 'furnace' && this.info.type !== 'cmm'
    if (running && s.speeds.length >= 3 && pv && !rulesApply) {
      const speedAvg = s.speeds.reduce((a, b) => a + b, 0) / s.speeds.length
      slowReason = speedAvg < UNEXPLAINED_THRESHOLD ? RULE.UNKNOWN : RULE.NONE
    } else if (running && s.speeds.length >= 3 && pv) {
      const speedAvg = s.speeds.reduce((a, b) => a + b, 0) / s.speeds.length
      slowReason = inferSlowReason({
        speedAvg,
        tempDevC: ch.temp - (ref.temp ?? NaN),
        feedPct: ch.feed,
        vibRatio: ref.vib ? ch.vib / ref.vib : NaN,
        hfRatio: ref.hf ? ch.hf / ref.hf : NaN,
        toolRatio: pv.toolCycleCount / this.info.toolLife,
        msSinceRestart: s.restartAt === null ? null : t - s.restartAt,
        msSinceLotChange: s.lotChangedAt === null ? null : t - s.lotChangedAt,
        operatorExperienceYears: this.ctx.experienceAt(this.info.id, t),
      })
    }
    this.trackSlow(t, slowReason, speed, out)

    out.buckets.push({
      machineId: this.info.id,
      t,
      state: s.state,
      downReason: running ? 0 : s.reason,
      slowReason,
      speed,
      ok: Math.max(0, dTotal - dReject),
      nok: Math.max(0, dReject),
      ...ch,
    })
  }

  /**
   * AMS 2750 reçete uyumu: tutma boyunca set değerinden sapmanın en düşük / en yüksek değeri ve
   * tutma süresi. Tutma, sıcaklık soğutmayla banttan çıkınca biter; süre ve sapma reçeteyle kıyaslanır.
   */
  private trackSoak(t: number, running: boolean, dev: number, out: TransformOutput): void {
    const s = this.s
    const r = this.info.recipe!
    if (running && !Number.isNaN(dev) && Math.abs(dev) < SOAK_BAND_C) {
      if (!s.soak) s.soak = { start: t, end: t, min: dev, max: dev }
      s.soak.end = t + BUCKET_MS
      s.soak.min = Math.min(s.soak.min, dev)
      s.soak.max = Math.max(s.soak.max, dev)
      return
    }
    // Kısa kesinti (ölçüm yok, kısa duruş) tutmayı bitirmez; soğutma (sapma < −bant) bitirir
    if (!s.soak || !(dev < -SOAK_BAND_C)) return
    const soak = s.soak
    s.soak = null
    const holdMin = (soak.end - soak.start) / 60000
    if (holdMin < 20) return
    out.cycles.push({
      machineId: this.info.id,
      start: soak.start,
      end: soak.end,
      holdMin,
      minDev: soak.min,
      maxDev: soak.max,
      setpointC: r.setpointC,
      requiredHoldMin: r.holdMin,
      toleranceC: r.toleranceC,
      furnaceClass: r.furnaceClass,
      ok: holdMin >= r.holdMin && Math.max(Math.abs(soak.min), Math.abs(soak.max)) <= r.toleranceC,
    })
  }

  private trackSlow(t: number, reason: number, speed: number, out: TransformOutput): void {
    const s = this.s
    const open = s.openSlow
    if (reason === RULE.NONE) {
      if (open) {
        open.end = t
        out.slows.push({ ...open })
        s.openSlow = null
      }
      return
    }
    if (open && open.reasonId === reason) {
      if (speed < open.minSpeed) {
        open.minSpeed = speed
        out.slows.push({ ...open })
      }
      return
    }
    if (open) {
      open.end = t
      out.slows.push({ ...open })
    }
    s.openSlow = { machineId: this.info.id, reasonId: reason, start: t, end: null, minSpeed: speed }
    out.slows.push({ ...s.openSlow })
  }

  addQuality(q: QualityRow, out: TransformOutput): void {
    const s = this.s
    if (s.quality && s.quality.subgroupNo !== q.subgroupNo) this.flushQuality(out)
    if (!s.quality) s.quality = { subgroupNo: q.subgroupNo, t: q.sampleT - BUCKET_MS, values: [] }
    s.quality.values.push(q.value)
    if (s.quality.values.length >= 5) this.flushQuality(out)
  }

  private flushQuality(out: TransformOutput): void {
    const g = this.s.quality
    this.s.quality = null
    if (!g || g.values.length < 2) return
    const mean = g.values.reduce((a, b) => a + b, 0) / g.values.length
    out.spc.push({ machineId: this.info.id, t: g.t, mean, range: Math.max(...g.values) - Math.min(...g.values) })
  }

  /** Collector yeniden başlarsa kaldığı yerden devam edebilmesi için. */
  snapshot(): string {
    return JSON.stringify({ s: this.s, events: this.events })
  }

  restore(json: string): void {
    const o = JSON.parse(json) as { s: State; events: EventRow[] }
    this.s = o.s
    this.events = o.events
  }
}
