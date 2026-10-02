/**
 * "Fabrikanın" SQL Server tabloları: hangileri gösterilir ve her biri nasıl anlamlandırılır.
 * API (gerçek SQL Server) ve demo modu (tarayıcı içi) aynı tanımı kullanır.
 */
export interface SqlTableDef {
  key: string
  time?: string
  kind: 'ölçüm' | 'olay' | 'referans'
  how: string
}

export interface SqlTableInfo {
  name: string
  kind: SqlTableDef['kind']
  how: string
  rows: number
  lastTime: number | null
}

export interface SqlTableData {
  name: string
  columns: string[]
  rows: unknown[][]
}

/** Gösterilecek tablolar (beyaz liste) ve anlamlandırma açıklamaları */
export const SQL_TABLES: Record<string, SqlTableDef> = {
  ProductionCounters: { key: 'Id', time: 'SampleTimeUtc', kind: 'ölçüm', how: 'Tezgâhın kümülatif parça sayacı: ardışık okumaların farkı alınarak tamamlanan uygun / uygunsuz parçalar çıkarılır (fırında şarj sonunda tüm parçalar birden); gün başında sayaç sıfırlanınca fark yeniden başlatılır.' },
  ProcessValues: { key: 'Id', time: 'SampleTimeUtc', kind: 'ölçüm', how: 'Tezgâh kontrolörünün bağlam verisi: çevrim süresi ideal çevrimle kıyaslanıp ilerleme hızı bulunur; takım sayacı ve malzeme partisi (ısıl no) yavaşlık kurallarına girer.' },
  ProcessTags: { key: 'Id', time: 'SampleTimeUtc', kind: 'ölçüm', how: 'Historian: her satır bir sensör etiketi. Etiketler MachineTags ile ortak kanallara (sıcaklık, titreşim, rulman titreşimi, yük, eksen akımı, soğutma basıncı / vakum, besleme) eşlenir ve makinenin referansına göre yorumlanır. Kurallar yavaşlık nedenini, öngörücü bakım modeli arıza riskini ve olası kaynağı buradan çıkarır. Kopuk sensörün satırı yoktur; eksik ölçüm atlanır.' },
  MachineEvents: { key: 'EventId', time: 'EventTimeUtc', kind: 'olay', how: 'Durum sadece değişince kaydedilir; 10 sn\'lik dilimlere ileri doldurulur ve başlangıç–bitişli duruş kayıtlarına dönüştürülür. Arızadan dönüş iş mili "ısınma programı" kuralını tetikler.' },
  QualitySamples: { key: 'Id', time: 'SampleTimeUtc', kind: 'ölçüm', how: 'Tezgâh üstü prob / kalınlık / sertlik ölçümleri 5\'li alt gruplara toplanır (ortalama + aralık); x̄–R kontrol grafiği, Western Electric kuralları ve Cpk bunlardan hesaplanır.' },
  MachineTags: { key: 'MachineId', kind: 'referans', how: 'Etiket sözlüğü: birim, açıklama, ortak kanal eşlemesi ve devreye alma referansı (sağlıklı makinenin değeri). Gerçek veriye geçişte yeni etiketler sadece buraya eklenerek sisteme tanıtılır.' },
  OperationEvents: { key: 'Id', time: 'EventTimeUtc', kind: 'olay', how: 'MES: seri numaralı parçanın bir makinede operasyona başlaması ve bitirmesi (operatör, ısıl no, fırın şarj no, sonuç). Başlangıç ve bitiş tek operasyon kaydına birleştirilir; İzlenebilirlik ekranındaki parça geçmişi (AS9100) ve şu anki parça buradan gelir.' },
  Nonconformances: { key: 'Id', time: 'DetectedUtc', kind: 'olay', how: 'Uygunsuzluk raporu (NCR): hangi parça, hangi operasyonda, hangi uygunsuzluk. Kalite ekranındaki MRB listesi ve hücre / vardiya bazında uygunsuzluk sayıları buradan gelir.' },
  MrbDecisions: { key: 'Id', time: 'DecisionUtc', kind: 'olay', how: 'MRB kararı: olduğu gibi kullan (sapma onayı), yeniden işle veya hurda. NCR kaydına eklenir; parçanın rotada devam edip etmediği buradan anlaşılır.' },
  FurnaceRecipes: { key: 'MachineId', kind: 'referans', how: 'Isıl işlem reçetesi (AMS 2750): set değeri, gerekli tutma süresi, sıcaklık toleransı ve fırın sınıfı. Collector her şarjın tutma süresini ve set değerinden sapmasını buna göre değerlendirir.' },
  Machines: { key: 'MachineId', kind: 'referans', how: 'Makine tipi, parça numarası, operasyon, şarj büyüklüğü ve ideal çevrim süresi: hız %, şu anki parçanın ilerlemesi ve günlük hedef bunlardan hesaplanır; tolerans alanları SPC\'de kullanılır.' },
  Lines: { key: 'LineId', kind: 'referans', how: 'Makineleri hücrelere gruplar; foreman ekranı hücre bazındadır.' },
  DowntimeReasons: { key: 'ReasonCode', kind: 'referans', how: 'Duruş kodlarını açıklamaya ve kategoriye çevirir; planlı duruşlar OEE paydasından düşülür.' },
  Employees: { key: 'EmployeeId', kind: 'referans', how: 'İşe giriş tarihinden tecrübe hesaplanır; 1 yıldan az tecrübe "operatör uyumu" kuralına girer.' },
  ShiftAssignments: { key: 'AssignmentId', kind: 'referans', how: 'Hangi gün/vardiyada hangi makinenin başında kimin olduğunu verir; kartlardaki operatör ve foreman buradan gelir.' },
  ShiftDefinitions: { key: 'ShiftCode', kind: 'referans', how: 'Vardiya pencereleri: vardiya hedefi, vardiya sonu tahmini ve devir özeti bu saatlere göre hesaplanır.' },
  WorkOrders: { key: 'WorkOrderNo', kind: 'referans', how: 'Makinede işlenen parça ve iş emri numarası.' },
}
