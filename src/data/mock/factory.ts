import type { DowntimeReason, Line, Machine, Person, Shift, ShiftId, SlowReason, SpecLimits } from '@/lib/types'
import { mulberry32, pick } from '@/lib/rng'

export const SHIFTS: Shift[] = [
  { id: 'A', name: 'A Vardiyası', startHour: 6, endHour: 14 },
  { id: 'B', name: 'B Vardiyası', startHour: 14, endHour: 22 },
  { id: 'C', name: 'C Vardiyası', startHour: 22, endHour: 6 },
]

/** Üretim günü başlangıç saati (A vardiyası ile aynı). */
export const DAY_START_HOUR = 6

export const LINES: Line[] = [
  { id: 'L1', name: 'Hat 1 · Plastik Enjeksiyon', short: 'Hat 1' },
  { id: 'L2', name: 'Hat 2 · Montaj', short: 'Hat 2' },
  { id: 'L3', name: 'Hat 3 · Paketleme', short: 'Hat 3' },
]

export const DOWNTIME_REASONS: DowntimeReason[] = [
  { id: 0, label: '—', category: 'planned', planned: false },
  { id: 1, label: 'Motor / hidrolik arızası', category: 'breakdown', planned: false },
  { id: 2, label: 'Sensör / PLC hatası', category: 'breakdown', planned: false },
  { id: 3, label: 'Takım kırılması', category: 'breakdown', planned: false },
  { id: 4, label: 'Ürün / kalıp değişimi', category: 'changeover', planned: false },
  { id: 5, label: 'Ayar ve ısınma', category: 'changeover', planned: false },
  { id: 6, label: 'Malzeme bekleme', category: 'material', planned: false },
  { id: 7, label: 'Operatör yok', category: 'staffing', planned: false },
  { id: 8, label: 'Planlı bakım', category: 'planned', planned: true },
  { id: 9, label: 'Kalite kontrol durdurması', category: 'quality', planned: false },
  { id: 10, label: 'Sıkışma / mikro duruş', category: 'microstop', planned: false },
  { id: 11, label: 'Temizlik / hijyen', category: 'planned', planned: true },
]

export const CATEGORY_LABEL: Record<string, string> = {
  breakdown: 'Arıza',
  changeover: 'Ayar & değişim',
  microstop: 'Mikro duruş',
  material: 'Malzeme / bekleme',
  staffing: 'Personel',
  quality: 'Kalite durdurması',
  planned: 'Planlı duruş',
}

export const SLOW_REASONS: SlowReason[] = [
  { id: 0, label: '—' },
  { id: 1, label: 'Takım / kalıp aşınması' },
  { id: 2, label: 'Hammadde kalitesi' },
  { id: 3, label: 'Operatör tecrübesi / uyum' },
  { id: 4, label: 'Yüksek sıcaklık (soğutma)' },
  { id: 5, label: 'Durma sonrası ısınma' },
  { id: 6, label: 'Besleme dalgalanması' },
]

export const DEFECT_TYPES: Record<string, { label: string; weight: number }[]> = {
  L1: [
    { label: 'Çapak', weight: 0.28 },
    { label: 'Eksik dolum', weight: 0.22 },
    { label: 'Çarpılma', weight: 0.18 },
    { label: 'Yüzey izi / çizik', weight: 0.15 },
    { label: 'Ölçü dışı', weight: 0.12 },
    { label: 'Yanık / renk hatası', weight: 0.05 },
  ],
  L2: [
    { label: 'Eksik parça', weight: 0.3 },
    { label: 'Yanlış tork', weight: 0.24 },
    { label: 'Hizalama hatası', weight: 0.2 },
    { label: 'Bağlantı hatası', weight: 0.16 },
    { label: 'Çizik', weight: 0.1 },
  ],
  L3: [
    { label: 'Etiket hatası', weight: 0.32 },
    { label: 'Ağırlık dışı', weight: 0.26 },
    { label: 'Hasarlı ambalaj', weight: 0.2 },
    { label: 'Mühür hatası', weight: 0.14 },
    { label: 'Eksik ürün', weight: 0.08 },
  ],
}

const specL1 = (): SpecLimits => ({ characteristic: 'Duvar kalınlığı', unit: 'mm', nominal: 2.5, lsl: 2.4, usl: 2.6, sigma: 0.022 })
const specL2 = (): SpecLimits => ({ characteristic: 'Sıkma torku', unit: 'Nm', nominal: 12, lsl: 11, usl: 13, sigma: 0.19 })
const specL3 = (): SpecLimits => ({ characteristic: 'Paket ağırlığı', unit: 'g', nominal: 500, lsl: 490, usl: 510, sigma: 1.7 })

interface MachineDef {
  id: string
  code: string
  name: string
  model: string
  lineId: string
  product: string
  idealRate: number
  spec: SpecLimits
}

