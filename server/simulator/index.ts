/**
 * FABRİKA TARAFI SİMÜLATÖRÜ — gerçek veri geldiğinde bu süreç tamamen kalkar.
 * 12 makineyi gerçek saatle simüle eder ve PLC'lerin yazacağı satırları SQL Server'a yazar.
 *   npm run sim            → kaldığı yerden devam (boşlukları doldurur)
 *   npm run sim -- --reset → her şeyi silip son 48 saati yeniden üretir
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MACHINES } from '@/sim/factoryDef'
import { MachineSim, alignBucket } from '@/sim/machineSim'
import { PlcRecorder, emptyRows } from '@/sim/plcRecorder'
import type { RecordedRows } from '@/sim/plcRecorder'
import { BUCKET_MS } from '@/lib/types'
import { log } from '../shared/env'
import { connect, ensureDatabase, retry, runSqlFile } from '../shared/mssql'
import { SCHEMA_VERSION, dropAll, ensureAssignments, schemaVersion, seedReference, setSchemaVersion, wipe } from './seed'
import { writeRows } from './writer'

const STATE_FILE = 'data/sim-state.json'
const LOCK_FILE = 'data/sim.lock'
const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const say = (...a: unknown[]) => log('sim', ...a)

interface SimState {
  t0: number
  startT: number
}

const reset = process.argv.includes('--reset')

// Aynı anda iki simülatör aynı veritabanına yazmasın
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
mkdirSync(dirname(LOCK_FILE), { recursive: true })
if (existsSync(LOCK_FILE)) {
  const other = Number(readFileSync(LOCK_FILE, 'utf8'))
  if (other && other !== process.pid && alive(other)) {
    say(`Başka bir simülatör zaten çalışıyor (pid ${other}). Önce onu durdurun.`)
    process.exit(1)
  }
}
writeFileSync(LOCK_FILE, String(process.pid))
process.on('exit', () => {
  if (existsSync(LOCK_FILE) && Number(readFileSync(LOCK_FILE, 'utf8')) === process.pid) rmSync(LOCK_FILE)
})

await retry(ensureDatabase, 'SQL Server', say)
const pool = await connect()
const ver = await schemaVersion(pool)
if (ver !== SCHEMA_VERSION) {
  say(`şema sürümü ${ver ?? 'yok'} → ${SCHEMA_VERSION}: tablolar yeniden kuruluyor`)
  await dropAll(pool)
  rmSync(STATE_FILE, { force: true })
}
await runSqlFile(pool, 'server/sql/schema.sql')
await setSchemaVersion(pool)

if (reset) {
  say('--reset: tüm tablolar temizleniyor')
  await wipe(pool)
  rmSync(STATE_FILE, { force: true })
}

const lastRow = await pool.request().query<{ t: Date | null }>('SELECT MAX(SampleTimeUtc) AS t FROM dbo.ProductionCounters')
const lastSampleT = lastRow.recordset[0].t?.getTime() ?? null

let state: SimState
if (existsSync(STATE_FILE) && lastSampleT !== null) {
  state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SimState
} else {
  if (lastSampleT === null) await wipe(pool) // yarım kalmış bir kurulumu temizle
  const t0 = alignBucket(Date.now())
  // 48 saat: öngörücü bakımın 24 saatlik pencereleri ilk andan dolu olsun
  state = { t0, startT: t0 - 2 * DAY }
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

await seedReference(pool, state.t0)
await ensureAssignments(pool, state.startT - DAY, Date.now() + 7 * DAY)

say(`başlangıç ${new Date(state.t0).toLocaleString('tr-TR')} · hikâyeler bu ana göre kurgulandı`)
if (Date.now() - state.startT > 3 * DAY) say('not: simülatör uzun süredir çalışıyor; sunum öncesi `npm run sim:reset` önerilir')

const sims = MACHINES.map((m, idx) => ({ sim: new MachineSim(m, idx, state.t0), rec: new PlcRecorder(m) }))
let i = 0
const tOf = (k: number) => state.startT + k * BUCKET_MS

/** i. dilimden itibaren, bitişi `until` anına kadar olan dilimleri üretir. */
async function advance(until: number, flushEvery = 20000): Promise<number> {
  let rows: RecordedRows = emptyRows()
  let written = 0
  while (tOf(i) + BUCKET_MS <= until) {
    const t = tOf(i)
    const write = lastSampleT === null || t + BUCKET_MS > lastSampleT
    for (const s of sims) s.rec.record(s.sim.step(i, t), rows, write)
    i++
    if (rows.counters.length >= flushEvery) {
      written += await writeRows(pool, rows)
      rows = emptyRows()
    }
  }
  written += await writeRows(pool, rows)
  return written
}

const catchUpStart = Date.now()
const n = await advance(Date.now())
say(`geçmiş dolduruldu: ${n.toLocaleString('tr-TR')} satır (${((Date.now() - catchUpStart) / 1000).toFixed(1)} sn)`)

let busy = false
let lastLog = 0
let lastHousekeeping = Date.now()
setInterval(async () => {
  if (busy) return
  busy = true
  try {
    const w = await advance(Date.now())
    if (Date.now() - lastLog > 60_000 && w > 0) {
      lastLog = Date.now()
      say(`canlı · son dilim ${new Date(tOf(i)).toLocaleTimeString('tr-TR')} · ${MACHINES.length} makine`)
    }
    if (Date.now() - lastHousekeeping > HOUR) {
      lastHousekeeping = Date.now()
      await ensureAssignments(pool, Date.now(), Date.now() + 7 * DAY)
      const cut = new Date(Date.now() - 7 * DAY)
      for (const [tbl, col] of [['ProductionCounters', 'SampleTimeUtc'], ['ProcessValues', 'SampleTimeUtc'], ['ProcessTags', 'SampleTimeUtc'], ['QualitySamples', 'SampleTimeUtc'], ['MachineEvents', 'EventTimeUtc']]) {
        await pool.request().input('cut', cut).query(`DELETE FROM dbo.${tbl} WHERE ${col} < @cut`)
      }
    }
  } catch (e) {
    say('yazma hatası:', (e as Error).message)
  } finally {
    busy = false
  }
}, 1000)

const stop = async () => {
  say('kapanıyor')
  await pool.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
