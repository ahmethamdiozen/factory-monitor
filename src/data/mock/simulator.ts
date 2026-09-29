import type { DataSource } from '@/data/DataSource'
import { BUCKET_MS, BUCKET_SEC, STATE } from '@/lib/types'
import type { Machine, MachineSeries, SlowEvent, SpcPoint, StateCode, StopEvent } from '@/lib/types'
import { between, gaussian, mulberry32 } from '@/lib/rng'
import type { Rng } from '@/lib/rng'
import { DAY_START_HOUR, MACHINES, shiftOf } from './factory'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY_BUCKETS = (24 * HOUR) / BUCKET_MS
const SPC_EVERY_BUCKETS = 90 // 15 dk
const SPC_N = 5

/** Simülasyon "şimdi" başlangıcı: bugün 17:40 (B vardiyasının 3 sa 40 dk'sı) */
function computeT0(): number {
  const d = new Date()
  d.setHours(DAY_START_HOUR, 0, 0, 0)
  return d.getTime() + 11 * HOUR + 40 * MIN
}

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
}

/** Demo için bilinçli gömülmüş "hikâyeler" (dakikalar t0'a göre). */
const STORIES: Record<string, Story> = {
  M02: { eff: 0.98, wear: true },
  M03: { forced: [{ fromMin: -18, toMin: 9, kind: 'stop', state: STATE.CHANGEOVER, reasonId: 4 }] },
  M04: { forced: [{ fromMin: -50, toMin: 30, kind: 'slow', reasonId: 4, factor: 0.84 }] },
  M06: { forced: [{ fromMin: -35, toMin: 40, kind: 'stop', state: STATE.MAINTENANCE, reasonId: 8 }] },
  M08: { eff: 0.97, rookieInB: true },
  M09: { forced: [{ fromMin: -40, toMin: 20, kind: 'slow', reasonId: 6, factor: 0.82 }] },
  M10: { forced: [{ fromMin: -22, toMin: 14, kind: 'stop', state: STATE.STOPPED, reasonId: 6 }] },
  M11: { forced: [{ fromMin: -40, toMin: 20, kind: 'slow', reasonId: 6, factor: 0.8 }] },
  M12: { forced: [{ fromMin: -170, toMin: -122, kind: 'stop', state: STATE.STOPPED, reasonId: 1 }] },
}

const WARMUP_BUCKETS = 36 // 6 dk

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
}

interface Seg {
  state: Exclude<StateCode, 0>
  reasonId: number
  remaining: number
}

interface SlowEp {
  reasonId: number
  factor: number
  remaining: number
  eventId: number
}

class MachineSim {
  readonly rng: Rng
  readonly p: Params
  readonly story: Story
  seg: Seg | null = null
  warmup = 0
  slow: SlowEp | null = null
  forcedWasActive = false
  /** Vardiyaya göre arıza olasılığı çarpanı (gece daha yüksek) */
  shiftHaz = 1
  noise = 0
  acc = 0
  prevState: StateCode = STATE.RUNNING
  prevReason = 0
  openStop: StopEvent | null = null
  openSlowForced: SlowEvent | null = null
  spc: SpcPoint[] = []

  readonly machine: Machine
  readonly idx: number
  private t0: number
  private newId: () => number
  private stops: StopEvent[]
  private slows: SlowEvent[]

  constructor(machine: Machine, idx: number, t0: number, newId: () => number, stops: StopEvent[], slows: SlowEvent[]) {
    this.machine = machine
    this.idx = idx
    this.t0 = t0
    this.newId = newId
    this.stops = stops
    this.slows = slows
    this.rng = mulberry32(1000 + idx * 7919)
    this.story = STORIES[machine.id] ?? {}
    const r = this.rng
    this.p = {
      eff: this.story.eff ?? between(r, 0.93, 0.985),
      baseNok: between(r, 0.004, 0.016),
      mtbfMin: between(r, 420, 900),
      microMin: between(r, 14, 32),
      changeoverH: between(r, 10, 18),
      plannedH: between(r, 24, 44),
      materialH: between(r, 9, 16),
      spcBias: gaussian(r) * 0.15,
      spcOffset: Math.floor(r() * SPC_EVERY_BUCKETS),
    }
  }

