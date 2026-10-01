// Domain tipleri. Gerçek SQL Server tablolarını yansıtacak şekilde tasarlandı:
//   Machine, MachineStateLog (state/downReason), ProductionCount (ok/nok), Person, Shift, DowntimeReason

/** Bucket boyutu (sn). Tüm zaman serileri bu çözünürlükte tutulur. */
export const BUCKET_SEC = 10
export const BUCKET_MS = BUCKET_SEC * 1000

export const STATE = { RUNNING: 0, STOPPED: 1, MAINTENANCE: 2, CHANGEOVER: 3 } as const
export type StateCode = (typeof STATE)[keyof typeof STATE]
export type MachineStateKey = 'running' | 'stopped' | 'maintenance' | 'changeover'
export const STATE_KEYS: MachineStateKey[] = ['running', 'stopped', 'maintenance', 'changeover']
export const STATE_LABEL: Record<MachineStateKey, string> = {
  running: 'Çalışıyor',
  stopped: 'Durdu',
  maintenance: 'Bakımda',
  changeover: 'Ayarda',
}

export type ShiftId = 'A' | 'B' | 'C'
export interface Shift {
  id: ShiftId
  name: string
  startHour: number
  endHour: number
}

export interface SpecLimits {
  characteristic: string
  unit: string
  nominal: number
  lsl: number
  usl: number
  /** Süreç standart sapması (bireysel ölçüm) */
  sigma: number
}

export interface Line {
  id: string
  name: string
  short: string
}

/** cnc: torna/freze · grinder: taşlama · furnace: vakum fırını · coating: plazma sprey · cmm: ölçüm */
export type MachineType = 'cnc' | 'grinder' | 'furnace' | 'coating' | 'cmm'

export const MACHINE_TYPE_LABEL: Record<MachineType, string> = {
  cnc: 'CNC tezgâh',
  grinder: 'Taşlama',
  furnace: 'Vakum fırını',
  coating: 'Kaplama',
  cmm: 'Ölçüm',
}

export interface Machine {
  id: string
  code: string
  name: string
  model: string
  lineId: string
  type: MachineType
  /** Parça adı, ör. "HPT türbin diski" */
  product: string
  /** Parça numarası (P/N) */
  partNumber: string
  /** Rota üzerindeki operasyon, ör. "Op 10" */
  operation: string
  /** Bir çevrimde çıkan parça sayısı (fırın şarjı > 1) */
  batchSize: number
  orderNo: string
  /** İdeal üretim hızı (parça/sn) = şarj / ideal çevrim süresi */
  idealRate: number
  /** Üretim günü (06:00→06:00) hedefi, parça */
  dailyTarget: number
  spec: SpecLimits
  /** Süreç sinyali kanalları (dbo.MachineTags'ten): ad, birim, devreye alma referansı */
  channels?: ChannelInfo[]
}

export interface ChannelInfo {
  channel: 'temp' | 'vib' | 'hf' | 'load' | 'cur' | 'aux' | 'feed'
  label: string
  unit: string
  /** Referans (sağlıklı makine); bağıl kanalda 0 */
  ref: number | null
}

/** İdeal çevrim süresi (saat) */
export const idealCycleHours = (m: Machine) => m.batchSize / m.idealRate / 3600

export type PersonRole = 'operator' | 'foreman'
export interface Person {
  id: string
  name: string
  role: PersonRole
  shiftId: ShiftId
  lineId: string
  machineId?: string
  experienceYears: number
  avatarSeed: string
}

export type ReasonCategory =
  | 'breakdown'
  | 'changeover'
  | 'microstop'
  | 'material'
  | 'staffing'
  | 'quality'
  | 'planned'

export interface DowntimeReason {
  id: number
  label: string
  category: ReasonCategory
  /** Planlı duruş: OEE planlı üretim süresine dahil edilmez (TEEP'e dahil). */
  planned: boolean
}

export interface SlowReason {
  id: number
  label: string
}

/** Bir makinenin 10 sn'lik bucket'lanmış zaman serisi. Index 0 = series.startT. */
export interface MachineSeries {
  startT: number
  length: number
  state: Uint8Array
  downReason: Uint8Array
  slowReason: Uint8Array
  /** gerçek hız / ideal hız (çalışırken); durunca 0 */
  speed: Float32Array
  ok: Uint16Array
  nok: Uint16Array
}

export interface StopEvent {
  id: number
  machineId: string
  state: Exclude<StateCode, 0>
  reasonId: number
  start: number
  end: number | null
}

export interface SlowEvent {
  id: number
  machineId: string
  reasonId: number
  start: number
  end: number | null
  minSpeed: number
}

export interface SpcPoint {
  t: number
  mean: number
  range: number
}

export type WindowKey = 'shift' | 'day' | 'h24'
export const WINDOW_LABEL: Record<WindowKey, string> = {
  shift: 'Bu vardiya',
  day: 'Bugün (06:00→)',
  h24: 'Son 24 saat',
}

/** API'nin /api/meta cevabı: arayüzün kullandığı referans verisi (SQL Server'dan gelir). */
export interface FactoryMeta {
  datasetId: string
  lines: Line[]
  machines: Machine[]
  reasons: DowntimeReason[]
  people: Person[]
}
