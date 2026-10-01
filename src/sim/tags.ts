import type { ChannelInfo, Machine, MachineType } from '@/lib/types'

/**
 * Süreç sinyalleri "historian" tarzı etiket (tag) olarak tutulur: her satır bir makine, bir an,
 * bir etiket ve bir değerdir (dbo.ProcessTags). Etiket sözlüğü ve devreye alma referansı
 * dbo.MachineTags'tedir. Collector etiketleri makine tipine göre ortak KANALLARA eşler; kurallar,
 * öngörücü bakım ve ekranlar kanallarla çalışır.
 */

/** Ortak kanallar (SQLite bucket kolonları). Ölçüm yoksa değer -1. */
export const CHANNELS = ['temp', 'vib', 'hf', 'load', 'cur', 'aux', 'feed'] as const
export type Channel = (typeof CHANNELS)[number]

export interface TagDef {
  tag: string
  channel: Channel | null
  unit: string
  description: string
  /** Kablosuz titreşim sensörü: ara sıra kopar (satır yazılmaz) */
  wireless?: boolean
  /** Kanal bu etiketin değeri eksi başka bir etiket olarak hesaplanır (fırın: set değerinden sapma) */
  relativeTo?: string
}

export const TAGS: Record<MachineType, TagDef[]> = {
  cnc: [
    { tag: 'SpindleLoadPct', channel: 'load', unit: '%', description: 'İş mili yükü' },
    { tag: 'SpindleVibMmS', channel: 'vib', unit: 'mm/s', description: 'İş mili titreşimi (RMS hız)', wireless: true },
    { tag: 'SpindleVibHfG', channel: 'hf', unit: 'g', description: 'Rulman zarf titreşimi (yüksek frekans)', wireless: true },
    { tag: 'SpindleTempC', channel: 'temp', unit: '°C', description: 'İş mili yatak sıcaklığı' },
    { tag: 'CoolantPressBar', channel: 'aux', unit: 'bar', description: 'Soğutma sıvısı basıncı' },
    { tag: 'FeedOverridePct', channel: 'feed', unit: '%', description: 'İlerleme ayarı (override)' },
    { tag: 'AxisCurrentA', channel: 'cur', unit: 'A', description: 'Eksen servo akımı' },
  ],
  grinder: [
    { tag: 'SpindleLoadPct', channel: 'load', unit: '%', description: 'Taş mili yükü' },
    { tag: 'SpindleVibMmS', channel: 'vib', unit: 'mm/s', description: 'Taş mili titreşimi (RMS hız)', wireless: true },
    { tag: 'SpindleVibHfG', channel: 'hf', unit: 'g', description: 'Rulman zarf titreşimi (yüksek frekans)', wireless: true },
    { tag: 'SpindleTempC', channel: 'temp', unit: '°C', description: 'Taş mili yatak sıcaklığı' },
    { tag: 'CoolantPressBar', channel: 'aux', unit: 'bar', description: 'Soğutma sıvısı basıncı' },
    { tag: 'FeedOverridePct', channel: 'feed', unit: '%', description: 'İlerleme ayarı (override)' },
  ],
  furnace: [
    { tag: 'FurnaceTempC', channel: 'temp', unit: '°C', description: 'Fırın sıcaklığı (kontrol termokuplu)', relativeTo: 'SetpointC' },
    { tag: 'SetpointC', channel: null, unit: '°C', description: 'Reçete set değeri' },
    { tag: 'VacuumMbar', channel: 'aux', unit: 'mbar', description: 'Fırın vakumu' },
    { tag: 'HeaterPowerPct', channel: 'load', unit: '%', description: 'Isıtıcı gücü' },
  ],
  coating: [
    { tag: 'GunVoltageV', channel: 'load', unit: 'V', description: 'Plazma tabancası gerilimi' },
    { tag: 'PowderFeedPct', channel: 'feed', unit: '%', description: 'Toz besleme oranı (ayara göre)' },
    { tag: 'CoolingWaterTempC', channel: 'temp', unit: '°C', description: 'Tabanca soğutma suyu sıcaklığı' },
  ],
  cmm: [{ tag: 'RoomTempC', channel: 'temp', unit: '°C', description: 'Ölçüm odası sıcaklığı' }],
}

