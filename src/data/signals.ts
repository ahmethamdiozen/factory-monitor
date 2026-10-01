import { STATE } from '@/lib/types'
import type { MachineType } from '@/lib/types'
import { CHANNELS } from '@/sim/tags'
import type { Channel } from '@/sim/tags'

/**
 * Süreç sinyallerinin 5 dakikalık ortalamaları (makine detayındaki sinyal grafikleri için).
 * Sadece çalışırken ölçülen değerler kullanılır; fırında sadece tutma (reçete sıcaklığında
 * bekleme) anı — ısınma ve soğutma rampaları referansla karşılaştırılamaz.
 */

export const SIGNAL_SLOT_MS = 5 * 60 * 1000
const SOAK_BAND_C = 15

export type SignalPoint = { t: number } & Record<Channel, number | null>

export interface SignalBucket {
  t: number
  state: number
  temp: number
  vib: number
  hf: number
  load: number
  cur: number
  aux: number
  feed: number
}

export function signalCounts(type: MachineType, b: SignalBucket): boolean {
  return b.state === STATE.RUNNING && (type !== 'furnace' || Math.abs(b.temp) < SOAK_BAND_C)
}

export class SignalAggregator {
  private readonly type: MachineType
  private readonly keepMs: number
  private points: SignalPoint[] = []
  private cur: { t: number; s: Record<Channel, number>; n: Record<Channel, number> } | null = null

  constructor(type: MachineType, keepMs: number) {
    this.type = type
    this.keepMs = keepMs
  }

  add(b: SignalBucket): void {
    const slot = Math.floor(b.t / SIGNAL_SLOT_MS) * SIGNAL_SLOT_MS
    if (!this.cur || this.cur.t !== slot) {
      this.flush()
      this.cur = { t: slot, s: Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<Channel, number>, n: Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<Channel, number> }
    }
    if (!signalCounts(this.type, b)) return
    for (const c of CHANNELS) {
      const v = b[c]
      if (!Number.isNaN(v)) {
        this.cur.s[c] += v
        this.cur.n[c]++
      }
    }
  }

  private flush(): void {
    const c = this.cur
    if (!c) return
    const p = { t: c.t } as SignalPoint
    for (const ch of CHANNELS) p[ch] = c.n[ch] ? c.s[ch] / c.n[ch] : null
    this.points.push(p)
    while (this.points.length && this.points[0].t < c.t - this.keepMs) this.points.shift()
  }

  /** Tamamlanmış dilimler + şu anki yarım dilim */
  list(): SignalPoint[] {
    const c = this.cur
    if (!c) return this.points
    const p = { t: c.t } as SignalPoint
    for (const ch of CHANNELS) p[ch] = c.n[ch] ? c.s[ch] / c.n[ch] : null
    return [...this.points, p]
  }
}
