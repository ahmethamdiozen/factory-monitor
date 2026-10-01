# Öngörücü bakım modeli

Bu klasör sadece **modeli eğitmek** içindir. Uygulama (tam sürüm ve web demosu) Python olmadan çalışır; eğitilmiş model `src/ml/modelData.ts` olarak repodadır.

## Akış

```
npm run ml:dataset  →  data/ml/dataset.csv   (TypeScript: simülatör + collector dönüşümü + src/ml/features.ts)
npm run ml:train    →  src/ml/modelData.ts   (Python: ml/train.py)
```

1. **Veri:** `server/ml/exportDataset.ts` simülatörü SQL'siz 180 gün çalıştırır. Her makine için saat başı bir satır yazar: özellikler (`src/ml/features.ts`), etiket (24 saat içinde arıza başlıyor mu), bir sonraki arızaya kalan süre, arızanın öngörülebilir (yıpranma kaynaklı) olup olmadığı ve analiz için gizli yıpranma seviyesi. Gizli yıpranma seviyesi **modele girdi değildir**.
2. **Eğitim:** `train.py`
   - zamana göre böler: ilk ~150 gün eğitim, son 30 gün test; eşikler eğitim içindeki son 30 günlük doğrulama döneminde seçilir (teste bakılmaz)
   - **Riskli** eşiği: makine başına haftada en fazla 0,5 boş alarm verecek şekilde; **Dikkat** eşiği daha hassas
   - olay bazında değerlendirir: arızadan 1–24 saat önce alarm verildiyse "yakalandı"; ardından 24 saat içinde arıza gelmeyen alarm dönemi "boş alarm"
   - öğrenme eğrisi: 1 hafta – 5 ay arası veriyle, her nokta 3 tohumun ortalaması
   - ağaçları JSON'a aktarır, kendi elle hesabının scikit-learn ile aynı olduğunu doğrular; 50 örnek tahmini dosyaya koyar (TypeScript testi bunlarla karşılaştırır)

## Gerçek veriye geçerken

- `dataset.csv`'yi simülatör yerine **gerçek SQLite verisinden** (collector'ın `bucket` tablosu + duruş kayıtları) üretmek gerekir. Özellik kodu (`src/ml/features.ts`) aynı kalır.
- Etiketin kalitesi her şeydir: arızaların doğru zaman ve nedenle kayıtlı olması gerekir. Ani arızalar (sensör/PLC) ayrı tutulmalı.
- Notebook'ta çalışmak istersen: `ml/.venv/bin/pip install jupyter` ve `train.py`'deki fonksiyonları içe aktar.
