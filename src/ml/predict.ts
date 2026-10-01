import { FEATURE_NAMES, STATIC_FEATURES } from './features'
import type { FeatureName } from './features'
import type { MachineType } from '@/lib/types'
import type { ModeId } from '@/lib/failureModes'
import { CHANNEL_LABEL } from '@/sim/tags'
import type { ModelData } from './model'
import { MODEL_DATA } from './modelData'
import type { RiskFactor, RiskLevel } from './types'

/**
 * Python'da eğitilen Gradient Boosting modelini çalıştırır (bağımlılıksız).
 * scikit-learn ağaçları özellikleri float32'ye çevirip "x <= eşik" ile sola gider;
 * aynı sonucu almak için karşılaştırmada Math.fround kullanılır.
 */

// Kontrol tahmin anında yapılır: eğitim verisi üretimi (eski) modeli yüklemeden çalışabilmeli
const COMPATIBLE = MODEL_DATA.features.join() === FEATURE_NAMES.join()

export function predictRisk(x: number[], model: ModelData = MODEL_DATA): number {
  if (model === MODEL_DATA && !COMPATIBLE) {
    throw new Error('Model özellikleri ile src/ml/features.ts uyuşmuyor — modeli yeniden eğitin (npm run ml:dataset && npm run ml:train)')
  }
  let raw = model.init
  for (const tr of model.trees) {
    let n = 0
    while (tr.l[n] !== -1) n = Math.fround(x[tr.f[n]]) <= tr.t[n] ? tr.l[n] : tr.r[n]
    raw += model.learningRate * tr.v[n]
  }
  return 1 / (1 + Math.exp(-raw))
}

export function levelOf(risk: number, model: ModelData = MODEL_DATA): RiskLevel {
  if (risk >= model.thresholds.alarm) return 'alarm'
  if (risk >= model.thresholds.watch) return 'watch'
  return 'good'
}

const pct = (v: number) => `%${Math.round(Math.abs(v) * 100)}`
const dec = (v: number, d = 1) => Math.abs(v).toFixed(d).replace('.', ',')
const up = (v: number, a = 'arttı', b = 'azaldı') => (v >= 0 ? a : b)

function factorText(f: FeatureName, v: number, ref: number, type: MachineType): string {
  const L = CHANNEL_LABEL[type]
  const furnace = type === 'furnace'
  switch (f) {
    case 'load_ratio_1h':
      return `${L.load ?? 'Yük'} referansın ${pct(v - 1)} ${v >= 1 ? 'üstünde' : 'altında'}`
    case 'load_slope_24h':
      return `${L.load ?? 'Yük'} son 24 saatte ${pct(v)} ${up(v)}`
    case 'vib_ratio_1h':
      return `Titreşim referansın ${dec(v)} katı`
    case 'vib_slope_24h':
      return `Titreşim son 24 saatte ${pct(v)} ${up(v)}`
    case 'hf_ratio_1h':
      return `Rulman zarf titreşimi (HF) referansın ${dec(v)} katı`
    case 'hf_slope_24h':
      return `Rulman zarf titreşimi son 24 saatte ${pct(v)} ${up(v)}`
    case 'temp_dev_1h':
      return furnace ? `Tutma sıcaklığı set değerinin ${dec(v)} °C ${v >= 0 ? 'üstünde' : 'altında'}` : `${L.temp ?? 'Sıcaklık'} referansın ${dec(v)} °C ${v >= 0 ? 'üstünde' : 'altında'}`
    case 'temp_slope_24h':
      return `${furnace ? 'Tutma sıcaklığı' : (L.temp ?? 'Sıcaklık')} son 24 saatte ${dec(v)} °C ${up(v)}`
    case 'cur_ratio_1h':
      return `Eksen servo akımı referansın ${pct(v - 1)} ${v >= 1 ? 'üstünde' : 'altında'}`
    case 'cur_slope_24h':
      return `Eksen servo akımı son 24 saatte ${pct(v)} ${up(v)}`
    case 'aux_ratio_1h':
      return furnace ? `Vakum referansın ${dec(v)} katı (kötüleşiyor)` : `Soğutma basıncı referansın ${pct(1 - v)} ${v <= 1 ? 'altında' : 'üstünde'}`
    case 'aux_slope_24h':
      return furnace ? `Vakum son 24 saatte ${v >= 0 ? 'kötüleşti' : 'iyileşti'}` : `Soğutma basıncı son 24 saatte ${pct(v)} ${v <= 0 ? 'düştü' : 'arttı'}`
    case 'feed_sd_1h':
      return type === 'coating' ? `Toz besleme dalgalanıyor (±${dec(v)}%, normali ~±${dec(ref)}%)` : `İlerleme dalgalanıyor (±${dec(v)}%)`
    case 'micro_6h':
      return `Son 6 saatte ${Math.round(v)} kısa duruş (normali ~${Math.round(ref)})`
    case 'micro_24h':
      return `Son 24 saatte ${Math.round(v)} kısa duruş (normali ~${Math.round(ref)})`
    case 'speed_cv_1h':
      return `Çevrim süresi düzensizleşti (±${dec(v * 100)}%)`
    case 'run_h_since_maint':
      return `Son bakımdan beri ${Math.round(v)} saat çalıştı`
    case 'h_since_changeover':
      return `Son program değişiminden beri ${Math.round(v)} saat`
    default:
      return f
  }
}

/** Her özelliği "sağlıklı makine" referansına çekince risk ne kadar düşüyor */
function impacts(x: number[], model: ModelData): number[] {
  const base = predictRisk(x, model)
  return FEATURE_NAMES.map((f, i) => {
    if (STATIC_FEATURES.has(f)) return 0
    const alt = [...x]
    alt[i] = model.reference[i]
    return base - predictRisk(alt, model)
  })
}

/** Riski en çok artıran etkenler */
export function explain(x: number[], type: MachineType, top = 3, model: ModelData = MODEL_DATA): RiskFactor[] {
  const imp = impacts(x, model)
  const out: RiskFactor[] = []
  FEATURE_NAMES.forEach((f, i) => {
    if (imp[i] > 0.02) out.push({ feature: f, impact: imp[i], text: factorText(f, x[i], model.reference[i], type) })
  })
  return out.sort((a, b) => b.impact - a.impact).slice(0, top)
}

/**
 * Olası kaynak: riski artıran sinyaller hangi arıza türünün belirti iziyle örtüşüyor?
 * Eşleme (özellik → arıza türü) makine tipine göre ml/train.py'de tanımlıdır ve modelle birlikte
 * gelir; Python aynı hesapla bu eşlemenin doğruluğunu ölçer (model kartında gösterilir).
 */
export function likelySource(x: number[], type: MachineType, model: ModelData = MODEL_DATA): ModeId | null {
  const map = model.sources[type]
  if (!map) return null
  const imp = impacts(x, model)
  const score: Partial<Record<ModeId, number>> = {}
  FEATURE_NAMES.forEach((f, i) => {
    const mode = map[f]
    if (mode && imp[i] > 0) score[mode] = (score[mode] ?? 0) + imp[i]
  })
  let best: ModeId | null = null
  for (const [m, v] of Object.entries(score) as [ModeId, number][]) if (v > 0.02 && v > (best ? score[best]! : 0)) best = m
  return best
}
