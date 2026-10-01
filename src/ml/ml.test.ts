import { describe, expect, it } from 'vitest'
import { MACHINES, REASON_BY_ID } from '@/sim/factoryDef'
import { MachineSim } from '@/sim/machineSim'
import { tagBaselines } from '@/sim/tags'
import { PlcRecorder, emptyRows } from '@/sim/plcRecorder'
import { MachineTransformer, emptyOutput } from '@/pipeline/transform'
import { experienceFromDefs, machineInfoOf, runLocalPipeline } from '@/pipeline/localPipeline'
import { BUCKET_MS, STATE } from '@/lib/types'
import type { MachineType } from '@/lib/types'
import { FEATURE_NAMES, FeatureTracker } from './features'
import { MODEL_DATA } from './modelData'
import { explain, levelOf, likelySource, predictRisk } from './predict'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const M = (id: string) => MACHINES.findIndex((m) => m.id === id)

/** Örnek vektörünün makine tipi (tip özelliklerinden) */
function typeOf(x: number[]): MachineType {
  const at = (n: string) => x[FEATURE_NAMES.indexOf(n as (typeof FEATURE_NAMES)[number])]
  return at('type_cnc') ? 'cnc' : at('type_grinder') ? 'grinder' : at('type_furnace') ? 'furnace' : at('type_coating') ? 'coating' : 'cmm'
}

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
    const f = explain(hi.x, typeOf(hi.x))
    expect(f.length).toBeGreaterThan(0)
    expect(f[0].impact).toBeGreaterThan(0)
  })
})

/** Hikâyeli bir makineyi rampa boyunca çalıştırıp çalışırken etiket değerlerini toplar */
function traceStory(id: string, fromH: number, toH: number) {
  const idx = M(id)
  const m = MACHINES[idx]
  const t0 = Date.UTC(2026, 5, 10)
  const sim = new MachineSim(m, idx, t0)
  const start = t0 + fromH * HOUR
  const n = ((toH - fromH) * HOUR) / BUCKET_MS
  const out: { t: number; d: number; tags: Record<string, number> }[] = []
  for (let i = 0; i < n; i++) {
    const s = sim.step(i, start + i * BUCKET_MS)
    if (s.status === STATE.RUNNING) out.push({ t: s.t, d: s.truthDegradation, tags: s.tags })
  }
  return { out, base: tagBaselines(m, idx) }
}

/** d aralığındaki çalışma örneklerinde bir etiketin ortalaması / referans */
function ratioAt(tr: ReturnType<typeof traceStory>, tag: string, d0: number, d1: number, filter: (t: Record<string, number>) => boolean = () => true): number {
  const v = tr.out.filter((x) => x.d >= d0 && x.d < d1 && x.tags[tag] !== undefined && filter(x.tags)).map((x) => x.tags[tag])
  return v.reduce((a, b) => a + b, 0) / v.length / tr.base[tag]
}

