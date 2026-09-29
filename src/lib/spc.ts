import type { SpcPoint, SpecLimits } from '@/lib/types'

// n=5 alt grup sabitleri
export const A2 = 0.577
export const D3 = 0
export const D4 = 2.114
export const D2 = 2.326

export interface ControlLimits {
  xbar: { cl: number; ucl: number; lcl: number; sigma: number }
  range: { cl: number; ucl: number; lcl: number }
}

/** Faz I: ilk `baseline` alt gruptan kontrol limitleri (x̄–R grafiği). */
export function controlLimits(points: SpcPoint[], baseline = 24): ControlLimits | null {
  const base = points.slice(0, baseline)
  if (base.length < 8) return null
  const xbb = base.reduce((a, p) => a + p.mean, 0) / base.length
  const rbar = base.reduce((a, p) => a + p.range, 0) / base.length
  return {
    xbar: { cl: xbb, ucl: xbb + A2 * rbar, lcl: xbb - A2 * rbar, sigma: (A2 * rbar) / 3 },
    range: { cl: rbar, ucl: D4 * rbar, lcl: D3 * rbar },
  }
}

export interface SpcViolation {
  index: number
  rule: 1 | 2 | 3 | 4
}

export const RULE_LABEL: Record<SpcViolation['rule'], string> = {
  1: 'Kural 1 · nokta 3σ dışında',
  2: 'Kural 2 · 3 noktadan 2\'si 2σ dışında (aynı taraf)',
  3: 'Kural 3 · 5 noktadan 4\'ü 1σ dışında (aynı taraf)',
  4: 'Kural 4 · ardışık 8 nokta merkez çizginin aynı tarafında',
}

/** Western Electric kuralları (1–4). Bir nokta için en ciddi kural raporlanır. */
export function detectViolations(points: SpcPoint[], lim: ControlLimits): SpcViolation[] {
  const { cl, sigma } = lim.xbar
  const z = points.map((p) => (p.mean - cl) / sigma)
  const out = new Map<number, SpcViolation['rule']>()
  const mark = (i: number, rule: SpcViolation['rule']) => {
    const prev = out.get(i)
    if (!prev || rule < prev) out.set(i, rule)
  }
  for (let i = 0; i < z.length; i++) {
    if (Math.abs(z[i]) > 3) mark(i, 1)
    if (i >= 2) {
      const w = z.slice(i - 2, i + 1)
      if (w.filter((v) => v > 2).length >= 2 && z[i] > 2) mark(i, 2)
      if (w.filter((v) => v < -2).length >= 2 && z[i] < -2) mark(i, 2)
    }
    if (i >= 4) {
      const w = z.slice(i - 4, i + 1)
      if (w.filter((v) => v > 1).length >= 4 && z[i] > 1) mark(i, 3)
      if (w.filter((v) => v < -1).length >= 4 && z[i] < -1) mark(i, 3)
    }
    if (i >= 7) {
      const w = z.slice(i - 7, i + 1)
      if (w.every((v) => v > 0) || w.every((v) => v < 0)) mark(i, 4)
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([index, rule]) => ({ index, rule }))
}

export interface Capability {
  cp: number
  cpk: number
  mean: number
  sigmaWithin: number
}

/** Süreç yeteneği: σ = R̄/d2 (grup içi), ortalama = x̿ */
export function capability(points: SpcPoint[], spec: SpecLimits): Capability | null {
  if (points.length < 5) return null
  const mean = points.reduce((a, p) => a + p.mean, 0) / points.length
  const rbar = points.reduce((a, p) => a + p.range, 0) / points.length
  const sigma = rbar / D2
  if (sigma <= 0) return null
  const cp = (spec.usl - spec.lsl) / (6 * sigma)
  const cpk = Math.min(spec.usl - mean, mean - spec.lsl) / (3 * sigma)
  return { cp, cpk, mean, sigmaWithin: sigma }
}

/** Bilinen süreç parametreleriyle (kalifiye süreç) kontrol limitleri: CL = nominal, σx̄ = σ/√n. */
export function referenceLimits(spec: SpecLimits, n = 5): ControlLimits {
  const sxbar = spec.sigma / Math.sqrt(n)
  const rbar = D2 * spec.sigma
  return {
    xbar: { cl: spec.nominal, ucl: spec.nominal + 3 * sxbar, lcl: spec.nominal - 3 * sxbar, sigma: sxbar },
    range: { cl: rbar, ucl: D4 * rbar, lcl: D3 * rbar },
  }
}
