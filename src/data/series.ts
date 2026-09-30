import { BUCKET_MS } from '@/lib/types'
import type { MachineSeries } from '@/lib/types'

/** API/collector dilimi (sütun adları SQLite'takiyle aynı). */
export interface BucketRow {
  t: number
  state: number
  downReason: number
  slowReason: number
  speed: number
  ok: number
  nok: number
}

export function createSeries(startT: number, capacity: number): MachineSeries {
  return {
    startT,
    length: 0,
    // Veri gelmeyen dilimler "durdu" sayılır (1) — sahte üretim göstermemek için
    state: new Uint8Array(capacity).fill(1),
    downReason: new Uint8Array(capacity),
    slowReason: new Uint8Array(capacity),
    speed: new Float32Array(capacity),
    ok: new Uint16Array(capacity),
    nok: new Uint16Array(capacity),
  }
}

function grow(s: MachineSeries, minCap: number): MachineSeries {
  let cap = s.state.length
  if (cap >= minCap) return s
  while (cap < minCap) cap *= 2
  const n = createSeries(s.startT, cap)
  n.length = s.length
  n.state.set(s.state)
  n.downReason.set(s.downReason)
  n.slowReason.set(s.slowReason)
  n.speed.set(s.speed)
  n.ok.set(s.ok)
  n.nok.set(s.nok)
  return n
}

/** Dilimleri seriye yerleştirir (gerekirse büyütür). Uzunluğu değiştirmez. Yeni seriyi döndürür. */
export function putBuckets(s0: MachineSeries, rows: BucketRow[]): MachineSeries {
  if (rows.length === 0) return s0
  const maxIdx = Math.max(...rows.map((r) => Math.round((r.t - s0.startT) / BUCKET_MS)))
  const s = grow(s0, maxIdx + 1)
  for (const r of rows) {
    const i = Math.round((r.t - s.startT) / BUCKET_MS)
    if (i < 0) continue
    s.state[i] = r.state
    s.downReason[i] = r.downReason
    s.slowReason[i] = r.slowReason
    s.speed[i] = r.speed
    s.ok[i] = Math.min(65535, r.ok)
    s.nok[i] = Math.min(65535, r.nok)
  }
  return s
}
