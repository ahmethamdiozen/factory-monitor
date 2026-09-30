import { describe, expect, it } from 'vitest'
import { runLocalPipeline } from '@/pipeline/localPipeline'
import { MACHINES } from '@/data/registry'
import { machineKpi, projection, sumKpi, windowRange } from '@/lib/kpi'
import { capability, controlLimits, detectViolations, referenceLimits } from '@/lib/spc'
import { BUCKET_MS, STATE } from '@/lib/types'
import type { MachineSeries } from '@/lib/types'

function fakeSeries(n: number, fill: (i: number) => { state: number; reason?: number; ok?: number; nok?: number }): MachineSeries {
  const s: MachineSeries = {
    startT: 0,
    length: n,
    state: new Uint8Array(n),
    downReason: new Uint8Array(n),
    slowReason: new Uint8Array(n),
    speed: new Float32Array(n),
    ok: new Uint16Array(n),
    nok: new Uint16Array(n),
  }
  for (let i = 0; i < n; i++) {
    const f = fill(i)
    s.state[i] = f.state
    s.downReason[i] = f.reason ?? 0
    s.ok[i] = f.ok ?? 0
    s.nok[i] = f.nok ?? 0
  }
  return s
}

const M = { ...MACHINES[0], idealRate: 1, dailyTarget: 1000 }

describe('machineKpi', () => {
  it('OEE = A × P × Q', () => {
    // 100 bucket: 80 çalışıyor (10 sn → 800 sn), 20 arıza. Ideal 1/sn → 10/bucket; gerçek 9/bucket, 1 NOK
    const s = fakeSeries(100, (i) => (i < 80 ? { state: STATE.RUNNING, ok: 8, nok: 1 } : { state: STATE.STOPPED, reason: 1 }))
    const k = machineKpi(s, M, 0, 100)
    expect(k.availability).toBeCloseTo(0.8, 5)
    expect(k.performance).toBeCloseTo(0.9, 5)
    expect(k.quality).toBeCloseTo(8 / 9, 5)
    expect(k.oee).toBeCloseTo(k.availability * k.performance * k.quality, 5)
    expect(k.loss.breakdown).toBe(200)
  })

  it('planlı duruş OEE paydasından düşer, TEEP\'e dahil kalır', () => {
    const s = fakeSeries(100, (i) => (i < 50 ? { state: STATE.RUNNING, ok: 10 } : { state: STATE.MAINTENANCE, reason: 8 }))
    const k = machineKpi(s, M, 0, 100)
    expect(k.availability).toBeCloseTo(1, 5)
    expect(k.oee).toBeCloseTo(1, 5)
    expect(k.teep).toBeCloseTo(0.5, 5)
  })

  it('sumKpi zaman ağırlıklı birleştirir', () => {
    const a = fakeSeries(100, () => ({ state: STATE.RUNNING, ok: 10 }))
    const b = fakeSeries(100, () => ({ state: STATE.STOPPED, reason: 1 }))
    const k = sumKpi([machineKpi(a, M, 0, 100), machineKpi(b, M, 0, 100)])
    expect(k.availability).toBeCloseTo(0.5, 5)
    expect(k.oee).toBeCloseTo(0.5, 5)
  })
})

describe('projection', () => {
  it('hedefe yetişme kararı', () => {
    const now = new Date()
    now.setHours(12, 0, 0, 0)
    const dayStart = new Date(now)
    dayStart.setHours(6, 0, 0, 0)
    const n = (6 * 3600) / 10
    const s = fakeSeries(n, () => ({ state: STATE.RUNNING, ok: 1 }))
    s.startT = dayStart.getTime()
    // 6 saatte 2160 OK, hedef 1000 → tamamlanmış
    const p = projection(s, M, now.getTime())
    expect(p.verdict).toBe('done')
    const p2 = projection(s, { ...M, dailyTarget: 3000 }, now.getTime())
    expect(p2.verdict).toBe('ontrack') // 0.1/sn × 18 sa = 6480 + 2160 > 3000
    const p3 = projection(s, { ...M, dailyTarget: 20000 }, now.getTime())
    expect(p3.verdict).toBe('behind')
  })
})

describe('yerel pipeline (sim → PLC satırları → dönüştürücü)', () => {
  const t0 = new Date(2026, 8, 29, 17, 40).getTime()
  const startT = t0 - 24 * 3600 * 1000
  const run = runLocalPipeline(startT, t0, t0)
  const ds = run.source

  it('aynı t0 ile deterministik', () => {
    const again = runLocalPipeline(startT, startT + 3600 * 1000, t0)
    const a = Array.from(ds.machineSeries('M05').ok.slice(0, 300))
    const b = Array.from(again.source.machineSeries('M05').ok.slice(0, 300))
    expect(a).toEqual(b)
  })

  it('hikâye durumları t0 anında beklenen gibi', () => {
    const last = (id: string) => ds.machineSeries(id).state[ds.machineSeries(id).length - 1]
    expect(last('M03')).toBe(STATE.CHANGEOVER)
    expect(last('M06')).toBe(STATE.MAINTENANCE)
    expect(last('M10')).toBe(STATE.STOPPED)
    expect(ds.now()).toBe(t0)
    expect(ds.machineSeries('M01').length * BUCKET_MS).toBe(24 * 3600 * 1000)
  })

  it('makul OEE aralığı', () => {
    const w = windowRange(ds, 'day')
    const kpis = MACHINES.map((m) => machineKpi(ds.machineSeries(m.id), m, w.i0, w.i1))
    const f = sumKpi(kpis)
    expect(f.oee).toBeGreaterThan(0.5)
    expect(f.oee).toBeLessThan(0.9)
  })

  it('SPC: aşınma makinesi kural ihlali üretir, sağlıklı makine üretmez', () => {
    const bad = ds.spc('M02').slice(-32)
    const vBad = detectViolations(bad, referenceLimits(MACHINES[1].spec))
    const cap = capability(bad, MACHINES[1].spec)!
    expect(vBad.length).toBeGreaterThan(3)
    expect(cap.cpk).toBeLessThan(1.33)
    const good = ds.spc('M09').slice(-32)
    const vGood = detectViolations(good, referenceLimits(MACHINES[8].spec))
    expect(vGood.length).toBeLessThan(vBad.length)
    expect(controlLimits(ds.spc('M09'))).not.toBeNull()
  })
})
