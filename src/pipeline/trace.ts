import type { MrbDisposition, MrbRow, NcrRow, OpEventRow } from './rows'

/**
 * İzlenebilirlik (AS9100) ve MRB'nin iç modeli. MES'in başlangıç / bitiş olay kayıtları tek
 * operasyon kaydına birleştirilir; uygunsuzluk raporlarına MRB kararı eklenir.
 * Collector aynı birleştirmeyi SQLite'ta yapar; web demo ve testler bu sınıfı kullanır.
 */

export interface PartOp {
  serial: string
  partNumber: string
  op: string
  machineId: string
  operatorId: string | null
  start: number
  /** Sürüyorsa null */
  end: number | null
  result: 'OK' | 'NOK' | null
  heatNo: string | null
  batchNo: string | null
}

export interface Ncr {
  ncrNo: string
  serial: string
  partNumber: string
  machineId: string
  op: string
  t: number
  defectType: string
  disposition: MrbDisposition | null
  dispositionAt: number | null
}

/** Fırın çevrimi reçete uyumu (AMS 2750) — collector fırın sıcaklığından çıkarır */
export interface FurnaceCycle {
  machineId: string
  /** Tutmanın başlangıcı / bitişi */
  start: number
  end: number
  holdMin: number
  /** Set değerinden sapma (°C): en düşük, en yüksek */
  minDev: number
  maxDev: number
  setpointC: number
  requiredHoldMin: number
  toleranceC: number
  furnaceClass: number
  ok: boolean
}

export const DISPOSITION_LABEL: Record<MrbDisposition, string> = {
  'use-as-is': 'Olduğu gibi kullan (sapma onayı)',
  rework: 'Yeniden işle',
  scrap: 'Hurda',
}

export class TraceStore {
  private ops = new Map<string, PartOp>()
  private open = new Map<string, string>()
  private ncrMap = new Map<string, Ncr>()
  private opList: PartOp[] | null = []
  private ncrList: Ncr[] | null = []

  addOpEvent(e: OpEventRow): void {
    const k = `${e.serialNo}|${e.machineId}`
    if (e.eventType === 'START') {
      const key = `${k}|${e.t}`
      this.ops.set(key, { serial: e.serialNo, partNumber: e.partNumber, op: e.operationNo, machineId: e.machineId, operatorId: e.operatorId, start: e.t, end: null, result: null, heatNo: e.heatNo, batchNo: e.batchNo })
      this.open.set(k, key)
    } else {
      const key = this.open.get(k)
      const op = key ? this.ops.get(key) : undefined
      if (!op) return
      op.end = e.t
      op.result = e.result
      if (e.operatorId) op.operatorId = e.operatorId
      this.open.delete(k)
    }
    this.opList = null
  }

  addNcr(n: NcrRow): void {
    this.ncrMap.set(n.ncrNo, { ncrNo: n.ncrNo, serial: n.serialNo, partNumber: n.partNumber, machineId: n.machineId, op: n.operationNo, t: n.t, defectType: n.defectType, disposition: null, dispositionAt: null })
    this.ncrList = null
  }

  addMrb(d: MrbRow): void {
    const n = this.ncrMap.get(d.ncrNo)
    if (!n) return
    n.disposition = d.disposition
    n.dispositionAt = d.t
    this.ncrList = null
  }

  /** Eski kayıtları atar */
  prune(before: number): void {
    for (const [k, o] of this.ops) if (o.end !== null && o.end < before) this.ops.delete(k)
    for (const [k, n] of this.ncrMap) if (n.t < before && n.disposition) this.ncrMap.delete(k)
    this.opList = null
    this.ncrList = null
  }

  partOps(): PartOp[] {
    if (!this.opList) this.opList = [...this.ops.values()].sort((a, b) => a.start - b.start)
    return this.opList
  }

  ncrs(): Ncr[] {
    if (!this.ncrList) this.ncrList = [...this.ncrMap.values()].sort((a, b) => b.t - a.t)
    return this.ncrList
  }
}
