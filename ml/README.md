# Öngörücü bakım modeli

Bu klasör sadece **modeli eğitmek** içindir. Uygulama (tam sürüm ve web demosu) Python olmadan çalışır; eğitilmiş model `src/ml/modelData.ts` olarak repodadır.

## Akış

```
npm run ml:dataset  →  data/ml/dataset.csv   (TypeScript: simülatör + collector dönüşümü + src/ml/features.ts)
npm run ml:train    →  src/ml/modelData.ts   (Python: ml/train.py)
```

1. **Veri:** `server/ml/exportDataset.ts` simülatörü SQL'siz 365 gün çalıştırır (aynı PLC kaydedici ve collector dönüşümüyle). Her makine için saat başı bir satır yazar: özellikler (`src/ml/features.ts`), etiket (72 saat içinde arıza başlıyor mu), bir sonraki arızaya kalan süre, arızanın türü (öngörülebilir türlerden biri ya da belirtisiz) ve analiz için gizli bozulma seviyesi. Gizli bozulma ve arıza türü **modele girdi değildir**.
2. **Eğitim:** `train.py`
   - zamana göre böler: son 90 gün test; eşikler eğitim içindeki son 60 günlük doğrulama döneminde seçilir (teste bakılmaz); 72 saatlik etiket sızmasın diye aralarda 3 gün boşluk bırakılır
   - **Riskli** eşiği: makine başına haftada en fazla 0,5 boş alarm verecek şekilde; **Dikkat** eşiği daha hassas
   - olay bazında değerlendirir: arızadan 1–72 saat önce alarm verildiyse "yakalandı"; ardından 72 saat içinde arıza gelmeyen alarm dönemi "boş alarm"; arıza türüne göre ayrıca
   - **olası kaynak**: makine tipine göre özellik → arıza türü eşlemesi (`SOURCE_MAP`) modelle birlikte dışa aktarılır; yakalanan arızalarda ilk alarm anındaki kaynağın doğru olup olmadığı ölçülür
   - öğrenme eğrisi: 1 – 6 ay arası veriyle, her nokta 3 tohumun ortalaması
   - ağaçları JSON'a aktarır, kendi elle hesabının scikit-learn ile aynı olduğunu doğrular; 50 örnek tahmini dosyaya koyar (TypeScript testi bunlarla karşılaştırır)

## Gerçek veriye geçerken

- `dataset.csv`'yi simülatör yerine **gerçek SQLite verisinden** (collector'ın `bucket` tablosu + duruş kayıtları) üretmek gerekir. Özellik kodu (`src/ml/features.ts`) aynı kalır.
- Etiketin kalitesi her şeydir: arızaların doğru zaman ve **türle** (rulman, vakum pompası…) kayıtlı olması gerekir. Ani arızalar (kontrol / elektrik) ayrı tutulmalı.
- Devreye alma referansları (`dbo.MachineTags.Baseline`) her makine için kurulumun ilk haftasında ölçülmeli; büyük revizyondan sonra yenilenmeli.
- Notebook'ta çalışmak istersen: `ml/.venv/bin/pip install jupyter` ve `train.py`'deki fonksiyonları içe aktar.
