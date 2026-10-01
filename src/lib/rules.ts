/**
 * Yavaşlık nedeni çıkarımı. Makineler "neden yavaşım" diye kayıt atmaz; nedeni
 * süreç sinyallerinden kurallarla buluruz. Kurallar öncelik sırasıyla denenir.
 * Eşikler mutlak değil, makinenin devreye alma referansına göredir (dbo.MachineTags.Baseline):
 * aynı titreşim bir tornada normal, bir taşlamada yüksek olabilir.
 * Kimlikler SLOW_REASONS ile eşleşir (src/sim/factoryDef.ts). Eksik ölçüm NaN'dır.
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
  /** referansın kaç °C üstü */
  tempDevC: 10,
  feedPct: 92,
  /** referansın kaç katı */
  vibRatio: 1.3,
  hfRatio: 1.8,
  toolRatio: 0.3,
  rookieYears: 1,
  lotRecentMs: 60 * 60 * 1000,
}

export interface RuleInput {
  /** Son ~1 dk çalışma hızının ortalaması (gerçek / ideal) */
  speedAvg: number
  /** Sıcaklık − referans (°C) */
  tempDevC: number
  /** İlerleme / besleme ayarı (%) */
  feedPct: number
  /** Titreşim / referans */
  vibRatio: number
  /** Rulman zarf titreşimi (yüksek frekans) / referans; yoksa NaN */
  hfRatio?: number
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
  if (x.tempDevC > T.tempDevC) return RULE.TEMP
  if (x.feedPct > 0 && x.feedPct < T.feedPct) return RULE.FEED
  // Takım aşınması RMS titreşimi artırır ama rulman zarf titreşimini (HF) artırmaz; HF de yüksekse
  // titreşim iş milinden geliyordur — takım aşınması denmez (öngörücü bakım ilgilenir)
  if (x.vibRatio > T.vibRatio && x.toolRatio > T.toolRatio && !((x.hfRatio ?? 0) > T.hfRatio)) return RULE.WEAR
  if (x.operatorExperienceYears !== null && x.operatorExperienceYears < T.rookieYears) return RULE.OPERATOR
  if (x.msSinceLotChange !== null && x.msSinceLotChange < T.lotRecentMs) return RULE.MATERIAL
  return x.speedAvg < UNEXPLAINED_THRESHOLD ? RULE.UNKNOWN : RULE.NONE
}

/** Arayüzde gösterilecek kısa açıklama: hangi sinyal bu nedeni gösterdi. */
export const RULE_EVIDENCE: Record<number, string> = {
  [RULE.WARMUP]: 'Duruştan döndükten sonraki ilk 6 dakika',
  [RULE.TEMP]: `Sıcaklık makine referansının ${THRESHOLDS.tempDevC} °C üstünde`,
  [RULE.FEED]: `İlerleme / besleme %${THRESHOLDS.feedPct} altında`,
  [RULE.WEAR]: `Titreşim referansın ${String(THRESHOLDS.vibRatio).replace('.', ',')} katı üstünde ve takım ömrünün sonuna yaklaşıldı`,
  [RULE.OPERATOR]: 'Operatör tecrübesi 1 yıldan az',
  [RULE.MATERIAL]: 'Son 1 saatte malzeme partisi (ısıl no) değişti',
  [RULE.UNKNOWN]: 'Hiçbir sinyal açıklamıyor',
}
