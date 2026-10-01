import type { DowntimeReason, Line, Machine, MachineType, Person, Shift, ShiftId, SlowReason, SpecLimits } from '@/lib/types'
import { mulberry32, pick } from '@/lib/rng'
import { TAGS, channelInfos, tagBaselines } from './tags'

export const SHIFTS: Shift[] = [
  { id: 'A', name: 'A Vardiyası', startHour: 6, endHour: 14 },
  { id: 'B', name: 'B Vardiyası', startHour: 14, endHour: 22 },
  { id: 'C', name: 'C Vardiyası', startHour: 22, endHour: 6 },
]

/**
 * Statik tesis tanımı: jet motoru parçaları üreten bir atölye (CNC talaşlı imalat, ısıl işlem
 * ve kaplama, ölçüm ve kalite). SADECE simülatörün SQL Server'a yazdığı tohum verisidir ve
 * testlerde kullanılır. Arayüz bu dosyayı değil, API'den doldurulan src/data/registry.ts'i kullanır.
 */

/** Üretim günü başlangıç saati (A vardiyası ile aynı). */
export const DAY_START_HOUR = 6

export const LINES: Line[] = [
  { id: 'L1', name: 'Hücre 1 · Döner Parçalar', short: 'Hücre 1' },
  { id: 'L2', name: 'Hücre 2 · Blisk & Muhafaza', short: 'Hücre 2' },
  { id: 'L3', name: 'Hücre 3 · Isıl İşlem & Kaplama', short: 'Hücre 3' },
  { id: 'L4', name: 'Hücre 4 · Ölçüm & Kalite', short: 'Hücre 4' },
]

export const DOWNTIME_REASONS: DowntimeReason[] = [
  { id: 0, label: '—', category: 'planned', planned: false },
  { id: 1, label: 'Mekanik / hidrolik arıza', category: 'breakdown', planned: false },
  { id: 2, label: 'Kontrol / elektrik arızası', category: 'breakdown', planned: false },
  { id: 3, label: 'Takım kırılması', category: 'breakdown', planned: false },
  { id: 4, label: 'Program / fikstür değişimi', category: 'changeover', planned: false },
  { id: 5, label: 'Ayar ve ilk parça onayı', category: 'changeover', planned: false },
  { id: 6, label: 'Malzeme / parça bekleme', category: 'material', planned: false },
  { id: 7, label: 'Operatör yok', category: 'staffing', planned: false },
  { id: 8, label: 'Planlı bakım', category: 'planned', planned: true },
  { id: 9, label: 'Kalite onayı bekleme (CMM)', category: 'quality', planned: false },
  { id: 10, label: 'Talaş temizleme / kısa alarm', category: 'microstop', planned: false },
  { id: 11, label: 'Temizlik / 5S', category: 'planned', planned: true },
  { id: 12, label: 'Şarj yükleme / boşaltma', category: 'changeover', planned: false },
  // Arıza türleri (öngörücü bakımın tanıdığı)
  { id: 13, label: 'İş mili rulmanı arızası', category: 'breakdown', planned: false },
  { id: 14, label: 'Eksen / vidalı mil arızası', category: 'breakdown', planned: false },
  { id: 15, label: 'Soğutma sistemi arızası', category: 'breakdown', planned: false },
  { id: 16, label: 'Isıtıcı eleman arızası', category: 'breakdown', planned: false },
  { id: 17, label: 'Vakum pompası arızası', category: 'breakdown', planned: false },
  { id: 18, label: 'Tabanca / elektrot arızası', category: 'breakdown', planned: false },
  { id: 19, label: 'Toz besleyici arızası', category: 'breakdown', planned: false },
]

export const CATEGORY_LABEL: Record<string, string> = {
  breakdown: 'Arıza',
  changeover: 'Ayar & değişim',
  microstop: 'Kısa duruş',
  material: 'Malzeme / bekleme',
  staffing: 'Personel',
  quality: 'Kalite onayı',
  planned: 'Planlı duruş',
}

