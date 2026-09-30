import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EChart } from '@/components/charts/EChart'
import { StateTimeline } from '@/components/charts/StateTimeline'
import { baseOption, categoryAxisStyle, hhmm, timeAxisStyle, useChartTokens, valueAxisStyle } from '@/components/charts/theme'
import { Avatar } from '@/components/machine/OperatorChip'
import { StatusBadge } from '@/components/machine/StatusBadge'
import { Card, CardHeader } from '@/components/ui/card'
import { Meter } from '@/components/ui/meter'
import { StatTile } from '@/components/ui/stat-tile'
import { hourSlices } from '@/data/aggregate'
import { cumulativeOk, downtimeByReason, rateSlices, slowLossByReason, slowSegments, speedHistogram, stateSegments } from '@/data/machineView'
import { LINE_BY_ID, MACHINE_BY_ID, REASON_BY_ID, SLOW_REASONS } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'
import { source } from '@/data/store'
import { dayStartOf, failureStats, fmtDuration, idxOf, machineKpi, num, pct } from '@/lib/kpi'
import { BUCKET_MS } from '@/lib/types'

const HOUR = 3600e3

function BarList({ rows, unit, empty }: { rows: { label: string; value: number; text: string }[]; unit?: string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-xs text-fg-2">{empty}</p>
  return (
    <ul className="space-y-2.5 px-4 pb-4 pt-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate">{r.label}</span>
            <span className="tnum shrink-0 font-medium">
              {r.text}
              {unit && <span className="font-normal text-fg-2"> {unit}</span>}
            </span>
          </div>
          <Meter value={r.value / max} height={6} />
        </li>
      ))}
    </ul>
  )
}

