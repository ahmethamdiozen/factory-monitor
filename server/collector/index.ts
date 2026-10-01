/**
 * DATA COLLECTOR — "bizim sistem"in giriş kapısı.
 * Her 5 sn'de SQL Server'dan sadece yeni satırları (Id > son okunan) salt-okur çeker,
 * src/pipeline/transform.ts ile anlamlandırır ve yerel SQLite'a yazar.
 * Gerçek veri geldiğinde değişecek tek yer: aşağıdaki SELECT'lerin kolon eşlemesi.
 */
import type { ConnectionPool } from 'mssql'
import { MachineTransformer, emptyOutput } from '@/pipeline/transform'
import type { TransformOutput } from '@/pipeline/transform'
import type { CounterRow, EventRow, ProcessRow, QualityRow } from '@/pipeline/rows'
import { shiftOf } from '@/sim/factoryDef'
import { dayStartOf } from '@/lib/kpi'
import { BUCKET_MS } from '@/lib/types'
import type { DowntimeReason, FactoryMeta, Line, Machine, Person, ReasonCategory, ShiftId } from '@/lib/types'
import { log } from '../shared/env'
import { connect, sql } from '../shared/mssql'
import { kvGet, kvSet, openSqlite } from '../shared/sqlite'
import type { CollectorHealth } from '../shared/sqlite'
import { RiskEngine } from '@/ml/riskEngine'
import { Notifier } from '@/ml/notify'
import type { FeatureBucket } from '@/ml/features'

const POLL_MS = 5000
const BATCH = 20000
const DAY = 24 * 3600 * 1000
const say = (...a: unknown[]) => log('collector', ...a)

const db = openSqlite()
let pool: ConnectionPool | null = null

// ---------- Referans verisi ----------
interface Ref {
  meta: Omit<FactoryMeta, 'datasetId'>
  toolLife: Map<string, number>
  hire: Map<string, number>
  /** "YYYY-MM-DD|vardiya|makine" → EmployeeId */
  operatorAt: Map<string, string>
}
let ref: Ref | null = null
let refLoadedAt = 0

