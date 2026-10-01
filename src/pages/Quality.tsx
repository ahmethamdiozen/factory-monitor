import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { EChart } from '@/components/charts/EChart'
import { baseOption, categoryAxisStyle, hhmm, timeAxisStyle, useChartTokens, valueAxisStyle } from '@/components/charts/theme'
import { Card, CardHeader } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { StatTile } from '@/components/ui/stat-tile'
import { hourlyKpi, machinesOfLine } from '@/data/aggregate'
import { DEFECT_TYPES, LINES, MACHINES, MACHINE_BY_ID } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'
import { source } from '@/data/store'
import { machineKpi, num, pct, sumKpi, windowRange } from '@/lib/kpi'
import { RULE_LABEL, capability, detectViolations, referenceLimits } from '@/lib/spc'
import { WINDOW_LABEL } from '@/lib/types'
import type { WindowKey } from '@/lib/types'
import { cn } from '@/lib/utils'

const WINDOW_OPTIONS = (Object.keys(WINDOW_LABEL) as WindowKey[]).map((k) => ({ value: k, label: WINDOW_LABEL[k] }))
const SPC_POINTS = 32

export default function Quality() {
  const snap = useSnapshot()
  const t = useChartTokens()
  const [win, setWin] = useState<WindowKey>('day')
  const [mid, setMid] = useState('M02')
  const now = snap.now
  const m = MACHINE_BY_ID[mid]

  const stats = useMemo(() => {
    const w = windowRange(source, win)
    const kpis = MACHINES.map((x) => machineKpi(source.machineSeries(x.id), x, w.i0, w.i1))
    const total = sumKpi(kpis)
    const byMachine = MACHINES.map((x, i) => ({ m: x, rate: kpis[i].total ? kpis[i].nok / kpis[i].total : 0, nok: kpis[i].nok })).sort((a, b) => b.rate - a.rate)
    const defects = new Map<string, number>()
    for (const l of LINES) {
      const nokLine = MACHINES.reduce((a, x, i) => a + (x.lineId === l.id ? kpis[i].nok : 0), 0)
      for (const d of DEFECT_TYPES[l.id]) defects.set(`${d.label} · ${l.short}`, (defects.get(`${d.label} · ${l.short}`) ?? 0) + nokLine * d.weight)
    }
    const defectRows = [...defects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    return { total, byMachine, defectRows }
  }, [win, now])

  const spc = useMemo(() => {
    const pts = source.spc(mid).slice(-SPC_POINTS)
    const lim = referenceLimits(m.spec)
    const viol = detectViolations(pts, lim)
    return { pts, lim, viol, cap: capability(pts, m.spec) }
  }, [mid, now, m])

  const lineTrend = useMemo(
    () => LINES.map((l) => ({ l, data: hourlyKpi(machinesOfLine(l.id), now, 8, 6).map((h) => [h.t0 + 3 * 3600e3, h.kpi.total ? h.kpi.nok / h.kpi.total : 0]) })),
    [now],
  )

  const xbarOption = useMemo(() => {
    const { pts, lim, viol } = spc
    const spec = m.spec
    const vals = pts.map((p) => p.mean)
    let lo = Math.min(...vals, lim.xbar.lcl)
    let hi = Math.max(...vals, lim.xbar.ucl)
    if (hi > lim.xbar.ucl + (spec.usl - lim.xbar.ucl) * 0.5) hi = Math.max(hi, spec.usl)
    if (lo < lim.xbar.lcl - (lim.xbar.lcl - spec.lsl) * 0.5) lo = Math.min(lo, spec.lsl)
    const pad = (hi - lo) * 0.12
    const dec = spec.sigma < 0.1 ? 3 : 2
    const fmt = (v: number) => v.toFixed(dec).replace('.', ',')
    const lineLabel = (name: string, v: number, color: string) => ({ yAxis: v, name, lineStyle: { color, type: 'dashed' as const, width: 1 }, label: { formatter: `${name} ${fmt(v)}`, color: t.fg3, position: 'insideEndTop' as const, fontSize: 11 } })
    const markData = [
      lineLabel('UCL', lim.xbar.ucl, t.fg3),
      lineLabel('LCL', lim.xbar.lcl, t.fg3),
      { yAxis: lim.xbar.cl, lineStyle: { color: t.fg3, type: 'solid' as const, width: 1 }, label: { formatter: `CL ${fmt(lim.xbar.cl)}`, color: t.fg3, position: 'insideEndTop' as const, fontSize: 11 } },
    ]
    if (spec.usl <= hi + pad) markData.push(lineLabel('USL (tolerans)', spec.usl, t.critical))
    if (spec.lsl >= lo - pad) markData.push(lineLabel('LSL (tolerans)', spec.lsl, t.critical))
    return {
      ...baseOption(t),
      grid: { left: 58, right: 18, top: 14, bottom: 26 },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: 'axis',
        formatter: (p: { dataIndex: number }[]) => {
          const i = p[0].dataIndex
          const v = viol.find((x) => x.index === i)
          return `<b>${hhmm(pts[i].t)}</b><br/>x̄ = ${fmt(pts[i].mean)} ${spec.unit}${v ? `<br/><span style="color:${t.critical}">${RULE_LABEL[v.rule]}</span>` : ''}`
        },
      },
      xAxis: { ...timeAxisStyle(t), axisLabel: { color: t.fg3, formatter: (v: number) => hhmm(v), hideOverlap: true } },
      yAxis: { ...valueAxisStyle(t), min: lo - pad, max: hi + pad, scale: true, axisLabel: { color: t.fg3, formatter: (v: number) => fmt(v) } },
      series: [
        {
          name: 'x̄',
          type: 'line',
          data: pts.map((p) => [p.t, p.mean]),
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color: t.series[0] },
          itemStyle: { color: t.series[0] },
          markLine: { silent: true, symbol: 'none', data: markData },
        },
        {
          name: 'İhlal',
          type: 'scatter',
          symbolSize: 12,
          itemStyle: { color: 'transparent', borderColor: t.critical, borderWidth: 2 },
          data: viol.map((v) => [pts[v.index].t, pts[v.index].mean]),
          tooltip: { show: false },
          z: 5,
        },
      ],
    }
  }, [spc, m, t])

  const rOption = useMemo(() => {
    const { pts, lim } = spc
    const dec = m.spec.sigma < 0.1 ? 3 : 2
    const fmt = (v: number) => v.toFixed(dec).replace('.', ',')
    return {
      ...baseOption(t),
      grid: { left: 58, right: 18, top: 10, bottom: 26 },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', valueFormatter: (v: number) => `${fmt(v)} ${m.spec.unit}` },
      xAxis: { ...timeAxisStyle(t), axisLabel: { color: t.fg3, formatter: (v: number) => hhmm(v), hideOverlap: true } },
      yAxis: { ...valueAxisStyle(t), min: 0, axisLabel: { color: t.fg3, formatter: (v: number) => fmt(v) } },
      series: [
        {
          name: 'R',
          type: 'line',
          data: pts.map((p) => [p.t, p.range]),
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: t.series[2] },
          itemStyle: { color: t.series[2] },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              { yAxis: lim.range.ucl, lineStyle: { color: t.fg3, type: 'dashed', width: 1 }, label: { formatter: `UCL ${fmt(lim.range.ucl)}`, color: t.fg3, position: 'insideEndTop', fontSize: 11 } },
              { yAxis: lim.range.cl, lineStyle: { color: t.fg3, type: 'solid', width: 1 }, label: { formatter: `R̄ ${fmt(lim.range.cl)}`, color: t.fg3, position: 'insideEndTop', fontSize: 11 } },
            ],
          },
        },
      ],
    }
  }, [spc, m, t])

  const trendOption = useMemo(
    () => ({
      ...baseOption(t),
      grid: { left: 44, right: 14, top: 28, bottom: 24 },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { color: t.fg2 } },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', valueFormatter: (v: number) => `%${(v * 100).toFixed(2)}` },
      xAxis: { ...timeAxisStyle(t), min: now - 48 * 3600e3, max: now, axisLabel: { color: t.fg3, formatter: (v: number) => hhmm(v), hideOverlap: true } },
      yAxis: { ...valueAxisStyle(t), min: 0, axisLabel: { color: t.fg3, formatter: (v: number) => `%${(v * 100).toFixed(1).replace('.', ',')}` } },
      series: lineTrend.map((d, i) => ({ name: d.l.short, type: 'line', data: d.data, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: t.series[i] } })),
    }),
    [lineTrend, t, now],
  )

  const defectOption = useMemo(
    () => ({
      ...baseOption(t),
      grid: { left: 170, right: 70, top: 6, bottom: 6 },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${(Math.round(v * 10) / 10).toString().replace('.', ',')} parça` },
      xAxis: { type: 'value', show: false },
      yAxis: { ...categoryAxisStyle(t, stats.defectRows.map((r) => r[0])), inverse: true, axisLine: { show: false }, axisLabel: { color: t.fg2, width: 160, overflow: 'truncate' } },
      series: [{ type: 'bar', data: stats.defectRows.map((r) => r[1]), barWidth: 12, itemStyle: { color: t.series[1], borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: t.fg2, formatter: (p: { value: number }) => num(Math.round(p.value)) } }],
    }),
    [stats.defectRows, t],
  )

  const machineOption = useMemo(() => {
    const rows = stats.byMachine
    return {
      ...baseOption(t),
      grid: { left: 70, right: 60, top: 6, bottom: 6 },
      tooltip: { ...(baseOption(t).tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `%${(v * 100).toFixed(2)}` },
      xAxis: { type: 'value', show: false },
      yAxis: { ...categoryAxisStyle(t, rows.map((r) => r.m.code)), inverse: true, axisLine: { show: false } },
      series: [{ type: 'bar', barWidth: 12, data: rows.map((r, i) => ({ value: r.rate, itemStyle: { color: i < 3 ? t.series[1] : t.series[0], borderRadius: [0, 4, 4, 0] } })), label: { show: true, position: 'right', color: t.fg2, formatter: (p: { value: number }) => `%${(p.value * 100).toFixed(1).replace('.', ',')}` } }],
    }
  }, [stats.byMachine, t])

  const cpk = spc.cap?.cpk ?? null
  const cpkStatus = cpk === null ? null : cpk >= 1.33 ? { text: 'Yeterli', cls: 'text-good-text', Icon: CheckCircle2 } : cpk >= 1 ? { text: 'Sınırda', cls: 'text-warning-text', Icon: AlertTriangle } : { text: 'Yetersiz', cls: 'text-critical-text', Icon: AlertTriangle }
  const violCount = spc.viol.length
  const lastRules = [...new Set(spc.viol.map((v) => v.rule))].sort()

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={win} onChange={setWin} options={WINDOW_OPTIONS} label="Zaman aralığı" />
        <label className="flex items-center gap-2 text-xs text-fg-2">
          SPC makinesi
          <select
            value={mid}
            onChange={(e) => setMid(e.target.value)}
            className="h-8 rounded-md border bg-card px-2 text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-s1"
          >
            {MACHINES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="grid grid-cols-5 gap-4">
        <StatTile label="İlk geçiş verimi (FPY)" value={pct(stats.total.quality, 2)} sub={<>{WINDOW_LABEL[win]}</>} />
        <StatTile label="Uygunsuz parça" value={num(stats.total.nok)} sub={<>Toplam {num(stats.total.total)} parçadan · MRB</>} />
        <StatTile label={`Cpk · ${m.code}`} value={cpk === null ? '—' : cpk.toFixed(2).replace('.', ',')} valueClass={cpkStatus?.cls} sub={cpkStatus && <span className={cn('inline-flex items-center gap-1 font-medium', cpkStatus.cls)}><cpkStatus.Icon className="size-3.5" />{cpkStatus.text} · Cp {spc.cap ? spc.cap.cp.toFixed(2).replace('.', ',') : '—'}</span>}><span className="text-[11px] text-fg-2">Hedef Cpk ≥ 1,33</span></StatTile>
        <StatTile label={`SPC ihlali · ${m.code}`} value={String(violCount)} valueClass={violCount > 0 ? 'text-warning-text' : 'text-good-text'} sub={violCount > 0 ? <>Kural {lastRules.join(', ')} · son {SPC_POINTS} ölçüm</> : <>Süreç kontrol altında</>} />
        <StatTile label="Ölçülen özellik" value={m.spec.characteristic} valueClass="!text-lg leading-tight" sub={<>Nominal {String(m.spec.nominal).replace('.', ',')} {m.spec.unit}<br />Tolerans {String(m.spec.lsl).replace('.', ',')}–{String(m.spec.usl).replace('.', ',')}</>} />
      </section>

      <Card>
        <CardHeader title={`x̄–R kontrol grafiği · ${m.code}`} subtitle={`${m.spec.characteristic} (${m.spec.unit}) · ara ölçümler 5'li alt gruplarda · son ${SPC_POINTS} ölçüm · kırmızı halka: Western Electric kural ihlali`} />
        <div className="px-2 pt-1">
          <EChart option={xbarOption} height={260} label="x-bar kontrol grafiği" />
          <EChart option={rOption} height={130} label="R kontrol grafiği" />
        </div>
        {spc.viol.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-t px-4 py-3 text-xs">
            {lastRules.map((r) => (
              <li key={r} className="inline-flex items-center gap-1.5 rounded-md bg-warning/20 px-2 py-1 font-medium text-warning-text">
                <AlertTriangle className="size-3" />
                {RULE_LABEL[r]} · {spc.viol.filter((v) => v.rule === r).length} nokta
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader title="Hücrelere göre uygunsuzluk oranı" subtitle="Son 48 saat · 6 saatlik dilimler" />
          <div className="px-2 pb-2 pt-1"><EChart option={trendOption} height={260} label="Hücre bazlı uygunsuzluk oranı" /></div>
        </Card>
        <Card>
          <CardHeader title="Uygunsuzluk türü Pareto" subtitle={`${WINDOW_LABEL[win]} · yer tutucu dağılım`} />
          <div className="px-2 pb-2 pt-1"><EChart option={defectOption} height={260} label="Uygunsuzluk türü Pareto grafiği" /></div>
        </Card>
        <Card>
          <CardHeader title="Makineye göre uygunsuzluk oranı" subtitle={`${WINDOW_LABEL[win]} · en yüksek 3 vurgulu`} />
          <div className="px-2 pb-2 pt-1"><EChart option={machineOption} height={260} label="Makine bazlı uygunsuzluk oranı" /></div>
        </Card>
      </section>
    </div>
  )
}