  private forcedAt(t: number): ForcedSegment | undefined {
    const f = this.story.forced
    if (!f) return undefined
    return f.find((s) => t >= this.t0 + s.fromMin * MIN && t < this.t0 + s.toMin * MIN)
  }

  private startSeg(t: number): void {
    const r = this.rng
    // Demo anı çevresinde rastgele planlı/ayar duruşu başlatma (hikâye senaryosu bozulmasın)
    const nearNow = t > this.t0 - 90 * MIN && t < this.t0 + 120 * MIN
    const b = (sec: number) => Math.max(1, Math.round(sec / BUCKET_SEC))
    const p = this.p
    const per = (meanSec: number) => BUCKET_SEC / meanSec
    const u = r()
    let c = per(p.mtbfMin * 60) * this.shiftHaz
    if (u < c) {
      const rr = r()
      this.seg = { state: STATE.STOPPED, reasonId: rr < 0.5 ? 1 : rr < 0.85 ? 2 : 3, remaining: b(between(r, 20, 90) * 60) }
      return
    }
    c += per(p.microMin * 60)
    if (u < c) {
      this.seg = { state: STATE.STOPPED, reasonId: 10, remaining: b(between(r, 20, 120)) }
      return
    }
    if (!nearNow) c += per(p.changeoverH * 3600)
    if (!nearNow && u < c) {
      this.seg = { state: STATE.CHANGEOVER, reasonId: r() < 0.7 ? 4 : 5, remaining: b(between(r, 15, 35) * 60) }
      return
    }
    if (!nearNow) c += per(p.plannedH * 3600)
    if (!nearNow && u < c) {
      const clean = r() < 0.35
      this.seg = {
        state: STATE.MAINTENANCE,
        reasonId: clean ? 11 : 8,
        remaining: b((clean ? between(r, 15, 30) : between(r, 30, 60)) * 60),
      }
      return
    }
    c += per(p.materialH * 3600)
    if (u < c) {
      this.seg = { state: STATE.STOPPED, reasonId: 6, remaining: b(between(r, 5, 20) * 60) }
      return
    }
    c += per(60 * 3600)
    if (u < c) {
      this.seg = { state: STATE.STOPPED, reasonId: 7, remaining: b(between(r, 10, 25) * 60) }
      return
    }
    c += per(30 * 3600)
    if (u < c) {
      this.seg = { state: STATE.STOPPED, reasonId: 9, remaining: b(between(r, 8, 20) * 60) }
    }
  }

  /** Aşınma yaşı (saat): her 12 saatte takım değişir, t0-8sa'te son değişim (t0'da yaş 8 sa). */
  private wearAgeH(t: number): number {
    const lastChange0 = this.t0 - 8 * HOUR
    const cycle = 12 * HOUR
    const since = t - lastChange0
    const m = ((since % cycle) + cycle) % cycle
    return m / HOUR
  }

