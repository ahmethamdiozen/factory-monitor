# Fabrika Monitör — Prototip

Fabrikadaki makine metriklerini (SQL Server'da tutulan) anlamlı bilgiye çevirip web üzerinde görselleştiren, **tamamen offline / localhost** çalışan prototip.

Örnek tesis bir **jet motoru parça atölyesidir**: 4 hücre, 12 makine.

| Hücre | Makineler | Parçalar |
|---|---|---|
| Hücre 1 · Döner Parçalar | TRN-01/02 dikey torna (VTL), TRN-03 CNC torna, TAS-01 silindirik taşlama | HPT/HPC türbin ve kompresör diskleri, LPT ana şaft |
| Hücre 2 · Blisk & Muhafaza | FRZ-01…04 5 eksen freze | fan ve kompresör bliskleri, yanma odası ve türbin muhafazaları |
| Hücre 3 · Isıl İşlem & Kaplama | FRN-01/02 vakum fırını (6 parçalık şarj), KPL-01 plazma sprey | çözeltiye alma, yaşlandırma, termal bariyer kaplama |
| Hücre 4 · Ölçüm & Kalite | CMM-01 koordinat ölçüm | son ölçüm |

Çevrimler saatler sürer (1–12 sa), günlük hedefler birkaç parçadır. Bu yüzden ekranlar "ürün/sn" yerine **şu anki parçanın ilerlemesini**, **ilerleme hızını** (ideal çevrime göre) ve **parçaların ne zaman bittiğini** gösterir. Uygunsuz parçalar MRB'ye (malzeme inceleme kurulu) gider.

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
| **Makine** | `/makine-ekrani/:id` | Makine başındaki operatör (tablet) | Büyük durum bandı, bu vardiya tamamlanan / hedef parça, "planın ~1 sa gerisindesin", şu anki parçanın ilerlemesi ve tahmini bitişi, yavaşlık nedeni + ne yapmalı, uygunsuz parça ve son ara ölçüm, vardiya zaman çizgisi, yapılacaklar. Jargon yok. Tam ekran (kiosk) modu var. |
| **Foreman** | `/foreman/:hucreId` | Hücrenin o vardiyadaki sorumlusu | Öncelikli müdahale listesi (öneriyle), vardiya hedefi ve vardiya sonu tahmini, hücrenin makineleri, makine makine vardiya zaman çizgisi ve tamamlanan parçalar tablosu (süre / ideal / sonuç), en büyük 3 kayıp, ekip, önceki vardiyadan otomatik devir özeti. |
| **Mühendis** | `/` | Mühendis / yönetici | OEE, kayıp şelalesi, duruş Pareto, SPC (x̄–R, Western Electric, Cpk), **öngörücü bakım** (yapay zekâ ile arıza tahmini), vardiya ve personel analizi, olay günlüğü, metrik rehberi. |
| **SQL Veri** | `/sql` | Teknik ekip / sunum | Veri hattının canlı sağlığı (her halkanın durumu ve gecikmesi), SQL Server'daki ham tablolar, her tablonun nasıl anlamlandırıldığı. |

Header'daki **zil**: öngörücü bakım bildirimleri (bakım ekibi ve hücrenin foreman'i için), "Okundu / Bakım planlandı / Kapat" durumlarıyla.

Backend koparsa ekranlar **eldeki son veriyi göstermeye devam eder**, sağ üstte (kiosk modunda sağ altta) "Yeni veri alınamıyor · son veri 17:42:10" uyarısı çıkar. Collector veya simülatör durursa "Veri gecikiyor" uyarısı çıkar.

## Veri hattı

### 1. Simülatör (`server/simulator/`) — fabrika tarafı
12 makineyi gerçek saatle simüle eder, PLC/SCADA'nın yazacağı satırları SQL Server'a yazar. Makine tipine göre davranır (tezgâh, taşlama, fırın şarjı, kaplama, CMM). **Yavaşlık nedenini yazmaz**; sadece sinyal üretir (makine tipine göre sensör etiketleri, takım çevrim sayısı, malzeme partisi, çevrim süresi). Demo için gömülü hikâyeler başlangıç anına göre kurgulanır: FRZ-01'in iş mili rulmanı ~4 gündür bozuluyor (yapay zekâ ~3 saat sonraki arızayı ve kaynağını önceden haber verir), FRN-02'nin ~3 saat önceki vakum pompası arızası önceden uyarılmıştı, TRN-02 takım aşınması (SPC alarmı), TAS-01 soğutma sıvısı sıcak, FRZ-03 titreşim nedeniyle ilerleme düşürüldü, KPL-01 toz besleme dalgalanması, FRN-01 parça bekliyor, FRZ-02 planlı bakım, TRN-03 program / fikstür değişimi, FRZ-04'te B vardiyasında yeni operatör.

- `npm run sim` kaldığı yerden devam eder (aradaki boşluğu doldurur)
- `npm run sim:reset` her şeyi silip son 48 saati yeniden üretir (sunumdan hemen önce önerilir)
- Şema sürümü (`dbo.SchemaInfo`) değişmişse simülatör tabloları kendiliğinden yeniden kurar; collector da bunu görüp SQLite'ı sıfırdan doldurur

### 2. SQL Server (`server/sql/schema.sql`) — bize verilecek olan
`Machines` (makine tipi, parça numarası, operasyon, şarj büyüklüğü, ideal çevrim), `Lines` (hücreler), `DowntimeReasons`, `Employees`, `ShiftDefinitions`, `ShiftAssignments`, `WorkOrders` (referans) ve `MachineEvents` (sadece durum değişince), `ProductionCounters` (10 sn'de bir **kümülatif** sayaç, 06:00'da sıfırlanır), `ProcessValues` (çevrim süresi, takım sayacı, malzeme partisi), `ProcessTags` (historian: sensör etiketleri) ve `MachineTags` (etiket sözlüğü + devreye alma referansı), `QualitySamples` (ölçüm). Zamanlar UTC, tablolar sadece ekleme.

