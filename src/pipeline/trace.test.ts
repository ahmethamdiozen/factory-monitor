import { describe, expect, it } from 'vitest'
import { FAMILY_BY_PN, MACHINES } from '@/sim/factoryDef'
import { runLocalPipeline } from './localPipeline'

const HOUR = 3600 * 1000

describe('izlenebilirlik (AS9100) ve MRB', () => {
  const t0 = new Date(2026, 8, 29, 17, 40).getTime()
  const run = runLocalPipeline(t0 - 48 * HOUR, t0, t0)
  const ops = run.source.partOps()
  const bySerial = new Map<string, typeof ops>()
  for (const o of ops) bySerial.set(o.serial, [...(bySerial.get(o.serial) ?? []), o])

  it('her makinede şu an işlenen parça var ve bitmiş operasyonlar kayıtlı', () => {
    const open = ops.filter((o) => o.end === null)
    for (const m of MACHINES) expect(open.some((o) => o.machineId === m.id)).toBe(true)
    expect(ops.filter((o) => o.end !== null).length).toBeGreaterThan(100)
    console.log('operasyon', ops.length, '· parça', bySerial.size, '· NCR', run.source.ncrs().length, '· fırın çevrimi', run.source.furnaceCycles().length)
  })

  it('parçalar rota sırasını izler ve bir operasyon öncekinden önce başlamaz', () => {
    let checked = 0
    for (const list of bySerial.values()) {
      const f = FAMILY_BY_PN[list[0].partNumber]
      expect(f).toBeDefined()
      const idx = list.map((o) => f.steps.findIndex((s) => s.machineId === o.machineId))
      for (let k = 1; k < list.length; k++) {
        expect(idx[k]).toBeGreaterThanOrEqual(idx[k - 1]) // yeniden işlemede aynı adım tekrarlanabilir
        expect(list[k].start).toBeGreaterThanOrEqual(list[k - 1].end ?? Infinity)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(30)
  })

  it('fırın şarjı en fazla 12 parça ve hepsi aynı anda başlar / biter', () => {
    const batches = new Map<string, typeof ops>()
    for (const o of ops) if (o.batchNo) batches.set(o.batchNo, [...(batches.get(o.batchNo) ?? []), o])
    expect(batches.size).toBeGreaterThan(3)
    for (const list of batches.values()) {
      expect(list.length).toBeLessThanOrEqual(12)
      expect(new Set(list.map((o) => o.start)).size).toBe(1)
      expect(new Set(list.map((o) => o.end)).size).toBe(1)
    }
  })

  it('her uygunsuz operasyon için NCR açılır; MRB en geç 24 saatte karar verir', () => {
    const nok = ops.filter((o) => o.result === 'NOK')
    const ncrs = run.source.ncrs()
    expect(ncrs.length).toBe(nok.length)
    for (const n of ncrs) {
      if (n.disposition) expect(n.dispositionAt! - n.t).toBeLessThanOrEqual(24 * HOUR + 10_000)
      else expect(t0 - n.t).toBeLessThanOrEqual(24 * HOUR + 10_000)
    }
  })

  it('fırın çevrimleri reçeteyle kıyaslanır (AMS 2750)', () => {
    const cycles = run.source.furnaceCycles()
    expect(cycles.length).toBeGreaterThan(3)
    for (const c of cycles) {
      expect(c.holdMin).toBeGreaterThan(20)
      expect(c.ok).toBe(c.holdMin >= c.requiredHoldMin && Math.max(Math.abs(c.minDev), Math.abs(c.maxDev)) <= c.toleranceC)
    }
    // Hikâye: FRN-01'in ısıtıcısı zayıflıyor → son şarj set değerinin altında kalıp reçete dışı
    const m09 = cycles.filter((c) => c.machineId === 'M09').at(-1)!
    expect(m09.ok).toBe(false)
    expect(m09.minDev).toBeLessThan(-6)
    console.log('fırın çevrimleri', cycles.map((c) => `${c.machineId} ${Math.round(c.holdMin)}dk ${c.minDev.toFixed(1)}/${c.maxDev.toFixed(1)} ${c.ok ? '✓' : '✗'}`).join(' · '))
  })
})
