import { DAY_START_HOUR, DOWNTIME_REASONS, EMPLOYEE_NO, LINES, MACHINES, PEOPLE, SHIFTS } from '@/sim/factoryDef'
import { toolLifeCycles } from '@/sim/machineSim'
import { sql } from '../shared/mssql'
import type { ConnectionPool } from 'mssql'

/** Yerel tarihin (Y-A-G) UTC gece yarısı karşılığı — SQL `date` kolonu için. */
export function sqlDate(t: number): Date {
  const d = new Date(t)
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

/** Üretim günü (06:00 başlar) tarihi */
export function workDateOf(t: number): Date {
  const d = new Date(t)
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1)
  return sqlDate(d.getTime())
}

const DAY = 24 * 3600 * 1000

export async function seedReference(pool: ConnectionPool, now: number): Promise<void> {
  const has = await pool.request().query<{ n: number }>('SELECT COUNT(*) AS n FROM dbo.Lines')
  if (has.recordset[0].n > 0) return

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const q = () => new sql.Request(tx)
    for (const l of LINES) await q().input('id', l.id).input('n', l.name).query('INSERT dbo.Lines VALUES (@id, @n)')
    for (const m of MACHINES) {
      await q()
        .input('id', m.id).input('code', m.code).input('name', m.name).input('model', m.model).input('line', m.lineId)
        .input('type', m.type).input('pn', m.partNumber).input('pname', m.product).input('op', m.operation).input('batch', m.batchSize)
        .input('cycle', Math.round((m.batchSize * 1000) / m.idealRate)).input('target', m.dailyTarget).input('tool', toolLifeCycles(m))
        .input('ch', m.spec.characteristic).input('unit', m.spec.unit)
        .input('nom', sql.Decimal(12, 4), m.spec.nominal).input('lsl', sql.Decimal(12, 4), m.spec.lsl)
        .input('usl', sql.Decimal(12, 4), m.spec.usl).input('sd', sql.Decimal(12, 4), m.spec.sigma)
        .query('INSERT dbo.Machines VALUES (@id,@code,@name,@model,@line,@type,@pn,@pname,@op,@batch,@cycle,@target,@tool,@ch,@unit,@nom,@lsl,@usl,@sd)')
      await q().input('wo', m.orderNo).input('m', m.id).input('p', m.product).input('t', m.dailyTarget * 5)
        .query("INSERT dbo.WorkOrders VALUES (@wo, @m, @p, @t, 'Released')")
    }
    for (const r of DOWNTIME_REASONS.filter((r) => r.id > 0)) {
      await q().input('c', r.id).input('d', r.label).input('cat', r.category).input('p', sql.Bit, r.planned)
        .query('INSERT dbo.DowntimeReasons VALUES (@c, @d, @cat, @p)')
    }
    for (const p of PEOPLE) {
      await q().input('id', EMPLOYEE_NO[p.id]).input('n', p.name).input('r', p.role)
        .input('h', sql.Date, sqlDate(now - p.experienceYears * 365.25 * DAY))
        .query('INSERT dbo.Employees VALUES (@id, @n, @r, @h)')
    }
    for (const s of SHIFTS) {
      const hh = (h: number) => `${String(h).padStart(2, '0')}:00:00`
      await q().input('c', s.id).input('n', s.name).input('s', hh(s.startHour)).input('e', hh(s.endHour))
        .query('INSERT dbo.ShiftDefinitions VALUES (@c, @n, @s, @e)')
    }
    await tx.commit()
  } catch (e) {
    await tx.rollback()
    throw e
  }
}

