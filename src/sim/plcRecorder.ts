import { BUCKET_MS } from '@/lib/types'
import type { Machine } from '@/lib/types'
import { dayStartOf } from '@/lib/kpi'
import { sqlStatusFromState } from '@/pipeline/rows'
import type { CounterRow, EventRow, ProcessRow, QualityRow } from '@/pipeline/rows'
import type { RawSample } from './machineSim'

export interface RecordedRows {
  events: EventRow[]
  counters: CounterRow[]
  process: ProcessRow[]
  quality: QualityRow[]
}

export const emptyRows = (): RecordedRows => ({ events: [], counters: [], process: [], quality: [] })

/**
 * Bir makinenin PLC'si gibi davranır: ham simülasyon örneklerini SQL satırlarına çevirir.
 * - durum yalnızca değişince olay satırı
 * - sayaçlar kümülatif, üretim günü başında (06:00) sıfırlanır
 */
export class PlcRecorder {
  private readonly machine: Machine
  private lastStatus = -1
  private lastReason = -1
  private total = 0
  private reject = 0
  private day = -1
  private subgroup = 0
  private baselineWritten = false

  constructor(machine: Machine) {
    this.machine = machine
  }

  record(s: RawSample, out: RecordedRows, write = true): void {
    const sampleT = s.t + BUCKET_MS
    const day = dayStartOf(s.t)
    if (day !== this.day) {
      this.day = day
      this.total = 0
      this.reject = 0
    }
    if (!this.baselineWritten) {
      this.baselineWritten = true
      if (write) out.counters.push({ machineId: s.machineId, sampleT: s.t, totalCount: this.total, rejectCount: this.reject })
    }
    if (s.status !== this.lastStatus || s.reasonId !== this.lastReason) {
      this.lastStatus = s.status
      this.lastReason = s.reasonId
      if (write) out.events.push({ machineId: s.machineId, t: s.t, status: sqlStatusFromState(s.status), reasonCode: s.reasonId || null })
    }
    this.total += s.produced
    this.reject += s.rejects
    if (s.quality) this.subgroup++
    if (!write) return
    out.counters.push({ machineId: s.machineId, sampleT, totalCount: this.total, rejectCount: this.reject })
    out.process.push({
      machineId: s.machineId,
      sampleT,
      cycleTimeMs: s.cycleTimeMs,
      temperatureC: s.temperatureC,
      vibrationMmS: s.vibrationMmS,
      feedPct: s.feedPct,
      toolCycleCount: s.toolCycles,
      materialLot: s.materialLot,
    })
    if (s.quality) {
      const spec = this.machine.spec
      s.quality.forEach((value, k) =>
        out.quality.push({
          machineId: s.machineId,
          sampleT,
          characteristic: spec.characteristic,
          subgroupNo: this.subgroup,
          sampleIdx: k + 1,
          value,
          nominal: spec.nominal,
          lsl: spec.lsl,
          usl: spec.usl,
        }),
      )
    }
  }
}
