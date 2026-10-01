import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EChart } from '@/components/charts/EChart'
import { baseOption, categoryAxisStyle, useChartTokens, valueAxisStyle } from '@/components/charts/theme'
import { gridLocale, gridTheme } from '@/components/grid/theme'
import { Card, CardHeader } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { StatTile } from '@/components/ui/stat-tile'
import { hourSlices } from '@/data/aggregate'
import { downtimeByReason, slowLossByReason } from '@/data/machineView'
import { LINES, MACHINES, REASON_BY_ID, SLOW_REASONS } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'
import { source } from '@/data/store'
import { OEE_WORLD_CLASS, failureStats, fmtDuration, idxOf, machineKpi, num, pct, sumKpi, windowRange } from '@/lib/kpi'
import { WINDOW_LABEL } from '@/lib/types'
import type { WindowKey } from '@/lib/types'

const WINDOW_OPTIONS = (Object.keys(WINDOW_LABEL) as WindowKey[]).map((k) => ({ value: k, label: WINDOW_LABEL[k] }))
const LOSS_LABELS = ['Arıza', 'Ayar & değişim', 'Mikro duruş', 'Bekleme', 'Hız kaybı', 'Hurda / kalite']

interface Row {
  id: string
  code: string
  line: string
  oee: number
  a: number
  p: number
  q: number
  downMin: number
  failures: number
  mttr: number | null
  nokRate: number
}

