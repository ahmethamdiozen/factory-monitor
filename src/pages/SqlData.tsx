import { AgGridReact } from 'ag-grid-react'
import type { ColDef } from 'ag-grid-community'
import { ArrowRight, Cpu, Database, Download, FlaskConical, HardDrive, Monitor, RefreshCw, Server, Workflow } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gridLocale, gridTheme } from '@/components/grid/theme'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IS_DEMO } from '@/data/mode'
import type { DemoDataSource } from '@/data/demo/DemoDataSource'
import type { SqlTableData, SqlTableInfo } from '@/data/sqlTables'
import { source, useFactory } from '@/data/store'
import { cn } from '@/lib/utils'

/**
 * SQL VERİ — "fabrikanın" SQL Server'ındaki ham tablolar ve veri hattının sağlığı.
 * Ham tablolar API üzerinden doğrudan SQL Server'dan (salt-okur) okunur.
 */

interface Health {
  now: number
  simulator: { lastWriteAt: number | null; lagSec: number | null }
  sqlServer: { ok: boolean; latencyMs: number | null; error: string | null }
  collector: { lastSuccessAt: number | null; error: string | null; rowsPerMin: number; sinceSuccessSec: number | null } | null
  sqlite: { bytes: number; buckets: number; lagSec: number | null }
}

type TableInfo = SqlTableInfo
type TableData = SqlTableData

type Level = 'ok' | 'warn' | 'down'
const DOT: Record<Level, string> = { ok: 'bg-good', warn: 'bg-warning', down: 'bg-critical' }
const LEVEL_LABEL: Record<Level, string> = { ok: 'Çalışıyor', warn: 'Gecikiyor', down: 'Ulaşılamıyor' }

const sec = (s: number | null | undefined) => (s == null ? '—' : s < 60 ? `${Math.round(s)} sn önce` : `${Math.round(s / 60)} dk önce`)
const n = (x: number) => x.toLocaleString('tr-TR')

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error ?? r.statusText)
  return r.json() as Promise<T>
}

function Stage({ icon: Icon, title, role, level, lines }: { icon: typeof Server; title: string; role: string; level: Level; lines: string[] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-fg-2" />
        <span className="truncate text-[13px] font-semibold">{title}</span>
      </div>
      <div className="text-[11px] text-fg-3">{role}</div>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <span className={cn('size-2 rounded-full', DOT[level])} />
        {LEVEL_LABEL[level]}
      </div>
      {lines.map((l) => (
        <div key={l} className="truncate text-[11px] text-fg-2" title={l}>
          {l}
        </div>
      ))}
    </div>
  )
}

