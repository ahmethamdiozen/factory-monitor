import { AgGridReact } from 'ag-grid-react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { Download, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gridLocale, gridTheme } from '@/components/grid/theme'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LINE_BY_ID, MACHINE_BY_ID, REASON_BY_ID, SLOW_REASONS, operatorFor, shiftOf } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'
import { source } from '@/data/store'
import { dayStartOf, fmtDuration } from '@/lib/kpi'
import { cn } from '@/lib/utils'

type EventType = 'Duruş' | 'Bakım' | 'Ayar' | 'Yavaşlama'

interface EventRow {
  id: string
  start: number
  end: number | null
  machineId: string
  machine: string
  line: string
  type: EventType
  reason: string
  durationSec: number
  status: 'Devam ediyor' | 'Bitti'
  shift: string
  operator: string
  micro: boolean
}

const TYPE_STYLE: Record<EventType, string> = {
  Duruş: 'bg-critical/15 text-critical-text',
  Bakım: 'bg-maint/15 text-maint',
  Ayar: 'bg-warning/20 text-warning-text',
  Yavaşlama: 'bg-serious/20 text-serious-text',
}

const fmtTime = (t: number) => {
  const d = new Date(t)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${d.toLocaleTimeString('tr-TR')}`
}

function TypeCell(p: ICellRendererParams<EventRow>) {
  const v = p.value as EventType
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TYPE_STYLE[v])}>{v}</span>
}

function StatusCell(p: ICellRendererParams<EventRow>) {
  const open = p.value === 'Devam ediyor'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn('size-2 rounded-full', open ? 'pulse-dot bg-critical' : 'bg-fg-3')} />
      {p.value}
    </span>
  )
}

export default function Events() {
  const snap = useSnapshot()
  const nav = useNavigate()
  const gridRef = useRef<AgGridReact<EventRow>>(null)
  const [quick, setQuick] = useState('')
  const [micro, setMicro] = useState(false)
  const now = snap.now

  const all = useMemo<EventRow[]>(() => {
    const rows: EventRow[] = []
    for (const e of source.stopEvents()) {
      const m = MACHINE_BY_ID[e.machineId]
      const r = REASON_BY_ID[e.reasonId]
      const type: EventType = e.state === 2 ? 'Bakım' : e.state === 3 ? 'Ayar' : 'Duruş'
      rows.push({
        id: `s${e.id}`,
        start: e.start,
        end: e.end,
        machineId: m.id,
        machine: m.code,
        line: LINE_BY_ID[m.lineId].short,
        type,
        reason: r.label,
        durationSec: ((e.end ?? now) - e.start) / 1000,
        status: e.end === null ? 'Devam ediyor' : 'Bitti',
        shift: shiftOf(e.start),
        operator: operatorFor(m.id, shiftOf(e.start))?.name ?? '—',
        micro: r.category === 'microstop',
      })
    }
    for (const e of source.slowEvents()) {
      const m = MACHINE_BY_ID[e.machineId]
      rows.push({
        id: `w${e.id}`,
        start: e.start,
        end: e.end,
        machineId: m.id,
        machine: m.code,
        line: LINE_BY_ID[m.lineId].short,
        type: 'Yavaşlama',
        reason: `${SLOW_REASONS[e.reasonId]?.label} (min. hız %${Math.round(e.minSpeed * 100)})`,
        durationSec: ((e.end ?? now) - e.start) / 1000,
        status: e.end === null ? 'Devam ediyor' : 'Bitti',
        shift: shiftOf(e.start),
        operator: operatorFor(m.id, shiftOf(e.start))?.name ?? '—',
        micro: false,
      })
    }
    return rows
  }, [snap.now])

  const rows = useMemo(() => (micro ? all : all.filter((r) => !r.micro)), [all, micro])
  const dayStart = dayStartOf(now)
  const today = all.filter((r) => r.start >= dayStart && !r.micro)
  const open = all.filter((r) => r.status === 'Devam ediyor')

  const cols = useMemo<ColDef<EventRow>[]>(
    () => [
      { field: 'start', headerName: 'Başlangıç', width: 170, sort: 'desc', valueFormatter: (p) => fmtTime(p.value), filter: 'agNumberColumnFilter' },
      { field: 'machine', headerName: 'Makine', width: 110 },
      { field: 'line', headerName: 'Hücre', width: 100 },
      { field: 'type', headerName: 'Tür', width: 130, cellRenderer: TypeCell },
      { field: 'reason', headerName: 'Neden', flex: 1, minWidth: 260 },
      { field: 'durationSec', headerName: 'Süre', width: 120, valueFormatter: (p) => fmtDuration(p.value), filter: 'agNumberColumnFilter' },
      { field: 'status', headerName: 'Durum', width: 150, cellRenderer: StatusCell },
      { field: 'shift', headerName: 'Vardiya', width: 110 },
      { field: 'operator', headerName: 'Operatör', width: 170 },
    ],
    [],
  )

  const topReason = useMemo(() => {
    const c = new Map<string, number>()
    for (const r of today) if (r.type === 'Duruş') c.set(r.reason, (c.get(r.reason) ?? 0) + r.durationSec)
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]
  }, [today])

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
      <section className="grid grid-cols-4 gap-4">
        {[
          ['Bugünkü olay', String(today.length), `${today.filter((r) => r.type === 'Duruş').length} duruş · ${today.filter((r) => r.type === 'Yavaşlama').length} yavaşlama`],
          ['Devam eden', String(open.length), 'Şu an açık kayıtlar'],
          ['Plansız duruş · bugün', fmtDuration(today.filter((r) => r.type === 'Duruş').reduce((a, r) => a + r.durationSec, 0)), 'Tüm makineler toplamı'],
          ['En çok süre kaybı', topReason ? topReason[0] : '—', topReason ? fmtDuration(topReason[1]) : ''],
        ].map(([l, v, s]) => (
          <Card key={l} className="px-4 py-3">
            <div className="text-xs font-medium text-fg-2">{l}</div>
            <div className="mt-1 truncate text-xl font-semibold">{v}</div>
            <div className="text-xs text-fg-2">{s}</div>
          </Card>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Ara: makine, neden, operatör…"
            className="h-8 w-72 rounded-md border bg-card pl-8 pr-2 text-[13px] placeholder:text-fg-3 focus-visible:outline-2 focus-visible:outline-s1"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-fg-2">
          <input type="checkbox" checked={micro} onChange={(e) => setMicro(e.target.checked)} className="accent-[var(--series-1)]" />
          Mikro duruşları göster (&lt; 2 dk)
        </label>
        <span className="text-xs text-fg-2">{rows.length} kayıt</span>
        <div className="ml-auto">
          <Button variant="outline" onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: 'olay-gunlugu.csv' })}>
            <Download className="size-3.5" /> CSV dışa aktar
          </Button>
        </div>
      </div>

      <div style={{ height: 'calc(100vh - 300px)', minHeight: 360 }}>
        <AgGridReact<EventRow>
          ref={gridRef}
          theme={gridTheme}
          localeText={gridLocale}
          autoSizeStrategy={{ type: 'fitGridWidth' }}
          rowData={rows}
          columnDefs={cols}
          defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: false }}
          quickFilterText={quick}
          getRowId={(p) => p.data.id}
          onRowClicked={(e) => e.data && nav(`/makine/${e.data.machineId}`)}
          rowStyle={{ cursor: 'pointer' }}
          pagination
          paginationPageSize={50}
          paginationPageSizeSelector={[25, 50, 100]}
        />
      </div>
    </div>
  )
}
