/**
 * API — arayüzün tek veri kapısı. Anlamlandırılmış veriyi SQLite'tan okur.
 * Sadece /api/sql/* ve /api/health SQL Server'a doğrudan (salt-okur) bakar.
 */
import Fastify from 'fastify'
import type { ConnectionPool } from 'mssql'
import { statSync } from 'node:fs'
import { env, log } from '../shared/env'
import { connect } from '../shared/mssql'
import { kvGet, openSqlite } from '../shared/sqlite'
import type { CollectorHealth } from '../shared/sqlite'
import type { FactoryMeta } from '@/lib/types'
import { SQL_TABLES } from '@/data/sqlTables'

const say = (...a: unknown[]) => log('api', ...a)
const db = openSqlite()
const app = Fastify()
const HOUR = 3600 * 1000

// ---------- SQL Server (salt-okur, tembel bağlantı) ----------
let pool: ConnectionPool | null = null
async function sqlPool(): Promise<ConnectionPool> {
  if (pool?.connected) return pool
  pool = await connect()
  return pool
}

// ---------- Anlamlandırılmış veri (SQLite) ----------
app.get('/api/meta', async (_req, reply) => {
  const meta = kvGet<Omit<FactoryMeta, 'datasetId'>>(db, 'meta')
  if (!meta) return reply.code(503).send({ error: 'Collector henüz referans verisi yazmadı' })
  return { datasetId: kvGet<string>(db, 'datasetId') ?? '-', ...meta }
})

const seriesStmt = db.prepare('SELECT machine_id, t, state, down_reason, slow_reason, speed, ok, nok FROM bucket WHERE t >= ? AND t < ? ORDER BY machine_id, t')
app.get<{ Querystring: { since?: string } }>('/api/series', async (req, reply) => {
  const wm = kvGet<number>(db, 'watermark')
  if (!wm) return reply.code(503).send({ error: 'Henüz veri yok' })
  const since = req.query.since ? Number(req.query.since) : wm - 50 * HOUR
  const rows = seriesStmt.all(since, wm) as { machine_id: string; t: number; state: number; down_reason: number; slow_reason: number; speed: number; ok: number; nok: number }[]
  const machines: Record<string, { t: number[]; state: number[]; down: number[]; slow: number[]; speed: number[]; ok: number[]; nok: number[] }> = {}
  for (const r of rows) {
    const m = (machines[r.machine_id] ??= { t: [], state: [], down: [], slow: [], speed: [], ok: [], nok: [] })
    m.t.push(r.t)
    m.state.push(r.state)
    m.down.push(r.down_reason)
    m.slow.push(r.slow_reason)
    m.speed.push(Math.round(r.speed * 1000) / 1000)
    m.ok.push(r.ok)
    m.nok.push(r.nok)
  }
  return { datasetId: kvGet<string>(db, 'datasetId'), watermark: wm, since, machines }
})

const stopStmt = db.prepare('SELECT id, machine_id, state, reason_id, start, end, updated_at FROM stop_event WHERE updated_at > ? AND (end IS NULL OR end >= ?) ORDER BY start')
const slowStmt = db.prepare('SELECT id, machine_id, reason_id, start, end, min_speed, updated_at FROM slow_event WHERE updated_at > ? AND (end IS NULL OR end >= ?) ORDER BY start')
app.get<{ Querystring: { cursor?: string; from?: string } }>('/api/events', async (req) => {
  const cursor = Number(req.query.cursor ?? 0)
  const from = Number(req.query.from ?? 0)
  const stops = stopStmt.all(cursor, from) as { id: number; machine_id: string; state: number; reason_id: number; start: number; end: number | null; updated_at: number }[]
  const slows = slowStmt.all(cursor, from) as { id: number; machine_id: string; reason_id: number; start: number; end: number | null; min_speed: number; updated_at: number }[]
  const next = Math.max(cursor, ...stops.map((e) => e.updated_at), ...slows.map((e) => e.updated_at))
  return {
    cursor: next,
    stops: stops.map((e) => ({ id: e.id, machineId: e.machine_id, state: e.state, reasonId: e.reason_id, start: e.start, end: e.end })),
    slows: slows.map((e) => ({ id: e.id, machineId: e.machine_id, reasonId: e.reason_id, start: e.start, end: e.end, minSpeed: e.min_speed })),
  }
})

