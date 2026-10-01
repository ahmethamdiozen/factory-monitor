import { describe, expect, it } from 'vitest'
import { MACHINES } from '@/sim/factoryDef'
import { MachineSim } from '@/sim/machineSim'
import { runLocalPipeline } from '@/pipeline/localPipeline'
import { BUCKET_MS } from '@/lib/types'
import { FEATURE_NAMES, FeatureTracker } from './features'
import { MODEL_DATA } from './modelData'
import { explain, levelOf, predictRisk } from './predict'

const HOUR = 3600 * 1000

describe('model aktarımı', () => {
  it('TypeScript değerlendirici Python (scikit-learn) tahminleriyle aynı', () => {
    expect(MODEL_DATA.samples.length).toBeGreaterThanOrEqual(40)
    for (const s of MODEL_DATA.samples) expect(Math.abs(predictRisk(s.x) - s.p)).toBeLessThan(1e-6)
  })

  it('özellik listesi modelle aynı sırada', () => {
    expect(MODEL_DATA.features).toEqual([...FEATURE_NAMES])
  })

  it('eşikler sıralı ve seviyeler tutarlı', () => {
    const { watch, alarm } = MODEL_DATA.thresholds
    expect(watch).toBeLessThanOrEqual(alarm)
    expect(levelOf(alarm)).toBe('alarm')
    expect(levelOf(watch)).toBe('watch')
    expect(levelOf(0)).toBe('good')
  })

  it('açıklama riski artıran etkenleri döndürür', () => {
    const hi = MODEL_DATA.samples.reduce((a, b) => (b.p > a.p ? b : a))
    const f = explain(hi.x)
    expect(f.length).toBeGreaterThan(0)
    expect(f[0].impact).toBeGreaterThan(0)
  })
})

describe('yıpranma fiziği', () => {
  it('yüksek yıpranmada arıza belirgin daha sık', () => {
    // 40 gün, tek makine: arıza başlangıcındaki gizli yıpranma seviyesine bak
    const sim = new MachineSim(MACHINES[0], 0, Date.UTC(2030, 0, 1))
    const start = Date.UTC(2026, 0, 1)
    let prev = false
    let high = 0
    let low = 0
    for (let i = 0; i < 40 * 8640; i++) {
      const s = sim.step(i, start + i * BUCKET_MS)
      const bd = s.status === 1 && [1, 2, 3].includes(s.reasonId)
      if (bd && !prev) {
        if (s.truthDegradation >= 0.55) high++
        else low++
      }
      prev = bd
    }
    expect(high).toBeGreaterThan(low)
  })

  it('özellik izleyici deterministik', () => {
    const mk = () => {
      const ft = new FeatureTracker('X', 'L1')
      for (let i = 0; i < 20 * 360; i++) ft.add({ t: i * BUCKET_MS, state: 0, downReason: 0, speed: 0.95, temp: 40, vib: 1.9 + (i % 7) * 0.01, cur: 30 + (i % 11) * 0.1 })
      return ft.features(20 * HOUR)
    }
    expect(mk()).toEqual(mk())
    expect(mk()).not.toBeNull()
  })
})

describe('demo hikâyeleri (yerel hat)', () => {
  const t0 = new Date(2026, 8, 29, 17, 40).getTime()
  const run = runLocalPipeline(t0 - 48 * HOUR, t0, t0)
  const ds = run.source

  it('FRZ-01 şu an riskli ve bildirim oluşmuş', () => {
    const r = ds.riskSeries('M05')
    const last = r[r.length - 1]
    console.log('M05 risk', last.risk.toFixed(2), last.level, last.factors.map((f) => f.text))
    expect(last.level).toBe('alarm')
    expect(ds.notifications().some((n) => n.machineId === 'M05')).toBe(true)
  })

  it('FRN-02 arızasından önce uyarı verilmiş ve arıza ile doğrulanmış', () => {
    const n = ds.notifications().find((x) => x.machineId === 'M10' && x.failureAt !== null)
    expect(n).toBeDefined()
    const lead = (n!.failureAt! - n!.t) / HOUR
    console.log('M10 uyarı', lead.toFixed(1), 'saat önce')
    expect(lead).toBeGreaterThan(1)
  })

  it('bildirim sayısı makul (boş alarm seli yok)', () => {
    const n = ds.notifications().length
    console.log('48 saatte bildirim:', n, ds.notifications().map((x) => `${x.machineId}${x.failureAt ? '✓' : ''}`).join(' '))
    expect(n).toBeLessThan(15)
  })
})
