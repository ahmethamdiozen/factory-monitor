/**
 * Öngörücü bakım eğitim verisi üretir (SQL Server gerekmez).
 * Simülatörü makine makine N gün çalıştırır, ham satırları collector'ın dönüştürücüsünden
 * geçirir, her saat başı özellikleri (src/ml/features.ts) ve etiketi CSV'ye yazar.
 *
 *   npm run ml:dataset            → 180 gün
 *   npm run ml:dataset -- 365     → 365 gün
 *
 * Etiket: önümüzdeki 24 saatte "arıza" kategorili bir duruş başlıyor mu?
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { MACHINES } from '@/sim/factoryDef'
import { MachineSim, alignBucket, toolLifeCycles } from '@/sim/machineSim'
import { PlcRecorder, emptyRows } from '@/sim/plcRecorder'
import { MachineTransformer, emptyOutput } from '@/pipeline/transform'
import { experienceFromDefs } from '@/pipeline/localPipeline'
import { FEATURE_NAMES, FeatureTracker } from '@/ml/features'
import { BUCKET_MS, STATE } from '@/lib/types'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const HORIZON = 24 * HOUR
const BREAKDOWN = new Set([1, 2, 3])

const days = Number(process.argv[2] ?? 180)
const WARMUP_DAYS = 2
// Sabit takvim: üretilen veri her çalıştırmada aynı olsun (tohumlu simülatör)
const end = alignBucket(new Date(2026, 8, 1, 6).getTime())
const start = end - (days + WARMUP_DAYS) * DAY - HORIZON
// Demo hikâyeleri (t0'a göre) eğitim penceresinin dışında kalsın
const t0 = end + 60 * DAY

interface Sample {
  t: number
  x: number[]
  d: number
}

const header = ['machine_id', 'line_id', 't', 'label', 'hours_to_failure', 'next_failure_predictable', 'degradation', ...FEATURE_NAMES]
const lines: string[] = [header.join(',')]
let failuresTotal = 0
let failuresPredictable = 0
const t1 = Date.now()

MACHINES.forEach((m, idx) => {
  const sim = new MachineSim(m, idx, t0)
  const rec = new PlcRecorder(m)
  const tr = new MachineTransformer({ id: m.id, idealCycleMs: 1000 / m.idealRate, toolLife: toolLifeCycles(m) }, { experienceAt: experienceFromDefs })
  const ft = new FeatureTracker(m.id, m.lineId)
  const samples: Sample[] = []
  /** arıza başlangıçları ve o andaki gizli yıpranma (öngörülebilir mi?) */
  const failures: { t: number; predictable: boolean }[] = []
  let prevBreakdown = false
  let lastDeg = 0
  const n = Math.round((end - start) / BUCKET_MS)
  for (let i = 0; i < n; i++) {
    const t = start + i * BUCKET_MS
    const raw = sim.step(i, t)
    const rows = emptyRows()
    rec.record(raw, rows)
    const out = emptyOutput()
    for (const e of rows.events) tr.addEvent(e)
    for (const c of rows.counters) tr.addCounter(c, rows.process.find((p) => p.sampleT === c.sampleT), out)
    for (const b of out.buckets) {
      ft.add(b)
      const isBd = b.state === STATE.STOPPED && BREAKDOWN.has(b.downReason)
      if (isBd && !prevBreakdown) failures.push({ t: b.t, predictable: lastDeg >= 0.55 })
      prevBreakdown = isBd
      if (b.t % HOUR === 0 && !isBd && b.t >= start + WARMUP_DAYS * DAY && b.t < end - HORIZON) {
        const x = ft.features(b.t)
        if (x) samples.push({ t: b.t, x, d: raw.truthDegradation })
      }
    }
    lastDeg = raw.truthDegradation
  }
  const inWindow = failures.filter((f) => f.t >= start + WARMUP_DAYS * DAY && f.t < end)
  failuresTotal += inWindow.length
  failuresPredictable += inWindow.filter((f) => f.predictable).length
  let k = 0
  for (const s of samples) {
    while (k < failures.length && failures[k].t <= s.t) k++
    const next = failures[k]
    const hrs = next ? (next.t - s.t) / HOUR : -1
    const label = next && next.t - s.t <= HORIZON ? 1 : 0
    lines.push([m.id, m.lineId, s.t, label, hrs.toFixed(2), next ? (next.predictable ? 1 : 0) : '', s.d.toFixed(3), ...s.x.map((v) => (Number.isInteger(v) ? v : v.toFixed(5)))].join(','))
  }
  console.log(`${m.code}: ${samples.length} örnek, ${inWindow.length} arıza (${inWindow.filter((f) => f.predictable).length} öngörülebilir) · ${((Date.now() - t1) / 1000).toFixed(0)} sn`)
})

mkdirSync('data/ml', { recursive: true })
writeFileSync('data/ml/dataset.csv', lines.join('\n') + '\n')
writeFileSync(
  'data/ml/dataset-info.json',
  JSON.stringify({ days, machines: MACHINES.length, rows: lines.length - 1, failures: failuresTotal, predictableFailures: failuresPredictable, start: start + WARMUP_DAYS * DAY, end, horizonHours: 24 }, null, 2),
)
console.log(`\n${lines.length - 1} satır · ${failuresTotal} arıza (${failuresPredictable} öngörülebilir) → data/ml/dataset.csv`)
