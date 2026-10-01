import type { MachineSeries, SlowEvent, SpcPoint, StopEvent } from '@/lib/types'
import type { MaintNotification, NotificationStatus, RiskPoint } from '@/ml/types'

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
  /** Öngörücü bakım: makinenin 5 dk'lık risk noktaları (eski → yeni) */
  riskSeries(machineId: string): RiskPoint[]
  /** Bakım bildirimleri (yeni → eski) */
  notifications(): MaintNotification[]
  setNotificationStatus(id: string, status: NotificationStatus): void
  subscribe(fn: () => void): () => void
}

export type ConnState = 'connecting' | 'live' | 'stale' | 'offline'

export interface ConnStatus {
  state: ConnState
  /** Kaynaktan son başarılı cevap (duvar saati) */
  lastSuccessAt: number | null
  /** Eldeki en yeni verinin zamanı */
  dataUntil: number | null
  error: string | null
}

/** Arayüzü canlı besleyen kaynak: API (gerçek hat) ya da demo (tarayıcı içi hat). */
export interface LiveSource extends DataSource {
  ready: boolean
  start(): void
  status(): ConnStatus
}