const DEFS: MachineDef[] = [
  { id: 'M01', code: 'ENJ-01', name: 'Enjeksiyon Presi 1', model: 'EP-350', lineId: 'L1', product: 'Kapak 40 mm', idealRate: 1.2, spec: specL1() },
  { id: 'M02', code: 'ENJ-02', name: 'Enjeksiyon Presi 2', model: 'EP-350', lineId: 'L1', product: 'Gövde 40 mm', idealRate: 1.5, spec: specL1() },
  { id: 'M03', code: 'ENJ-03', name: 'Enjeksiyon Presi 3', model: 'EP-450', lineId: 'L1', product: 'Kapak 60 mm', idealRate: 1.2, spec: specL1() },
  { id: 'M04', code: 'ENJ-04', name: 'Enjeksiyon Presi 4', model: 'EP-450', lineId: 'L1', product: 'Gövde 60 mm', idealRate: 1.8, spec: specL1() },
  { id: 'M05', code: 'MNT-01', name: 'Montaj İstasyonu 1', model: 'MS-20', lineId: 'L2', product: 'Valf grubu A', idealRate: 0.8, spec: specL2() },
  { id: 'M06', code: 'MNT-02', name: 'Montaj İstasyonu 2', model: 'MS-20', lineId: 'L2', product: 'Valf grubu A', idealRate: 0.8, spec: specL2() },
  { id: 'M07', code: 'MNT-03', name: 'Montaj İstasyonu 3', model: 'MS-30', lineId: 'L2', product: 'Valf grubu B', idealRate: 1.0, spec: specL2() },
  { id: 'M08', code: 'MNT-04', name: 'Montaj İstasyonu 4', model: 'MS-30', lineId: 'L2', product: 'Valf grubu B', idealRate: 1.0, spec: specL2() },
  { id: 'M09', code: 'PKT-01', name: 'Paketleme 1', model: 'PK-100', lineId: 'L3', product: 'Kutu 500 g', idealRate: 2.4, spec: specL3() },
  { id: 'M10', code: 'PKT-02', name: 'Paketleme 2', model: 'PK-100', lineId: 'L3', product: 'Kutu 500 g', idealRate: 2.4, spec: specL3() },
  { id: 'M11', code: 'PKT-03', name: 'Paketleme 3', model: 'PK-200', lineId: 'L3', product: 'Kutu 1 kg', idealRate: 3.0, spec: specL3() },
  { id: 'M12', code: 'PKT-04', name: 'Paketleme 4', model: 'PK-200', lineId: 'L3', product: 'Kutu 1 kg', idealRate: 3.0, spec: specL3() },
]

/** Günlük hedef = ideal hız × 86 400 sn × planlanan verimlilik (%72) */
const PLANNED_ATTAINMENT = 0.72

export const MACHINES: Machine[] = DEFS.map((d, i) => ({
  ...d,
  orderNo: `İE-${24100 + i * 7}`,
  dailyTarget: Math.round((d.idealRate * 86400 * PLANNED_ATTAINMENT) / 100) * 100,
}))

export const MACHINE_BY_ID: Record<string, Machine> = Object.fromEntries(MACHINES.map((m) => [m.id, m]))
export const LINE_BY_ID: Record<string, Line> = Object.fromEntries(LINES.map((l) => [l.id, l]))
export const REASON_BY_ID: Record<number, DowntimeReason> = Object.fromEntries(DOWNTIME_REASONS.map((r) => [r.id, r]))

const FIRST = [
  'Ahmet', 'Mehmet', 'Mustafa', 'Ali', 'Hasan', 'Hüseyin', 'İbrahim', 'Yusuf', 'Emre', 'Burak', 'Serkan', 'Murat',
  'Kemal', 'Osman', 'Fatih', 'Cem', 'Onur', 'Tolga', 'Volkan', 'Barış', 'Ayşe', 'Fatma', 'Zeynep', 'Elif', 'Esra',
  'Selin', 'Merve', 'Derya', 'Gül', 'Hatice', 'Sevgi', 'Pınar', 'Deniz', 'Ceren', 'Büşra', 'Nihat', 'Recep', 'Erkan',
  'Taner', 'Uğur', 'Gökhan', 'Melih', 'Sinan', 'Kadir', 'Halil', 'Metin', 'Levent', 'Orhan',
]
const LAST = [
  'Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan',
  'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Korkmaz', 'Erdoğan', 'Güneş',
  'Tekin', 'Aksoy', 'Acar', 'Türk', 'Bulut', 'Karaca', 'Yavuz', 'Sezer', 'Uçar', 'Coşkun', 'Bayram', 'Tunç',
]

function makePeople(): Person[] {
  const rng = mulberry32(20260929)
  const used = new Set<string>()
  const name = () => {
    for (;;) {
      const n = `${pick(rng, FIRST)} ${pick(rng, LAST)}`
      if (!used.has(n)) {
        used.add(n)
        return n
      }
    }
  }
  const people: Person[] = []
  const shifts: ShiftId[] = ['A', 'B', 'C']
  for (const s of shifts) {
    for (const l of LINES) {
      const n = name()
      people.push({
        id: `F-${s}-${l.id}`,
        name: n,
        role: 'foreman',
        shiftId: s,
        lineId: l.id,
        experienceYears: 8 + Math.floor(rng() * 12),
        avatarSeed: n,
      })
    }
    for (const m of MACHINES) {
      const n = name()
      people.push({
        id: `O-${s}-${m.id}`,
        name: n,
        role: 'operator',
        shiftId: s,
        lineId: m.lineId,
        machineId: m.id,
        experienceYears: Math.round((1 + rng() * 11) * 10) / 10,
        avatarSeed: n,
      })
    }
  }
  return people
}

export const PEOPLE: Person[] = makePeople()

/** Hikâye: B vardiyasında Montaj 4'teki operatör yeni başlamış (yavaşlık nedeni "operatör tecrübesi"). */
const rookie = PEOPLE.find((p) => p.id === 'O-B-M08')
if (rookie) rookie.experienceYears = 0.4

export function shiftOf(t: number): ShiftId {
  const h = new Date(t).getHours()
  if (h >= 6 && h < 14) return 'A'
  if (h >= 14 && h < 22) return 'B'
  return 'C'
}

export function operatorFor(machineId: string, shiftId: ShiftId): Person | undefined {
  return PEOPLE.find((p) => p.role === 'operator' && p.machineId === machineId && p.shiftId === shiftId)
}

export function foremanFor(lineId: string, shiftId: ShiftId): Person | undefined {
  return PEOPLE.find((p) => p.role === 'foreman' && p.lineId === lineId && p.shiftId === shiftId)
}
