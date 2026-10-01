import { CheckCircle2, CircleDashed, Database } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/card'

type Status = 'live' | 'data'

interface Item {
  name: string
  desc: string
  status: Status
  where?: string
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Verimlilik',
    items: [
      { name: 'OEE', desc: 'Kullanılabilirlik × Performans × Kalite. Fabrikanın "gerçekten değerli üretim yaptığı" süre oranı.', status: 'live', where: 'Genel, Kayıp, Makine' },
      { name: 'TEEP', desc: 'OEE’nin takvim süresine göre hali; planlı duruşlar dahil. Kapasite kullanımını gösterir.', status: 'live', where: 'Kayıp' },
    ],
  },
  {
    title: 'Hız',
    items: [
      { name: 'Ürün/sn ve hız %', desc: 'Anlık üretim hızı, ideal çevrim süresine kıyasla. %90 altı yavaşlık kabul edilir.', status: 'live', where: 'Makine kartı' },
      { name: 'Çevrim / takt süresi', desc: 'Bir ürünün ideal üretim süresi ve müşteri talebine göre hedeflenen ritim.', status: 'data' },
      { name: 'Yavaşlık nedeni', desc: 'Takım aşınması, hammadde, sıcaklık, operatör uyumu, ısınma… kayıp adetleriyle sıralanır.', status: 'live', where: 'Kart, Makine, Kayıp' },
    ],
  },
  {
    title: 'Duruş & Bakım',
    items: [
      { name: 'MTBF / MTTR', desc: 'Arızalar arası ortalama süre / ortalama onarım süresi. Güvenilirliğin ve bakım hızının ölçüsü.', status: 'live', where: 'Kayıp, Makine' },
      { name: 'Duruş Pareto’su', desc: 'Kayıp süresinin çoğunu hangi 2–3 nedenin oluşturduğunu gösterir (%80/20).', status: 'live', where: 'Kayıp' },
      { name: 'Mikro duruşlar', desc: '2 dakikadan kısa, kayda geçmeyen ama toplamda büyük kayıp yaratan duruşlar.', status: 'live', where: 'Olay Günlüğü' },
      { name: 'Ayar / kalıp değişim süresi (SMED)', desc: 'Ürün değişiminde kaybedilen süre; kısaltmak küçük partili üretimi mümkün kılar.', status: 'live', where: 'Kayıp' },
      { name: 'Planlı bakım uyumu (PM)', desc: 'Planlı bakımların zamanında yapılma oranı; arızaları öncesinde azaltır.', status: 'data' },
      { name: 'Öngörücü bakım (yapay zekâ)', desc: 'Motor akımı, titreşim, mikro duruş ve çevrim düzensizliği eğilimlerinden 24 saat içinde arıza riskini tahmin eder; risk yükselince bakım ekibine ve foreman\'e bildirim gider.', status: 'live', where: 'Öngörücü Bakım, Foreman, Makine' },
    ],
  },
  {
    title: 'Kalite',
    items: [
      { name: 'FPY / NOK oranı', desc: 'İlk seferde doğru üretim oranı ve hurda yüzdesi.', status: 'live', where: 'Kalite, Genel' },
      { name: 'SPC kontrol grafikleri', desc: 'x̄–R grafiği, Western Electric kuralları; ölçüm sınır dışına çıkmadan önce sürüklenmeyi yakalar.', status: 'live', where: 'Kalite' },
      { name: 'Cp / Cpk', desc: 'Sürecin tolerans içinde kalma yeteneği. Cpk ≥ 1,33 genel kabul.', status: 'live', where: 'Kalite' },
      { name: 'Hata tipi Pareto', desc: 'Hurdanın hangi hata türlerinden geldiği.', status: 'live', where: 'Kalite' },
    ],
  },
  {
    title: 'Plan & Teslimat',
    items: [
      { name: 'Günlük hedef %', desc: 'Üretim günü hedefine ilerleme ve zamansal beklentiyle karşılaştırma.', status: 'live', where: 'Kart, Genel' },
      { name: 'Tahmini bitiş / yetişme', desc: 'Son 60 dk hızıyla hedefin ne zaman tamamlanacağı ve eksik kalacak adet.', status: 'live', where: 'Kart, Makine' },
      { name: 'Plan uyumu, OTIF', desc: 'Siparişlerin zamanında ve eksiksiz teslim oranı.', status: 'data' },
    ],
  },
  {
    title: 'İnsan & Vardiya',
    items: [
      { name: 'Vardiya karşılaştırması', desc: 'Aynı makinelerde vardiyalar arası OEE ve hurda farkları; standartlaştırma fırsatı.', status: 'live', where: 'Personel' },
      { name: 'Operatör / foreman ataması', desc: 'Makine başında kim var; tecrübe ve eğitim düzeyinin performansa etkisi.', status: 'live', where: 'Kart, Personel' },
      { name: 'İş güvenliği göstergeleri', desc: 'Kazasız gün, ramak kala; verimli fabrikaların ortak izlediği bir metrik.', status: 'data' },
    ],
  },
  {
    title: 'Kaynak',
    items: [
      { name: 'Enerji / ürün', desc: 'Birim ürün başına enerji tüketimi; verimsiz çalışmayı ve kaçakları gösterir.', status: 'data' },
      { name: 'Hammadde verimi & WIP', desc: 'Fire oranı, yarı mamul stoku, malzeme bekleme süresi.', status: 'data' },
    ],
  },
]

