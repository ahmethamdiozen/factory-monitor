import { REASON_BY_ID } from '@/data/registry'
import { source } from '@/data/store'
import { STATE } from '@/lib/types'
import type { RiskLevel, RiskPoint } from '@/ml/types'

/** Makinenin en son risk değerlendirmesi (yoksa null — ilk ~12 çalışma saati ya da arızada) */
export function latestRisk(machineId: string): RiskPoint | null {
  const r = source.riskSeries(machineId)
  return r.length ? r[r.length - 1] : null
}

/**
 * Gösterilecek risk: makine zaten arızadaysa null (risk anlamını yitirir); kısa duruşlarda,
 * ayarda veya bakımda risk geçerliliğini korur ve gösterilir.
 */
export function activeRisk(machineId: string, state: number, reasonId: number): RiskPoint | null {
  if (state === STATE.STOPPED && REASON_BY_ID[reasonId]?.category === 'breakdown') return null
  return latestRisk(machineId)
}

/** Görsel tonlar: durum renkleri her zaman ikon + kelimeyle birlikte kullanılır */
export const LEVEL_STYLE: Record<RiskLevel, { text: string; bg: string; dot: string; word: string }> = {
  good: { text: 'text-good-text', bg: 'bg-good/15', dot: 'bg-good', word: 'İyi' },
  watch: { text: 'text-warning-text', bg: 'bg-warning/20', dot: 'bg-warning', word: 'Dikkat' },
  alarm: { text: 'text-critical-text', bg: 'bg-critical/15', dot: 'bg-critical', word: 'Riskli' },
}

export const pctRisk = (r: number) => `%${Math.round(r * 100)}`

export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} dk önce`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} sa önce` : `${Math.floor(h / 24)} gün önce`
}
