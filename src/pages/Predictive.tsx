import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, HeartPulse, OctagonAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EChart } from '@/components/charts/EChart'
import { baseOption, hhmm, timeAxisStyle, useChartTokens, valueAxisStyle } from '@/components/charts/theme'
import { Card, CardHeader } from '@/components/ui/card'
import { Meter } from '@/components/ui/meter'
import { StatTile } from '@/components/ui/stat-tile'
import { LINE_BY_ID, MACHINES, MACHINE_BY_ID, REASON_BY_ID } from '@/data/registry'
import { LEVEL_STYLE, ago, latestRisk, pctRisk } from '@/data/predictiveView'
import { useSnapshot } from '@/data/snapshot'
import { source } from '@/data/store'
import { IS_DEMO } from '@/data/mode'
import { FEATURE_LABEL } from '@/ml/features'
import type { FeatureName } from '@/ml/features'
import { MODEL_DATA } from '@/ml/modelData'
import { NOTIFICATION_STATUS_LABEL } from '@/ml/types'
import type { RiskLevel } from '@/ml/types'
import { cn } from '@/lib/utils'

/**
 * ÖNGÖRÜCÜ BAKIM — makine başına arıza riski, nedenleri, modelin başarısı ve
 * "ne kadar veri gerekir" sorusunun cevabı.
 */

const HOUR = 3600 * 1000
const LEVEL_ICON: Record<RiskLevel, typeof HeartPulse> = { good: CheckCircle2, watch: AlertTriangle, alarm: OctagonAlert }
const p0 = (v: number) => `%${Math.round(v * 100)}`
const dec = (v: number, d = 1) => v.toFixed(d).replace('.', ',')

function LevelBadge({ level }: { level: RiskLevel }) {
  const s = LEVEL_STYLE[level]
  const Icon = LEVEL_ICON[level]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', s.bg, s.text)}>
      <Icon className="size-3" /> {s.word}
    </span>
  )
}

