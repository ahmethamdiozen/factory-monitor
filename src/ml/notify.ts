import { MODEL_DATA } from './modelData'
import type { MaintNotification, RiskFactor, RiskPoint } from './types'

/**
 * Bildirim kuralları. KARAR modeldedir; bu dosya sadece ne zaman ve kime haber verileceğini
 * belirler. Mesaj metni composeMessage() ile şablondan üretilir — ileride SLM (küçük dil modeli)
 * bağlandığında sadece bu fonksiyon değişecek; karar ve eşikler aynı kalacak.
 */

const HOUR = 3600 * 1000
/** Risk bu kadar süre "Dikkat" eşiğinin altında kalırsa olay kapanır, yeni bildirim açılabilir */
const QUIET_MS = 60 * 60 * 1000

export interface NotifyMachine {
  id: string
  code: string
  name: string
  lineId: string
  lineShort: string
}

export function composeMessage(m: NotifyMachine, risk: number, factors: RiskFactor[], horizonHours: number): { title: string; message: string } {
  const why = factors.length ? factors.map((f) => f.text.charAt(0).toLowerCase() + f.text.slice(1)).join('; ') : 'birden fazla sinyal normalin dışında'
  return {
    title: `${m.code} · Arıza riski yüksek (%${Math.round(risk * 100)})`,
    message: `${m.name} önümüzdeki ${horizonHours} saat içinde arızalanabilir. Neden: ${why}. Öneri: bakım ekibi bu vardiya içinde kontrol etsin; ${m.lineShort} foreman'i üretim planını buna göre ayarlasın.`,
  }
}

export interface NotifyChange {
  created?: MaintNotification
  /** Arıza gerçekleşti → bu bildirim doğrulandı */
  confirmed?: { id: string; failureAt: number }
}

export class Notifier {
  private machines = new Map<string, NotifyMachine>()
  /** makine → açık olay (son bildirim kimliği, son "yüksek" zamanı) */
  private open = new Map<string, { id: string; lastHigh: number }>()
  /** makine → son bildirim (arıza doğrulaması için) */
  private last = new Map<string, { id: string; t: number }>()

  constructor(machines: NotifyMachine[]) {
    for (const m of machines) this.machines.set(m.id, m)
  }

  onRisk(p: RiskPoint): NotifyChange | null {
    const m = this.machines.get(p.machineId)
    if (!m) return null
    const o = this.open.get(p.machineId)
    if (o) {
      if (p.risk >= MODEL_DATA.thresholds.watch) o.lastHigh = p.t
      else if (p.t - o.lastHigh >= QUIET_MS) this.open.delete(p.machineId)
      return null
    }
    if (p.level !== 'alarm') return null
    const { title, message } = composeMessage(m, p.risk, p.factors, MODEL_DATA.horizonHours)
    const n: MaintNotification = {
      id: `${p.machineId}-${p.t}`,
      t: p.t,
      machineId: p.machineId,
      lineId: m.lineId,
      title,
      message,
      recipients: ['bakim', `foreman:${m.lineId}`],
      risk: p.risk,
      factors: p.factors,
      status: 'new',
      statusAt: null,
      failureAt: null,
    }
    this.open.set(p.machineId, { id: n.id, lastHigh: p.t })
    this.last.set(p.machineId, { id: n.id, t: p.t })
    return { created: n }
  }

  onFailure(machineId: string, t: number): NotifyChange | null {
    this.open.delete(machineId)
    const l = this.last.get(machineId)
    if (l && t - l.t <= MODEL_DATA.horizonHours * HOUR) return { confirmed: { id: l.id, failureAt: t } }
    return null
  }
}

export const RECIPIENT_LABEL = (r: string, lineShort: (lineId: string) => string) =>
  r === 'bakim' ? 'Bakım ekibi' : r.startsWith('foreman:') ? `${lineShort(r.slice(8))} foreman'i` : r
