import type { MachineSeries, SlowEvent, SpcPoint, StopEvent } from '@/lib/types'

/**
 * UI'ın veriye erişim sözleşmesi. Şimdi MockDataSource (simülatör) uygular;
 * gerçek veri geldiğinde SQL Server → Node API → ApiDataSource aynı arayüzü uygular.
 * Zaman serileri BUCKET_SEC (10 sn) çözünürlüğünde MachineSeries olarak beklenir.
 */
export interface DataSource {
  readonly kind: 'mock' | 'live'
  /** Serilerin ilk bucket'ının zamanı (ms) */
  readonly startT: number
  /** Şu anki (simüle) zaman, ms */
  now(): number
  machineSeries(machineId: string): MachineSeries
  stopEvents(): StopEvent[]
  slowEvents(): SlowEvent[]
  /** Kalite ölçümleri (alt grup ortalaması + aralık) */
  spc(machineId: string): SpcPoint[]
  subscribe(fn: () => void): () => void
  /** Sadece mock kaynakta anlamlı */
  controls?: {
    getSpeed(): number
    setSpeed(bucketsPerTick: number): void
    isPaused(): boolean
    setPaused(p: boolean): void
    reset(): void
  }
}