### 3. Collector (`server/collector/`) — anlamlandırma
5 sn'de bir sadece yeni satırları (`Id > son okunan`) salt-okur çeker ve `src/pipeline/transform.ts` ile dönüştürür:
kümülatif sayaç → tamamlanan uygun / uygunsuz parçalar · historian etiketleri → ortak kanallar (referansa göre) · olaylar → dilim durumu + duruş kayıtları · çevrim süresi → ilerleme hızı % · sinyaller + **kural motoru** (`src/lib/rules.ts`) → yavaşlık nedeni · ölçümler → SPC alt grupları. Sonuç `data/factory.db` (SQLite) dosyasına yazılır. Yeniden başlarsa kaldığı yerden devam eder; SQL Server sıfırlanırsa kendini yeniden kurar.

### 4. API (`server/api/`, port 3001)
`/api/meta`, `/api/series`, `/api/events`, `/api/spc` (SQLite'tan), `/api/health`, `/api/sql/tables`, `/api/sql/table/:ad` (SQL Server'dan, salt-okur, beyaz listeli). Vite geliştirme sunucusu `/api` isteklerini buraya yönlendirir.

## Öngörücü bakım (yapay zekâ ile arıza tahmini)

**Soru:** "Bu makinede önümüzdeki 3 gün (72 saat) içinde arıza olacak mı, olacaksa olası kaynağı ne?" **Model karar verir, mesajı şablon yazar** (ileride küçük dil modeli bağlanacak; sadece `src/ml/notify.ts` içindeki `composeMessage()` değişir).

- **Sinyaller (historian):** sensörler `dbo.ProcessTags` tablosuna etiket etiket yazılır (makine tipine göre 1–7 etiket: iş mili yükü, RMS titreşim, rulman zarf titreşimi, yatak sıcaklığı, soğutma basıncı, eksen servo akımı; fırında sıcaklık / set değeri / vakum / ısıtıcı gücü; kaplamada tabanca gerilimi / toz besleme / soğutma suyu). `dbo.MachineTags` etiketleri ortak kanallara eşler ve **devreye alma referansını** tutar; kurallar ve model değerleri bu referansa göre (oran / fark) yorumlar.
- **Arıza fiziği (simülasyon):** her makine tipinin kendi arıza türleri vardır (CNC: iş mili rulmanı, eksen / vidalı mil, soğutma; fırın: ısıtıcı eleman, vakum pompası; kaplama: tabanca / elektrot, toz besleyici). Bozulma rastgele başlar, P-F eğrisiyle ilerler ve kendine özgü iz bırakır (rulmanda önce yüksek frekans titreşim, sonra RMS titreşim, en son sıcaklık). Belirti şiddeti arızadan arızaya değişir; arızaya benzeyen durumlar (ağır kesim, filtre tıkanması, şarj ağırlığı, kapı contası kaçağı, gaz tüpü değişimi) ve kablosuz sensör kopmaları vardır. Kontrol / elektrik arızaları ve takım kırılması belirtisizdir; bunları hiçbir model önceden göremez.
- **Özellikler:** `src/ml/features.ts` her kanalın referansa oranını ve 24 saatlik eğilimini, kısa duruşları, çevrim düzensizliğini ve makine tipini çıkarır; eksik ölçümler atlanır. Eğitimde ve canlıda **aynı kod** çalışır.
- **Olası kaynak:** riski artıran sinyaller hangi arıza türünün iziyle örtüşüyorsa o tür ve bakım önerisi bildirimde gösterilir (`src/ml/predict.ts`, `src/lib/failureModes.ts`).
- **Model:** Python'da (scikit-learn, Gradient Boosting) eğitilir, ağaçlar `src/ml/modelData.ts`'e aktarılır ve TypeScript'te çalışır: tam sürümde collector'da (5 dk'da bir → SQLite `risk`, `notification`), web demosunda tarayıcıda. TS tahminlerinin Python'la aynı olduğu testle doğrulanır.
- **Sonuç (simüle 365 gün, modelin görmediği son 90 günde):** öngörülebilir arızaların ~%77'si ortalama ~2 gün önceden yakalanır; makine başına haftada ~0,5 boş alarm (alarmların ~yarısı gerçek arızaya denk gelir); olası kaynak yakalanan arızaların ~%83'ünde doğru. Değerler `ml:train` çıktısında ve uygulamadaki **Öngörücü Bakım** sayfasındadır (arıza türüne göre tablo dahil). Bunlar simülasyon sonuçlarıdır; gerçek veride model aynı yöntemle yeniden eğitilir.
- **Ne kadar veri gerekir?** Belirleyici olan süre değil, arıza örneği sayısıdır. Sayfadaki öğrenme eğrisi: 1 aylık veriyle ~%42, ~90 arıza örneğiyle ~%73'e çıkar, sonra yavaşlar.

Modeli yeniden eğitmek (isteğe bağlı; eğitilmiş model repoda hazır, uygulama için Python gerekmez):
```bash
# bir kere: Python 3.9+ sanal ortamı
python3 -m venv ml/.venv            # Windows: py -m venv ml\.venv
ml/.venv/bin/pip install -r ml/requirements.txt   # Windows: ml\.venv\Scripts\pip install -r ml\requirements.txt

npm run ml:dataset   # simülatörden 365 günlük eğitim verisi (~1,5 dk) → data/ml/dataset.csv
npm run ml:train     # eğitim + değerlendirme (~5 dk) → src/ml/modelData.ts
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