export const SLOW_REASONS: SlowReason[] = [
  { id: 0, label: '—' },
  { id: 1, label: 'Takım aşınması' },
  { id: 2, label: 'Malzeme partisi (sertlik)' },
  { id: 3, label: 'Operatör tecrübesi / uyum' },
  { id: 4, label: 'Yüksek sıcaklık (soğutma)' },
  { id: 5, label: 'Isınma programı (duruş sonrası)' },
  { id: 6, label: 'İlerleme düşürüldü (titreşim / besleme)' },
  { id: 7, label: 'Neden belirlenemedi' },
]

/** Uygunsuzluk türleri (hücre bazında, yer tutucu dağılım) */
export const DEFECT_TYPES: Record<string, { label: string; weight: number }[]> = {
  L1: [
    { label: 'Ölçü dışı', weight: 0.34 },
    { label: 'Yüzey pürüzlülüğü', weight: 0.24 },
    { label: 'Takım izi', weight: 0.18 },
    { label: 'Form / konum toleransı', weight: 0.14 },
    { label: 'Çapak', weight: 0.1 },
  ],
  L2: [
    { label: 'Kanat profili dışı', weight: 0.3 },
    { label: 'Ölçü dışı', weight: 0.26 },
    { label: 'Yüzey pürüzlülüğü', weight: 0.2 },
    { label: 'Takım izi', weight: 0.14 },
    { label: 'Çapak', weight: 0.1 },
  ],
  L3: [
    { label: 'Sertlik dışı', weight: 0.34 },
    { label: 'Distorsiyon', weight: 0.26 },
    { label: 'Kaplama kalınlığı dışı', weight: 0.24 },
    { label: 'Kaplama yapışması', weight: 0.16 },
  ],
  L4: [{ label: 'Tekrar ölçüm', weight: 1 }],
}

const spec = (characteristic: string, unit: string, nominal: number, tol: number, sigma: number): SpecLimits => ({
  characteristic,
  unit,
  nominal,
  lsl: nominal - tol,
  usl: nominal + tol,
  sigma,
})

interface MachineDef {
  id: string
  code: string
  name: string
  model: string
  lineId: string
  type: MachineType
  product: string
  partNumber: string
  operation: string
  /** İdeal çevrim süresi (saat); fırında bir şarj */
  cycleH: number
  /** Bir çevrimde çıkan parça (fırın şarjı) */
  batchSize: number
  spec: SpecLimits
}