  step(i: number, s: MachineSeries): void {
    const t = s.startT + i * BUCKET_MS
    const r = this.rng
    const sh = shiftOf(t)
    this.shiftHaz = sh === 'C' ? 1.6 : sh === 'B' ? 1.05 : 1
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
        this.seg = null
        this.warmup = WARMUP_BUCKETS
      }
      if (this.seg) {
        this.seg.remaining -= 1
        if (this.seg.remaining < 0) {
          if (this.seg.reasonId !== 10) this.warmup = WARMUP_BUCKETS
          this.seg = null
        }
      }
      if (!this.seg && this.i0Started(i)) this.startSeg(t)
      if (this.seg) {
        state = this.seg.state
        reasonId = this.seg.reasonId
      }
    }

    // Durum olayı takibi
    if (state !== this.prevState || reasonId !== this.prevReason) {
      if (this.openStop) {
        this.openStop.end = t
        this.openStop = null
      }
      if (state !== STATE.RUNNING) {
        const ev: StopEvent = { id: this.newId(), machineId: this.machine.id, state, reasonId, start: t, end: null }
        this.stops.push(ev)
        this.openStop = ev
      }
      this.prevState = state
      this.prevReason = reasonId
    }

    s.state[i] = state
    s.downReason[i] = reasonId

    if (state !== STATE.RUNNING) {
      this.endRandomSlow(t)
      this.closeSlow(t)
      s.speed[i] = 0
      s.slowReason[i] = 0
      s.ok[i] = 0
      s.nok[i] = 0
      return
    }

    // Yavaşlama bölümleri
    let slowFactor = 1
    let slowCause = 0
    if (forced && forced.kind === 'slow') {
      slowFactor = forced.factor! + gaussian(r) * 0.01
      slowCause = forced.reasonId
      if (!this.openSlowForced) {
        const ev: SlowEvent = { id: this.newId(), machineId: this.machine.id, reasonId: forced.reasonId, start: t, end: null, minSpeed: slowFactor }
        this.slows.push(ev)
        this.openSlowForced = ev
      } else {
        this.openSlowForced.minSpeed = Math.min(this.openSlowForced.minSpeed, slowFactor)
      }
    } else {
      this.closeSlow(t)
      if (this.slow) {
        this.slow.remaining -= 1
        if (this.slow.remaining < 0) this.endRandomSlow(t)
      }
      if (!this.slow && r() < BUCKET_SEC / (7 * 3600)) {
        const reasonPool = [2, 4, 6]
        const reasonId = reasonPool[Math.floor(r() * reasonPool.length)]
        const factor = between(r, 0.72, 0.86)
        const ev: SlowEvent = { id: this.newId(), machineId: this.machine.id, reasonId, start: t, end: null, minSpeed: factor }
        this.slows.push(ev)
        this.slow = { reasonId, factor, remaining: Math.round(between(r, 20, 60) * 6), eventId: ev.id }
      }
      if (this.slow) {
        slowFactor = this.slow.factor
        slowCause = this.slow.reasonId
      }
    }

    // Isınma rampası
    let warmFactor = 1
    if (this.warmup > 0) {
      warmFactor = 0.72 + 0.28 * (1 - this.warmup / WARMUP_BUCKETS)
      this.warmup -= 1
    }

    // Aşınma
    let wearLoss = 0
    if (this.story.wear) wearLoss = 0.1 * Math.pow(this.wearAgeH(t) / 8, 1.3)

    // Acemi operatör (yalnızca B vardiyası)
    const rookieFactor = this.story.rookieInB && sh === 'B' ? 0.85 : 1
    const shiftEff = sh === 'C' ? 0.965 : sh === 'B' ? 0.99 : 1

    this.noise = this.noise * 0.9 + gaussian(r) * 0.009
    const base = (this.p.eff + this.noise) * shiftEff

    const factors: [number, number][] = [
      [slowFactor, slowCause],
      [warmFactor, 5],
      [1 - wearLoss, 1],
      [rookieFactor, 3],
    ]
    let minF = 1
    let cause = 0
    let prod = 1
    for (const [f, c] of factors) {
      prod *= f
      if (f < minF) {
        minF = f
        cause = c
      }
    }
    const speed = Math.max(0.05, base * prod)
    s.speed[i] = speed
    s.slowReason[i] = minF < 0.93 ? cause : 0

    const expected = this.machine.idealRate * BUCKET_SEC * speed
    this.acc += expected
    const total = Math.floor(this.acc)
    this.acc -= total

    let pNok = this.p.baseNok
    pNok += Math.max(0, 0.93 - warmFactor) * 0.2
    pNok += wearLoss * 0.35
    if (slowFactor < 0.9) pNok += 0.004
    pNok = Math.min(0.2, pNok)
    let nok = Math.round(total * pNok + gaussian(r) * Math.sqrt(total * pNok * (1 - pNok)))
    nok = Math.max(0, Math.min(total, nok))
    s.ok[i] = total - nok
    s.nok[i] = nok

    // SPC örneklemesi
    if ((i + this.p.spcOffset) % SPC_EVERY_BUCKETS === 0) {
      const spec = this.machine.spec
      const drift = this.story.wear ? 0.2 * spec.sigma * this.wearAgeH(t) : 0
      const vals: number[] = []
      for (let k = 0; k < SPC_N; k++) {
        vals.push(spec.nominal + this.p.spcBias * spec.sigma + drift + gaussian(r) * spec.sigma)
      }
      const mean = vals.reduce((a, b) => a + b, 0) / SPC_N
      const range = Math.max(...vals) - Math.min(...vals)
      this.spc.push({ t, mean, range })
    }
  }

  private endRandomSlow(t: number): void {
    if (!this.slow) return
    const id = this.slow.eventId
    const ev = this.slows.find((e) => e.id === id)
    if (ev) ev.end = t
    this.slow = null
  }

  private closeSlow(t: number): void {
    if (this.openSlowForced) {
      this.openSlowForced.end = t
      this.openSlowForced = null
    }
  }

  /** Simülasyonun ilk bucket'ında makine çalışır durumda başlar. */
  private i0Started(i: number): boolean {
    return i > 0
  }
}

