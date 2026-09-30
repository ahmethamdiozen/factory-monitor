import type { ConnStatus, LiveSource } from '@/data/DataSource'
import { hydrate } from '@/data/registry'
import { createSeries, putBuckets } from '@/data/series'
import type { BucketRow } from '@/data/series'
import { BUCKET_MS } from '@/lib/types'
import type { FactoryMeta, MachineSeries, SlowEvent, SpcPoint, StopEvent } from '@/lib/types'

/**
 * Gerçek veri hattından (SQL Server → Collector → SQLite → API) beslenen veri kaynağı.
 * 5 sn'de bir sadece yeni dilimleri/olayları çeker. API'ye ulaşılamazsa eldeki veri
 * kalır ve durum "offline" olur — arayüz eski veriyi göstermeye devam eder.
 */

const POLL_MS = 5000
const HISTORY_MS = 30 * 3600 * 1000
/** Veri bu kadar geride kalırsa (simülatör/collector durmuş) "bayat" sayılır */
const STALE_AFTER_MS = 30 * 1000

interface SeriesResponse {
  datasetId: string
  watermark: number
  since: number
  machines: Record<string, { t: number[]; state: number[]; down: number[]; slow: number[]; speed: number[]; ok: number[]; nok: number[] }>
}

interface EventsResponse {
  cursor: number
  stops: StopEvent[]
  slows: SlowEvent[]
}

async function getJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export class ApiDataSource implements LiveSource {
  readonly kind = 'live' as const
  startT = 0
  ready = false
  private datasetId: string | null = null
  private watermark = 0
  private series = new Map<string, MachineSeries>()
  private stops = new Map<number, StopEvent>()
  private slows = new Map<number, SlowEvent>()
  private stopList: StopEvent[] = []
  private slowList: SlowEvent[] = []
  private spcByMachine = new Map<string, SpcPoint[]>()
  private lastSpcT = 0
  private eventCursor = 0
  private metaLoadedAt = 0
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private conn: ConnStatus = { state: 'connecting', lastSuccessAt: null, dataUntil: null, error: null }

  start(): void {
    if (this.timer) return
    const loop = async () => {
      await this.poll()
      this.timer = setTimeout(loop, POLL_MS)
    }
    void loop()
  }

  status(): ConnStatus {
    return this.conn
  }

  private async poll(): Promise<void> {
    try {
      if (!this.ready || Date.now() - this.metaLoadedAt > 60_000) await this.loadMeta()
      if (!this.ready) await this.loadAll()
      else await this.loadIncrement()
      const lag = Date.now() - this.watermark
      this.conn = { state: lag > STALE_AFTER_MS ? 'stale' : 'live', lastSuccessAt: Date.now(), dataUntil: this.watermark || null, error: null }
    } catch (e) {
      this.conn = { ...this.conn, state: 'offline', error: (e as Error).message }
    }
    this.emit()
  }

  private async loadMeta(): Promise<void> {
    const meta = await getJson<FactoryMeta>('/api/meta')
    hydrate(meta)
    this.metaLoadedAt = Date.now()
    if (this.datasetId && meta.datasetId !== this.datasetId) this.ready = false // veri sıfırlandı → baştan yükle
  }

  private async loadAll(): Promise<void> {
    const res = await getJson<SeriesResponse>(`/api/series?since=${Math.floor((Date.now() - HISTORY_MS) / BUCKET_MS) * BUCKET_MS}`)
    this.datasetId = res.datasetId
    this.startT = Math.floor(res.since / BUCKET_MS) * BUCKET_MS
    this.series.clear()
    this.stops.clear()
    this.slows.clear()
    this.spcByMachine.clear()
    this.eventCursor = 0
    this.lastSpcT = 0
    this.applySeries(res)
    await this.loadEvents()
    await this.loadSpc()
    this.ready = true
  }

  private async loadIncrement(): Promise<void> {
    const res = await getJson<SeriesResponse>(`/api/series?since=${this.watermark}`)
    if (res.datasetId !== this.datasetId) {
      this.ready = false
      await this.loadAll()
      return
    }
    this.applySeries(res)
    await this.loadEvents()
    await this.loadSpc()
  }

  private applySeries(res: SeriesResponse): void {
    const cap = Math.ceil((res.watermark - this.startT) / BUCKET_MS) + 8640
    for (const [id, c] of Object.entries(res.machines)) {
      const rows: BucketRow[] = c.t.map((t, k) => ({ t, state: c.state[k], downReason: c.down[k], slowReason: c.slow[k], speed: c.speed[k], ok: c.ok[k], nok: c.nok[k] }))
      const s = putBuckets(this.series.get(id) ?? createSeries(this.startT, cap), rows)
      this.series.set(id, s)
    }
    this.watermark = Math.max(this.watermark, res.watermark)
    const length = Math.max(0, Math.round((this.watermark - this.startT) / BUCKET_MS))
    for (const s of this.series.values()) s.length = length
  }

  private async loadEvents(): Promise<void> {
    const res = await getJson<EventsResponse>(`/api/events?cursor=${this.eventCursor}&from=${this.startT}`)
    for (const e of res.stops) this.stops.set(e.id, e)
    for (const e of res.slows) this.slows.set(e.id, e)
    if (res.stops.length) this.stopList = [...this.stops.values()].sort((a, b) => a.start - b.start)
    if (res.slows.length) this.slowList = [...this.slows.values()].sort((a, b) => a.start - b.start)
    this.eventCursor = res.cursor
  }

  private async loadSpc(): Promise<void> {
    const res = await getJson<{ rows: (SpcPoint & { machineId: string })[] }>(`/api/spc?since=${this.lastSpcT + 1}`)
    for (const r of res.rows) {
      const list = this.spcByMachine.get(r.machineId) ?? []
      list.push({ t: r.t, mean: r.mean, range: r.range })
      this.spcByMachine.set(r.machineId, list)
      this.lastSpcT = Math.max(this.lastSpcT, r.t)
    }
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn())
  }

  now(): number {
    return this.watermark || Date.now()
  }
  machineSeries(id: string): MachineSeries {
    let s = this.series.get(id)
    if (!s) {
      s = createSeries(this.startT || Date.now(), 8640)
      this.series.set(id, s)
    }
    return s
  }
  stopEvents(): StopEvent[] {
    return this.stopList
  }
  slowEvents(): SlowEvent[] {
    return this.slowList
  }
  spc(id: string): SpcPoint[] {
    return this.spcByMachine.get(id) ?? []
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
