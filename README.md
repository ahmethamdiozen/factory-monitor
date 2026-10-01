# Fabrika Monitör — Prototip

Fabrikadaki makine metriklerini (SQL Server'da tutulan) anlamlı bilgiye çevirip web üzerinde görselleştiren, **tamamen offline / localhost** çalışan prototip.

Veri, fabrikadaki gerçek yolu izler:

```
[Makine simülatörü] → [SQL Server (Docker)] → [Collector] → [SQLite] → [API] → [Ekranlar]
   fabrika tarafı       bize verilecek olan     bizim sistem: anlamlandırma burada
```

Gerçek veri geldiğinde sadece ilk kutu (simülatör) kalkar; gerisi aynen çalışır.

## Kurulumsuz demo (web)

**https://ahmethamdiozen.github.io/factory-monitor/**

Hiçbir şey kurmadan tarayıcıda açılır. Bu sürümde tüm hat (makine simülasyonu → SQL Server'a yazılacak ham satırlar → collector'ın anlamlandırması) tarayıcının içinde çalışır; SQL Server, collector ve API yoktur. Ekranlar tam sürümle aynıdır. `main`'e her push'ta GitHub Actions ile otomatik güncellenir (`.github/workflows/pages.yml`). Yerelde denemek için: `npm run dev:demo`.

## Tam sürüm (SQL Server ile) — hızlı başlangıç

Gereksinimler:
- [Node.js](https://nodejs.org) **22.13 veya üzeri** (24 LTS önerilir). Collector, Node'un yerleşik `node:sqlite` modülünü kullanır; daha eski Node sürümlerinde çalışmaz. Sürümü `node -v` ile kontrol edin.
- Git
- [Docker Desktop](https://www.docker.com/products/docker-desktop/). **Apple Silicon (M1/M2/M3…) Mac'lerde:** Settings → General → *"Use Rosetta for x86_64/amd64 emulation on Apple Silicon"* açık olmalı. Kapalıysa SQL Server açılır açılmaz çöker.

1. Repoyu klonla ve klasöre gir:
   ```bash
   git clone https://github.com/ahmethamdiozen/factory-monitor.git
   cd factory-monitor
   ```
2. Ayar dosyasını oluştur (Windows'ta `cp` yerine `copy`):
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

İlk açılışta simülatör son 48 saati SQL Server'a yazar (~2 sn), collector bunu okur (~2 sn), sonra her şey gerçek saatle 10 sn'de bir akar. Durdurmak için `Ctrl + C`; SQL Server'ı kapatmak için `npm run db:down`.

### Windows

**Seçenek 1 — Docker ile (en kolay):**
1. [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)'u kurun. Kurulum WSL 2'yi ister; onaylayın ve bilgisayarı yeniden başlatın.
2. Docker Desktop'ı açın, sol altta "Engine running" yazana kadar bekleyin.
3. PowerShell'de yukarıdaki 1–6. adımları uygulayın (`cp` yerine `copy .env.example .env`).

**Seçenek 2 — Docker'sız, SQL Server'ı doğrudan kurarak:**
1. [SQL Server 2022 Express](https://www.microsoft.com/sql-server/sql-server-downloads)'i (ücretsiz) indirin, **Custom** kurulumu seçin.
2. Kurulumda *Database Engine Configuration* adımında **Mixed Mode**'u seçin ve `sa` için bir şifre belirleyin.
3. **SQL Server Configuration Manager**'ı açın → *SQL Server Network Configuration* → *Protocols for SQLEXPRESS* → **TCP/IP**'yi *Enabled* yapın. TCP/IP'nin özelliklerinde *IP Addresses* sekmesinin en altındaki **IPAll** bölümünde *TCP Dynamic Ports*'u boşaltın ve *TCP Port*'a `1433` yazın.
4. *SQL Server Services* altında **SQL Server (SQLEXPRESS)**'i yeniden başlatın.
5. `copy .env.example .env` yapın ve `.env` içindeki `MSSQL_SA_PASSWORD`'ü kurulumda belirlediğiniz şifreyle değiştirin.
6. `npm install`, sonra `npm run stack` (bu seçenekte `npm run db:up` **çalıştırılmaz**). Veritabanı ve tablolar ilk açılışta otomatik oluşur.

### Mac (Intel)

Mac için SQL Server'ın doğrudan kurulan sürümü yoktur; Docker gerekir. Intel Mac'lerde Rosetta ayarı **gerekmez**, SQL Server doğrudan çalışır:
1. [Docker Desktop for Mac — Intel chip](https://www.docker.com/products/docker-desktop/) sürümünü kurun ve açın.
2. Terminalde yukarıdaki 1–6. adımları uygulayın.

Docker kurmak istemeyen herkes için: yukarıdaki **kurulumsuz demo** linki.

## Ekranlar

Üst çubuğun ortasındaki 4 buton:

| Buton | Yol | Kimin için | İçerik |
|---|---|---|---|
| **Makine** | `/makine-ekrani/:id` | Makine başındaki operatör (tablet) | Büyük durum bandı, bu vardiya üretilen / hedef, "geridesin / öndesin", hız ve yavaşlık nedeni + ne yapmalı, son 1 saat hatalı ürün, saat saat üretim, yapılacaklar. Jargon yok. Tam ekran (kiosk) modu var. |
| **Foreman** | `/foreman/:hatId` | Hattın o vardiyadaki sorumlusu | Öncelikli müdahale listesi (öneriyle), vardiya hedefi ve vardiya sonu tahmini, hattın makineleri, saat saat plan/gerçek/fark/kayıp tablosu, en büyük 3 kayıp, ekip, önceki vardiyadan otomatik devir özeti. |
| **Mühendis** | `/` | Mühendis / yönetici | OEE, kayıp şelalesi, duruş Pareto, SPC (x̄–R, Western Electric, Cpk), **öngörücü bakım** (yapay zekâ ile arıza tahmini), vardiya ve personel analizi, olay günlüğü, metrik rehberi. |
| **SQL Veri** | `/sql` | Teknik ekip / sunum | Veri hattının canlı sağlığı (her halkanın durumu ve gecikmesi), SQL Server'daki ham tablolar, her tablonun nasıl anlamlandırıldığı. |

Header'daki **zil**: öngörücü bakım bildirimleri (bakım ekibi ve hattın foreman'i için), "Okundu / Bakım planlandı / Kapat" durumlarıyla.

Backend koparsa ekranlar **eldeki son veriyi göstermeye devam eder**, sağ üstte (kiosk modunda sağ altta) "Yeni veri alınamıyor · son veri 17:42:10" uyarısı çıkar. Collector veya simülatör durursa "Veri gecikiyor" uyarısı çıkar.

## Veri hattı

### 1. Simülatör (`server/simulator/`) — fabrika tarafı
12 makineyi gerçek saatle simüle eder, PLC/SCADA'nın yazacağı satırları SQL Server'a yazar. **Yavaşlık nedenini yazmaz**; sadece sinyal üretir (sıcaklık, titreşim, besleme %, takım çevrim sayısı, hammadde lotu, çevrim süresi). Demo için gömülü hikâyeler başlangıç anına göre kurgulanır: MNT-01 hızla yıpranıyor (yapay zekâ ~3 saat sonraki arızayı önceden haber verir), PKT-04'ün 3 saat önceki arızası önceden uyarılmıştı, ENJ-02 takım aşınması (SPC alarmı), ENJ-04 aşırı ısınma, Hat 3 besleme dalgalanması, PKT-02 malzeme beklemesi, MNT-02 planlı bakım, ENJ-03 kalıp değişimi, MNT-04'te B vardiyasında yeni operatör.

- `npm run sim` kaldığı yerden devam eder (aradaki boşluğu doldurur)
- `npm run sim:reset` her şeyi silip son 48 saati yeniden üretir (sunumdan hemen önce önerilir)

### 2. SQL Server (`server/sql/schema.sql`) — bize verilecek olan
`Machines`, `Lines`, `DowntimeReasons`, `Employees`, `ShiftDefinitions`, `ShiftAssignments`, `WorkOrders` (referans) ve `MachineEvents` (sadece durum değişince), `ProductionCounters` (10 sn'de bir **kümülatif** sayaç, 06:00'da sıfırlanır), `ProcessValues`, `QualitySamples` (ölçüm). Zamanlar UTC, tablolar sadece ekleme.

### 3. Collector (`server/collector/`) — anlamlandırma
5 sn'de bir sadece yeni satırları (`Id > son okunan`) salt-okur çeker ve `src/pipeline/transform.ts` ile dönüştürür:
kümülatif sayaç → 10 sn'lik OK/NOK · olaylar → dilim durumu + duruş kayıtları · çevrim süresi → hız % · sinyaller + **kural motoru** (`src/lib/rules.ts`) → yavaşlık nedeni · ölçümler → SPC alt grupları. Sonuç `data/factory.db` (SQLite) dosyasına yazılır. Yeniden başlarsa kaldığı yerden devam eder; SQL Server sıfırlanırsa kendini yeniden kurar.

### 4. API (`server/api/`, port 3001)
`/api/meta`, `/api/series`, `/api/events`, `/api/spc` (SQLite'tan), `/api/health`, `/api/sql/tables`, `/api/sql/table/:ad` (SQL Server'dan, salt-okur, beyaz listeli). Vite geliştirme sunucusu `/api` isteklerini buraya yönlendirir.

## Öngörücü bakım (yapay zekâ ile arıza tahmini)

**Soru:** "Bu makinede önümüzdeki 24 saatte arıza olacak mı?" **Model karar verir, mesajı şablon yazar** (ileride küçük dil modeli bağlanacak; sadece `src/ml/notify.ts` içindeki `composeMessage()` değişir).

- **Belirtiler:** simülatörde her makinenin gizli bir yıpranma seviyesi vardır. Yıpranma motor akımını (`ProcessValues.MotorCurrentA`), titreşimi, mikro duruş sıklığını ve çevrim süresi düzensizliğini artırır, sonunda arızaya yol açar. Arızaların bir kısmı (sensör/PLC) ani ve belirtisizdir; bunları hiçbir model önceden göremez.
- **Özellikler:** `src/ml/features.ts` son 1–24 saatin eğilimlerini çıkarır. Eğitimde ve canlıda **aynı kod** çalışır.
- **Model:** Python'da (scikit-learn, Gradient Boosting) eğitilir, ağaçlar `src/ml/modelData.ts`'e aktarılır ve TypeScript'te çalışır: tam sürümde collector'da (5 dk'da bir → SQLite `risk`, `notification`), web demosunda tarayıcıda. TS tahminlerinin Python'la aynı olduğu testle doğrulanır.
- **Sonuç (simüle 180 gün, modelin görmediği son 30 günde):** öngörülebilir arızaların ~%69'u ortalama ~16 saat önceden yakalanır; makine başına haftada ~0,4 boş alarm. Değerler `ml:train` çıktısında ve uygulamadaki **Öngörücü Bakım** sayfasındadır.
- **Ne kadar veri gerekir?** Belirleyici olan süre değil, arıza örneği sayısıdır (~50–100). Sayfadaki öğrenme eğrisi bunu gösterir; simülasyonda belirtiler basit olduğu için eğri erken düzleşir, gerçek veride daha yavaş yükselir.

Modeli yeniden eğitmek (isteğe bağlı; eğitilmiş model repoda hazır, uygulama için Python gerekmez):
```bash
# bir kere: Python 3.9+ sanal ortamı
python3 -m venv ml/.venv            # Windows: py -m venv ml\.venv
ml/.venv/bin/pip install -r ml/requirements.txt   # Windows: ml\.venv\Scripts\pip install -r ml\requirements.txt

npm run ml:dataset   # simülatörden 180 günlük eğitim verisi (~30 sn) → data/ml/dataset.csv
npm run ml:train     # eğitim + değerlendirme (~1 dk) → src/ml/modelData.ts
```
Ayrıntılar: [`ml/README.md`](ml/README.md).

## Diğer komutlar

```bash
npm test           # KPI, SPC, kural motoru ve dönüştürücü testleri (SQL gerektirmez)
npm run typecheck  # frontend + server TypeScript kontrolü
npm run build      # dist/ — statik dosyalar
npm run sim | collector | api | dev   # parçaları ayrı ayrı çalıştırmak için
npm run dev:demo   # kurulumsuz demo sürümünü yerelde aç (backend gerekmez)
npm run build:demo # demo sürümünü dist/'e derle (GitHub Pages'e giden)
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
  ml/exportDataset.ts    eğitim verisi üretici
ml/                      Python: train.py, requirements.txt
src/
  sim/                   makine simülasyonu (machineSim), PLC kaydedici, tohum veri
  pipeline/              SQL satır tipleri, dönüştürücü (saf, testli), yerel test hattı
  lib/                   kpi.ts, spc.ts, rules.ts — saf hesaplar
  ml/                    öngörücü bakım: features, predict, riskEngine, notify, modelData (Python'dan üretilir)
  data/                  ApiDataSource (tam sürüm), demo/DemoDataSource (web demosu), registry, snapshot, shiftView
  components/, pages/    arayüz (operator/, foreman/, SqlData, mühendis sayfaları)
```

Stack: Vite + React + TypeScript · Tailwind v4 · Apache ECharts · AG Grid Community · Zustand · Fastify · mssql · node:sqlite.

## Gerçek veriye geçiş

1. `.env`'deki SQL Server bağlantısını fabrikanın sunucusuna çevir, simülatörü çalıştırma.
2. `server/collector/index.ts` içindeki SELECT'leri gerçek tablo/kolon adlarına eşle (satır tipleri `src/pipeline/rows.ts`).
3. Durum/neden kodları farklıysa `stateFromSqlStatus` ve `DowntimeReasons` eşlemesini güncelle; kural eşiklerini (`src/lib/rules.ts`) gerçek sinyallere göre ayarla.