export default function Losses() {
  const snap = useSnapshot()
  const t = useChartTokens()
  const nav = useNavigate()
  const [win, setWin] = useState<WindowKey>('day')
  const [lineId, setLineId] = useState<string>('all')
  const now = snap.now

  const data = useMemo(() => {
    const machines = MACHINES.filter((m) => lineId === 'all' || m.lineId === lineId)
    const w = windowRange(source, win)
    const kpis = machines.map((m) => machineKpi(source.machineSeries(m.id), m, w.i0, w.i1))
    const total = sumKpi(kpis)
    const stops = source.stopEvents()
    const fail = failureStats(stops, new Set(machines.map((m) => m.id)), w.startT, w.endT, total.runSec)

    const down = new Map<number, number>()
    const slowLoss = new Map<number, number>()
    for (const m of machines) {
      const s = source.machineSeries(m.id)
      for (const [r, v] of downtimeByReason(s, w.i0, w.i1)) down.set(r, (down.get(r) ?? 0) + v)
      for (const [r, v] of slowLossByReason(s, m, w.i0, w.i1)) slowLoss.set(r, (slowLoss.get(r) ?? 0) + v)
    }

    const hours = hourSlices(now, 24)
    const heat: [number, number, number][] = []
    machines.forEach((m, mi) => {
      const s = source.machineSeries(m.id)
      hours.forEach((h, hi) => {
        const k = machineKpi(s, m, Math.max(0, idxOf(source, h.t0)), idxOf(source, h.t1))
        const l = k.loss
        heat.push([hi, mi, Math.round((l.breakdown + l.changeover + l.microstop + l.waiting) / 6) / 10])
      })
    })

    const rows: Row[] = machines.map((m, i) => {
      const k = kpis[i]
      const f = failureStats(stops, new Set([m.id]), w.startT, w.endT, k.runSec)
      const l = k.loss
      return {
        id: m.id,
        code: m.code,
        line: LINES.find((x) => x.id === m.lineId)!.short,
        oee: k.oee,
        a: k.availability,
        p: k.performance,
        q: k.quality,
        downMin: Math.round((l.breakdown + l.changeover + l.microstop + l.waiting) / 60),
        failures: f.failures,
        mttr: f.mttrSec,
        nokRate: k.total ? k.nok / k.total : 0,
      }
    })
    return { machines, total, fail, down, slowLoss, hours, heat, rows }
  }, [win, lineId, now])

  const { total: k } = data
  const lossVals = useMemo(
    () => [k.loss.breakdown, k.loss.changeover, k.loss.microstop, k.loss.waiting, k.loss.speed, k.loss.quality].map((v) => (k.plannedSec > 0 ? v / k.plannedSec : 0)),
    [k],
  )

  const waterfall = useMemo(() => {
    const cats = ['Planlı süre', ...LOSS_LABELS, 'OEE']
    const base: number[] = [0]
    const vals: (number | { value: number; itemStyle: { color: string } })[] = [{ value: 1, itemStyle: { color: t.series[0] } }]
    let remaining = 1
    lossVals.forEach((v) => {
      remaining -= v
      base.push(remaining)
      vals.push({ value: v, itemStyle: { color: t.series[1] } })
    })
    base.push(0)
    vals.push({ value: Math.max(0, remaining), itemStyle: { color: t.series[0] } })
    return {
      ...baseOption(t),
      grid: { left: 44, right: 12, top: 24, bottom: 34 },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const i = p[0].dataIndex
          const v = typeof vals[i] === 'object' ? (vals[i] as { value: number }).value : (vals[i] as number)
          return `<b>${cats[i]}</b><br/>${pct(v, 1)} planlı sürenin`
        },
      },
      xAxis: { ...categoryAxisStyle(t, cats), axisLabel: { color: t.fg2, interval: 0, fontSize: 11 } },
      yAxis: { ...valueAxisStyle(t), min: 0, max: 1, axisLabel: { color: t.fg3, formatter: (v: number) => `%${Math.round(v * 100)}` } },
      series: [
        { type: 'bar', stack: 'w', silent: true, data: base, itemStyle: { color: 'transparent' }, tooltip: { show: false } },
        {
          type: 'bar',
          stack: 'w',
          data: vals,
          barWidth: '58%',
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          label: {
            show: true,
            position: 'top',
            color: t.fg,
            fontSize: 11,
            formatter: (p: { dataIndex: number }) => {
              const v = typeof vals[p.dataIndex] === 'object' ? (vals[p.dataIndex] as { value: number }).value : (vals[p.dataIndex] as number)
              return p.dataIndex === 0 || p.dataIndex === cats.length - 1 ? pct(v, 1) : `−${(v * 100).toFixed(1).replace('.', ',')}`
            },
          },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: t.fg3, type: 'dashed' }, label: { color: t.fg3, formatter: 'Dünya standardı %85', position: 'insideEndTop' }, data: [{ yAxis: OEE_WORLD_CLASS }] },
        },
      ],
    }
  }, [t, lossVals])

  const pareto = useMemo(() => {
    const items = [...data.down.entries()]
      .filter(([r]) => !REASON_BY_ID[r]?.planned)
      .map(([r, sec]) => ({ label: REASON_BY_ID[r]?.label ?? '?', sec }))
      .sort((a, b) => b.sec - a.sec)
    const sum = items.reduce((a, b) => a + b.sec, 0) || 1
    return items.map((i, idx) => ({ ...i, share: i.sec / sum, cum: items.slice(0, idx + 1).reduce((a, b) => a + b.sec, 0) / sum }))
  }, [data.down])

  const paretoOption = useMemo(
    () => ({
      ...baseOption(t),
      grid: { left: 150, right: 150, top: 6, bottom: 6 },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: { dataIndex: number }[]) => { const r = pareto[p[0].dataIndex]; return `<b>${r.label}</b><br/>${fmtDuration(r.sec)} · pay ${pct(r.share, 0)} · küm. ${pct(r.cum, 0)}` } },
      xAxis: { type: 'value', show: false },
      yAxis: { ...categoryAxisStyle(t, pareto.map((r) => r.label)), inverse: true, axisLine: { show: false }, axisLabel: { color: t.fg2, width: 140, overflow: 'truncate' } },
      series: [
        {
          type: 'bar',
          data: pareto.map((r) => r.sec / 60),
          barWidth: 12,
          itemStyle: { color: t.series[1], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', color: t.fg2, formatter: (p: { dataIndex: number }) => `${Math.round(pareto[p.dataIndex].sec / 60)} dk · küm. ${Math.round(pareto[p.dataIndex].cum * 100)}%` },
        },
      ],
    }),
    [pareto, t],
  )

  const heatOption = useMemo(() => {
    const hoursLbl = data.hours.map((h) => `${String(new Date(h.t0).getHours()).padStart(2, '0')}:00`)
    return {
      ...baseOption(t),
      grid: { left: 70, right: 12, top: 8, bottom: 52 },
      tooltip: { ...(baseOption(t).tooltip as object), formatter: (p: { value: number[] }) => `<b>${data.machines[p.value[1]].code}</b> · ${hoursLbl[p.value[0]]}<br/>${p.value[2].toFixed(1).replace('.', ',')} dk plansız duruş` },
      xAxis: { type: 'category', data: hoursLbl, splitArea: { show: false }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.fg3, interval: 2 } },
      yAxis: { type: 'category', data: data.machines.map((m) => m.code), inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.fg2 } },
      visualMap: { min: 0, max: 30, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 12, itemHeight: 160, text: ['30 dk', '0'], textStyle: { color: t.fg2 }, inRange: { color: t.seqRamp } },
      series: [{ type: 'heatmap', data: data.heat, itemStyle: { borderColor: t.card, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: t.fg, borderWidth: 1 } } }],
    }
  }, [data, t])

  const slowRows = [...data.slowLoss.entries()].sort((a, b) => b[1] - a[1])
  const slowMax = Math.max(1, ...slowRows.map((r) => r[1]))

  const cols = useMemo<ColDef<Row>[]>(
    () => [
      { field: 'code', headerName: 'Makine', width: 110, pinned: 'left' },
      { field: 'line', headerName: 'Hücre', width: 100 },
      { field: 'oee', headerName: 'OEE', width: 100, valueFormatter: (p) => pct(p.value, 1), cellStyle: (p) => ({ fontWeight: 600, color: p.value >= OEE_WORLD_CLASS ? 'var(--good-text)' : p.value < 0.65 ? 'var(--critical-text)' : 'var(--fg)' }) },
      { field: 'a', headerName: 'Kullanılabilirlik', width: 150, valueFormatter: (p) => pct(p.value, 1) },
      { field: 'p', headerName: 'Performans', width: 130, valueFormatter: (p) => pct(p.value, 1) },
      { field: 'q', headerName: 'Kalite', width: 100, valueFormatter: (p) => pct(p.value, 1) },
      { field: 'nokRate', headerName: 'NOK %', width: 100, valueFormatter: (p) => pct(p.value, 2) },
      { field: 'downMin', headerName: 'Plansız duruş (dk)', width: 160 },
      { field: 'failures', headerName: 'Arıza', width: 90 },
      { field: 'mttr', headerName: 'MTTR', width: 110, valueFormatter: (p) => (p.value ? fmtDuration(p.value) : '—') },
    ],
    [],
  )

  const lineOptions = [{ value: 'all', label: 'Tüm hücreler' }, ...LINES.map((l) => ({ value: l.id, label: l.short }))]

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={win} onChange={setWin} options={WINDOW_OPTIONS} label="Zaman aralığı" />
        <Segmented value={lineId} onChange={setLineId} options={lineOptions} label="Hat" />
        <span className="text-xs text-fg-2">Planlı duruşlar (bakım/temizlik) OEE'ye dahil edilmez, TEEP'e dahildir.</span>
      </div>

      <section className="grid grid-cols-6 gap-4">
        <StatTile label="OEE" value={pct(k.oee, 1)} sub={<>TEEP {pct(k.teep, 1)}</>} />
        <StatTile label="Kullanılabilirlik" value={pct(k.availability, 1)} sub={<>Çalışma {fmtDuration(k.runSec / Math.max(1, data.machines.length))}/makine</>} />
        <StatTile label="Performans" value={pct(k.performance, 1)} sub="Gerçek hız / ideal hız" />
        <StatTile label="Kalite" value={pct(k.quality, 2)} sub={<>{num(k.nok)} NOK</>} />
        <StatTile label="MTBF" value={data.fail.mtbfSec ? fmtDuration(data.fail.mtbfSec) : '—'} sub={<>{data.fail.failures} arıza</>} />
        <StatTile label="MTTR" value={data.fail.mttrSec ? fmtDuration(data.fail.mttrSec) : '—'} sub="Ort. onarım süresi" />
      </section>

      <section className="grid grid-cols-5 gap-4">
        <Card className="col-span-3">
          <CardHeader title="OEE kayıp şelalesi" subtitle="Altı büyük kayıp · planlı sürenin yüzdesi olarak" />
          <div className="px-2 pb-2 pt-1"><EChart option={waterfall} height={300} label="OEE kayıp şelale grafiği" /></div>
        </Card>
        <Card className="col-span-2">
          <CardHeader title="Plansız duruş nedenleri (Pareto)" subtitle={`${WINDOW_LABEL[win]} · süreye göre azalan`} />
          <div className="px-2 pb-2 pt-1"><EChart option={paretoOption} height={300} label="Duruş nedenleri Pareto grafiği" /></div>
        </Card>
      </section>

      <section className="grid grid-cols-5 gap-4">
        <Card className="col-span-3">
          <CardHeader title="Duruş yoğunluğu ısı haritası" subtitle="Makine × saat · son 24 saat · plansız duruş dakikası" />
          <div className="px-2 pb-2 pt-1"><EChart option={heatOption} height={data.machines.length * 28 + 80} label="Makine ve saate göre duruş ısı haritası" /></div>
        </Card>
        <Card className="col-span-2">
          <CardHeader title="Yavaşlık nedenleri" subtitle={`${WINDOW_LABEL[win]} · ideal hıza göre kayıp süre`} />
          <ul className="space-y-3 px-4 pb-4 pt-3">
            {slowRows.map(([r, v]) => (
              <li key={r}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{SLOW_REASONS[r]?.label}</span>
                  <span className="tnum font-medium">{fmtDuration(v)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-wash"><div className="h-full rounded-full" style={{ width: `${(v / slowMax) * 100}%`, background: 'var(--series-2)' }} /></div>
              </li>
            ))}
            {slowRows.length === 0 && <li className="py-6 text-center text-xs text-fg-2">Seçili aralıkta belirgin yavaşlık yok</li>}
          </ul>
        </Card>
      </section>

      <Card>
        <CardHeader title="Makine performans tablosu" subtitle="Sıralamak için başlığa, ayrıntı için satıra tıklayın" />
        <div className="p-3">
          <div style={{ height: data.rows.length * 42 + 50 }}>
            <AgGridReact<Row>
              theme={gridTheme}
              localeText={gridLocale}
              autoSizeStrategy={{ type: 'fitGridWidth' }}
              rowData={data.rows}
              columnDefs={cols}
              defaultColDef={{ sortable: true, resizable: true }}
              initialState={{ sort: { sortModel: [{ colId: 'oee', sort: 'asc' }] } }}
              getRowId={(p) => p.data.id}
              onRowClicked={(e) => e.data && nav(`/makine/${e.data.id}`)}
              rowStyle={{ cursor: 'pointer' }}
            />
          </div>
        </div>
      </Card>
    </div>
  )
}
