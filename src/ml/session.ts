import type { FeatureBucket } from './features'
import { Notifier } from './notify'
import type { NotifyMachine } from './notify'
import { RiskEngine } from './riskEngine'
import type { MaintNotification, NotificationStatus, RiskPoint } from './types'

const KEEP_MS = 7 * 24 * 3600 * 1000

/**
 * Bellekte çalışan öngörücü bakım oturumu: risk motoru + bildirimler + durumlar.
 * Web demo ve yerel test hattı kullanır; tam sürümde aynı parçalar collector'da SQLite'a yazar.
 */
export class PredictiveSession {
  private engine: RiskEngine
  private notifier: Notifier
  private risk = new Map<string, RiskPoint[]>()
  private notes = new Map<string, MaintNotification>()
  private list: MaintNotification[] = []

  constructor(machines: NotifyMachine[]) {
    this.engine = new RiskEngine(machines)
    this.notifier = new Notifier(machines)
  }

  /** true: yeni risk noktası veya bildirim değişikliği oldu */
  add(machineId: string, b: FeatureBucket): boolean {
    const ev = this.engine.add(machineId, b)
    if (!ev) return false
    let changed = false
    if (ev.failureAt !== undefined) {
      const c = this.notifier.onFailure(machineId, ev.failureAt)
      if (c?.confirmed) {
        const n = this.notes.get(c.confirmed.id)
        if (n) n.failureAt = c.confirmed.failureAt
        changed = true
      }
    }
    if (ev.point) {
      const arr = this.risk.get(machineId) ?? []
      arr.push(ev.point)
      while (arr.length && arr[0].t < ev.point.t - KEEP_MS) arr.shift()
      this.risk.set(machineId, arr)
      const c = this.notifier.onRisk(ev.point)
      if (c?.created) this.notes.set(c.created.id, c.created)
      changed = true
    }
    if (changed) this.list = [...this.notes.values()].sort((a, b) => b.t - a.t)
    return changed
  }

  riskSeries(machineId: string): RiskPoint[] {
    return this.risk.get(machineId) ?? []
  }
  notifications(): MaintNotification[] {
    return this.list
  }
  setStatus(id: string, status: NotificationStatus, now: number): void {
    const n = this.notes.get(id)
    if (!n) return
    n.status = status
    n.statusAt = now
    this.list = [...this.list]
  }
}
