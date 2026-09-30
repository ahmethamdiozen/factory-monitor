import type { MachineSeries, SlowEvent, SpcPoint, StopEvent } from '@/lib/types'

/**
 * UI'ın veriye erişim sözleşmesi. Canlı uygulamada ApiDataSource (SQL Server → Collector →
 * SQLite → API) uygular; testlerde yerel pipeline (src/pipeline/localPipeline.ts) uygular.
 * Zaman serileri BUCKET_SEC (10 sn) çözünürlüğünde MachineSeries olarak beklenir.
 */
export interface DataSource {
  readonly kind: 'mock' | 'live'
  /** Serilerin ilk diliminin zamanı (ms) */
  readonly startT: number
  /** Eldeki en yeni verinin zamanı (ms) — hesaplar "şimdi" olarak bunu kullanır */
  now(): number
  machineSeries(machineId: string): MachineSeries
  stopEvents(): StopEvent[]
  slowEvents(): SlowEvent[]
  /** Kalite ölçümleri (alt grup ortalaması + aralık) */
  spc(machineId: string): SpcPoint[]
  subscribe(fn: () => void): () => void
}
