import type { ConnStatus, LiveSource } from '@/data/DataSource'
import { createSeries, putBuckets } from '@/data/series'
import type { BucketRow } from '@/data/series'
import { SQL_TABLES } from '@/data/sqlTables'
import type { SqlTableData, SqlTableInfo } from '@/data/sqlTables'
import { experienceFromDefs, machineInfoOf, notifyMachinesFromDefs, operatorNoFromDefs, tagsBySample } from '@/pipeline/localPipeline'
import { SerialRouter } from '@/sim/serialRouter'
import { TraceStore } from '@/pipeline/trace'
import type { FurnaceCycle, Ncr, PartOp } from '@/pipeline/trace'
import { SignalAggregator } from '@/data/signals'
import type { SignalPoint } from '@/data/signals'
import { TAGS, tagDefsOf } from '@/sim/tags'
import { MachineTransformer, emptyOutput } from '@/pipeline/transform'
import type { SlowOut, StopOut, TransformOutput } from '@/pipeline/transform'
import { DAY_START_HOUR, DOWNTIME_REASONS, EMPLOYEE_NO, FURNACE_RECIPES, LINES, MACHINES, PEOPLE, SHIFTS } from '@/sim/factoryDef'
import { MachineSim, alignBucket, toolLifeCycles } from '@/sim/machineSim'
import { PlcRecorder, emptyRows } from '@/sim/plcRecorder'
import type { RecordedRows } from '@/sim/plcRecorder'
import { BUCKET_MS } from '@/lib/types'
import type { MachineSeries, SlowEvent, SpcPoint, StopEvent } from '@/lib/types'
import { PredictiveSession } from '@/ml/session'
import type { MaintNotification, NotificationStatus, RiskPoint } from '@/ml/types'

/**
 * DEMO MODU — kurulum gerektirmeyen web sürümü (GitHub Pages).
 * Gerçek sistemde ayrı süreçlerde çalışan zincirin aynısı tarayıcının içinde çalışır:
 *   MachineSim (makineler) → PlcRecorder (SQL Server'a yazılacak ham satırlar) → MachineTransformer (collector'ın anlamlandırması)
 * SQL Server, collector süreci, SQLite ve API yoktur; ham satırlar bellekte tutulur ve SQL Veri
 * ekranında aynı tablo yapısıyla gösterilir.
 */

const DAY = 24 * 3600 * 1000
/** Geçmiş: öngörücü bakımın 24 saatlik pencereleri için 48 saat */
const HISTORY = 2 * DAY
const RAW_KEEP = 400

interface Unit {
  sim: MachineSim
  rec: PlcRecorder
  tr: MachineTransformer
  signals: SignalAggregator
}

type RawRow = Record<string, unknown>