const ymdLocal = (t: number) => {
  const d = new Date(dayStartOf(t))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const ymdUtc = (d: Date) => d.toISOString().slice(0, 10)

async function loadRef(p: ConnectionPool): Promise<Ref> {
  const lines = (await p.request().query('SELECT LineId, LineName FROM dbo.Lines ORDER BY LineId')).recordset
  const machines = (
    await p.request().query(`
      SELECT m.*, w.WorkOrderNo, w.ProductName
      FROM dbo.Machines m
      OUTER APPLY (SELECT TOP 1 WorkOrderNo, ProductName FROM dbo.WorkOrders w WHERE w.MachineId = m.MachineId AND w.Status = 'Released' ORDER BY WorkOrderNo) w
      ORDER BY m.MachineId`)
  ).recordset
  const reasons = (await p.request().query('SELECT ReasonCode, Description, Category, IsPlanned FROM dbo.DowntimeReasons ORDER BY ReasonCode')).recordset
  const employees = (await p.request().query('SELECT EmployeeId, FullName, Role, HireDate FROM dbo.Employees')).recordset
  const assignments = (
    await p.request().input('from', sql.Date, new Date(Date.now() - 3 * DAY)).query(
      'SELECT WorkDate, ShiftCode, LineId, MachineId, EmployeeId, Role FROM dbo.ShiftAssignments WHERE WorkDate >= @from',
    )
  ).recordset

  const hire = new Map<string, number>(employees.map((e) => [e.EmployeeId as string, (e.HireDate as Date).getTime()]))
  const operatorAt = new Map<string, string>()
  for (const a of assignments) if (a.MachineId && a.Role === 'operator') operatorAt.set(`${ymdUtc(a.WorkDate)}|${a.ShiftCode}|${a.MachineId}`, a.EmployeeId)

  const today = ymdLocal(Date.now())
  const empById = new Map(employees.map((e) => [e.EmployeeId as string, e]))
  const people: Person[] = assignments
    .filter((a) => ymdUtc(a.WorkDate) === today)
    .map((a) => {
      const e = empById.get(a.EmployeeId)!
      return {
        id: a.EmployeeId,
        name: e.FullName,
        role: a.Role,
        shiftId: a.ShiftCode as ShiftId,
        lineId: a.LineId,
        machineId: a.MachineId ?? undefined,
        experienceYears: Math.round(((Date.now() - (e.HireDate as Date).getTime()) / (365.25 * DAY)) * 10) / 10,
        avatarSeed: e.FullName,
      }
    })

  const meta: Omit<FactoryMeta, 'datasetId'> = {
    lines: lines.map((l): Line => ({ id: l.LineId, name: l.LineName, short: (l.LineName as string).split('·')[0].trim() })),
    machines: machines.map(
      (m): Machine => ({
        id: m.MachineId,
        code: m.MachineCode,
        name: m.MachineName,
        model: m.Model,
        lineId: m.LineId,
        type: m.MachineType,
        product: m.PartName,
        partNumber: m.PartNumber,
        operation: m.OperationNo,
        batchSize: m.BatchSize,
        orderNo: m.WorkOrderNo ?? '—',
        idealRate: (m.BatchSize * 1000) / m.IdealCycleTimeMs,
        dailyTarget: m.DailyTarget,
        spec: { characteristic: m.QualityCharacteristic, unit: m.QualityUnit, nominal: Number(m.Nominal), lsl: Number(m.Lsl), usl: Number(m.Usl), sigma: Number(m.ProcessStdDev) },
      }),
    ),
    reasons: [
      { id: 0, label: '—', category: 'planned', planned: false },
      ...reasons.map((r): DowntimeReason => ({ id: r.ReasonCode, label: r.Description, category: r.Category as ReasonCategory, planned: !!r.IsPlanned })),
    ],
    people,
  }
  return { meta, toolLife: new Map(machines.map((m) => [m.MachineId as string, m.ToolLifeCycles as number])), hire, operatorAt }
}

function experienceAt(machineId: string, t: number): number | null {
  if (!ref) return null
  const emp = ref.operatorAt.get(`${ymdLocal(t)}|${shiftOf(t)}|${machineId}`)
  const h = emp ? ref.hire.get(emp) : undefined
  return h === undefined ? null : (t - h) / (365.25 * DAY)
}

// ---------- Dönüştürücüler ----------
const transformers = new Map<string, MachineTransformer>()
function transformerFor(machineId: string): MachineTransformer {
  let tr = transformers.get(machineId)
  if (!tr) {
    const m = ref!.meta.machines.find((x) => x.id === machineId)
    if (!m) throw new Error(`Bilinmeyen makine: ${machineId}`)
    tr = new MachineTransformer({ id: m.id, type: m.type, idealCycleMs: 1000 / m.idealRate, toolLife: ref!.toolLife.get(m.id) ?? 1e9 }, { experienceAt })
    const snap = kvGet<string>(db, `tr:${machineId}`)
    if (snap) tr.restore(snap)
    transformers.set(machineId, tr)
  }
  return tr
}

// ---------- SQLite yazma ----------
const stmt = {
  bucket: db.prepare(`INSERT OR REPLACE INTO bucket (machine_id, t, state, down_reason, slow_reason, speed, ok, nok, temp, vib, feed, cur) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  stop: db.prepare(`INSERT INTO stop_event (machine_id, state, reason_id, start, end, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT (machine_id, start) DO UPDATE SET state = excluded.state, reason_id = excluded.reason_id, end = excluded.end, updated_at = excluded.updated_at`),
  slow: db.prepare(`INSERT INTO slow_event (machine_id, reason_id, start, end, min_speed, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT (machine_id, start) DO UPDATE SET reason_id = excluded.reason_id, end = excluded.end, min_speed = excluded.min_speed, updated_at = excluded.updated_at`),
  spc: db.prepare('INSERT OR REPLACE INTO spc_subgroup (machine_id, t, mean, range) VALUES (?,?,?,?)'),
  sync: db.prepare(`INSERT INTO sync_state (tbl, last_id, last_sync_at, rows_total) VALUES (?,?,?,?)
    ON CONFLICT (tbl) DO UPDATE SET last_id = excluded.last_id, last_sync_at = excluded.last_sync_at, rows_total = sync_state.rows_total + excluded.rows_total`),
  lastIds: db.prepare('SELECT tbl, last_id FROM sync_state'),
  lastBucket: db.prepare('SELECT machine_id, MAX(t) AS t FROM bucket GROUP BY machine_id'),
  risk: db.prepare('INSERT OR REPLACE INTO risk (machine_id, t, risk, level, factors) VALUES (?,?,?,?,?)'),
  notifIns: db.prepare('INSERT OR IGNORE INTO notification (id, t, machine_id, line_id, title, message, recipients, risk, factors) VALUES (?,?,?,?,?,?,?,?,?)'),
  notifFail: db.prepare('UPDATE notification SET failure_at = ? WHERE id = ? AND failure_at IS NULL'),
}

// ---------- Öngörücü bakım ----------
// Risk motoru türetilmiş durumdur: açılışta SQLite'taki dilimlerden yeniden kurulur (anlık görüntü gerekmez).
// Bildirim durumları (okundu / bakım planlandı) INSERT OR IGNORE sayesinde yeniden kurulumda korunur.
let engine: RiskEngine | null = null
let notifier: Notifier | null = null

function feedPredictive(machineId: string, b: FeatureBucket): void {
  const ev = engine!.add(machineId, b)
  if (!ev) return
  if (ev.failureAt !== undefined) {
    const c = notifier!.onFailure(machineId, ev.failureAt)
    if (c?.confirmed) stmt.notifFail.run(c.confirmed.failureAt, c.confirmed.id)
  }
  if (ev.point) {
    const p = ev.point
    stmt.risk.run(p.machineId, p.t, p.risk, p.level, JSON.stringify(p.factors))
    const c = notifier!.onRisk(p)
    if (c?.created) {
      const n = c.created
      stmt.notifIns.run(n.id, n.t, n.machineId, n.lineId, n.title, n.message, JSON.stringify(n.recipients), n.risk, JSON.stringify(n.factors))
    }
  }
}

function initPredictive(): void {
  const lines = ref!.meta.lines
  const ms = ref!.meta.machines.map((m) => ({ id: m.id, code: m.code, name: m.name, lineId: m.lineId, lineShort: lines.find((l) => l.id === m.lineId)?.short ?? m.lineId }))
  engine = new RiskEngine(ms)
  notifier = new Notifier(ms)
  const rows = db.prepare('SELECT machine_id, t, state, down_reason, speed, temp, vib, cur FROM bucket ORDER BY t, machine_id').all() as {
    machine_id: string; t: number; state: number; down_reason: number; speed: number; temp: number; vib: number; cur: number
  }[]
  db.exec('BEGIN')
  try {
    for (const r of rows) feedPredictive(r.machine_id, { t: r.t, state: r.state, downReason: r.down_reason, speed: r.speed, temp: r.temp, vib: r.vib, cur: r.cur })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  if (rows.length) say(`öngörücü bakım: ${rows.length.toLocaleString('tr-TR')} dilimden risk geçmişi kuruldu`)
}

let updSeq = 0
const nextUpd = () => (updSeq = Math.max(updSeq + 1, Date.now()))

function persist(out: TransformOutput, ids: Record<string, { lastId: number; rows: number }>): void {
  const upd = nextUpd()
  db.exec('BEGIN')
  try {
    for (const b of out.buckets) stmt.bucket.run(b.machineId, b.t, b.state, b.downReason, b.slowReason, b.speed, b.ok, b.nok, b.temp, b.vib, b.feed, b.cur)
    for (const e of out.stops) stmt.stop.run(e.machineId, e.state, e.reasonId, e.start, e.end, upd)
    for (const e of out.slows) stmt.slow.run(e.machineId, e.reasonId, e.start, e.end, e.minSpeed, upd)
    for (const g of out.spc) stmt.spc.run(g.machineId, g.t, g.mean, g.range)
    for (const b of out.buckets) feedPredictive(b.machineId, b)
    for (const [tbl, v] of Object.entries(ids)) stmt.sync.run(tbl, v.lastId, Date.now(), v.rows)
    for (const [id, tr] of transformers) kvSet(db, `tr:${id}`, tr.snapshot())
    const rows = stmt.lastBucket.all() as { machine_id: string; t: number }[]
    if (rows.length) kvSet(db, 'watermark', Math.min(...rows.map((r) => r.t)) + BUCKET_MS)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

function lastIds(): Record<string, number> {
  const out: Record<string, number> = { ProductionCounters: 0, ProcessValues: 0, MachineEvents: 0, QualitySamples: 0 }
  for (const r of stmt.lastIds.all() as { tbl: string; last_id: number }[]) out[r.tbl] = r.last_id
  return out
}

function rebuild(reason: string): void {
  say(`SQLite yeniden kuruluyor: ${reason}`)
  db.exec('DELETE FROM bucket; DELETE FROM stop_event; DELETE FROM slow_event; DELETE FROM spc_subgroup; DELETE FROM sync_state; DELETE FROM kv; DELETE FROM risk; DELETE FROM notification')
  transformers.clear()
  engine = null
  notifier = null
  kvSet(db, 'datasetId', Date.now().toString(36))
}

// ---------- Okuma turu ----------
async function pullOnce(p: ConnectionPool): Promise<{ counters: number; total: number }> {
  const last = lastIds()
  const counters = (
    await p.request().input('last', sql.BigInt, last.ProductionCounters).query(
      `SELECT TOP (${BATCH}) Id, MachineId, SampleTimeUtc, TotalCount, RejectCount FROM dbo.ProductionCounters WHERE Id > @last ORDER BY Id`,
    )
  ).recordset
  if (!counters.length) return { counters: 0, total: 0 }
  const maxT: Date = counters[counters.length - 1].SampleTimeUtc
  const q = (text: string, lastId: number) => p.request().input('last', sql.BigInt, lastId).input('maxT', sql.DateTime2(3), maxT).query(text)

  // Sayaçlar ilk okunur: bir sayaç satırı görünüyorsa aynı işlemdeki diğer satırlar da görünür
  const process = (await q('SELECT Id, MachineId, SampleTimeUtc, CycleTimeMs, TemperatureC, VibrationMmS, FeedPct, ToolCycleCount, MaterialLot, MotorCurrentA FROM dbo.ProcessValues WHERE Id > @last AND SampleTimeUtc <= @maxT ORDER BY Id', last.ProcessValues)).recordset
  const events = (await q('SELECT EventId, MachineId, EventTimeUtc, StatusCode, ReasonCode FROM dbo.MachineEvents WHERE EventId > @last AND EventTimeUtc < @maxT ORDER BY EventId', last.MachineEvents)).recordset
  const quality = (await q('SELECT Id, MachineId, SampleTimeUtc, Characteristic, SubgroupNo, SampleIdx, Value, Nominal, Lsl, Usl FROM dbo.QualitySamples WHERE Id > @last AND SampleTimeUtc <= @maxT ORDER BY Id', last.QualitySamples)).recordset

  const out = emptyOutput()
  for (const e of events) {
    const row: EventRow = { machineId: e.MachineId, t: (e.EventTimeUtc as Date).getTime(), status: e.StatusCode, reasonCode: e.ReasonCode }
    transformerFor(row.machineId).addEvent(row)
  }
  const pv = new Map<string, ProcessRow>()
  for (const r of process) {
    const row: ProcessRow = {
      machineId: r.MachineId,
      sampleT: (r.SampleTimeUtc as Date).getTime(),
      cycleTimeMs: r.CycleTimeMs,
      temperatureC: Number(r.TemperatureC),
      vibrationMmS: Number(r.VibrationMmS),
      feedPct: Number(r.FeedPct),
      toolCycleCount: r.ToolCycleCount,
      materialLot: r.MaterialLot,
      motorCurrentA: r.MotorCurrentA === null ? 0 : Number(r.MotorCurrentA),
    }
    pv.set(`${row.machineId}|${row.sampleT}`, row)
  }
  for (const c of counters) {
    const row: CounterRow = { machineId: c.MachineId, sampleT: (c.SampleTimeUtc as Date).getTime(), totalCount: c.TotalCount, rejectCount: c.RejectCount }
    transformerFor(row.machineId).addCounter(row, pv.get(`${row.machineId}|${row.sampleT}`), out)
  }
  for (const r of quality) {
    const row: QualityRow = {
      machineId: r.MachineId,
      sampleT: (r.SampleTimeUtc as Date).getTime(),
      characteristic: r.Characteristic,
      subgroupNo: r.SubgroupNo,
      sampleIdx: r.SampleIdx,
      value: Number(r.Value),
      nominal: Number(r.Nominal),
      lsl: Number(r.Lsl),
      usl: Number(r.Usl),
    }
    transformerFor(row.machineId).addQuality(row, out)
  }

  const lastOf = (rows: Record<string, unknown>[], key: string, prev: number) => (rows.length ? Number(rows[rows.length - 1][key]) : prev)
  persist(out, {
    ProductionCounters: { lastId: lastOf(counters, 'Id', last.ProductionCounters), rows: counters.length },
    ProcessValues: { lastId: lastOf(process, 'Id', last.ProcessValues), rows: process.length },
    MachineEvents: { lastId: lastOf(events, 'EventId', last.MachineEvents), rows: events.length },
    QualitySamples: { lastId: lastOf(quality, 'Id', last.QualitySamples), rows: quality.length },
  })
  return { counters: counters.length, total: counters.length + process.length + events.length + quality.length }
}

// ---------- Ana döngü ----------
const health: CollectorHealth = { lastPollAt: 0, lastSuccessAt: null, error: null, lastRows: 0, rowsPerMin: 0 }
const recent: { t: number; n: number }[] = []
let lastHousekeeping = 0

async function poll(): Promise<void> {
  health.lastPollAt = Date.now()
  try {
    if (!pool || !pool.connected) {
      pool = await connect()
      say('SQL Server bağlantısı kuruldu')
    }
    if (!ref || Date.now() - refLoadedAt > 60_000) {
      ref = await loadRef(pool)
      refLoadedAt = Date.now()
      kvSet(db, 'meta', ref.meta)
    }
    if (!kvGet(db, 'datasetId')) kvSet(db, 'datasetId', Date.now().toString(36))

    // SQL Server şeması değişti mi? (simülatör tabloları yeniden kurduysa Id'ler baştan başlar)
    const ver = (await pool.request().query("SELECT CASE WHEN OBJECT_ID('dbo.SchemaInfo') IS NULL THEN 0 ELSE 1 END AS e")).recordset[0].e
      ? ((await pool.request().query('SELECT MAX(Version) AS v FROM dbo.SchemaInfo')).recordset[0].v as number | null)
      : null
    const known = kvGet<number | null>(db, 'sourceSchema')
    if (known !== ver && lastIds().ProductionCounters > 0) {
      rebuild(`SQL Server şema sürümü değişti (${known ?? '-'} → ${ver ?? '-'})`)
      kvSet(db, 'meta', ref.meta)
    }
    kvSet(db, 'sourceSchema', ver)
    // SQL Server sıfırlandı mı? (Id'ler geri gittiyse)
    const max = (await pool.request().query('SELECT ISNULL((SELECT MAX(Id) FROM dbo.ProductionCounters), 0) AS c')).recordset[0].c as number
    if (Number(max) < lastIds().ProductionCounters) {
      rebuild('SQL Server verisi sıfırlanmış')
      kvSet(db, 'meta', ref.meta)
      kvSet(db, 'sourceSchema', ver)
    }
    if (!engine) initPredictive()

    let total = 0
    for (;;) {
      const n = await pullOnce(pool)
      total += n.total
      if (n.counters < BATCH) break
      say(`geçmiş okunuyor… ${total.toLocaleString('tr-TR')} satır`)
    }
    recent.push({ t: Date.now(), n: total })
    while (recent.length && recent[0].t < Date.now() - 60_000) recent.shift()
    health.lastRows = total
    health.rowsPerMin = recent.reduce((a, r) => a + r.n, 0)
    health.lastSuccessAt = Date.now()
    health.error = null

    if (Date.now() - lastHousekeeping > 3600_000) {
      lastHousekeeping = Date.now()
      const cut = Date.now() - 7 * DAY
      db.prepare('DELETE FROM bucket WHERE t < ?').run(cut)
      db.prepare('DELETE FROM stop_event WHERE end IS NOT NULL AND end < ?').run(cut)
      db.prepare('DELETE FROM slow_event WHERE end IS NOT NULL AND end < ?').run(cut)
      db.prepare('DELETE FROM spc_subgroup WHERE t < ?').run(cut)
      db.prepare('DELETE FROM risk WHERE t < ?').run(cut)
    }
  } catch (e) {
    health.error = (e as Error).message.split('\n')[0]
    say('hata:', health.error)
    if (pool && !pool.connected) pool = null
  } finally {
    kvSet(db, 'collectorHealth', health)
  }
}

say('başladı · her', POLL_MS / 1000, 'sn\'de SQL Server okunacak')
let running = false
const tick = async () => {
  if (running) return
  running = true
  await poll()
  running = false
}
await tick()
setInterval(tick, POLL_MS)

const stop = async () => {
  say('kapanıyor')
  await pool?.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
