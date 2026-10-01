import type { MachineType } from './types'

/**
 * Öngörülebilir arıza türleri. Simülatör bunları fiziksel olarak üretir (gizli bozulma → belirti),
 * öngörücü bakım riski artıran sinyallerden "olası kaynağı" bu listeden seçer.
 * Belirtisiz ani arızalar (kontrol / elektrik, takım kırılması) bu listede yoktur.
 */

export type ModeId = 'bearing' | 'axis' | 'coolant' | 'heater' | 'vacuum' | 'gun' | 'feeder'

export interface FailureModeDef {
  id: ModeId
  /** Arıza duruşunda yazılan neden kodu (DowntimeReasons) */
  reasonId: number
  label: string
  /** Bakım ekibine öneri */
  advice: string
  /** Belirti izi: erkenden geçe */
  signature: string
}

export const FAILURE_MODES: Record<ModeId, FailureModeDef> = {
  bearing: {
    id: 'bearing',
    reasonId: 13,
    label: 'İş mili rulmanı',
    advice: 'İş mili rulmanlarını titreşim analiziyle kontrol edin, yağlamayı doğrulayın; değişim için parça ve duruş planlayın.',
    signature: 'Rulman zarf titreşimi (HF) ↑ → RMS titreşim ↑ → yatak sıcaklığı ↑',
  },
  axis: {
    id: 'axis',
    reasonId: 14,
    label: 'Eksen / vidalı mil',
    advice: 'Eksen servo akımını ve boşluğu kontrol edin; vidalı mil ve kızak yağlamasını gözden geçirin.',
    signature: 'Eksen servo akımı ↑, çevrim süresi düzensizleşir',
  },
  coolant: {
    id: 'coolant',
    reasonId: 15,
    label: 'Soğutma sistemi',
    advice: 'Soğutma sıvısı pompası, filtreleri ve seviyesini kontrol edin.',
    signature: 'Soğutma basıncı ↓, iş mili sıcaklığı ↑',
  },
  heater: {
    id: 'heater',
    reasonId: 16,
    label: 'Isıtıcı eleman',
    advice: 'Isıtıcı eleman dirençlerini ölçün, bağlantıları kontrol edin; sonraki şarjdan önce değerlendirin.',
    signature: 'Aynı sıcaklık için ısıtıcı gücü ↑, ısınma yavaşlar',
  },
  vacuum: {
    id: 'vacuum',
    reasonId: 17,
    label: 'Vakum pompası',
    advice: 'Vakum pompası yağını ve contaları kontrol edin, kaçak testi yapın; şarjı riske atmadan bakım planlayın.',
    signature: 'Tutma sırasında vakum kötüleşir (mbar ↑), pompalama uzar',
  },
  gun: {
    id: 'gun',
    reasonId: 18,
    label: 'Tabanca / elektrot',
    advice: 'Plazma tabancasının anot / katot aşınmasını kontrol edin; elektrot değişimini planlayın.',
    signature: 'Tabanca gerilimi kayar ve dalgalanır',
  },
  feeder: {
    id: 'feeder',
    reasonId: 19,
    label: 'Toz besleyici',
    advice: 'Toz besleyici hattını ve taşıyıcı gaz akışını kontrol edin, tıkanmayı temizleyin.',
    signature: 'Toz besleme dalgalanır, kısa duruşlar sıklaşır',
  },
}

export const MODE_BY_REASON: Record<number, ModeId> = Object.fromEntries(Object.values(FAILURE_MODES).map((m) => [m.reasonId, m.id]))

/** Makine tiplerinin öngörülebilir arıza türleri */
export const MODES_OF_TYPE: Record<MachineType, ModeId[]> = {
  cnc: ['bearing', 'axis', 'coolant'],
  grinder: ['bearing', 'coolant'],
  furnace: ['heater', 'vacuum'],
  coating: ['gun', 'feeder'],
  cmm: [],
}
