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
  ProductionCounters: { key: 'Id', time: 'SampleTimeUtc', kind: 'ölçüm', how: 'Kümülatif sayaçlar ardışık okumaların farkı alınarak 10 sn\'lik OK/NOK adetlerine çevrilir; gün başında sayaç sıfırlanınca fark yeniden başlatılır.' },
  ProcessValues: { key: 'Id', time: 'SampleTimeUtc', kind: 'ölçüm', how: 'Çevrim süresi ideal çevrimle kıyaslanıp hız %\'si bulunur. Sıcaklık, titreşim, besleme, takım sayacı ve lot kurallara girer; yavaşlık nedeni buradan çıkarılır. Motor akımı, titreşim ve çevrim oynaklığı öngörücü bakım modelinin girdisidir: yıpranan makinede akım yavaşça yükselir.' },
  MachineEvents: { key: 'EventId', time: 'EventTimeUtc', kind: 'olay', how: 'Durum sadece değişince kaydedilir; 10 sn\'lik dilimlere ileri doldurulur ve başlangıç–bitişli duruş kayıtlarına dönüştürülür. Arızadan dönüş "ısınma" kuralını tetikler.' },
  QualitySamples: { key: 'Id', time: 'SampleTimeUtc', kind: 'ölçüm', how: '5\'li ölçümler alt gruplara toplanır (ortalama + aralık); x̄–R kontrol grafiği, Western Electric kuralları ve Cpk bunlardan hesaplanır.' },
  Machines: { key: 'MachineId', kind: 'referans', how: 'İdeal çevrim süresi (hız %) ve günlük hedef (plan) hesaplarının temelidir; tolerans alanları SPC\'de kullanılır.' },
  Lines: { key: 'LineId', kind: 'referans', how: 'Makineleri hatlara gruplar; foreman ekranı hat bazındadır.' },
  DowntimeReasons: { key: 'ReasonCode', kind: 'referans', how: 'Duruş kodlarını açıklamaya ve kategoriye çevirir; planlı duruşlar OEE paydasından düşülür.' },
  Employees: { key: 'EmployeeId', kind: 'referans', how: 'İşe giriş tarihinden tecrübe hesaplanır; 1 yıldan az tecrübe "operatör uyumu" kuralına girer.' },
  ShiftAssignments: { key: 'AssignmentId', kind: 'referans', how: 'Hangi gün/vardiyada hangi makinenin başında kimin olduğunu verir; kartlardaki operatör ve foreman buradan gelir.' },
  ShiftDefinitions: { key: 'ShiftCode', kind: 'referans', how: 'Vardiya pencereleri: vardiya hedefi, vardiya sonu tahmini ve devir özeti bu saatlere göre hesaplanır.' },
  WorkOrders: { key: 'WorkOrderNo', kind: 'referans', how: 'Makinede üretilen ürün ve iş emri numarası.' },
}