const spcStmt = db.prepare('SELECT machine_id, t, mean, range FROM spc_subgroup WHERE t >= ? ORDER BY machine_id, t')
app.get<{ Querystring: { since?: string } }>('/api/spc', async (req) => {
  const rows = spcStmt.all(Number(req.query.since ?? 0)) as { machine_id: string; t: number; mean: number; range: number }[]
  return { rows: rows.map((r) => ({ machineId: r.machine_id, t: r.t, mean: r.mean, range: r.range })) }
})

// Süreç sinyalleri: 5 dk'lık ortalamalar (çalışırken; fırında sadece tutma anı — bkz. src/data/signals.ts)
const signalStmt = db.prepare(`
  SELECT (t / 300000) * 300000 AS t,
    AVG(temp) AS temp, AVG(vib) AS vib, AVG(hf) AS hf, AVG(load) AS load, AVG(cur) AS cur, AVG(aux) AS aux, AVG(feed) AS feed
  FROM bucket
  WHERE machine_id = ? AND t >= ? AND state = 0 AND (? = 0 OR ABS(temp) < 15)
  GROUP BY t / 300000 ORDER BY 1`)
app.get<{ Querystring: { machine?: string; since?: string } }>('/api/signals', async (req, reply) => {
  const meta = kvGet<Omit<FactoryMeta, 'datasetId'>>(db, 'meta')
  const m = meta?.machines.find((x) => x.id === req.query.machine)
  if (!m) return reply.code(404).send({ error: 'Makine bulunamadı' })
  const since = Number(req.query.since ?? 0) || Date.now() - 48 * HOUR
  return { points: signalStmt.all(m.id, since, m.type === 'furnace' ? 1 : 0) }
})

// ---------- Öngörücü bakım ----------
const riskStmt = db.prepare('SELECT machine_id, t, risk, level, factors, source FROM risk WHERE t >= ? ORDER BY t')
app.get<{ Querystring: { since?: string } }>('/api/risk', async (req) => {
  const since = Number(req.query.since ?? 0) || Date.now() - 50 * HOUR
  const rows = riskStmt.all(since) as { machine_id: string; t: number; risk: number; level: string; factors: string; source: string | null }[]
  return { points: rows.map((r) => ({ machineId: r.machine_id, t: r.t, risk: r.risk, level: r.level, factors: JSON.parse(r.factors), source: r.source })) }
})

const notifStmt = db.prepare('SELECT * FROM notification WHERE t >= ? ORDER BY t DESC')
app.get('/api/notifications', async () => {
  const rows = notifStmt.all(Date.now() - 7 * 24 * HOUR) as Record<string, unknown>[]
  return {
    notifications: rows.map((r) => ({
      id: r.id,
      t: r.t,
      machineId: r.machine_id,
      lineId: r.line_id,
      title: r.title,
      message: r.message,
      recipients: JSON.parse(r.recipients as string),
      risk: r.risk,
      factors: JSON.parse(r.factors as string),
      source: r.source ?? null,
      status: r.status,
      statusAt: r.status_at,
      failureAt: r.failure_at,
    })),
  }
})

const STATUSES = new Set(['new', 'read', 'planned', 'closed'])
const setStatusStmt = db.prepare('UPDATE notification SET status = ?, status_at = ? WHERE id = ?')
app.post<{ Params: { id: string }; Body: { status?: string } }>('/api/notifications/:id', async (req, reply) => {
  const status = req.body?.status
  if (!status || !STATUSES.has(status)) return reply.code(400).send({ error: 'Geçersiz durum' })
  const r = setStatusStmt.run(status, Date.now(), req.params.id)
  if (r.changes === 0) return reply.code(404).send({ error: 'Bildirim bulunamadı' })
  return { ok: true }
})

