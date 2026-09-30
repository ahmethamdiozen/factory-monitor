/**
 * Yavaşlık nedeni çıkarımı. Makineler "neden yavaşım" diye kayıt atmaz; nedeni
 * süreç sinyallerinden kurallarla buluruz. Kurallar öncelik sırasıyla denenir.
 * Kimlikler SLOW_REASONS ile eşleşir (src/sim/factoryDef.ts).
 */

export const SLOW_THRESHOLD = 0.9
/** Hiçbir sinyal açıklamıyorsa, bu eşiğin üstü normal dalgalanma sayılır */
export const UNEXPLAINED_THRESHOLD = 0.85

export const RULE = {
  NONE: 0,
  WEAR: 1,
  MATERIAL: 2,
  OPERATOR: 3,
  TEMP: 4,
  WARMUP: 5,
  FEED: 6,
  UNKNOWN: 7,
} as const

export const THRESHOLDS = {
  warmupMs: 6 * 60 * 1000,
  tempC: 55,
  feedPct: 92,
  vibrationMmS: 2.5,
  toolRatio: 0.3,
  rookieYears: 1,
  lotRecentMs: 60 * 60 * 1000,
}

export interface RuleInput {
  /** Son ~1 dk çalışma hızının ortalaması (gerçek / ideal) */
  speedAvg: number
  temperatureC: number
  feedPct: number
  vibrationMmS: number
  /** Takım çevrim sayısı / takım ömrü */
  toolRatio: number
  /** Arıza/ayar/bakım dönüşünden bu yana geçen süre (mikro duruşlar hariç) */
  msSinceRestart: number | null
  msSinceLotChange: number | null
  operatorExperienceYears: number | null
}

export function inferSlowReason(x: RuleInput): number {
  if (x.speedAvg >= SLOW_THRESHOLD) return RULE.NONE
  const T = THRESHOLDS
  if (x.msSinceRestart !== null && x.msSinceRestart < T.warmupMs) return RULE.WARMUP
  if (x.temperatureC > T.tempC) return RULE.TEMP
  if (x.feedPct > 0 && x.feedPct < T.feedPct) return RULE.FEED
  if (x.vibrationMmS > T.vibrationMmS && x.toolRatio > T.toolRatio) return RULE.WEAR
  if (x.operatorExperienceYears !== null && x.operatorExperienceYears < T.rookieYears) return RULE.OPERATOR
  if (x.msSinceLotChange !== null && x.msSinceLotChange < T.lotRecentMs) return RULE.MATERIAL
  return x.speedAvg < UNEXPLAINED_THRESHOLD ? RULE.UNKNOWN : RULE.NONE
}

/** Arayüzde gösterilecek kısa açıklama: hangi sinyal bu nedeni gösterdi. */
export const RULE_EVIDENCE: Record<number, string> = {
  [RULE.WARMUP]: 'Duruştan döndükten sonraki ilk 6 dakika',
  [RULE.TEMP]: `Sıcaklık ${THRESHOLDS.tempC} °C üstünde`,
  [RULE.FEED]: `Besleme %${THRESHOLDS.feedPct} altında`,
  [RULE.WEAR]: 'Titreşim yüksek ve takım ömrünün sonuna yaklaşıldı',
  [RULE.OPERATOR]: 'Operatör tecrübesi 1 yıldan az',
  [RULE.MATERIAL]: 'Son 1 saatte hammadde lotu değişti',
  [RULE.UNKNOWN]: 'Hiçbir sinyal açıklamıyor',
}
