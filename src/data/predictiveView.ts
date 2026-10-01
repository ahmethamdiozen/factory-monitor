import { REASON_BY_ID } from '@/data/registry'
import { source } from '@/data/store'
import { STATE } from '@/lib/types'
import type { RiskLevel, RiskPoint } from '@/ml/types'
import { MODEL_DATA } from '@/ml/modelData'
import { FAILURE_MODES } from '@/lib/failureModes'
import type { ModeId } from '@/lib/failureModes'

/** Tahmin ufku metni: "3 gün" / "24 saat" */
export const HORIZON_TEXT = MODEL_DATA.horizonHours % 24 === 0 ? `${MODEL_DATA.horizonHours / 24} gün` : `${MODEL_DATA.horizonHours} saat`

/** Olası kaynağın adı (küçük harfle cümle içinde kullanmak için lower=true) */
export function sourceLabel(id: ModeId | null | undefined, lower = false): string | null {
  if (!id) return null
  const l = FAILURE_MODES[id].label
  return lower ? l.toLocaleLowerCase('tr-TR') : l
}

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
  const r = latestRisk(machineId)
  if (!r) return null
  // Onarım veya planlı bakımdan önceki değerlendirme artık geçerli değil (yeni veri birikene kadar risk gösterilmez)
  const fixed = source
    .stopEvents()
    .some((e) => e.machineId === machineId && e.end !== null && e.end > r.t && (REASON_BY_ID[e.reasonId]?.category === 'breakdown' || e.reasonId === 8))
  return fixed ? null : r
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