export default function MachineDetail() {
  const { id = '' } = useParams()
  const m = MACHINE_BY_ID[id]
  const snap = useSnapshot()
  const t = useChartTokens()
  const live = snap.byId[id]
  const now = snap.now

  const view = useMemo(() => {
    if (!m) return null
    const s = source.machineSeries(m.id)
    const i1 = s.length
    const i8 = Math.max(0, i1 - (8 * HOUR) / BUCKET_MS)
    const iDay = Math.max(0, idxOf(source, dayStartOf(now)))
    const kpiDay = machineKpi(s, m, iDay, i1)
    const stops = source.stopEvents()
    return {
      seg: stateSegments(s, i8, i1),
      slow: slowSegments(s, i8, i1),
      rate: rateSlices(s, i8, i1, 30),
      cum: cumulativeOk(s, iDay, 90),
      hist: speedHistogram(s, i8, i1),
      down: downtimeByReason(s, iDay, i1),
      slowLoss: slowLossByReason(s, m, i8, i1),
      hourly: hourSlices(now, 12).map((h) => {
        const k = machineKpi(s, m, Math.max(0, idxOf(source, h.t0)), idxOf(source, h.t1))
        return { t: h.t0, nok: k.total > 0 ? k.nok / k.total : 0, total: k.total }
      }),
      fail: failureStats(stops, new Set([m.id]), dayStartOf(now), now, kpiDay.runSec),
      events: stops.filter((e) => e.machineId === m.id).slice(-8).reverse(),
      i8,
    }
  }, [m, now])

  const rateOption = useMemo(() => {
    if (!m || !view) return {}
    return {
      ...baseOption(t),
      grid: { left: 44, right: 14, top: 26, bottom: 24 },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { color: t.fg2 } },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', valueFormatter: (v: number) => `${v.toFixed(2).replace('.', ',')} ürün/sn` },
      xAxis: { ...timeAxisStyle(t), min: now - 8 * HOUR, max: now, axisLabel: { color: t.fg3, formatter: (v: number) => hhmm(v), hideOverlap: true } },
      yAxis: { ...valueAxisStyle(t), min: 0, max: Math.ceil(m.idealRate * 1.15 * 10) / 10 },
      series: [
        { name: 'Gerçek (5 dk ort.)', type: 'line', data: view.rate, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: t.series[0] } },
        { name: 'İdeal', type: 'line', data: [[now - 8 * HOUR, m.idealRate], [now, m.idealRate]], showSymbol: false, silent: true, lineStyle: { width: 1.5, type: 'dashed', color: t.fg3 }, itemStyle: { color: t.fg3 } },
      ],
    }
  }, [m, view, t, now])

  const cumOption = useMemo(() => {
    if (!m || !view) return {}
    const day0 = dayStartOf(now)
    const last = view.cum[view.cum.length - 1]
    const rate = live?.proj.avgRate ?? 0
    const endT = day0 + 24 * HOUR
    return {
      ...baseOption(t),
      grid: { left: 56, right: 14, top: 26, bottom: 24 },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { color: t.fg2 } },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', valueFormatter: (v: number) => `${num(Math.round(v))} adet` },
      xAxis: { ...timeAxisStyle(t), min: day0, max: endT, axisLabel: { color: t.fg3, formatter: (v: number) => hhmm(v), hideOverlap: true } },
      yAxis: { ...valueAxisStyle(t), min: 0, max: Math.max(m.dailyTarget * 1.05, (last?.[1] ?? 0) + rate * ((endT - now) / 1000)), axisLabel: { color: t.fg3, formatter: (v: number) => num(v / 1000) + ' bin' } },
      series: [
        { name: 'Plan (doğrusal)', type: 'line', data: [[day0, 0], [endT, m.dailyTarget]], showSymbol: false, silent: true, lineStyle: { width: 1.5, type: 'dashed', color: t.fg3 }, itemStyle: { color: t.fg3 } },
        { name: 'Gerçekleşen OK', type: 'line', data: view.cum, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: t.series[0] }, areaStyle: { color: t.series[0], opacity: 0.12 } },
        { name: 'Tahmin (son 60 dk hızı)', type: 'line', data: [[now, last?.[1] ?? 0], [endT, (last?.[1] ?? 0) + rate * ((endT - now) / 1000)]], showSymbol: false, lineStyle: { width: 2, type: 'dotted' }, itemStyle: { color: t.series[0] } },
      ],
    }
  }, [m, view, t, now, live])

  const nokOption = useMemo(() => {
    if (!view) return {}
    return {
      ...baseOption(t),
      grid: { left: 44, right: 14, top: 12, bottom: 24 },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', valueFormatter: (v: number) => `%${(v * 100).toFixed(2)}` },
      xAxis: categoryAxisStyle(t, view.hourly.map((h) => hhmm(h.t))),
      yAxis: { ...valueAxisStyle(t), axisLabel: { color: t.fg3, formatter: (v: number) => `%${(v * 100).toFixed(0)}` } },
      series: [
        {
          type: 'bar',
          data: view.hourly.map((h) => h.nok),
          barMaxWidth: 22,
          itemStyle: { color: t.series[1], borderRadius: [4, 4, 0, 0] },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: t.fg3, type: 'dashed' }, label: { color: t.fg3, formatter: 'Sınır %2', position: 'insideEndTop' }, data: [{ yAxis: 0.02 }] },
        },
      ],
    }
  }, [view, t])

  const histOption = useMemo(() => {
    if (!view) return {}
    return {
      ...baseOption(t),
      grid: { left: 44, right: 14, top: 12, bottom: 24 },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: { dataIndex: number }[]) => `Hız %${view.hist[p[0].dataIndex].from}–${view.hist[p[0].dataIndex].from + 4}<br/><b>${fmtDuration(view.hist[p[0].dataIndex].count * 10)}</b>` },
      xAxis: { ...categoryAxisStyle(t, view.hist.map((h) => h.label)), name: '% hız', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.fg3 } },
      yAxis: { ...valueAxisStyle(t), axisLabel: { color: t.fg3, formatter: (v: number) => `${Math.round((v * 10) / 60)} dk` } },
      series: [{ type: 'bar', data: view.hist.map((h) => h.count), barCategoryGap: '12%', itemStyle: { color: t.series[0], borderRadius: [3, 3, 0, 0] } }],
    }
  }, [view, t])

  if (!m || !live || !view) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-fg-2">Makine bulunamadı.</p>
        <Link to="/" className="mt-3 inline-block text-s1 underline">Genel ekrana dön</Link>
      </div>
    )
  }

  const line = LINE_BY_ID[m.lineId]
  const durSec = (now - live.sinceT) / 1000
  const k = live.kpiShift
  const kd = live.kpiDay
  const etaText = live.proj.verdict === 'done' ? 'Hedef tamamlandı' : live.proj.etaSec === null ? 'Hız 0 · tahmin yok' : live.proj.verdict === 'behind' ? `Yetişmez · −${num(Math.round(live.proj.shortfall / 10) * 10)} adet` : `Tahmini bitiş ${new Date(now + live.proj.etaSec * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`

  const downRows = [...view.down.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r, sec]) => ({ label: REASON_BY_ID[r]?.label ?? '?', value: sec, text: fmtDuration(sec) }))
  const slowRows = [...view.slowLoss.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r, lost]) => ({ label: SLOW_REASONS[r]?.label ?? '?', value: lost, text: num(Math.round(lost)) }))

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="grid size-8 place-items-center rounded-md border bg-card text-fg-2 hover:bg-wash hover:text-fg focus-visible:outline-2 focus-visible:outline-s1" aria-label="Genel ekrana dön">
            <ArrowLeft className="size-4" />
          </Link>
          <div className="leading-tight">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-semibold">{m.code} · {m.name}</h2>
              <StatusBadge state={live.stateKey} />
              {live.state !== 0 && <span className="text-xs text-fg-2">{REASON_BY_ID[live.reasonId]?.label} · {fmtDuration(durSec)}</span>}
            </div>
            <p className="mt-0.5 text-xs text-fg-2">{line.name} · Model {m.model} · İş emri {m.orderNo} · {m.product}</p>
          </div>
        </div>
      </div>

      <section className="grid grid-cols-6 gap-4">
        <StatTile className="col-span-2" label="OEE · bu vardiya" value={pct(k.oee, 1)} sub={`Bugün ${pct(kd.oee, 1)}`}>
          <div className="mt-1 grid grid-cols-3 gap-3 text-xs">
            {[
              ['Kullanılabilirlik', k.availability],
              ['Performans', k.performance],
              ['Kalite', k.quality],
            ].map(([l, v]) => (
              <div key={l as string}>
                <div className="text-fg-2">{l}</div>
                <div className="tnum mb-1 font-semibold">{pct(v as number, 1)}</div>
                <Meter value={v as number} height={4} />
              </div>
            ))}
          </div>
        </StatTile>
        <StatTile label="Anlık hız" value={live.ratePerSec.toFixed(2).replace('.', ',')} unit="ürün/sn" sub={<>İdeal {m.idealRate.toFixed(1).replace('.', ',')} · hız <b className="tnum text-fg">{live.state === 0 ? pct(live.speedPct, 0) : '—'}</b></>} />
        <StatTile label="Günlük hedef" value={pct(live.proj.progress, 0)} sub={<>{num(live.proj.produced)} / {num(m.dailyTarget)} · {etaText}</>}>
          <Meter value={live.proj.progress} marker={(now - dayStartOf(now)) / 86400e3} height={5} color={live.proj.verdict === 'behind' ? 'var(--serious)' : 'var(--series-1)'} />
        </StatTile>
        <StatTile label="NOK oranı · bugün" value={pct(kd.total ? kd.nok / kd.total : 0, 2)} sub={<>{num(kd.nok)} NOK / {num(kd.total)}</>} />
        <StatTile label="MTBF / MTTR · bugün" value={view.fail.mtbfSec ? fmtDuration(view.fail.mtbfSec) : '—'} sub={<>MTTR {view.fail.mttrSec ? fmtDuration(view.fail.mttrSec) : '—'} · {view.fail.failures} arıza</>} />
      </section>

      <Card>
        <CardHeader title="Durum zaman çizgisi" subtitle="Son 8 saat · üst şerit makine durumu, alt şerit yavaşlık dönemleri ve nedenleri"
          right={
            <div className="flex items-center gap-3 text-[11px] text-fg-2">
              {[['Çalışıyor', 'var(--good)'], ['Durdu', 'var(--critical)'], ['Bakımda', 'var(--maint)'], ['Ayarda', 'var(--warning)'], ['Yavaş', 'var(--serious)']].map(([l, c]) => (
                <span key={l} className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: c }} />{l}</span>
              ))}
            </div>
          }
        />
        <div className="px-2 pb-2 pt-1">
          <StateTimeline segments={view.seg} slow={view.slow} from={now - 8 * HOUR} to={now} />
        </div>
      </Card>

      <section className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Üretim hızı" subtitle="Son 8 saat · 5 dakikalık ortalama, duruşlar dahil" />
          <div className="px-2 pb-2 pt-1"><EChart option={rateOption} height={240} label="Üretim hızı ve ideal hız çizgi grafiği" /></div>
        </Card>
        <Card>
          <CardHeader title="Günlük hedefe doğru" subtitle="Kümülatif OK üretim · plan doğrusu ve son 60 dk hızıyla tahmin" />
          <div className="px-2 pb-2 pt-1"><EChart option={cumOption} height={240} label="Kümülatif üretim, plan ve tahmin" /></div>
        </Card>
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader title="Saatlik NOK oranı" subtitle="Son 12 saat" />
          <div className="px-2 pb-2 pt-1"><EChart option={nokOption} height={210} label="Saatlik NOK oranı sütun grafiği" /></div>
        </Card>
        <Card>
          <CardHeader title="Hız dağılımı" subtitle="Çalışırken hangi hızda kaç dakika (son 8 sa)" />
          <div className="px-2 pb-2 pt-1"><EChart option={histOption} height={210} label="Hız dağılımı histogramı" /></div>
        </Card>
        <Card>
          <CardHeader title="Yavaşlık nedenleri" subtitle="Son 8 saat · tahmini kayıp adet" />
          <BarList rows={slowRows} unit="adet" empty="Son 8 saatte belirgin yavaşlık yok" />
        </Card>
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader title="Duruş nedenleri" subtitle="Bugün · süreye göre" />
          <BarList rows={downRows} empty="Bugün duruş yok" />
        </Card>
        <Card>
          <CardHeader title="Başındaki ekip" subtitle="Şu anki vardiya" />
          <div className="space-y-3 px-4 pb-4 pt-3">
            {[[live.operator, 'Operatör'], [live.foreman, 'Foreman']].map(([p, role]) => {
              const person = p as typeof live.operator
              if (!person) return null
              return (
                <div key={role as string} className="flex items-center gap-3">
                  <Avatar person={person} size={44} />
                  <div className="leading-tight">
                    <div className="text-sm font-medium">{person.name}</div>
                    <div className="text-xs text-fg-2">{role as string} · {person.experienceYears < 1 ? `${Math.round(person.experienceYears * 12)} aylık` : `${String(person.experienceYears).replace('.', ',')} yıl`} tecrübe</div>
                  </div>
                </div>
              )
            })}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-3 text-xs">
              <dt className="text-fg-2">İş emri</dt><dd className="text-right font-medium">{m.orderNo}</dd>
              <dt className="text-fg-2">Ürün</dt><dd className="text-right font-medium">{m.product}</dd>
              <dt className="text-fg-2">Günlük hedef</dt><dd className="tnum text-right font-medium">{num(m.dailyTarget)}</dd>
              <dt className="text-fg-2">İdeal çevrim</dt><dd className="tnum text-right font-medium">{(1 / m.idealRate).toFixed(2).replace('.', ',')} sn/ürün</dd>
            </dl>
          </div>
        </Card>
        <Card>
          <CardHeader title="Son olaylar" subtitle="Bu makine" />
          <ul className="divide-y px-4 pb-2 pt-1">
            {view.events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{REASON_BY_ID[e.reasonId]?.label}</span>
                  <span className="text-fg-2">{hhmm(e.start)}{e.end ? ` – ${hhmm(e.end)}` : ' – devam ediyor'}</span>
                </span>
                <span className="tnum shrink-0 text-fg-2">{fmtDuration(((e.end ?? now) - e.start) / 1000)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  )
}