/** Ekranda kanal adı (fırında sıcaklık kanalı set değerinden sapmadır) */
export const CHANNEL_LABEL: Record<MachineType, Partial<Record<Channel, string>>> = Object.fromEntries(
  Object.entries(TAGS).map(([type, defs]) => [
    type,
    Object.fromEntries(defs.filter((d) => d.channel).map((d) => [d.channel!, d.relativeTo ? 'Set değerinden sapma' : d.description])),
  ]),
) as Record<MachineType, Partial<Record<Channel, string>>>

export const CHANNEL_UNIT: Record<MachineType, Partial<Record<Channel, string>>> = Object.fromEntries(
  Object.entries(TAGS).map(([type, defs]) => [type, Object.fromEntries(defs.filter((d) => d.channel).map((d) => [d.channel!, d.unit]))]),
) as Record<MachineType, Partial<Record<Channel, string>>>

/** Collector'a verilen etiket → kanal eşlemesi (gerçekte dbo.MachineTags'ten okunur) */
export interface TagMap {
  tag: string
  channel: Channel | null
  relativeTo?: string | null
}

export type Baseline = Record<string, number>

/** Fırın reçete set değeri (°C) — çözeltiye alma / yaşlandırma */
export function furnaceSetpoint(m: Machine): number {
  return m.operation === 'Op 50' ? 980 : 720
}

/**
 * Devreye alma referansı: sağlıklı makinenin tipik değerleri. Gerçekte kurulumun ilk haftasında
 * ölçülür ve dbo.MachineTags.Baseline'a yazılır. Simülatör sağlıklı sinyali bu değerlerin
 * çevresinde üretir; kurallar ve öngörücü bakım değerleri buna göre (oran / fark) yorumlar.
 */
export function tagBaselines(m: Machine, idx: number): Baseline {
  const k = 1 + ((idx * 37) % 11) / 100 // makineden makineye küçük fark
  switch (m.type) {
    case 'cnc':
      return { SpindleLoadPct: 42 * k, SpindleVibMmS: 1.6 * k, SpindleVibHfG: 0.32 * k, SpindleTempC: 34 + idx * 0.4, CoolantPressBar: 60 * k, FeedOverridePct: 100, AxisCurrentA: 9 * k }
    case 'grinder':
      return { SpindleLoadPct: 30 * k, SpindleVibMmS: 0.9 * k, SpindleVibHfG: 0.22 * k, SpindleTempC: 30 + idx * 0.3, CoolantPressBar: 18 * k, FeedOverridePct: 100 }
    case 'furnace': {
      const sp = furnaceSetpoint(m)
      return { FurnaceTempC: sp, SetpointC: sp, VacuumMbar: 2e-4 * k, HeaterPowerPct: (sp > 900 ? 58 : 44) * k }
    }
    case 'coating':
      return { GunVoltageV: 68 * k, PowderFeedPct: 100, CoolingWaterTempC: 24 }
    case 'cmm':
      return { RoomTempC: 20 }
  }
}

/** Kanal referansları (kurallar ve özellikler için); bağıl kanalın referansı 0'dır */
export function channelBaselines(defs: (TagMap & { baseline: number | null })[]): Partial<Record<Channel, number>> {
  const out: Partial<Record<Channel, number>> = {}
  for (const d of defs) if (d.channel && d.baseline !== null) out[d.channel] = d.relativeTo ? 0 : d.baseline
  return out
}

/** Ekranlar için kanal bilgisi (etiket sözlüğünden) */
export function channelInfos(defs: { channel: Channel | null; relativeTo?: string | null; unit: string; description: string; baseline: number | null }[]): ChannelInfo[] {
  return defs
    .filter((d) => d.channel)
    .map((d) => ({ channel: d.channel!, label: d.relativeTo ? 'Set değerinden sapma' : d.description, unit: d.unit, ref: d.relativeTo ? 0 : d.baseline }))
}

/** Statik tanımdan makinenin etiket listesi (simülatör tohumu, web demo, testler) */
export function tagDefsOf(m: Machine, idx: number): (TagMap & { baseline: number })[] {
  const b = tagBaselines(m, idx)
  return TAGS[m.type].map((d) => ({ tag: d.tag, channel: d.channel, relativeTo: d.relativeTo ?? null, baseline: b[d.tag] }))
}
