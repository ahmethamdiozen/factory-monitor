# Fabrika Monitör — Prototip

Fabrikadaki makine metriklerini (SQL Server'da tutulan) anlamlı bilgiye çevirip web üzerinde görselleştiren, **tamamen offline / localhost** çalışan prototip.
Şu an veriler **simülatörden** (yer tutucu) gelir; gerçek veri gelince aynı arayüz SQL Server'a bağlanacak.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # KPI, SPC ve simülatör testleri
npm run typecheck
npm run build      # dist/ — statik dosyalar, internet gerektirmez
```

Uygulama hiçbir dış kaynağa istek atmaz (font, ikon, avatar hepsi pakete gömülü).

## Ekranlar

| Yol | Ekran |
|---|---|
| `/` | Fabrika Genel: OEE, günlük hedef, makine kartları (durum, ürün/sn, OK/NOK, operatör+foreman, hedef %, tahmini bitiş, yavaşlık nedeni), hat OEE trendi, canlı uyarılar |
| `/makine/:id` | Durum zaman çizgisi, hız & hedef eğrisi, saatlik NOK, hız dağılımı, yavaşlık/duruş nedenleri, ekip, olaylar |
| `/kayip` | OEE kayıp şelalesi (altı büyük kayıp), duruş Pareto, ısı haritası, yavaşlık nedenleri, makine tablosu (AG Grid) |
| `/kalite` | FPY, x̄–R SPC grafiği + Western Electric kuralları, Cp/Cpk, hata Pareto |
| `/personel` | Vardiya karşılaştırması, foreman ve operatör kartları |
| `/olaylar` | Olay günlüğü (AG Grid: filtre, arama, CSV) |
| `/metrikler` | Verimli fabrikalarda izlenen parametreler + gerçek veri için gereken alanlar |

Üst çubukta simülasyon kontrolleri: duraklat, hız (10× / 60× / 300×), sıfırla (17:40'a döner), tema.
Simülasyon 17:40'ta başlar ve içine sunum için bilinçli "hikâyeler" gömülüdür: ENJ-02 takım aşınması (SPC alarmı), PKT-02 malzeme beklemesi (Hat 3 besleme dalgalanması), MNT-02 planlı bakım, ENJ-03 kalıp değişimi, MNT-04'te yeni operatör.

## Mimari

```
src/
  lib/          kpi.ts (OEE, MTBF/MTTR, ETA…), spc.ts (kontrol limitleri, WE kuralları, Cpk) — saf fonksiyonlar, testli
  data/
    DataSource.ts        UI'ın veri sözleşmesi (10 sn'lik bucket'lı MachineSeries + olaylar)
    mock/                fabrika tanımı + tohumlu (seeded) simülatör
    snapshot.ts          makine/fabrika görünümleri, uyarılar
    store.ts             Zustand: tick, hız, tema
  components/   charts (ECharts sarmalayıcı), machine, ui (shadcn tarzı), layout
  pages/        ekranlar
```

Stack: Vite + React + TypeScript · Tailwind v4 · Apache ECharts · AG Grid Community · Zustand · React Router.

## Gerçek veriye geçiş

1. SQL Server → Node (Fastify + `mssql`) küçük bir API: durum kayıtları, üretim sayaçları, neden kodları, vardiya/personel, iş emirleri.
2. `DataSource` arayüzünü uygulayan `ApiDataSource` yaz (veriyi 10 sn'lik `MachineSeries` bucket'larına çevirir).
3. `src/data/store.ts` içinde `MockDataSource` yerine onu ver. UI değişmez.

Gereken alanların listesi uygulamada **Metrik Rehberi** sayfasında.
