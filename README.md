# Fabrika Monitör — Prototip

Fabrikadaki makine metriklerini (SQL Server'da tutulan) anlamlı bilgiye çevirip web üzerinde görselleştiren, **tamamen offline / localhost** çalışan prototip.

Veri, fabrikadaki gerçek yolu izler:

```
[Makine simülatörü] → [SQL Server (Docker)] → [Collector] → [SQLite] → [API] → [Ekranlar]
   fabrika tarafı       bize verilecek olan     bizim sistem: anlamlandırma burada
```

Gerçek veri geldiğinde sadece ilk kutu (simülatör) kalkar; gerisi aynen çalışır.

## Hızlı başlangıç

Gereksinimler:
- [Node.js](https://nodejs.org) **20.19+** (ya da 22.12+). SQLite için Node'un yerleşik `node:sqlite` modülü kullanılır; **Node 24 önerilir**.
- Git
- [Docker Desktop](https://www.docker.com/products/docker-desktop/). **Apple Silicon (M1/M2/M3…) Mac'lerde:** Settings → General → *"Use Rosetta for x86_64/amd64 emulation on Apple Silicon"* açık olmalı. Kapalıysa SQL Server açılır açılmaz çöker.

1. Repoyu klonla ve klasöre gir:
   ```bash
   git clone https://github.com/ahmethamdiozen/factory-monitor.git
   cd factory-monitor
   ```
2. Ayar dosyasını oluştur:
   ```bash
   cp .env.example .env
   ```
3. Bağımlılıkları kur (ilk seferde internet gerekir, sonrasında gerekmez):
   ```bash
   npm install
   ```
4. SQL Server'ı başlat (ilk seferde ~1,5 GB imaj iner; sağlıklı olana kadar bekler):
   ```bash
   npm run db:up
   ```
5. Tüm hattı başlat — simülatör, collector, API ve web aynı terminalde:
   ```bash
   npm run stack
   ```
6. Tarayıcıda aç: **http://localhost:5173**

İlk açılışta simülatör son 24 saati SQL Server'a yazar (~1 sn), collector bunu okur (~1 sn), sonra her şey gerçek saatle 10 sn'de bir akar. Durdurmak için `Ctrl + C`; SQL Server'ı kapatmak için `npm run db:down`.

## Ekranlar

Üst çubuğun ortasındaki 4 buton:

| Buton | Yol | Kimin için | İçerik |
|---|---|---|---|
| **Makine** | `/makine-ekrani/:id` | Makine başındaki operatör (tablet) | Büyük durum bandı, bu vardiya üretilen / hedef, "geridesin / öndesin", hız ve yavaşlık nedeni + ne yapmalı, son 1 saat hatalı ürün, saat saat üretim, yapılacaklar. Jargon yok. Tam ekran (kiosk) modu var. |
| **Foreman** | `/foreman/:hatId` | Hattın o vardiyadaki sorumlusu | Öncelikli müdahale listesi (öneriyle), vardiya hedefi ve vardiya sonu tahmini, hattın makineleri, saat saat plan/gerçek/fark/kayıp tablosu, en büyük 3 kayıp, ekip, önceki vardiyadan otomatik devir özeti. |
| **Mühendis** | `/` | Mühendis / yönetici | OEE, kayıp şelalesi, duruş Pareto, SPC (x̄–R, Western Electric, Cpk), vardiya ve personel analizi, olay günlüğü, metrik rehberi. |
| **SQL Veri** | `/sql` | Teknik ekip / sunum | Veri hattının canlı sağlığı (her halkanın durumu ve gecikmesi), SQL Server'daki ham tablolar, her tablonun nasıl anlamlandırıldığı. |

Backend koparsa ekranlar **eldeki son veriyi göstermeye devam eder**, sağ üstte (kiosk modunda sağ altta) "Yeni veri alınamıyor · son veri 17:42:10" uyarısı çıkar. Collector veya simülatör durursa "Veri gecikiyor" uyarısı çıkar.

## Veri hattı

### 1. Simülatör (`server/simulator/`) — fabrika tarafı
12 makineyi gerçek saatle simüle eder, PLC/SCADA'nın yazacağı satırları SQL Server'a yazar. **Yavaşlık nedenini yazmaz**; sadece sinyal üretir (sıcaklık, titreşim, besleme %, takım çevrim sayısı, hammadde lotu, çevrim süresi). Demo için gömülü hikâyeler başlangıç anına göre kurgulanır: ENJ-02 takım aşınması (SPC alarmı), ENJ-04 aşırı ısınma, Hat 3 besleme dalgalanması, PKT-02 malzeme beklemesi, MNT-02 planlı bakım, ENJ-03 kalıp değişimi, MNT-04'te B vardiyasında yeni operatör.

- `npm run sim` kaldığı yerden devam eder (aradaki boşluğu doldurur)
- `npm run sim:reset` her şeyi silip son 24 saati yeniden üretir (sunumdan hemen önce önerilir)

### 2. SQL Server (`server/sql/schema.sql`) — bize verilecek olan
`Machines`, `Lines`, `DowntimeReasons`, `Employees`, `ShiftDefinitions`, `ShiftAssignments`, `WorkOrders` (referans) ve `MachineEvents` (sadece durum değişince), `ProductionCounters` (10 sn'de bir **kümülatif** sayaç, 06:00'da sıfırlanır), `ProcessValues`, `QualitySamples` (ölçüm). Zamanlar UTC, tablolar sadece ekleme.

### 3. Collector (`server/collector/`) — anlamlandırma
5 sn'de bir sadece yeni satırları (`Id > son okunan`) salt-okur çeker ve `src/pipeline/transform.ts` ile dönüştürür:
kümülatif sayaç → 10 sn'lik OK/NOK · olaylar → dilim durumu + duruş kayıtları · çevrim süresi → hız % · sinyaller + **kural motoru** (`src/lib/rules.ts`) → yavaşlık nedeni · ölçümler → SPC alt grupları. Sonuç `data/factory.db` (SQLite) dosyasına yazılır. Yeniden başlarsa kaldığı yerden devam eder; SQL Server sıfırlanırsa kendini yeniden kurar.

### 4. API (`server/api/`, port 3001)
`/api/meta`, `/api/series`, `/api/events`, `/api/spc` (SQLite'tan), `/api/health`, `/api/sql/tables`, `/api/sql/table/:ad` (SQL Server'dan, salt-okur, beyaz listeli). Vite geliştirme sunucusu `/api` isteklerini buraya yönlendirir.

## Diğer komutlar

```bash
npm test           # KPI, SPC, kural motoru ve dönüştürücü testleri (SQL gerektirmez)
npm run typecheck  # frontend + server TypeScript kontrolü
npm run build      # dist/ — statik dosyalar
npm run sim | collector | api | dev   # parçaları ayrı ayrı çalıştırmak için
```

Uygulama hiçbir dış kaynağa istek atmaz (font, ikon, avatar hepsi pakete gömülü).

## Proje yapısı

```
server/
  sql/schema.sql         SQL Server şeması
  simulator/             fabrika tarafı (gerçek veri gelince kalkar)
  collector/             SQL Server → dönüştür → SQLite
  api/                   Fastify API
  shared/                env, mssql, sqlite yardımcıları
src/
  sim/                   makine simülasyonu (machineSim), PLC kaydedici, tohum veri
  pipeline/              SQL satır tipleri, dönüştürücü (saf, testli), yerel test hattı
  lib/                   kpi.ts, spc.ts, rules.ts — saf hesaplar
  data/                  ApiDataSource, registry (API'den doldurulur), snapshot, shiftView
  components/, pages/    arayüz (operator/, foreman/, SqlData, mühendis sayfaları)
```

Stack: Vite + React + TypeScript · Tailwind v4 · Apache ECharts · AG Grid Community · Zustand · Fastify · mssql · node:sqlite.

## Gerçek veriye geçiş

1. `.env`'deki SQL Server bağlantısını fabrikanın sunucusuna çevir, simülatörü çalıştırma.
2. `server/collector/index.ts` içindeki SELECT'leri gerçek tablo/kolon adlarına eşle (satır tipleri `src/pipeline/rows.ts`).
3. Durum/neden kodları farklıysa `stateFromSqlStatus` ve `DowntimeReasons` eşlemesini güncelle; kural eşiklerini (`src/lib/rules.ts`) gerçek sinyallere göre ayarla.
