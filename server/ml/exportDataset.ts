/**
 * Öngörücü bakım eğitim verisi üretir (SQL Server gerekmez).
 * Simülatörü makine makine N gün çalıştırır, ham satırları collector'ın dönüştürücüsünden
 * geçirir, her saat başı özellikleri (src/ml/features.ts) ve etiketi CSV'ye yazar.
 *
 *   npm run ml:dataset            → 365 gün
 *   npm run ml:dataset -- 180     → 180 gün
 *
 * Etiket: önümüzdeki 72 saatte "arıza" kategorili bir duruş başlıyor mu?
 * Arızanın türü (öngörülebilir türlerden biri ya da belirtisiz) sadece analiz için yazılır.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { MACHINES } from '@/sim/factoryDef'
import { MachineSim, alignBucket } from '@/sim/machineSim'
import { PlcRecorder, emptyRows } from '@/sim/plcRecorder'
import { MachineTransformer, emptyOutput } from '@/pipeline/transform'
import { experienceFromDefs, machineInfoOf } from '@/pipeline/localPipeline'
import { MODE_BY_REASON } from '@/lib/failureModes'
import { REASON_BY_ID } from '@/sim/factoryDef'
import { FEATURE_NAMES, FeatureTracker } from '@/ml/features'
import { BUCKET_MS, STATE } from '@/lib/types'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const HORIZON = 72 * HOUR
const isBreakdown = (reason: number) => REASON_BY_ID[reason]?.category === 'breakdown'

const days = Number(process.argv[2] ?? 365)
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
  mode: string
}

const header = ['machine_id', 'machine_type', 't', 'label', 'hours_to_failure', 'next_failure_predictable', 'next_failure_mode', 'degradation', 'degradation_mode', ...FEATURE_NAMES]
const lines: string[] = [header.join(',')]
let failuresTotal = 0
let failuresPredictable = 0
const t1 = Date.now()

MACHINES.forEach((m, idx) => {
  const sim = new MachineSim(m, idx, t0)
  const rec = new PlcRecorder(m)
  const info = machineInfoOf(m, idx)
  const tr = new MachineTransformer(info, { experienceAt: experienceFromDefs })
  const ft = new FeatureTracker(m.id, m.type, info.ref!)
  const samples: Sample[] = []
  /** arıza başlangıçları ve türü ('' = belirtisiz ani arıza) */
  const failures: { t: number; mode: string }[] = []
  let prevBreakdown = false
  const n = Math.round((end - start) / BUCKET_MS)
  for (let i = 0; i < n; i++) {
    const t = start + i * BUCKET_MS
    const raw = sim.step(i, t)
    const rows = emptyRows()
    rec.record(raw, rows)
    const out = emptyOutput()
    for (const e of rows.events) tr.addEvent(e)
    for (const c of rows.counters) tr.addCounter(c, rows.process[0], out, rows.tags)
    for (const b of out.buckets) {
      ft.add(b)
      const isBd = b.state === STATE.STOPPED && isBreakdown(b.downReason)
      if (isBd && !prevBreakdown) failures.push({ t: b.t, mode: MODE_BY_REASON[b.downReason] ?? '' })
      prevBreakdown = isBd
      if (b.t % HOUR === 0 && !isBd && b.t >= start + WARMUP_DAYS * DAY && b.t < end - HORIZON) {
        const x = ft.features(b.t)
        if (x) samples.push({ t: b.t, x, d: raw.truthDegradation, mode: raw.truthMode })
      }
    }
  }
  const inWindow = failures.filter((f) => f.t >= start + WARMUP_DAYS * DAY && f.t < end)
  failuresTotal += inWindow.length
  failuresPredictable += inWindow.filter((f) => f.mode).length
  let k = 0
  for (const s of samples) {
    while (k < failures.length && failures[k].t <= s.t) k++
    const next = failures[k]
    const hrs = next ? (next.t - s.t) / HOUR : -1
    const label = next && next.t - s.t <= HORIZON ? 1 : 0
    lines.push([m.id, m.type, s.t, label, hrs.toFixed(2), next ? (next.mode ? 1 : 0) : '', next?.mode ?? '', s.d.toFixed(3), s.mode, ...s.x.map((v) => (Number.isInteger(v) ? v : v.toFixed(5)))].join(','))
  }
  const counts = new Map<string, number>()
  for (const f of inWindow) counts.set(f.mode || 'ani', (counts.get(f.mode || 'ani') ?? 0) + 1)
  const byMode = [...counts].map(([k, v]) => `${k} ${v}`).join(' · ')
  console.log(`${m.code}: ${samples.length} örnek, ${inWindow.length} arıza (${byMode}) · ${((Date.now() - t1) / 1000).toFixed(0)} sn`)
})

mkdirSync('data/ml', { recursive: true })
writeFileSync('data/ml/dataset.csv', lines.join('\n') + '\n')
writeFileSync(
  'data/ml/dataset-info.json',
  JSON.stringify({ days, machines: MACHINES.length, rows: lines.length - 1, failures: failuresTotal, predictableFailures: failuresPredictable, start: start + WARMUP_DAYS * DAY, end, horizonHours: HORIZON / HOUR }, null, 2),
)
console.log(`\n${lines.length - 1} satır · ${failuresTotal} arıza (${failuresPredictable} öngörülebilir) → data/ml/dataset.csv`)