export default function SqlData() {
  const conn = useFactory((s) => s.conn)
  const [health, setHealth] = useState<Health | null>(null)
  const [apiOk, setApiOk] = useState(true)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [tablesErr, setTablesErr] = useState<string | null>(null)
  const [sel, setSel] = useState('ProductionCounters')
  const [data, setData] = useState<TableData | null>(null)
  const [dataErr, setDataErr] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  const gridRef = useRef<AgGridReact<Record<string, unknown>>>(null)

  const demo = IS_DEMO ? (source as DemoDataSource) : null

  const refresh = useCallback(async () => {
    if (demo) {
      setTables(demo.sqlTables())
      return
    }
    try {
      setHealth(await getJson<Health>('/api/health'))
      setApiOk(true)
    } catch {
      setApiOk(false)
    }
    try {
      setTables((await getJson<{ tables: TableInfo[] }>('/api/sql/tables')).tables)
      setTablesErr(null)
    } catch (e) {
      setTablesErr((e as Error).message)
    }
  }, [])

  const loadTable = useCallback(async (name: string) => {
    if (demo) {
      setData(demo.sqlTable(name, 200))
      return
    }
    try {
      setData(await getJson<TableData>(`/api/sql/table/${name}?limit=200`))
      setDataErr(null)
    } catch (e) {
      setDataErr((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 5000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    void loadTable(sel)
    if (!auto) return
    const id = setInterval(() => void loadTable(sel), 5000)
    return () => clearInterval(id)
  }, [sel, auto, loadTable])

  const cols = useMemo<ColDef<Record<string, unknown>>[]>(
    () =>
      (data?.columns ?? []).map((c) => ({
        field: c,
        headerName: c,
        minWidth: 110,
        valueFormatter: (p) => {
          const v = p.value
          if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.replace('T', ' ').replace('Z', ' UTC')
          if (typeof v === 'boolean') return v ? '1' : '0'
          return v == null ? 'NULL' : String(v)
        },
      })),
    [data?.columns],
  )
  const rowData = useMemo(() => (data?.rows ?? []).map((r) => Object.fromEntries((data?.columns ?? []).map((c, i) => [c, r[i]]))), [data])

  const h = health
  const simLevel: Level = !h?.simulator.lastWriteAt ? 'down' : (h.simulator.lagSec ?? 999) < 30 ? 'ok' : 'warn'
  const sqlLevel: Level = !apiOk ? 'down' : h?.sqlServer.ok ? 'ok' : 'down'
  const colLevel: Level = !h?.collector ? 'down' : h.collector.error ? 'down' : (h.collector.sinceSuccessSec ?? 999) < 20 ? 'ok' : 'warn'
  const liteLevel: Level = !h ? 'down' : (h.sqlite.lagSec ?? 999) < 30 ? 'ok' : 'warn'
  const uiLevel: Level = conn.state === 'live' ? 'ok' : conn.state === 'offline' ? 'down' : 'warn'
  const info = tables.find((t) => t.name === sel)

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <div>
          <h1 className="text-[17px] font-semibold">SQL Veri</h1>
          <p className="mt-0.5 text-xs text-fg-2">Fabrikanın SQL Server'ındaki ham tablolar ve bu verinin ekranlara ulaşana kadar geçtiği hat. Gerçek veri geldiğinde sadece ilk kutu (makine simülatörü) değişir.</p>
        </div>

        {IS_DEMO ? (
          <>
            <div className="flex items-start gap-2.5 rounded-xl border border-dashed bg-card px-4 py-3 text-sm">
              <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning-text" />
              <p className="leading-relaxed text-fg-2">
                <b className="text-fg">Demo modu (web sürümü).</b> Kurulum gerekmesin diye tüm hat tarayıcınızın içinde çalışıyor: makineler simüle ediliyor, ürettikleri satırlar aşağıda
                gerçek SQL Server'daki tablo yapısıyla gösteriliyor ve collector'ın anlamlandırma kodunun aynısı bu satırları işliyor. Gerçek kurulumda bu satırlar fabrikanın SQL Server'ından okunur.
              </p>
            </div>
            <section aria-label="Veri hattı" className="flex items-stretch gap-1.5">
              <Stage icon={Cpu} title="Makineler" role="Tarayıcıda simülasyon · 10 sn'de bir" level="ok" lines={[`Son satır ${conn.dataUntil ? new Date(conn.dataUntil).toLocaleTimeString('tr-TR') : '—'}`, '12 makine · PLC gibi']} />
              <ArrowRight className="size-4 shrink-0 self-center text-fg-3" />
              <Stage icon={Server} title="Ham tablolar" role="SQL Server yapısında, bellekte" level="ok" lines={[`${n(tables.reduce((a, t) => a + t.rows, 0))} satır`, 'Gerçekte: SQL Server']} />
              <ArrowRight className="size-4 shrink-0 self-center text-fg-3" />
              <Stage icon={Workflow} title="Anlamlandırma" role="Collector'ın kodu, tarayıcıda" level="ok" lines={['Sayaç farkı · hız · kurallar', 'Gerçekte: collector + SQLite']} />
              <ArrowRight className="size-4 shrink-0 self-center text-fg-3" />
              <Stage icon={Monitor} title="Ekranlar" role="Makine · Foreman · Mühendis" level={uiLevel} lines={[conn.dataUntil ? `Son veri ${new Date(conn.dataUntil).toLocaleTimeString('tr-TR')}` : '—', '10 sn\'de bir güncellenir']} />
            </section>
          </>
        ) : (
          <section aria-label="Veri hattı" className="flex items-stretch gap-1.5">
            <Stage icon={Cpu} title="Makineler" role="Simülatör · 10 sn'de bir yazar" level={simLevel} lines={[`Son yazma ${sec(h?.simulator.lagSec)}`, '12 makine · PLC gibi']} />
            <ArrowRight className="size-4 shrink-0 self-center text-fg-3" />
            <Stage icon={Server} title="SQL Server" role="Fabrikanın veritabanı" level={sqlLevel} lines={[h?.sqlServer.ok ? `Yanıt ${h.sqlServer.latencyMs} ms` : (h?.sqlServer.error ?? 'API yanıt vermiyor'), `${n(tables.reduce((a, t) => a + t.rows, 0))} satır`]} />
            <ArrowRight className="size-4 shrink-0 self-center text-fg-3" />
            <Stage icon={Workflow} title="Collector" role="5 sn'de bir yeni satırları okur" level={colLevel} lines={[h?.collector?.error ?? `Son okuma ${sec(h?.collector?.sinceSuccessSec)}`, `${n(h?.collector?.rowsPerMin ?? 0)} satır/dk`]} />
            <ArrowRight className="size-4 shrink-0 self-center text-fg-3" />
            <Stage icon={HardDrive} title="SQLite" role="Anlamlandırılmış veri" level={liteLevel} lines={[`${((h?.sqlite.bytes ?? 0) / 1e6).toFixed(1).replace('.', ',')} MB · ${n(h?.sqlite.buckets ?? 0)} dilim`, `Gecikme ${h?.sqlite.lagSec != null ? Math.round(h.sqlite.lagSec) + ' sn' : '—'}`]} />
            <ArrowRight className="size-4 shrink-0 self-center text-fg-3" />
            <Stage icon={Database} title="API" role="Ekranların veri kapısı" level={apiOk ? 'ok' : 'down'} lines={[apiOk ? 'localhost:3001' : 'Yanıt yok', 'Salt-okur']} />
            <ArrowRight className="size-4 shrink-0 self-center text-fg-3" />
            <Stage icon={Monitor} title="Ekranlar" role="Makine · Foreman · Mühendis" level={uiLevel} lines={[conn.dataUntil ? `Son veri ${new Date(conn.dataUntil).toLocaleTimeString('tr-TR')}` : '—', '5 sn\'de bir güncellenir']} />
          </section>
        )}

        <section className="grid grid-cols-[280px_1fr] gap-4">
          <Card className="self-start">
            <div className="px-4 pb-1 pt-3.5 text-[13px] font-semibold">Tablolar · FactoryDB{IS_DEMO && <span className="font-normal text-fg-3"> (demo)</span>}</div>
            {tablesErr && <p className="px-4 py-2 text-xs text-critical-text">{tablesErr}</p>}
            <ul className="p-2">
              {tables.map((t) => (
                <li key={t.name}>
                  <button
                    onClick={() => setSel(t.name)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-s1',
                      sel === t.name ? 'bg-wash' : 'hover:bg-wash',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[12px] font-medium">dbo.{t.name}</span>
                      <span className="text-[11px] text-fg-3">
                        {t.kind}
                        {t.lastTime ? ` · son ${new Date(t.lastTime).toLocaleTimeString('tr-TR')}` : ''}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-[11px] text-fg-2">{n(t.rows)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-mono text-[13px] font-semibold">SELECT TOP 200 * FROM dbo.{sel} ORDER BY 1 DESC</h2>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-fg-2">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[var(--series-1)]" />
                5 sn'de bir yenile
              </label>
              <Button variant="outline" size="icon" onClick={() => void loadTable(sel)} aria-label="Yenile" title="Yenile">
                <RefreshCw className="size-3.5" />
              </Button>
              <Button variant="outline" onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: `${sel}.csv` })}>
                <Download className="size-3.5" /> CSV
              </Button>
            </div>
            {dataErr && <p className="text-xs text-critical-text">Okunamadı: {dataErr} — ekranda son okunan satırlar duruyor.</p>}
            <div style={{ height: 460 }}>
              <AgGridReact<Record<string, unknown>>
                ref={gridRef}
                theme={gridTheme}
                localeText={gridLocale}
                rowData={rowData}
                columnDefs={cols}
                defaultColDef={{ sortable: true, resizable: true, filter: true }}
                autoSizeStrategy={{ type: 'fitGridWidth' }}
              />
            </div>
            {info && (
              <Card className="px-4 py-3">
                <div className="text-[13px] font-semibold">Bu veri nasıl anlamlandırılıyor?</div>
                <p className="mt-1 text-sm leading-relaxed text-fg-2">{info.how}</p>
              </Card>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