const LOSSES = [
  ['Arıza', 'Kullanılabilirlik', 'Makine bozulup duruyor'],
  ['Ayar & değişim', 'Kullanılabilirlik', 'Ürün/kalıp değişimi, ısınma'],
  ['Mikro duruş', 'Performans', 'Kısa tıkanma, sensör bekleme'],
  ['Hız kaybı', 'Performans', 'İdeal hızın altında çalışma'],
  ['Üretim hurdası', 'Kalite', 'Kararlı üretimde NOK çıkması'],
  ['Başlangıç hurdası', 'Kalite', 'Açılış/ısınmada çıkan NOK'],
]

const NEEDS = [
  'Makine kimliği ve durum kaydı: çalışıyor / durdu / bakımda / ayarda + başlangıç-bitiş zamanı',
  'Duruş neden kodu (tabloyla birlikte: kod → açıklama, planlı/plansız)',
  'Üretim sayaçları: zaman damgalı OK ve NOK adetleri (mümkünse en fazla 10–60 sn aralıkla)',
  'İdeal çevrim süresi veya ideal hız (makine / ürün bazında)',
  'İş emri: ürün, hedef adet, başlangıç-bitiş',
  'Vardiya çizelgesi ve operatör / foreman atamaları',
  'Kalite ölçümleri (varsa): ölçülen özellik, nominal, tolerans, örnek değerleri',
]

export default function Guide() {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <Card>
        <CardHeader title="Verimli fabrikaların ortak ölçüsü: OEE" subtitle="Toplam Ekipman Verimliliği — kayıpları tek bir sayıda ve üç bileşende gösterir" />
        <div className="flex flex-wrap items-center gap-3 px-4 pb-4 pt-4">
          {[
            ['Kullanılabilirlik', 'Çalışma süresi / planlı süre', '%90', 'var(--series-1)'],
            ['Performans', 'Gerçek hız / ideal hız', '%95', 'var(--series-2)'],
            ['Kalite', 'İyi ürün / toplam ürün', '%99,9', 'var(--series-3)'],
          ].map(([n, d, v, c], i) => (
            <div key={n} className="flex items-center gap-3">
              {i > 0 && <span className="text-xl text-fg-3">×</span>}
              <div className="rounded-xl border px-4 py-3" style={{ borderTopColor: c, borderTopWidth: 3 }}>
                <div className="text-xs text-fg-2">{n}</div>
                <div className="tnum text-2xl font-semibold">{v}</div>
                <div className="text-[11px] text-fg-2">{d}</div>
              </div>
            </div>
          ))}
          <span className="text-xl text-fg-3">=</span>
          <div className="rounded-xl border bg-wash px-4 py-3">
            <div className="text-xs text-fg-2">Dünya standardı OEE</div>
            <div className="tnum text-2xl font-semibold">≈ %85</div>
            <div className="text-[11px] text-fg-2">Tipik fabrika: %55–65</div>
          </div>
        </div>
      </Card>

      <section className="grid grid-cols-3 gap-4">
        <Card className="col-span-1">
          <CardHeader title="Altı büyük kayıp" subtitle="OEE kaybının kaynakları — şelale grafiğinde görülür" />
          <ul className="divide-y px-4 pb-2 pt-2 text-xs">
            {LOSSES.map(([n, k, d]) => (
              <li key={n} className="flex items-baseline justify-between gap-2 py-2">
                <span>
                  <b className="text-[13px]">{n}</b>
                  <span className="block text-fg-2">{d}</span>
                </span>
                <span className="shrink-0 rounded-md bg-wash px-1.5 py-0.5 text-fg-2">{k}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="col-span-2">
          <CardHeader title="Gerçek veri için ihtiyaç duyulan alanlar" subtitle="SQL Server’dan bu bilgileri alabilirsek prototipteki her ekran gerçek veriyle çalışır" />
          <ul className="space-y-2 px-4 pb-4 pt-3 text-[13px]">
            {NEEDS.map((n) => (
              <li key={n} className="flex items-start gap-2">
                <Database className="mt-0.5 size-3.5 shrink-0 text-s1" />
                {n}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-4">
        {GROUPS.map((g) => (
          <Card key={g.title}>
            <CardHeader title={g.title} />
            <ul className="divide-y px-4 pb-2 pt-1">
              {g.items.map((it) => (
                <li key={it.name} className="flex items-start gap-3 py-2.5">
                  {it.status === 'live' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-text" aria-label="Prototipte gösteriliyor" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-fg-3" aria-label="Veri gelince eklenecek" />}
                  <div className="min-w-0 text-xs leading-snug">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <b className="text-[13px]">{it.name}</b>
                      <span className="text-fg-3">{it.status === 'live' ? `Prototipte: ${it.where}` : 'Veri gelince'}</span>
                    </div>
                    <p className="mt-0.5 text-fg-2">{it.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>
    </div>
  )
}
