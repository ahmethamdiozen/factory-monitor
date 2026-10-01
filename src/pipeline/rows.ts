/**
 * "Fabrikanın SQL Server'ı"ndaki satır biçimleri. Simülatör bunları yazar, collector okur.
 * Gerçek veri geldiğinde collector'daki sorgular bu tiplere eşlenir.
 */

/** SQL tarafındaki durum kodları (bizim iç kodlarımızdan bilerek farklı). */
export const SQL_STATUS = { RUNNING: 1, STOPPED: 2, MAINTENANCE: 3, SETUP: 4 } as const
export const sqlStatusFromState = (s: number) => s + 1
export const stateFromSqlStatus = (s: number) => Math.max(0, Math.min(3, s - 1))

export interface EventRow {
  machineId: string
  t: number
  status: number
  reasonCode: number | null
}

/** Kümülatif sayaç okuması. Okuma zamanı = dilim sonu. 06:00'da sıfırlanır. */
export interface CounterRow {
  machineId: string
  sampleT: number
  totalCount: number
  rejectCount: number
}

/** Tezgâh kontrolörü / MES bağlamı: çevrim süresi, takım sayacı, malzeme partisi */
export interface ProcessRow {
  machineId: string
  sampleT: number
  cycleTimeMs: number
  toolCycleCount: number
  materialLot: string
}

/** Historian etiket okuması (dbo.ProcessTags): bir makine, bir an, bir etiket */
export interface TagRow {
  machineId: string
  sampleT: number
  tag: string
  value: number
}

export interface QualityRow {
  machineId: string
  sampleT: number
  characteristic: string
  subgroupNo: number
  sampleIdx: number
  value: number
  nominal: number
  lsl: number
  usl: number
}
