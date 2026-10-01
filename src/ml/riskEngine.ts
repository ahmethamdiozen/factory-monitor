import { STATE } from '@/lib/types'
import { FeatureTracker } from './features'
import type { FeatureBucket } from './features'
import { explain, levelOf, predictRisk } from './predict'
import type { RiskPoint } from './types'

/** Riskin hesaplanma aralığı (fabrikanın istediği 3–5 dk) */
export const RISK_EVERY_MS = 5 * 60 * 1000
const BREAKDOWN = new Set([1, 2, 3])

export interface RiskMachine {
  id: string
  lineId: string
}

export interface EngineEvent {
  /** Hesaplanan risk noktası */
  point?: RiskPoint
  /** Bu dilimde arıza başladı */
  failureAt?: number
}

/**
 * Makine başına özellik izleyicisi + model. Dilimler zaman sırasıyla verilir;
 * her 5 dakikalık sınırda risk hesaplanır. Collector ve web demo aynı motoru kullanır.
 */
export class RiskEngine {
  private trackers = new Map<string, FeatureTracker>()
  private inBreakdown = new Map<string, boolean>()

  constructor(machines: RiskMachine[]) {
    for (const m of machines) this.trackers.set(m.id, new FeatureTracker(m.id, m.lineId))
  }

  add(machineId: string, b: FeatureBucket): EngineEvent | null {
    const tr = this.trackers.get(machineId)
    if (!tr) return null
    tr.add(b)
    const bd = b.state === STATE.STOPPED && BREAKDOWN.has(b.downReason)
    const ev: EngineEvent = {}
    if (bd && !this.inBreakdown.get(machineId)) ev.failureAt = b.t
    this.inBreakdown.set(machineId, bd)
    // Arıza sürerken risk hesaplanmaz (makine zaten arızada)
    if (!bd && b.t % RISK_EVERY_MS === 0) {
      const x = tr.features(b.t)
      if (x) {
        const risk = predictRisk(x)
        const level = levelOf(risk)
        ev.point = { machineId, t: b.t, risk, level, factors: level === 'good' ? [] : explain(x) }
      }
    }
    return ev.point || ev.failureAt !== undefined ? ev : null
  }
}