export class MockDataSource implements DataSource {
  readonly kind = 'mock' as const
  startT = 0
  private t0 = 0
  private length = 0
  private cap = 0
  private series = new Map<string, MachineSeries>()
  private sims: MachineSim[] = []
  private stops: StopEvent[] = []
  private slows: SlowEvent[] = []
  private listeners = new Set<() => void>()
  private eventId = 1
  private speedBuckets = 6
  private paused = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.init()
    this.timer = setInterval(() => this.tick(), 1000)
  }

  private init(): void {
    this.t0 = computeT0()
    const dayStart = new Date(this.t0)
    dayStart.setHours(DAY_START_HOUR, 0, 0, 0)
    this.startT = dayStart.getTime() - 24 * HOUR
    const n0 = Math.round((this.t0 - this.startT) / BUCKET_MS)
    this.cap = n0 + DAY_BUCKETS * 7
    this.series.clear()
    this.stops = []
    this.slows = []
    this.eventId = 1
    this.sims = MACHINES.map((m, idx) => {
      this.series.set(m.id, {
        startT: this.startT,
        length: 0,
        state: new Uint8Array(this.cap),
        downReason: new Uint8Array(this.cap),
        slowReason: new Uint8Array(this.cap),
        speed: new Float32Array(this.cap),
        ok: new Uint16Array(this.cap),
        nok: new Uint16Array(this.cap),
      })
      return new MachineSim(m, idx, this.t0, () => this.eventId++, this.stops, this.slows)
    })
    this.length = 0
    this.advance(n0)
  }

  private advance(n: number): void {
    for (let k = 0; k < n; k++) {
      if (this.length >= this.cap) {
        this.paused = true
        break
      }
      const i = this.length
      for (const sim of this.sims) {
        const s = this.series.get(sim.machine.id)!
        sim.step(i, s)
      }
      this.length++
      for (const s of this.series.values()) s.length = this.length
    }
  }

  private tick(): void {
    if (this.paused) return
    this.advance(this.speedBuckets)
    this.listeners.forEach((fn) => fn())
  }

  now(): number {
    return this.startT + this.length * BUCKET_MS
  }
  machineSeries(id: string): MachineSeries {
    return this.series.get(id)!
  }
  stopEvents(): StopEvent[] {
    return this.stops
  }
  slowEvents(): SlowEvent[] {
    return this.slows
  }
  spc(id: string): SpcPoint[] {
    return this.sims.find((s) => s.machine.id === id)?.spc ?? []
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  controls = {
    getSpeed: () => this.speedBuckets,
    setSpeed: (n: number) => {
      this.speedBuckets = n
    },
    isPaused: () => this.paused,
    setPaused: (p: boolean) => {
      this.paused = p
      this.listeners.forEach((fn) => fn())
    },
    reset: () => {
      this.init()
      this.listeners.forEach((fn) => fn())
    },
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