function RiskSpark({ values, alarm }: { values: number[]; alarm: number }) {
  if (values.length < 2) return <div className="h-7 text-[11px] text-fg-3">veri birikiyor…</div>
  const w = 120
  const h = 28
  const x = (i: number) => (i / (values.length - 1)) * (w - 2) + 1
  const y = (v: number) => h - 2 - v * (h - 4)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Son 48 saat risk">
      <line x1={0} x2={w} y1={y(alarm)} y2={y(alarm)} stroke="var(--fg-3)" strokeDasharray="3 3" strokeWidth={1} />
      <polyline points={values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

export default function Predictive() {
  const snap = useSnapshot()
  const t = useChartTokens()
  const now = snap.now
  const M = MODEL_DATA
  const [sel, setSel] = useState<string | null>(null)

  const machines = useMemo(() => {
    return MACHINES.map((m) => {
      const live = snap.byId[m.id]
      const r = latestRisk(m.id)
      const inBreakdown = live && live.state === 1 && REASON_BY_ID[live.reasonId]?.category === 'breakdown'
      const series = source.riskSeries(m.id).filter((p) => p.t > now - 48 * HOUR)
      return { m, r, inBreakdown, spark: series.filter((_, i) => i % 3 === 0).map((p) => p.risk) }
    }).sort((a, b) => (b.r?.risk ?? -1) - (a.r?.risk ?? -1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap])

  const selected = sel ?? machines[0]?.m.id
  const selM = MACHINE_BY_ID[selected]
  const selR = machines.find((x) => x.m.id === selected)
  const notes = source.notifications()
  const counts = {
    alarm: machines.filter((x) => x.r?.level === 'alarm' && !x.inBreakdown).length,
    watch: machines.filter((x) => x.r?.level === 'watch' && !x.inBreakdown).length,
    open: notes.filter((n) => n.status === 'new' || n.status === 'read').length,
  }

  const trendOption = useMemo(() => {
    const pts = source.riskSeries(selected).filter((p) => p.t > now - 48 * HOUR)
    const failures = source
      .stopEvents()
      .filter((e) => e.machineId === selected && e.start > now - 48 * HOUR && REASON_BY_ID[e.reasonId]?.category === 'breakdown')
    const warn = notes.filter((n) => n.machineId === selected && n.t > now - 48 * HOUR)
    return {
      ...baseOption(t),
      grid: { left: 44, right: 16, top: 30, bottom: 24 },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { color: t.fg2 }, data: ['Arıza riski'] },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', valueFormatter: (v: number) => p0(v) },
      xAxis: { ...timeAxisStyle(t), min: now - 48 * HOUR, max: now, axisLabel: { color: t.fg3, formatter: (v: number) => hhmm(v), hideOverlap: true } },
      yAxis: { ...valueAxisStyle(t), min: 0, max: 1, axisLabel: { color: t.fg3, formatter: (v: number) => p0(v) } },
      series: [
        {
          name: 'Arıza riski',
          type: 'line',
          data: pts.map((p) => [p.t, p.risk]),
          showSymbol: false,
          lineStyle: { width: 2, color: t.series[0] },
          itemStyle: { color: t.series[0] },
          areaStyle: { color: t.series[0], opacity: 0.08 },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              { yAxis: M.thresholds.alarm, lineStyle: { color: t.critical, type: 'dashed', width: 1 }, label: { formatter: `Riskli ≥ ${p0(M.thresholds.alarm)}`, color: t.fg3, position: 'insideEndTop', fontSize: 11 } },
              { yAxis: M.thresholds.watch, lineStyle: { color: t.fg3, type: 'dashed', width: 1 }, label: { formatter: `Dikkat ≥ ${p0(M.thresholds.watch)}`, color: t.fg3, position: 'insideEndTop', fontSize: 11 } },
              ...failures.map((f) => ({ xAxis: f.start, lineStyle: { color: t.critical, type: 'solid' as const, width: 2 }, label: { formatter: 'Arıza', color: t.critical, position: 'end' as const, fontSize: 11 } })),
              ...warn.map((n) => ({ xAxis: n.t, lineStyle: { color: t.warning, type: 'solid' as const, width: 2 }, label: { formatter: 'Uyarı', color: t.fg2, position: 'end' as const, fontSize: 11 } })),
            ],
          },
        },
      ],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, snap, t])

  const curveOption = useMemo(() => {
    const c = M.learningCurve
    const labels = c.map((x) => (x.months < 1 ? `${Math.round(x.months * 30 / 7)} hafta` : `${x.months} ay`))
    return {
      ...baseOption(t),
      grid: { left: 44, right: 16, top: 28, bottom: 44 },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { color: t.fg2 } },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: 'axis',
        formatter: (ps: { dataIndex: number; seriesName: string; value: number }[]) =>
          `<b>${labels[ps[0].dataIndex]} veri · ${c[ps[0].dataIndex].trainFailures} arıza örneği</b><br/>` + ps.map((p) => `${p.seriesName}: ${p0(p.value)}`).join('<br/>'),
      },
      xAxis: {
        type: 'category',
        data: labels.map((l, i) => `${l}\n${c[i].trainFailures} arıza`),
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.fg2, fontSize: 11, lineHeight: 15 },
      },
      yAxis: { ...valueAxisStyle(t), min: 0, max: 1, axisLabel: { color: t.fg3, formatter: (v: number) => p0(v) } },
      series: [
        { name: 'Öngörülebilir arızaları yakalama', type: 'line', data: c.map((x) => x.caughtPredictablePct), symbolSize: 7, lineStyle: { width: 2, color: t.series[0] }, itemStyle: { color: t.series[0] } },
        { name: 'Tüm arızaları yakalama', type: 'line', data: c.map((x) => x.caughtPct), symbolSize: 7, lineStyle: { width: 2, color: t.series[1] }, itemStyle: { color: t.series[1] } },
      ],
    }
  }, [t, M])

  const met = M.metrics
  const topImportance = M.importances.filter((i) => !i.feature.startsWith('line_')).slice(0, 6)
  const impMax = Math.max(...topImportance.map((i) => i.value))

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <div className="flex items-start gap-2.5 rounded-xl border border-dashed bg-card px-4 py-3 text-sm">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning-text" />
        <p className="leading-relaxed text-fg-2">
          <b className="text-fg">Model simüle veriyle eğitildi.</b> Aşağıdaki başarı oranları {M.dataset.days} günlük simülasyondan gelir. Gerçek fabrikada belirtiler daha gürültülü ve makineye özgüdür; model aynı yöntemle gerçek veriyle yeniden eğitilir ve bu sayfa
          gerçek sonuçları gösterir. Karar modeldedir; bildirim metni şablondan üretilir (ileride küçük dil modeli ile).
        </p>
      </div>

      <section className="grid grid-cols-5 gap-4">
        <StatTile label="Riskli makine" value={String(counts.alarm)} valueClass={counts.alarm ? 'text-critical-text' : 'text-good-text'} sub="24 saat içinde arıza bekleniyor" />
        <StatTile label="Dikkat" value={String(counts.watch)} valueClass={counts.watch ? 'text-warning-text' : ''} sub="Risk artıyor, izlenmeli" />
        <StatTile label="Açık bildirim" value={String(counts.open)} sub="Yeni + okunmuş, henüz bakım planlanmamış" />
        <StatTile label="Model · yakalanan arıza" value={p0(met.caughtPredictablePct)} sub={<>Öngörülebilir arızalar · ort. {dec(met.leadHoursMedian, 0)} sa önceden</>} />
        <StatTile label="Boş alarm" value={dec(met.falseAlarmsPerMachineWeek)} unit="/ makine-hafta" sub={<>Alarmların {p0(met.precision)}'i gerçek arızaya denk geldi</>} />
      </section>

      <section aria-label="Makine riskleri">
        <h2 className="mb-2 text-[13px] font-semibold">Makine riskleri <span className="font-normal text-fg-2">· en riskli üstte · 5 dakikada bir güncellenir</span></h2>
        <div className="grid grid-cols-4 gap-3">
          {machines.map(({ m, r, inBreakdown, spark }) => (
            <button
              key={m.id}
              onClick={() => setSel(m.id)}
              className={cn('flex flex-col gap-2 rounded-xl border bg-card p-3 text-left hover:bg-wash focus-visible:outline-2 focus-visible:outline-s1', selected === m.id && 'ring-2 ring-s1')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{m.code}</span>
                {inBreakdown ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-critical/15 px-2 py-0.5 text-xs font-medium text-critical-text">
                    <OctagonAlert className="size-3" /> Arızada
                  </span>
                ) : r ? (
                  <LevelBadge level={r.level} />
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-fg-3">
                    <CircleDashed className="size-3" /> veri birikiyor
                  </span>
                )}
              </div>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="tnum text-2xl font-semibold leading-none">{r && !inBreakdown ? pctRisk(r.risk) : '—'}</div>
                  <div className="mt-1 text-[11px] text-fg-2">24 sa içinde arıza riski</div>
                </div>
                <RiskSpark values={spark} alarm={M.thresholds.alarm} />
              </div>
              <div className="min-h-[16px] truncate text-[11px] text-fg-2" title={r?.factors.map((f) => f.text).join(' · ')}>
                {!inBreakdown && r?.factors[0]?.text}
              </div>
            </button>
          ))}
        </div>
      </section>

      {selM && (
        <section className="grid grid-cols-3 gap-4">
          <Card className="col-span-2">
            <CardHeader
              title={`${selM.code} · ${selM.name} — son 48 saat`}
              subtitle="Arıza riski (5 dk'da bir) · kırmızı: gerçekleşen arıza · sarı: gönderilen uyarı"
              right={
                <Link to={`/makine/${selM.id}`} className="text-xs font-medium text-s1 hover:underline">
                  Makine detayı
                </Link>
              }
            />
            <div className="px-2 pb-2 pt-1">
              <EChart option={trendOption} height={260} label="Seçili makinenin arıza riski trendi" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Riski artıran etkenler" subtitle={selR?.r ? `Şu an ${pctRisk(selR.r.risk)} · ${LEVEL_STYLE[selR.r.level].word}` : 'Henüz değerlendirme yok'} />
            <ul className="space-y-3 px-4 pb-4 pt-3">
              {(selR?.r?.factors ?? []).map((f) => (
                <li key={f.feature}>
                  <div className="mb-1 flex justify-between gap-2 text-xs">
                    <span>{f.text}</span>
                    <span className="tnum shrink-0 text-fg-2">−{p0(f.impact)}</span>
                  </div>
                  <Meter value={Math.min(1, f.impact / 0.6)} height={5} color="var(--series-2)" />
                </li>
              ))}
              {!selR?.r?.factors.length && <li className="text-xs text-fg-2">Risk düşük — belirgin bir etken yok.</li>}
            </ul>
            <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-fg-3">Her etkenin yanındaki sayı: o sinyal sağlıklı makinedeki değerine dönse riskin ne kadar düşeceği.</p>
          </Card>
        </section>
      )}

      <section className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Model kartı" subtitle={`${M.algorithm} · ${M.trainedAt} tarihinde eğitildi`} />
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 pt-3 text-xs">
            <div className="text-fg-2">Eğitim verisi</div>
            <div className="text-right font-medium">{M.dataset.days} gün · {M.dataset.machines} makine · {M.dataset.trainFailures} arıza</div>
            <div className="text-fg-2">Test (modelin görmediği son {M.dataset.testDays} gün)</div>
            <div className="text-right font-medium">{met.failures} arıza</div>
            <div className="text-fg-2">Öngörülebilir arızaları yakalama</div>
            <div className="text-right font-medium">{p0(met.caughtPredictablePct)} ({met.predictableFailures} arızadan)</div>
            <div className="text-fg-2">Ani arızaları yakalama (sensör/PLC)</div>
            <div className="text-right font-medium">{p0(met.caughtSuddenPct)} — belirtisi olmadığı için beklenen</div>
            <div className="text-fg-2">Uyarı süresi (medyan)</div>
            <div className="text-right font-medium">arızadan {dec(met.leadHoursMedian, 0)} saat önce</div>
            <div className="text-fg-2">Boş alarm</div>
            <div className="text-right font-medium">makine başına haftada {dec(met.falseAlarmsPerMachineWeek)}</div>
            <div className="text-fg-2">Lojistik regresyonla karşılaştırma</div>
            <div className="text-right font-medium">lojistik {p0(M.baseline.logisticCaughtPct)} · gradient boosting {p0(M.baseline.boostingCaughtPct)}</div>
          </div>
          <div className="px-4 pb-4 pt-4">
            <div className="mb-2 text-xs font-medium">Modelin en çok baktığı sinyaller</div>
            <ul className="space-y-1.5">
              {topImportance.map((i) => (
                <li key={i.feature} className="flex items-center gap-2 text-xs">
                  <span className="w-48 shrink-0 truncate text-fg-2">{FEATURE_LABEL[i.feature as FeatureName]}</span>
                  <Meter value={i.value / impMax} height={5} className="flex-1" />
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card>
          <CardHeader title="Ne kadar veri gerekir?" subtitle="Aynı model farklı miktarda geçmiş veriyle eğitildi · aynı boş alarm seviyesinde · 3 eğitimin ortalaması" />
          <div className="px-2 pt-1">
            <EChart option={curveOption} height={220} label="Eğitim verisi miktarına göre yakalama oranı" />
          </div>
          <div className="space-y-2 px-4 pb-4 pt-1 text-xs leading-relaxed text-fg-2">
            <p>
              Belirleyici olan süre değil, <b className="text-fg">öğrenilecek arıza örneği sayısı</b>. Simülasyonda belirtiler tutarlı olduğu için model birkaç düzine arızayla doyuyor; gerçek fabrikada belirtiler daha karmaşık olduğundan
              eğri daha yavaş yükselir.
            </p>
            <ol className="space-y-1">
              <li>
                <b className="text-fg">1. ay:</b> normal davranış öğrenilir, anormallik uyarıları başlar (etiket gerekmez).
              </li>
              <li>
                <b className="text-fg">3–6. ay:</b> ~50–100 arıza örneği birikir, ilk tahmin modeli eğitilir ve geçmiş arızalarla sınanır.
              </li>
              <li>
                <b className="text-fg">12. ay:</b> mevsimsellik ve nadir arıza türleri eklenir; model düzenli yeniden eğitilir.
              </li>
            </ol>
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader title="Bildirim geçmişi" subtitle="Bakım ekibine ve hattın foreman'ine gönderilen uyarılar" />
        <table className="mt-2 w-full text-xs">
          <thead className="text-fg-2">
            <tr className="border-y">
              <th className="px-4 py-2 text-left font-medium">Zaman</th>
              <th className="px-2 py-2 text-left font-medium">Makine</th>
              <th className="px-2 py-2 text-right font-medium">Risk</th>
              <th className="px-2 py-2 text-left font-medium">Neden</th>
              <th className="px-2 py-2 text-left font-medium">Durum</th>
              <th className="px-4 py-2 text-left font-medium">Sonuç</th>
            </tr>
          </thead>
          <tbody>
            {notes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-fg-2">
                  Henüz bildirim yok
                </td>
              </tr>
            )}
            {notes.slice(0, 20).map((n) => (
              <tr key={n.id} className="border-b last:border-0">
                <td className="px-4 py-2">
                  {hhmm(n.t)} <span className="text-fg-3">· {ago(Date.now() - n.t)}</span>
                </td>
                <td className="px-2 font-medium">
                  {MACHINE_BY_ID[n.machineId]?.code} <span className="font-normal text-fg-3">{LINE_BY_ID[n.lineId]?.short}</span>
                </td>
                <td className="tnum px-2 text-right">{pctRisk(n.risk)}</td>
                <td className="max-w-[360px] truncate px-2 text-fg-2" title={n.factors.map((f) => f.text).join(' · ')}>
                  {n.factors[0]?.text ?? '—'}
                </td>
                <td className="px-2">{NOTIFICATION_STATUS_LABEL[n.status]}</td>
                <td className="px-4">
                  {n.failureAt ? (
                    <span className="inline-flex items-center gap-1 font-medium text-good-text">
                      <CheckCircle2 className="size-3.5" /> {dec((n.failureAt - n.t) / HOUR)} sa sonra arıza oldu
                    </span>
                  ) : now - n.t > M.horizonHours * HOUR ? (
                    <span className="text-fg-3">24 saatte arıza olmadı</span>
                  ) : (
                    <span className="text-fg-2">bekleniyor</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {IS_DEMO && <p className="px-4 pb-3 pt-2 text-[11px] text-fg-3">Demo modunda bildirim durumları tarayıcıda tutulur; sayfa yenilenince sıfırlanır.</p>}
      </Card>
    </div>
  )
}
