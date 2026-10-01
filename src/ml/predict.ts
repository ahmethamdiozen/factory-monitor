import { FEATURE_NAMES } from './features'
import type { FeatureName } from './features'
import type { ModelData } from './model'
import { MODEL_DATA } from './modelData'
import type { RiskFactor, RiskLevel } from './types'

/**
 * Python'da eğitilen Gradient Boosting modelini çalıştırır (bağımlılıksız).
 * scikit-learn ağaçları özellikleri float32'ye çevirip "x <= eşik" ile sola gider;
 * aynı sonucu almak için karşılaştırmada Math.fround kullanılır.
 */

if (MODEL_DATA.features.join() !== FEATURE_NAMES.join()) {
  throw new Error('Model özellikleri ile src/ml/features.ts uyuşmuyor — modeli yeniden eğitin (npm run ml:dataset && npm run ml:train)')
}

export function predictRisk(x: number[], model: ModelData = MODEL_DATA): number {
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

const pct = (v: number) => `%${Math.round(v * 100)}`
const dec = (v: number, d = 1) => v.toFixed(d).replace('.', ',')

function factorText(f: FeatureName, v: number, ref: number): string {
  switch (f) {
    case 'cur_ratio_1h':
      return `Motor akımı normalin ${pct(v - 1)} üstünde`
    case 'cur_slope_24h':
      return v >= 0 ? `Motor akımı son 24 saatte ${pct(v)} arttı` : `Motor akımı son 24 saatte ${pct(-v)} azaldı`
    case 'vib_1h':
      return `Titreşim ${dec(v, 2)} mm/s (normali ~${dec(ref, 2)})`
    case 'vib_slope_24h':
      return `Titreşim son 24 saatte ${dec(v, 2)} mm/s arttı`
    case 'temp_dev_1h':
      return `Sıcaklık normalin ${dec(v)} °C üstünde`
    case 'micro_6h':
      return `Son 6 saatte ${Math.round(v)} mikro duruş (normali ~${Math.round(ref)})`
    case 'micro_24h':
      return `Son 24 saatte ${Math.round(v)} mikro duruş (normali ~${Math.round(ref)})`
    case 'speed_cv_1h':
      return `Çevrim süresi düzensizleşti (±${dec(v * 100)}%)`
    case 'run_h_since_maint':
      return `Son bakımdan beri ${Math.round(v)} saat çalıştı`
    default:
      return f
  }
}

/**
 * Riski en çok artıran etkenler: her özelliği "sağlıklı makine" referans değerine
 * çekince riskin ne kadar düştüğüne bakılır.
 */
export function explain(x: number[], top = 3, model: ModelData = MODEL_DATA): RiskFactor[] {
  const base = predictRisk(x, model)
  const out: RiskFactor[] = []
  FEATURE_NAMES.forEach((f, i) => {
    if (f.startsWith('line_')) return
    const alt = [...x]
    alt[i] = model.reference[i]
    const impact = base - predictRisk(alt, model)
    if (impact > 0.02) out.push({ feature: f, impact, text: factorText(f, x[i], model.reference[i]) })
  })
  return out.sort((a, b) => b.impact - a.impact).slice(0, top)
}
