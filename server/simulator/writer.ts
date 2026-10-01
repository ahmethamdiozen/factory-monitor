import type { ConnectionPool } from 'mssql'
import type { RecordedRows } from '@/sim/plcRecorder'
import { sql } from '../shared/mssql'

/** Kaydedilen satırları tek işlemde (transaction) toplu yazar — collector yarım tur görmez. */
export async function writeRows(pool: ConnectionPool, rows: RecordedRows): Promise<number> {
  const tables: sql.Table[] = []
  if (rows.events.length) {
    const t = new sql.Table('dbo.MachineEvents')
    t.create = false
    t.columns.add('MachineId', sql.VarChar(10), { nullable: false })
    t.columns.add('EventTimeUtc', sql.DateTime2(3), { nullable: false })
    t.columns.add('StatusCode', sql.TinyInt, { nullable: false })
    t.columns.add('ReasonCode', sql.Int, { nullable: true })
    for (const e of rows.events) t.rows.add(e.machineId, new Date(e.t), e.status, e.reasonCode)
    tables.push(t)
  }
  if (rows.process.length) {
    const t = new sql.Table('dbo.ProcessValues')
    t.create = false
    t.columns.add('MachineId', sql.VarChar(10), { nullable: false })
    t.columns.add('SampleTimeUtc', sql.DateTime2(3), { nullable: false })
    t.columns.add('CycleTimeMs', sql.Int, { nullable: false })
    t.columns.add('TemperatureC', sql.Decimal(5, 1), { nullable: false })
    t.columns.add('VibrationMmS', sql.Decimal(6, 2), { nullable: false })
    t.columns.add('FeedPct', sql.Decimal(5, 1), { nullable: false })
    t.columns.add('ToolCycleCount', sql.Int, { nullable: false })
    t.columns.add('MaterialLot', sql.VarChar(20), { nullable: false })
    t.columns.add('MotorCurrentA', sql.Decimal(6, 1), { nullable: true })
    for (const p of rows.process) t.rows.add(p.machineId, new Date(p.sampleT), p.cycleTimeMs, p.temperatureC, p.vibrationMmS, p.feedPct, p.toolCycleCount, p.materialLot, p.motorCurrentA)
    tables.push(t)
  }
  if (rows.quality.length) {
    const t = new sql.Table('dbo.QualitySamples')
    t.create = false
    t.columns.add('MachineId', sql.VarChar(10), { nullable: false })
    t.columns.add('SampleTimeUtc', sql.DateTime2(3), { nullable: false })
    t.columns.add('Characteristic', sql.NVarChar(60), { nullable: false })
    t.columns.add('SubgroupNo', sql.Int, { nullable: false })
    t.columns.add('SampleIdx', sql.TinyInt, { nullable: false })
    t.columns.add('Value', sql.Decimal(12, 4), { nullable: false })
    t.columns.add('Nominal', sql.Decimal(12, 4), { nullable: false })
    t.columns.add('Lsl', sql.Decimal(12, 4), { nullable: false })
    t.columns.add('Usl', sql.Decimal(12, 4), { nullable: false })
    for (const q of rows.quality) t.rows.add(q.machineId, new Date(q.sampleT), q.characteristic, q.subgroupNo, q.sampleIdx, q.value, q.nominal, q.lsl, q.usl)
    tables.push(t)
  }
  if (rows.counters.length) {
    const t = new sql.Table('dbo.ProductionCounters')
    t.create = false
    t.columns.add('MachineId', sql.VarChar(10), { nullable: false })
    t.columns.add('SampleTimeUtc', sql.DateTime2(3), { nullable: false })
    t.columns.add('TotalCount', sql.Int, { nullable: false })
    t.columns.add('RejectCount', sql.Int, { nullable: false })
    for (const c of rows.counters) t.rows.add(c.machineId, new Date(c.sampleT), c.totalCount, c.rejectCount)
    tables.push(t)
  }
  if (!tables.length) return 0
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    for (const t of tables) await new sql.Request(tx).bulk(t)
    await tx.commit()
  } catch (e) {
    await tx.rollback()
    throw e
  }
  return tables.reduce((a, t) => a + t.rows.length, 0)
}