const iso = (t: number) => new Date(t).toISOString()
const dateOnly = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export class DemoDataSource implements LiveSource {
  readonly kind = 'mock' as const
  ready = false
  readonly startT: number
  private readonly t0: number
  private i = 0
  private units = new Map<string, Unit>()
  private series = new Map<string, MachineSeries>()
  private stops = new Map<string, StopEvent>()
  private slows = new Map<string, SlowEvent>()
  private stopList: StopEvent[] = []
  private slowList: SlowEvent[] = []
  private spcByMachine = new Map<string, SpcPoint[]>()
  private nextEventId = 1
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  /** "SQL Server" tablolarının bellek kopyası: son satırlar + toplam sayaç */
  private raw: Record<string, { rows: RawRow[]; total: number; lastTime: number | null }> = {}
  private readonly reference: Record<string, RawRow[]>
  private readonly predictive: PredictiveSession
  private readonly router: SerialRouter
  private readonly trace = new TraceStore()
  private cycles: FurnaceCycle[] = []

  constructor() {
    this.t0 = alignBucket(Date.now())
    this.startT = this.t0 - HISTORY
    MACHINES.forEach((m, idx) => {
      this.units.set(m.id, {
        sim: new MachineSim(m, idx, this.t0),
        rec: new PlcRecorder(m),
        tr: new MachineTransformer(machineInfoOf(m, idx), { experienceAt: experienceFromDefs }),
        signals: new SignalAggregator(m.type, HISTORY),
      })
      this.series.set(m.id, createSeries(this.startT, (HISTORY + DAY) / BUCKET_MS))
    })
    for (const t of ['MachineEvents', 'ProductionCounters', 'ProcessValues', 'ProcessTags', 'QualitySamples', 'OperationEvents', 'Nonconformances', 'MrbDecisions']) this.raw[t] = { rows: [], total: 0, lastTime: null }
    this.router = new SerialRouter(MACHINES, this.t0, { operatorAt: operatorNoFromDefs })
    const init = emptyRows()
    this.router.init(this.startT, init)
    this.keepTrace(init)
    this.reference = this.buildReference()
    this.predictive = new PredictiveSession(notifyMachinesFromDefs())
  }

  start(): void {
    if (this.timer) return
    // Önce ekran "yükleniyor" durumunu çizsin, sonra son 24 saat üretilsin
    setTimeout(() => {
      this.advance(Date.now())
      this.ready = true
      this.emit()
      this.timer = setInterval(() => {
        if (this.advance(Date.now())) this.emit()
      }, 1000)
    }, 50)
  }

  status(): ConnStatus {
    return { state: this.ready ? 'live' : 'connecting', lastSuccessAt: Date.now(), dataUntil: this.ready ? this.now() : null, error: null }
  }

  /** Bitişi `until` anına kadar olan tüm 10 sn'lik dilimleri üretir. Yeni dilim varsa true. */
  private advance(until: number): boolean {
    const perMachine = new Map<string, BucketRow[]>()
    const out: TransformOutput = emptyOutput()
    let any = false
    while (this.startT + (this.i + 1) * BUCKET_MS <= until) {
      const t = this.startT + this.i * BUCKET_MS
      const routed = emptyRows()
      for (const [id, u] of this.units) {
        const rows = emptyRows()
        const raw = u.sim.step(this.i, t)
        u.rec.record(raw, rows)
        this.router.setLot(id, raw.materialLot)
        this.router.complete(id, t + BUCKET_MS, raw.produced, raw.rejects, routed)
        // Ham satırlar sadece son birkaç dakika için nesneye çevrilir (SQL Veri ekranı son satırları gösterir)
        this.keepRaw(rows, t > until - 10 * 60 * 1000)
        const mo = emptyOutput()
        for (const e of rows.events) u.tr.addEvent(e)
        const tags = tagsBySample(rows.tags)
        for (const c of rows.counters) u.tr.addCounter(c, rows.process.find((p) => p.sampleT === c.sampleT), mo, tags.get(c.sampleT))
        for (const q of rows.quality) u.tr.addQuality(q, mo)
        const list = perMachine.get(id) ?? []
        for (const b of mo.buckets) {
          list.push(b)
          u.signals.add(b)
          this.predictive.add(id, b)
        }
        perMachine.set(id, list)
        out.stops.push(...mo.stops)
        out.slows.push(...mo.slows)
        out.spc.push(...mo.spc)
        out.cycles.push(...mo.cycles)
      }
      this.router.tick(t + BUCKET_MS, routed)
      this.keepTrace(routed)
      this.i++
      any = true
    }
    if (!any) return false
    for (const [id, rows] of perMachine) {
      const s = putBuckets(this.series.get(id)!, rows)
      this.series.set(id, s)
    }
    for (const s of this.series.values()) s.length = this.i
    this.upsertStops(out.stops)
    this.upsertSlows(out.slows)
    if (out.cycles.length) this.cycles = [...this.cycles, ...out.cycles]
    for (const g of out.spc) {
      const list = this.spcByMachine.get(g.machineId) ?? []
      list.push({ t: g.t, mean: g.mean, range: g.range })
      this.spcByMachine.set(g.machineId, list)
    }
    return true
  }

  private upsertStops(list: StopOut[]): void {
    if (!list.length) return
    for (const e of list) {
      const key = `${e.machineId}|${e.start}`
      const prev = this.stops.get(key)
      this.stops.set(key, { id: prev?.id ?? this.nextEventId++, machineId: e.machineId, state: e.state as StopEvent['state'], reasonId: e.reasonId, start: e.start, end: e.end })
    }
    this.stopList = [...this.stops.values()].sort((a, b) => a.start - b.start)
  }

  private upsertSlows(list: SlowOut[]): void {
    if (!list.length) return
    for (const e of list) {
      const key = `${e.machineId}|${e.start}`
      const prev = this.slows.get(key)
      this.slows.set(key, { id: prev?.id ?? this.nextEventId++, machineId: e.machineId, reasonId: e.reasonId, start: e.start, end: e.end, minSpeed: e.minSpeed })
    }
    this.slowList = [...this.slows.values()].sort((a, b) => a.start - b.start)
  }

  // ---------- "SQL Server" tablolarının bellek kopyası (SQL Veri ekranı için) ----------

  /** Satır sayacını ilerletir; `row` verilirse son satırlar listesine ekler */
  private push(table: string, t: number, row?: (id: number) => RawRow): void {
    const r = this.raw[table]
    r.total++
    r.lastTime = t
    if (!row) return
    r.rows.push(row(r.total))
    if (r.rows.length > RAW_KEEP * 2) r.rows.splice(0, r.rows.length - RAW_KEEP)
  }

  private keepRaw(rows: RecordedRows, materialize: boolean): void {
    const m = materialize
    for (const e of rows.events) this.push('MachineEvents', e.t, (id) => ({ EventId: id, MachineId: e.machineId, EventTimeUtc: iso(e.t), StatusCode: e.status, ReasonCode: e.reasonCode }))
    for (const c of rows.counters) this.push('ProductionCounters', c.sampleT, m ? (id) => ({ Id: id, MachineId: c.machineId, SampleTimeUtc: iso(c.sampleT), TotalCount: c.totalCount, RejectCount: c.rejectCount }) : undefined)
    for (const p of rows.process)
      this.push('ProcessValues', p.sampleT, m ? (id) => ({ Id: id, MachineId: p.machineId, SampleTimeUtc: iso(p.sampleT), CycleTimeMs: p.cycleTimeMs, ToolCycleCount: p.toolCycleCount, MaterialLot: p.materialLot }) : undefined)
    for (const g of rows.tags) this.push('ProcessTags', g.sampleT, m ? (id) => ({ Id: id, MachineId: g.machineId, SampleTimeUtc: iso(g.sampleT), Tag: g.tag, Value: g.value }) : undefined)
    for (const q of rows.quality)
      this.push('QualitySamples', q.sampleT, (id) => ({
          Id: id,
          MachineId: q.machineId,
          SampleTimeUtc: iso(q.sampleT),
          Characteristic: q.characteristic,
          SubgroupNo: q.subgroupNo,
          SampleIdx: q.sampleIdx,
          Value: q.value,
          Nominal: q.nominal,
          Lsl: q.lsl,
          Usl: q.usl,
        }))
  }

  /** MES satırları: hem "SQL Server" tablolarına hem izlenebilirlik deposuna */
  private keepTrace(rows: { opEvents: RecordedRows['opEvents']; ncrs: RecordedRows['ncrs']; mrb: RecordedRows['mrb'] }): void {
    for (const e of rows.opEvents) {
      this.trace.addOpEvent(e)
      this.push('OperationEvents', e.t, (id) => ({ Id: id, SerialNo: e.serialNo, PartNumber: e.partNumber, OperationNo: e.operationNo, MachineId: e.machineId, OperatorId: e.operatorId, EventTimeUtc: iso(e.t), EventType: e.eventType, Result: e.result, HeatNo: e.heatNo, BatchNo: e.batchNo }))
    }
    for (const n of rows.ncrs) {
      this.trace.addNcr(n)
      this.push('Nonconformances', n.t, (id) => ({ Id: id, NcrNo: n.ncrNo, SerialNo: n.serialNo, PartNumber: n.partNumber, MachineId: n.machineId, OperationNo: n.operationNo, DetectedUtc: iso(n.t), DefectType: n.defectType }))
    }
    for (const d of rows.mrb) {
      this.trace.addMrb(d)
      this.push('MrbDecisions', d.t, (id) => ({ Id: id, NcrNo: d.ncrNo, DecisionUtc: iso(d.t), Disposition: d.disposition }))
    }
  }

  private buildReference(): Record<string, RawRow[]> {
    const workDate = (t: number) => {
      const d = new Date(t)
      if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1)
      return dateOnly(d.getTime())
    }
    const assignments: RawRow[] = []
    let aid = 1
    for (const off of [-1, 0, 1]) {
      const wd = workDate(this.t0 + off * DAY)
      for (const p of PEOPLE) assignments.push({ AssignmentId: aid++, WorkDate: wd, ShiftCode: p.shiftId, LineId: p.lineId, MachineId: p.machineId ?? null, EmployeeId: EMPLOYEE_NO[p.id], Role: p.role })
    }
    const hh = (h: number) => `${String(h).padStart(2, '0')}:00:00`
    return {
      Machines: MACHINES.map((m) => ({
        MachineId: m.id,
        MachineCode: m.code,
        MachineName: m.name,
        Model: m.model,
        LineId: m.lineId,
        MachineType: m.type,
        PartNumber: m.partNumber,
        PartName: m.product,
        OperationNo: m.operation,
        BatchSize: m.batchSize,
        IdealCycleTimeMs: Math.round((m.batchSize * 1000) / m.idealRate),
        DailyTarget: m.dailyTarget,
        ToolLifeCycles: toolLifeCycles(m),
        QualityCharacteristic: m.spec.characteristic,
        QualityUnit: m.spec.unit,
        Nominal: m.spec.nominal,
        Lsl: m.spec.lsl,
        Usl: m.spec.usl,
        ProcessStdDev: m.spec.sigma,
      })),
      MachineTags: MACHINES.flatMap((m, idx) =>
        tagDefsOf(m, idx).map((d, k) => ({ MachineId: m.id, Tag: d.tag, Channel: d.channel, RelativeTo: d.relativeTo, Unit: TAGS[m.type][k].unit, Description: TAGS[m.type][k].description, Baseline: Number(d.baseline.toPrecision(4)) })),
      ),
      Lines: LINES.map((l) => ({ LineId: l.id, LineName: l.name })),
      DowntimeReasons: DOWNTIME_REASONS.filter((r) => r.id > 0).map((r) => ({ ReasonCode: r.id, Description: r.label, Category: r.category, IsPlanned: r.planned })),
      Employees: PEOPLE.map((p) => ({ EmployeeId: EMPLOYEE_NO[p.id], FullName: p.name, Role: p.role, HireDate: dateOnly(this.t0 - p.experienceYears * 365.25 * DAY) })),
      ShiftAssignments: assignments,
      ShiftDefinitions: SHIFTS.map((s) => ({ ShiftCode: s.id, ShiftName: s.name, StartTime: hh(s.startHour), EndTime: hh(s.endHour) })),
      FurnaceRecipes: FURNACE_RECIPES.map((r) => ({ MachineId: r.machineId, OperationNo: r.operation, RecipeName: r.name, SetpointC: r.setpointC, HoldMin: r.holdMin, ToleranceC: r.toleranceC, FurnaceClass: r.furnaceClass })),
      WorkOrders: MACHINES.map((m) => ({ WorkOrderNo: m.orderNo, MachineId: m.id, ProductName: m.product, TargetQty: m.dailyTarget * 5, Status: 'Released' })),
    }
  }

  sqlTables(): SqlTableInfo[] {
    return Object.entries(SQL_TABLES).map(([name, def]) => {
      const live = this.raw[name]
      return { name, kind: def.kind, how: def.how, rows: live ? live.total : (this.reference[name]?.length ?? 0), lastTime: live ? live.lastTime : null }
    })
  }

  sqlTable(name: string, limit = 200): SqlTableData {
    const rows = this.raw[name] ? this.raw[name].rows.slice(-limit).reverse() : (this.reference[name] ?? []).slice(0, limit)
    const columns = rows.length ? Object.keys(rows[0]) : []
    return { name, columns, rows: rows.map((r) => columns.map((c) => r[c])) }
  }

  // ---------- DataSource ----------

  private emit(): void {
    this.listeners.forEach((fn) => fn())
  }
  now(): number {
    return this.startT + this.i * BUCKET_MS
  }
  machineSeries(id: string): MachineSeries {
    return this.series.get(id) ?? createSeries(this.startT, 1)
  }
  stopEvents(): StopEvent[] {
    return this.stopList
  }
  slowEvents(): SlowEvent[] {
    return this.slowList
  }
  partOps(): PartOp[] {
    return this.trace.partOps()
  }
  ncrs(): Ncr[] {
    return this.trace.ncrs()
  }
  furnaceCycles(): FurnaceCycle[] {
    return this.cycles
  }
  spc(id: string): SpcPoint[] {
    return this.spcByMachine.get(id) ?? []
  }
  signals(id: string): SignalPoint[] {
    return this.units.get(id)?.signals.list() ?? []
  }
  riskSeries(id: string): RiskPoint[] {
    return this.predictive.riskSeries(id)
  }
  notifications(): MaintNotification[] {
    return this.predictive.notifications()
  }
  setNotificationStatus(id: string, status: NotificationStatus): void {
    this.predictive.setStatus(id, status, Date.now())
    this.emit()
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