const DEFS: MachineDef[] = [
  { id: 'M01', code: 'TRN-01', name: 'Dikey Torna (VTL) 1', model: 'VTL-1600', lineId: 'L1', type: 'cnc', product: 'HPT türbin diski', partNumber: 'HPT-D-1101', operation: 'Op 10', cycleH: 3, batchSize: 1, spec: spec('Göbek iç çapı', 'mm', 120, 0.02, 0.004) },
  { id: 'M02', code: 'TRN-02', name: 'Dikey Torna (VTL) 2', model: 'VTL-1600', lineId: 'L1', type: 'cnc', product: 'HPC kompresör diski', partNumber: 'HPC-D-2204', operation: 'Op 10', cycleH: 2.5, batchSize: 1, spec: spec('Göbek iç çapı', 'mm', 96, 0.02, 0.0045) },
  { id: 'M03', code: 'TRN-03', name: 'CNC Torna 3', model: 'CT-800', lineId: 'L1', type: 'cnc', product: 'LPT ana şaft', partNumber: 'LPT-S-3010', operation: 'Op 20', cycleH: 4, batchSize: 1, spec: spec('Yatak oturma çapı', 'mm', 55, 0.01, 0.002) },
  { id: 'M04', code: 'TAS-01', name: 'Silindirik Taşlama 1', model: 'CG-1000', lineId: 'L1', type: 'grinder', product: 'LPT ana şaft', partNumber: 'LPT-S-3010', operation: 'Op 40', cycleH: 1.5, batchSize: 1, spec: spec('Yatak yüzeyi çapı', 'mm', 54.99, 0.005, 0.0009) },
  { id: 'M05', code: 'FRZ-01', name: '5 Eksen Freze 1', model: '5X-1250', lineId: 'L2', type: 'cnc', product: 'Fan bliski', partNumber: 'FAN-B-4001', operation: 'Op 30', cycleH: 8, batchSize: 1, spec: spec('Kanat profil kalınlığı', 'mm', 2.4, 0.05, 0.009) },
  { id: 'M06', code: 'FRZ-02', name: '5 Eksen Freze 2', model: '5X-1250', lineId: 'L2', type: 'cnc', product: 'Kompresör bliski', partNumber: 'HPC-B-4102', operation: 'Op 30', cycleH: 6, batchSize: 1, spec: spec('Kanat profil kalınlığı', 'mm', 1.8, 0.04, 0.007) },
  { id: 'M07', code: 'FRZ-03', name: '5 Eksen Freze 3', model: '5X-1600', lineId: 'L2', type: 'cnc', product: 'Yanma odası muhafazası', partNumber: 'CMB-C-5003', operation: 'Op 20', cycleH: 5, batchSize: 1, spec: spec('Flanş kalınlığı', 'mm', 6, 0.05, 0.009) },
  { id: 'M08', code: 'FRZ-04', name: '5 Eksen Freze 4', model: '5X-1600', lineId: 'L2', type: 'cnc', product: 'Türbin muhafazası', partNumber: 'TRB-C-5104', operation: 'Op 20', cycleH: 5, batchSize: 1, spec: spec('Montaj flanşı çapı', 'mm', 820, 0.08, 0.014) },
  { id: 'M09', code: 'FRN-01', name: 'Vakum Fırını 1', model: 'VF-1200', lineId: 'L3', type: 'furnace', product: 'Disk ve şaftlar · çözeltiye alma', partNumber: 'ISL-ÇZ-01', operation: 'Op 50', cycleH: 10, batchSize: 6, spec: spec('Sertlik', 'HRC', 30, 4, 0.7) },
  { id: 'M10', code: 'FRN-02', name: 'Vakum Fırını 2', model: 'VF-1200', lineId: 'L3', type: 'furnace', product: 'Disk ve şaftlar · yaşlandırma', partNumber: 'ISL-YŞ-02', operation: 'Op 60', cycleH: 12, batchSize: 6, spec: spec('Sertlik', 'HRC', 42, 3, 0.5) },
  { id: 'M11', code: 'KPL-01', name: 'Plazma Sprey Kaplama', model: 'PS-300', lineId: 'L3', type: 'coating', product: 'Muhafaza · termal bariyer kaplama', partNumber: 'KPL-TBC-01', operation: 'Op 70', cycleH: 1.5, batchSize: 1, spec: spec('Kaplama kalınlığı', 'µm', 300, 40, 7) },
  { id: 'M12', code: 'CMM-01', name: 'Koordinat Ölçüm Makinesi', model: 'CMM-1210', lineId: 'L4', type: 'cmm', product: 'Son ölçüm (tüm parçalar)', partNumber: 'ÖLÇ-SON', operation: 'Op 90', cycleH: 1, batchSize: 1, spec: spec('Referans bilye sapması', 'µm', 0, 2, 0.4) },
]

/** Günlük hedef = ideal çevrim kapasitesi × planlanan verimlilik (%72), tam sayı parça */
const PLANNED_ATTAINMENT = 0.72

export const MACHINES: Machine[] = DEFS.map((d, i) => ({
  id: d.id,
  code: d.code,
  name: d.name,
  model: d.model,
  lineId: d.lineId,
  type: d.type,
  product: d.product,
  partNumber: d.partNumber,
  operation: d.operation,
  batchSize: d.batchSize,
  orderNo: `İE-${26100 + i * 7}`,
  idealRate: d.batchSize / (d.cycleH * 3600),
  dailyTarget: Math.max(1, Math.round(((d.batchSize * 24) / d.cycleH) * PLANNED_ATTAINMENT)),
  spec: d.spec,
}))

MACHINES.forEach((m, i) => {
  const b = tagBaselines(m, i)
  m.channels = channelInfos(TAGS[m.type].map((d) => ({ ...d, baseline: b[d.tag] ?? null })))
})

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

/** Hikâye: B vardiyasında FRZ-04'teki operatör yeni başlamış (yavaşlık nedeni "operatör tecrübesi"). */
const rookie = PEOPLE.find((p) => p.id === 'O-B-M08')
if (rookie) rookie.experienceYears = 0.4

/** Personel sicil numarası (SQL Server'daki EmployeeId) */
export const EMPLOYEE_NO: Record<string, string> = Object.fromEntries(PEOPLE.map((p, i) => [p.id, `P${1001 + i}`]))

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