/** Vardiya atamalarını [from, to] üretim günleri için tamamlar (eksik günleri ekler). */
export async function ensureAssignments(pool: ConnectionPool, from: number, to: number): Promise<number> {
  const r = await pool.request().query<{ d: Date | null }>('SELECT MAX(WorkDate) AS d FROM dbo.ShiftAssignments')
  const last = r.recordset[0].d?.getTime() ?? 0
  const table = new sql.Table('dbo.ShiftAssignments')
  table.create = false
  table.columns.add('WorkDate', sql.Date, { nullable: false })
  table.columns.add('ShiftCode', sql.Char(1), { nullable: false })
  table.columns.add('LineId', sql.VarChar(10), { nullable: false })
  table.columns.add('MachineId', sql.VarChar(10), { nullable: true })
  table.columns.add('EmployeeId', sql.VarChar(10), { nullable: false })
  table.columns.add('Role', sql.VarChar(20), { nullable: false })
  for (let t = from; t <= to; t += DAY) {
    const wd = workDateOf(t)
    if (wd.getTime() <= last) continue
    for (const p of PEOPLE) table.rows.add(wd, p.shiftId, p.lineId, p.machineId ?? null, EMPLOYEE_NO[p.id], p.role)
  }
  if (table.rows.length) await pool.request().bulk(table)
  return table.rows.length
}

/** Şema sürümü: tablo yapısı değişince artırılır → simülatör tabloları düşürüp yeniden kurar */
export const SCHEMA_VERSION = 2

const ALL_TABLES = [
  'ShiftAssignments', 'WorkOrders', 'MachineEvents', 'ProductionCounters', 'ProcessValues', 'ProcessTags', 'MachineTags',
  'QualitySamples', 'PartOperations', 'Employees', 'Machines', 'Lines', 'DowntimeReasons', 'ShiftDefinitions', 'SchemaInfo',
]

export async function schemaVersion(pool: ConnectionPool): Promise<number | null> {
  // Tablo yokken alt sorgu derlenemediği için önce varlığı ayrı sorulur
  const e = await pool.request().query<{ id: number | null }>("SELECT OBJECT_ID('dbo.SchemaInfo') AS id")
  if (e.recordset[0].id === null) return null
  const r = await pool.request().query<{ v: number | null }>('SELECT MAX(Version) AS v FROM dbo.SchemaInfo')
  return r.recordset[0].v
}

export async function dropAll(pool: ConnectionPool): Promise<void> {
  for (const t of ALL_TABLES) await pool.request().batch(`DROP TABLE IF EXISTS dbo.${t}`)
}

export async function setSchemaVersion(pool: ConnectionPool): Promise<void> {
  await pool.request().batch(`DELETE dbo.SchemaInfo; INSERT dbo.SchemaInfo VALUES (${SCHEMA_VERSION})`)
}

export async function wipe(pool: ConnectionPool): Promise<void> {
  await pool.request().batch(`
    IF OBJECT_ID('dbo.MachineEvents') IS NOT NULL TRUNCATE TABLE dbo.MachineEvents;
    IF OBJECT_ID('dbo.ProductionCounters') IS NOT NULL TRUNCATE TABLE dbo.ProductionCounters;
    IF OBJECT_ID('dbo.ProcessValues') IS NOT NULL TRUNCATE TABLE dbo.ProcessValues;
    IF OBJECT_ID('dbo.QualitySamples') IS NOT NULL TRUNCATE TABLE dbo.QualitySamples;
    IF OBJECT_ID('dbo.ShiftAssignments') IS NOT NULL TRUNCATE TABLE dbo.ShiftAssignments;
    IF OBJECT_ID('dbo.WorkOrders') IS NOT NULL DELETE dbo.WorkOrders;
    IF OBJECT_ID('dbo.Employees') IS NOT NULL DELETE dbo.Employees;
    IF OBJECT_ID('dbo.Machines') IS NOT NULL DELETE dbo.Machines;
    IF OBJECT_ID('dbo.Lines') IS NOT NULL DELETE dbo.Lines;
    IF OBJECT_ID('dbo.DowntimeReasons') IS NOT NULL DELETE dbo.DowntimeReasons;
    IF OBJECT_ID('dbo.ShiftDefinitions') IS NOT NULL DELETE dbo.ShiftDefinitions;
  `)
}
