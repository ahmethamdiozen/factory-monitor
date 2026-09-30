import { describe, expect, it } from 'vitest'
import { MACHINES } from '@/sim/factoryDef'
import { inferSlowReason, RULE } from '@/lib/rules'
import type { RuleInput } from '@/lib/rules'
import { BUCKET_MS, STATE } from '@/lib/types'
import { MachineTransformer, emptyOutput } from './transform'
import { runLocalPipeline } from './localPipeline'
import { SQL_STATUS } from './rows'

const base: RuleInput = {
  speedAvg: 0.8,
  temperatureC: 42,
  feedPct: 100,
  vibrationMmS: 1.9,
  toolRatio: 0.1,
  msSinceRestart: null,
  msSinceLotChange: null,
  operatorExperienceYears: 5,
}

describe('kural motoru', () => {
  it('hız normalse neden yok', () => expect(inferSlowReason({ ...base, speedAvg: 0.95 })).toBe(RULE.NONE))
  it('sıcaklık', () => expect(inferSlowReason({ ...base, temperatureC: 58 })).toBe(RULE.TEMP))
  it('besleme', () => expect(inferSlowReason({ ...base, feedPct: 82 })).toBe(RULE.FEED))
  it('aşınma', () => expect(inferSlowReason({ ...base, vibrationMmS: 2.9, toolRatio: 0.5 })).toBe(RULE.WEAR))
  it('ısınma diğerlerinden önce gelir', () => expect(inferSlowReason({ ...base, temperatureC: 58, msSinceRestart: 60_000 })).toBe(RULE.WARMUP))
  it('acemi operatör', () => expect(inferSlowReason({ ...base, operatorExperienceYears: 0.4 })).toBe(RULE.OPERATOR))
  it('yeni lot', () => expect(inferSlowReason({ ...base, msSinceLotChange: 10 * 60_000 })).toBe(RULE.MATERIAL))
  it('açıklanamayan', () => expect(inferSlowReason(base)).toBe(RULE.UNKNOWN))
  it('hafif ve açıklanamayan yavaşlık normal dalgalanmadır', () => expect(inferSlowReason({ ...base, speedAvg: 0.88 })).toBe(RULE.NONE))
})

describe('dönüştürücü', () => {
  const info = { id: 'X', idealCycleMs: 1000, toolLife: 10000 }
  const ctx = { experienceAt: () => 5 }

  it('kümülatif sayaçtan fark çıkarır, sıfırlanmayı yakalar', () => {
    const tr = new MachineTransformer(info, ctx)
    const out = emptyOutput()
    const c = (sampleT: number, total: number, reject: number) => tr.addCounter({ machineId: 'X', sampleT, totalCount: total, rejectCount: reject }, undefined, out)
    c(0, 100, 5) // taban
    c(10_000, 110, 6)
    c(20_000, 118, 6)
    c(30_000, 7, 1) // gün başı sıfırlandı
    expect(out.buckets.map((b) => [b.ok, b.nok])).toEqual([[9, 1], [8, 0], [6, 1]])
    expect(out.buckets.map((b) => b.t)).toEqual([0, 10_000, 20_000])
  })

  it('olayları dilimlere ileri doldurur ve duruş kaydı açıp kapatır', () => {
    const tr = new MachineTransformer(info, ctx)
    const out = emptyOutput()
    tr.addEvent({ machineId: 'X', t: 10_000, status: SQL_STATUS.STOPPED, reasonCode: 6 })
    tr.addEvent({ machineId: 'X', t: 30_000, status: SQL_STATUS.RUNNING, reasonCode: null })
    for (let k = 0; k <= 5; k++) tr.addCounter({ machineId: 'X', sampleT: k * 10_000, totalCount: k * 10, rejectCount: 0 }, undefined, out)
    expect(out.buckets.map((b) => b.state)).toEqual([STATE.RUNNING, STATE.STOPPED, STATE.STOPPED, STATE.RUNNING, STATE.RUNNING])
    const last = out.stops[out.stops.length - 1]
    expect(last).toMatchObject({ reasonId: 6, start: 10_000, end: 30_000 })
  })

  it('anlık görüntüden devam eder', () => {
    const a = new MachineTransformer(info, ctx)
    const out = emptyOutput()
    a.addCounter({ machineId: 'X', sampleT: 0, totalCount: 50, rejectCount: 0 }, undefined, out)
    const b = new MachineTransformer(info, ctx)
    b.restore(a.snapshot())
    b.addCounter({ machineId: 'X', sampleT: 10_000, totalCount: 60, rejectCount: 1 }, undefined, out)
    expect(out.buckets[0]).toMatchObject({ ok: 9, nok: 1 })
  })
})

describe('uçtan uca: kurallar simülatörün gerçek nedenini buluyor', () => {
  const t0 = new Date(2026, 8, 29, 17, 40).getTime()
  const startT = t0 - 24 * 3600 * 1000
  const run = runLocalPipeline(startT, t0 + 30 * 60 * 1000, t0)

  function agreement(machineId: string, truthCode: number): number {
    const s = run.source.machineSeries(machineId)
    const tv = run.truth.get(machineId)!
    let n = 0
    let hit = 0
    for (let i = 0; i < s.length; i++) {
      if (tv[i] !== truthCode || s.state[i] !== STATE.RUNNING || s.slowReason[i] === 0) continue
      n++
      if (s.slowReason[i] === truthCode) hit++
    }
    return n ? hit / n : NaN
  }

  it.each([
    ['M02', RULE.WEAR],
    ['M04', RULE.TEMP],
    ['M09', RULE.FEED],
    ['M11', RULE.FEED],
    ['M08', RULE.OPERATOR],
  ])('%s → neden %i', (id, code) => {
    const a = agreement(id, code)
    expect(a).toBeGreaterThan(0.8)
  })

  it('tüm makinelerde yavaş dilimlerin çoğu doğru nedenle etiketleniyor', () => {
    let n = 0
    let hit = 0
    for (const m of MACHINES) {
      const s = run.source.machineSeries(m.id)
      const tv = run.truth.get(m.id)!
      for (let i = 0; i < s.length; i++) {
        if (tv[i] === 0 || s.slowReason[i] === 0) continue
        n++
        if (s.slowReason[i] === tv[i]) hit++
      }
    }
    console.log(`kural doğruluğu: ${hit}/${n} = ${((hit / n) * 100).toFixed(1)}%`)
    expect(hit / n).toBeGreaterThan(0.85)
  })

  it('dilim zamanları ardışık', () => {
    const s = run.source.machineSeries('M01')
    expect(s.startT).toBe(startT)
    expect(run.output.buckets.filter((b) => b.machineId === 'M01')[1].t - startT).toBe(BUCKET_MS)
  })
})
