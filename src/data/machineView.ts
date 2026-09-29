import { BUCKET_MS, BUCKET_SEC, STATE } from '@/lib/types'
import type { Machine, MachineSeries } from '@/lib/types'

export interface Segment {
  start: number
  end: number
  state: number
  reasonId: number
}

/** Durum + neden değişimine göre run-length segmentler. */
export function stateSegments(s: MachineSeries, i0: number, i1: number): Segment[] {
  const out: Segment[] = []
  const lo = Math.max(0, i0)
  const hi = Math.min(s.length, i1)
  let cur: Segment | null = null
  for (let i = lo; i < hi; i++) {
    const st = s.state[i]
    const r = s.downReason[i]
    if (!cur || cur.state !== st || cur.reasonId !== r) {
      if (cur) out.push(cur)
      cur = { start: s.startT + i * BUCKET_MS, end: s.startT + (i + 1) * BUCKET_MS, state: st, reasonId: r }
    } else cur.end = s.startT + (i + 1) * BUCKET_MS
  }
  if (cur) out.push(cur)
  return out
}

export interface SlowSegment {
  start: number
  end: number
  reasonId: number
  avgSpeed: number
}

export function slowSegments(s: MachineSeries, i0: number, i1: number): SlowSegment[] {
  const out: SlowSegment[] = []
  const lo = Math.max(0, i0)
  const hi = Math.min(s.length, i1)
  let cur: (SlowSegment & { sum: number; n: number }) | null = null
  const flush = () => {
    if (cur) out.push({ start: cur.start, end: cur.end, reasonId: cur.reasonId, avgSpeed: cur.sum / cur.n })
    cur = null
  }
  for (let i = lo; i < hi; i++) {
    const r = s.state[i] === STATE.RUNNING ? s.slowReason[i] : 0
    if (r === 0) {
      flush()
      continue
    }
    if (!cur || cur.reasonId !== r) {
      flush()
      cur = { start: s.startT + i * BUCKET_MS, end: s.startT + (i + 1) * BUCKET_MS, reasonId: r, avgSpeed: 0, sum: s.speed[i], n: 1 }
    } else {
      cur.end = s.startT + (i + 1) * BUCKET_MS
      cur.sum += s.speed[i]
      cur.n++
    }
  }
  flush()
  return out
}

/** step bucket'lık dilimlerde ortalama üretim hızı (ürün/sn, duruşlar dahil). */
export function rateSlices(s: MachineSeries, i0: number, i1: number, step: number): [number, number][] {
  const out: [number, number][] = []
  const lo = Math.max(0, i0)
  const hi = Math.min(s.length, i1)
  for (let a = lo; a < hi; a += step) {
    const b = Math.min(a + step, hi)
    let c = 0
    for (let i = a; i < b; i++) c += s.ok[i] + s.nok[i]
    out.push([s.startT + ((a + b) / 2) * BUCKET_MS, c / ((b - a) * BUCKET_SEC)])
  }
  return out
}

/** Gün başından itibaren kümülatif OK üretim. */
export function cumulativeOk(s: MachineSeries, i0: number, step: number): [number, number][] {
  const out: [number, number][] = []
  let acc = 0
  out.push([s.startT + i0 * BUCKET_MS, 0])
  for (let a = i0; a < s.length; a += step) {
    const b = Math.min(a + step, s.length)
    for (let i = a; i < b; i++) acc += s.ok[i]
    out.push([s.startT + b * BUCKET_MS, acc])
  }
  return out
}

export function speedHistogram(s: MachineSeries, i0: number, i1: number, binPct = 4, minPct = 56): { label: string; count: number; from: number }[] {
  const bins: number[] = new Array(Math.ceil((104 - minPct) / binPct)).fill(0)
  for (let i = Math.max(0, i0); i < Math.min(s.length, i1); i++) {
    if (s.state[i] !== STATE.RUNNING) continue
    const p = s.speed[i] * 100
    const k = Math.min(bins.length - 1, Math.max(0, Math.floor((p - minPct) / binPct)))
    bins[k]++
  }
  return bins.map((count, k) => ({ label: `${minPct + k * binPct}`, count, from: minPct + k * binPct }))
}

/** Duruş süreleri (sn) neden bazında */
export function downtimeByReason(s: MachineSeries, i0: number, i1: number): Map<number, number> {
  const out = new Map<number, number>()
  for (let i = Math.max(0, i0); i < Math.min(s.length, i1); i++) {
    if (s.state[i] === STATE.RUNNING) continue
    const r = s.downReason[i]
    out.set(r, (out.get(r) ?? 0) + BUCKET_SEC)
  }
  return out
}

/** Yavaşlık nedenine göre kayıp üretim (adet) */
export function slowLossByReason(s: MachineSeries, m: Machine, i0: number, i1: number): Map<number, number> {
  const out = new Map<number, number>()
  for (let i = Math.max(0, i0); i < Math.min(s.length, i1); i++) {
    if (s.state[i] !== STATE.RUNNING) continue
    const r = s.slowReason[i]
    if (!r) continue
    // Kayıp: ideal hıza göre eksik üretim (yalnızca yavaşlık kaynaklı, %96 taban hızına kıyasla)
    const lost = Math.max(0, 0.96 - s.speed[i]) * m.idealRate * BUCKET_SEC
    out.set(r, (out.get(r) ?? 0) + lost)
  }
  return out
}