// ---------- Sağlık ----------
let sqlHealth = { checkedAt: 0, ok: false, latencyMs: null as number | null, lastWriteAt: null as number | null, error: null as string | null }
async function checkSql(): Promise<typeof sqlHealth> {
  if (Date.now() - sqlHealth.checkedAt < 4000) return sqlHealth
  const t0 = Date.now()
  try {
    const p = await sqlPool()
    const r = await p.request().query<{ t: Date | null }>('SELECT MAX(SampleTimeUtc) AS t FROM dbo.ProductionCounters')
    sqlHealth = { checkedAt: Date.now(), ok: true, latencyMs: Date.now() - t0, lastWriteAt: r.recordset[0].t?.getTime() ?? null, error: null }
  } catch (e) {
    pool = null
    sqlHealth = { checkedAt: Date.now(), ok: false, latencyMs: null, lastWriteAt: sqlHealth.lastWriteAt, error: (e as Error).message.split('\n')[0] }
  }
  return sqlHealth
}

app.get('/api/health', async () => {
  const now = Date.now()
  const wm = kvGet<number>(db, 'watermark')
  const col = kvGet<CollectorHealth>(db, 'collectorHealth')
  const s = await checkSql()
  let sqliteBytes = 0
  try {
    sqliteBytes = statSync(env.sqlitePath).size + (statSync(`${env.sqlitePath}-wal`, { throwIfNoEntry: false })?.size ?? 0)
  } catch {
    /* dosya yok */
  }
  const buckets = (db.prepare('SELECT COUNT(*) AS n FROM bucket').get() as { n: number }).n
  return {
    now,
    datasetId: kvGet<string>(db, 'datasetId'),
    watermark: wm,
    simulator: { lastWriteAt: s.lastWriteAt, lagSec: s.lastWriteAt ? (now - s.lastWriteAt) / 1000 : null },
    sqlServer: { ok: s.ok, latencyMs: s.latencyMs, error: s.error },
    collector: col ? { ...col, sinceSuccessSec: col.lastSuccessAt ? (now - col.lastSuccessAt) / 1000 : null } : null,
    sqlite: { bytes: sqliteBytes, buckets, lagSec: wm ? (now - wm) / 1000 : null },
  }
})

// ---------- Ham SQL Server tabloları ----------
app.get('/api/sql/tables', async (_req, reply) => {
  try {
    const p = await sqlPool()
    const counts = (
      await p.request().query(`
        SELECT t.name, SUM(s.row_count) AS rows
        FROM sys.tables t JOIN sys.dm_db_partition_stats s ON s.object_id = t.object_id AND s.index_id IN (0, 1)
        GROUP BY t.name`)
    ).recordset as { name: string; rows: number }[]
    const out = []
    for (const [name, def] of Object.entries(SQL_TABLES)) {
      let last: number | null = null
      if (def.time) {
        const r = await p.request().query(`SELECT MAX(${def.time}) AS t FROM dbo.${name}`)
        last = (r.recordset[0].t as Date | null)?.getTime() ?? null
      }
      out.push({ name, kind: def.kind, how: def.how, rows: Number(counts.find((c) => c.name === name)?.rows ?? 0), lastTime: last })
    }
    return { tables: out }
  } catch (e) {
    pool = null
    return reply.code(503).send({ error: (e as Error).message.split('\n')[0] })
  }
})

app.get<{ Params: { name: string }; Querystring: { limit?: string } }>('/api/sql/table/:name', async (req, reply) => {
  const def = SQL_TABLES[req.params.name]
  if (!def) return reply.code(404).send({ error: 'Tablo bulunamadı' })
  const limit = Math.max(1, Math.min(1000, Number(req.query.limit ?? 200)))
  try {
    const p = await sqlPool()
    const r = await p.request().query(`SELECT TOP (${limit}) * FROM dbo.${req.params.name} ORDER BY ${def.key} DESC`)
    const columns = Object.keys(r.recordset.columns)
    return { name: req.params.name, columns, rows: r.recordset.map((row: Record<string, unknown>) => columns.map((c) => (row[c] instanceof Date ? (row[c] as Date).toISOString() : row[c]))) }
  } catch (e) {
    pool = null
    return reply.code(503).send({ error: (e as Error).message.split('\n')[0] })
  }
})

await app.listen({ port: env.apiPort, host: '127.0.0.1' })
say(`dinliyor: http://localhost:${env.apiPort}`)

const stop = async () => {
  await app.close()
  await pool?.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