describe('arıza fiziği (P-F)', () => {
  it('iş mili rulmanı: önce yüksek frekans titreşim, sonra RMS titreşim, en son sıcaklık', () => {
    const tr = traceStory('M05', -93, 3)
    // erken evre: HF belirgin yükselmiş, RMS henüz normal
    expect(ratioAt(tr, 'SpindleVibHfG', 0.25, 0.35)).toBeGreaterThan(1.6)
    expect(ratioAt(tr, 'SpindleVibMmS', 0.25, 0.35)).toBeLessThan(1.15)
    // geç evre: RMS de yükselmiş
    expect(ratioAt(tr, 'SpindleVibMmS', 0.85, 1)).toBeGreaterThan(1.4)
    const tempEarly = tr.out.filter((x) => x.d < 0.4).map((x) => x.tags.SpindleTempC)
    const tempLate = tr.out.filter((x) => x.d > 0.9).map((x) => x.tags.SpindleTempC)
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    expect(avg(tempLate) - avg(tempEarly)).toBeGreaterThan(3)
  })

  it('vakum pompası: tutma sırasında vakum kötüleşir', () => {
    const tr = traceStory('M10', -110, -3)
    const soak = (t: Record<string, number>) => Math.abs(t.FurnaceTempC - t.SetpointC) < 15
    expect(ratioAt(tr, 'VacuumMbar', 0, 0.1, soak)).toBeLessThan(1.3)
    expect(ratioAt(tr, 'VacuumMbar', 0.7, 1, soak)).toBeGreaterThan(5)
  })

  it('belirtisiz (ani) arızadan önce rulman titreşimi normal', () => {
    const ratios: number[] = []
    for (const id of ['M01', 'M02', 'M03', 'M06']) {
      const idx = M(id)
      const m = MACHINES[idx]
      const sim = new MachineSim(m, idx, Date.UTC(2031, 0, 1))
      const base = tagBaselines(m, idx)
      const start = Date.UTC(2026, 0, 1)
      const window: number[] = []
      let prev = false
      for (let i = 0; i < 200 * 8640; i++) {
        const s = sim.step(i, start + i * BUCKET_MS)
        if (s.status === STATE.RUNNING && s.tags.SpindleVibHfG !== undefined) {
          window.push(s.tags.SpindleVibHfG / base.SpindleVibHfG)
          if (window.length > 6 * 360) window.shift()
        }
        const bd = s.status === STATE.STOPPED && REASON_BY_ID[s.reasonId]?.category === 'breakdown'
        // HF titreşimini sadece rulman bozulması etkiler
        if (bd && !prev && [1, 2, 3].includes(s.reasonId) && (s.truthMode !== 'bearing' || s.truthDegradation < 0.2) && window.length > 600) ratios.push(window.reduce((a, b) => a + b, 0) / window.length)
        prev = bd
      }
    }
    expect(ratios.length).toBeGreaterThan(2)
    // tek tek ağır kesim dönemine denk gelebilir; ortalamada sinyal normaldir
    expect(ratios.reduce((a, b) => a + b, 0) / ratios.length).toBeLessThan(1.3)
  }, 60_000)

  it('kablosuz sensör kopar: kanal NaN olur ama özellikler hesaplanmaya devam eder', () => {
    const idx = M('M01')
    const m = MACHINES[idx]
    const info = machineInfoOf(m, idx)
    const sim = new MachineSim(m, idx, Date.UTC(2031, 0, 1))
    const rec = new PlcRecorder(m)
    const tr = new MachineTransformer(info, { experienceAt: experienceFromDefs })
    const ft = new FeatureTracker(m.id, m.type, info.ref!)
    const start = Date.UTC(2026, 2, 1)
    let missing = 0
    let featuresOk = 0
    for (let i = 0; i < 40 * 8640; i++) {
      const rows = emptyRows()
      rec.record(sim.step(i, start + i * BUCKET_MS), rows)
      const out = emptyOutput()
      for (const e of rows.events) tr.addEvent(e)
      for (const c of rows.counters) tr.addCounter(c, rows.process[0], out, rows.tags)
      for (const b of out.buckets) {
        ft.add(b)
        if (b.state === STATE.RUNNING && Number.isNaN(b.vib)) {
          missing++
          if (missing % 50 === 0) {
            const x = ft.features(b.t)
            if (x) {
              expect(x.every((v) => Number.isFinite(v))).toBe(true)
              featuresOk++
            }
          }
        }
      }
    }
    expect(missing).toBeGreaterThan(100)
    expect(featuresOk).toBeGreaterThan(0)
  })

  it('özellik izleyici deterministik', () => {
    const mk = () => {
      const ft = new FeatureTracker('X', 'cnc', { temp: 34, vib: 1.6, hf: 0.3, load: 42, cur: 9, aux: 60, feed: 100 })
      for (let i = 0; i < 20 * 360; i++)
        ft.add({ t: i * BUCKET_MS, state: 0, downReason: 0, speed: 0.95, temp: 35, vib: 1.6 + (i % 7) * 0.01, hf: 0.3, load: 42, cur: 9 + (i % 11) * 0.01, aux: 60, feed: 100 })
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

  it('FRZ-01 şu an riskli, olası kaynak iş mili rulmanı ve bildirim oluşmuş', () => {
    const r = ds.riskSeries('M05')
    const last = r[r.length - 1]
    console.log('M05 risk', last.risk.toFixed(2), last.level, last.source, last.factors.map((f) => f.text))
    expect(last.level).toBe('alarm')
    expect(last.source).toBe('bearing')
    expect(ds.notifications().some((n) => n.machineId === 'M05')).toBe(true)
  })

  it('FRN-02 arızasından önce uyarı verilmiş ve arıza ile doğrulanmış', () => {
    const n = ds.notifications().find((x) => x.machineId === 'M10' && x.failureAt !== null)
    expect(n).toBeDefined()
    const lead = (n!.failureAt! - n!.t) / HOUR
    console.log('M10 uyarı', lead.toFixed(1), 'saat önce · kaynak', n!.source)
    expect(lead).toBeGreaterThan(1)
    expect(n!.source).toBe('vacuum')
  })

  it('bildirim sayısı makul (boş alarm seli yok)', () => {
    const n = ds.notifications().length
    console.log('48 saatte bildirim:', n, ds.notifications().map((x) => `${x.machineId}${x.failureAt ? '✓' : ''}:${x.source ?? '-'}`).join(' '))
    expect(n).toBeLessThan(15)
  })

  it('olası kaynak makine tipinin arıza türlerinden biri', () => {
    for (const s of MODEL_DATA.samples) {
      const src = likelySource(s.x, typeOf(s.x))
      if (src) expect(Object.values(MODEL_DATA.sources[typeOf(s.x)] ?? {})).toContain(src)
    }
  })

  it('sinyal özetleri 5 dakikalık', () => {
    const sig = ds.signals('M05')
    expect(sig.length).toBeGreaterThan(400)
    expect(sig[1].t - sig[0].t).toBe(5 * 60 * 1000)
    expect(DAY).toBeGreaterThan(0)
  })
})
