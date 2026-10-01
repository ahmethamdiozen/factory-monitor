import type { FeatureName } from './features'
import type { ModeId } from '@/lib/failureModes'

export type RiskLevel = 'good' | 'watch' | 'alarm'

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  good: 'İyi',
  watch: 'Dikkat',
  alarm: 'Riskli',
}

export interface RiskFactor {
  feature: FeatureName
  /** Arayüz metni, ör. "Motor akımı normalin %12 üstünde" */
  text: string
  /** Bu etken normal değerine dönse risk ne kadar düşerdi (0–1) */
  impact: number
}

export interface RiskPoint {
  machineId: string
  t: number
  risk: number
  level: RiskLevel
  factors: RiskFactor[]
  /** Olası kaynak (arıza türü); belirlenemediyse null */
  source?: ModeId | null
}

export type NotificationStatus = 'new' | 'read' | 'planned' | 'closed'

export const NOTIFICATION_STATUS_LABEL: Record<NotificationStatus, string> = {
  new: 'Yeni',
  read: 'Okundu',
  planned: 'Bakım planlandı',
  closed: 'Kapandı',
}

export interface MaintNotification {
  id: string
  t: number
  machineId: string
  lineId: string
  title: string
  message: string
  /** 'bakim' ve 'foreman:L1' gibi rol anahtarları */
  recipients: string[]
  risk: number
  factors: RiskFactor[]
  source?: ModeId | null
  status: NotificationStatus
  statusAt: number | null
  /** Uyarıdan sonra gerçekten arıza olduysa zamanı */
  failureAt: number | null
}
