import { downtimeByReason } from '@/data/machineView'
import { MACHINES, REASON_BY_ID, SHIFTS, SLOW_REASONS, foremanFor, operatorFor, shiftOf } from '@/data/registry'
import type { MachineLive, Snapshot } from '@/data/snapshot'
import { source } from '@/data/store'
import { failureStats, idxOf, machineKpi, sumKpi } from '@/lib/kpi'
import type { Kpi } from '@/lib/kpi'
import { detectViolations, referenceLimits } from '@/lib/spc'
import { BUCKET_MS, BUCKET_SEC, STATE } from '@/lib/types'
import type { Machine, MachineSeries, Person, ShiftId } from '@/lib/types'

/**
 * Operatör ve foreman ekranlarının hesapları. Bu ekranların ufku VARDİYA'dır
 * (vardiya hedefi = günlük hedef / 3) ve dili jargonsuzdur.
 */

const HOUR = 3600 * 1000
const SHIFT_MS = 8 * HOUR

export interface ShiftWindow {
  id: ShiftId
  name: string
  start: number
  end: number
}

export function shiftWindowAt(t: number): ShiftWindow {
  const id = shiftOf(t)
  const def = SHIFTS.find((s) => s.id === id)!
  const d = new Date(t)
  d.setHours(def.startHour, 0, 0, 0)
  if (d.getTime() > t) d.setDate(d.getDate() - 1)
  const start = d.getTime()
  return { id, name: def.name, start, end: start + SHIFT_MS }
}

export const previousShift = (w: ShiftWindow) => shiftWindowAt(w.start - 1)
export const shiftTarget = (m: Machine) => Math.round(m.dailyTarget / 3)

export interface ShiftProgress {
  ok: number
  nok: number
  target: number
  /** Şu ana kadar üretilmiş olması gereken (doğrusal plan) */
  expected: number
  /** ok − expected (negatif: geride) */
  diff: number
  /** Son 60 dk hızıyla vardiya sonu tahmini */
  projected: number
  progress: number
  timeProgress: number
  remainingMs: number
}

function sumRange(s: MachineSeries, i0: number, i1: number): { ok: number; nok: number } {
  let ok = 0
  let nok = 0
  for (let i = Math.max(0, i0); i < Math.min(s.length, i1); i++) {
    ok += s.ok[i]
    nok += s.nok[i]
  }
  return { ok, nok }
}

export function shiftProgress(m: Machine, w: ShiftWindow, now: number): ShiftProgress {
  const s = source.machineSeries(m.id)
  const i0 = idxOf(source, w.start)
  const i1 = idxOf(source, Math.min(now, w.end))
  const { ok, nok } = sumRange(s, i0, i1)
  const target = shiftTarget(m)
  const elapsed = Math.max(0, Math.min(SHIFT_MS, now - w.start))
  const expected = Math.round((target * elapsed) / SHIFT_MS)
  const win = Math.min(i1 - i0, (60 * 60) / BUCKET_SEC)
  const recent = win > 0 ? sumRange(s, i1 - win, i1).ok / (win * BUCKET_SEC) : 0
  const remainingMs = Math.max(0, w.end - now)
  return {
    ok,
    nok,
    target,
    expected,
    diff: ok - expected,
    projected: Math.round(ok + (recent * remainingMs) / 1000),
    progress: Math.min(1, ok / target),
    timeProgress: elapsed / SHIFT_MS,
    remainingMs,
  }
}

export interface HourBar {
  start: number
  ok: number
  target: number
  /** Saat tamamlanmadıysa kısmi hedef */
  partial: boolean
  future: boolean
}

export function hourlyBars(ids: string[], w: ShiftWindow, now: number): HourBar[] {
  const out: HourBar[] = []
  const machines = MACHINES.filter((m) => ids.includes(m.id))
  const hourTarget = machines.reduce((a, m) => a + shiftTarget(m), 0) / 8
  for (let h = 0; h < 8; h++) {
    const start = w.start + h * HOUR
    const end = Math.min(start + HOUR, now)
    if (start >= now) {
      out.push({ start, ok: 0, target: Math.round(hourTarget), partial: false, future: true })
      continue
    }
    let ok = 0
    for (const m of machines) ok += sumRange(source.machineSeries(m.id), idxOf(source, start), idxOf(source, end)).ok
    const frac = (end - start) / HOUR
    out.push({ start, ok, target: Math.round(hourTarget * frac), partial: frac < 1, future: false })
  }
  return out
}

export function lastHourQuality(machineId: string, now: number): { nok: number; total: number; rate: number } {
  const s = source.machineSeries(machineId)
  const { ok, nok } = sumRange(s, idxOf(source, now - HOUR), idxOf(source, now))
  const total = ok + nok
  return { nok, total, rate: total ? nok / total : 0 }
}

// ---------- Sade dil: öneriler ----------

/** Yavaşlık nedeni → operatörün anlayacağı kısa açıklama ve yapılacak iş */
export const SLOW_ADVICE: Record<number, { what: string; todo: string }> = {
  1: { what: 'Kalıp / takım aşınıyor', todo: "Foreman'e takım değişimini söyle" },
  2: { what: 'Yeni hammadde lotu sorunlu olabilir', todo: 'Kaliteye numune ver, lotu kontrol ettir' },
  3: { what: 'Makine ayarı yavaş kalmış olabilir', todo: 'İş talimatındaki hız ayarını kontrol et' },
  4: { what: 'Makine fazla ısınmış', todo: 'Soğutma suyunu ve fanı kontrol et' },
  5: { what: 'Duruştan sonra ısınıyor', todo: 'Birkaç dakikada normale döner, bekle' },
  6: { what: 'Besleme düzensiz geliyor', todo: 'Besleme bandını ve hazneyi kontrol et' },
  7: { what: 'Neden belli değil', todo: "Foreman'e haber ver" },
}

/** Duruş için "normal" süre (dk). Aşılırsa müdahale gerekir. Arıza her zaman müdahale ister. */
export const NORMAL_STOP_MIN: Record<string, number> = {
  breakdown: 0,
  changeover: 20,
  microstop: 3,
  material: 10,
  staffing: 10,
  quality: 15,
  planned: 60,
}

export const STOP_ADVICE: Record<string, string> = {
  breakdown: 'Bakım ekibini çağır',
  changeover: 'Ayar ekibine sor, ne kadar kaldı?',
  microstop: 'Sıkışmayı temizle',
  material: 'Malzeme / forklift durumunu sor',
  staffing: 'Yedek operatör ayarla',
  quality: 'Kalite onayını takip et',
  planned: 'Planlı — bitiş saatini takip et',
}

export type Tone = 'critical' | 'serious' | 'warning' | 'ok' | 'info'

export interface TodoItem {
  tone: Tone
  text: string
}

function nextQualityCheck(machineId: string): number | null {
  const pts = source.spc(machineId)
  if (!pts.length) return null
  return pts[pts.length - 1].t + 15 * 60 * 1000
}

function spcAlarm(m: Machine): boolean {
  const pts = source.spc(m.id).slice(-12)
  if (pts.length < 8) return false
  const v = detectViolations(pts, referenceLimits(m.spec))
  return v.some((x) => x.index >= pts.length - 3)
}

export function operatorTodos(live: MachineLive, w: ShiftWindow, now: number): TodoItem[] {
  const out: TodoItem[] = []
  const m = live.machine
  const stopMin = (now - live.sinceT) / 60000
  if (live.state !== STATE.RUNNING) {
    const cat = REASON_BY_ID[live.reasonId]?.category ?? 'breakdown'
    if (stopMin > NORMAL_STOP_MIN[cat]) out.push({ tone: 'critical', text: `Duruş ${Math.round(stopMin)} dk sürdü — ${STOP_ADVICE[cat]}` })
  } else if (live.slow) {
    const a = SLOW_ADVICE[live.slowReasonId] ?? SLOW_ADVICE[7]
    out.push({ tone: 'warning', text: `${a.todo}` })
  }
  const q = lastHourQuality(m.id, now)
  if (q.total > 50 && q.rate > 0.02) out.push({ tone: 'warning', text: 'Hatalı ürün arttı — ölçü kontrolü yap' })
  if (spcAlarm(m)) out.push({ tone: 'warning', text: `${m.spec.characteristic} kayıyor — kaliteye haber ver` })
  const next = live.state === STATE.RUNNING ? nextQualityCheck(m.id) : null
  if (next !== null) {
    const min = Math.round((next - now) / 60000)
    out.push(min <= 0 ? { tone: 'serious', text: 'Kalite ölçümü zamanı geçti — şimdi ölç' } : { tone: 'info', text: `Sıradaki kalite ölçümü ${min} dk sonra` })
  }
  const left = (w.end - now) / 60000
  if (left < 30) out.push({ tone: 'info', text: `Vardiya devrine ${Math.round(left)} dk kaldı — devir notunu hazırla` })
  if (!out.some((x) => x.tone === 'critical' || x.tone === 'warning' || x.tone === 'serious')) out.unshift({ tone: 'ok', text: 'Her şey yolunda, böyle devam' })
  return out
}

// ---------- Foreman: müdahale listesi ----------

export interface Intervention {
  machineId: string
  code: string
  tone: Tone
  /** Sıralama anahtarı (küçük = önce) */
  rank: number
  title: string
  detail: string
  action: string
}

export function interventions(snap: Snapshot, lineId: string, w: ShiftWindow): Intervention[] {
  const now = snap.now
  const out: Intervention[] = []
  for (const l of snap.machines.filter((x) => x.machine.lineId === lineId)) {
    const m = l.machine
    const stopMin = (now - l.sinceT) / 60000
    if (l.state !== STATE.RUNNING) {
      const r = REASON_BY_ID[l.reasonId]
      const cat = r?.category ?? 'breakdown'
      const normal = NORMAL_STOP_MIN[cat]
      const over = stopMin > normal
      if (cat === 'breakdown' || over || cat !== 'planned') {
        out.push({
          machineId: m.id,
          code: m.code,
          tone: cat === 'breakdown' || over ? 'critical' : 'serious',
          rank: cat === 'breakdown' ? 0 : over ? 1 : 3,
          title: `DURDU · ${r?.label ?? 'Bilinmeyen neden'}`,
          detail: `${Math.round(stopMin)} dk${normal > 0 ? ` (normal ${normal} dk)` : ''}`,
          action: STOP_ADVICE[cat],
        })
      } else {
        out.push({ machineId: m.id, code: m.code, tone: 'info', rank: 6, title: `${r?.label}`, detail: `${Math.round(stopMin)} dk · planlı`, action: STOP_ADVICE.planned })
      }
      continue
    }
    const spc = spcAlarm(m)
    if (l.slow) {
      const a = SLOW_ADVICE[l.slowReasonId] ?? SLOW_ADVICE[7]
      out.push({
        machineId: m.id,
        code: m.code,
        tone: 'warning',
        rank: spc ? 2 : 4,
        title: `YAVAŞ %${Math.round(l.speedPct * 100)} · ${SLOW_REASONS[l.slowReasonId]?.label ?? 'neden belirsiz'}`,
        detail: spc ? `${a.what} · ayrıca ölçü kayıyor (${m.spec.characteristic.toLowerCase()})` : a.what,
        action: a.todo,
      })
    } else if (spc) {
      out.push({ machineId: m.id, code: m.code, tone: 'warning', rank: 2, title: 'KALİTE ALARMI', detail: `${m.spec.characteristic} kontrol sınırında`, action: 'Kalite kontrol ölçümü iste' })
    }
    const p = shiftProgress(m, w, now)
    if (p.projected < p.target * 0.95 && p.timeProgress > 0.1) {
      out.push({
        machineId: m.id,
        code: m.code,
        tone: 'warning',
        rank: 5,
        title: 'Vardiya hedefinin gerisinde',
        detail: `Bu hızla vardiya sonunda ${(Math.round((p.target - p.projected) / 10) * 10).toLocaleString('tr-TR')} adet eksik`,
        action: 'Duruşları kısalt, gerekirse yardım ver',
      })
    }
  }
  return out.sort((a, b) => a.rank - b.rank)
}

// ---------- Foreman: hat özetleri ----------

export function lineShiftKpi(lineId: string, w: ShiftWindow, now: number): Kpi {
  const ms = MACHINES.filter((m) => m.lineId === lineId)
  const i0 = idxOf(source, w.start)
  const i1 = idxOf(source, Math.min(now, w.end))
  return sumKpi(ms.map((m) => machineKpi(source.machineSeries(m.id), m, i0, i1)))
}

export interface LossRow {
  label: string
  minutes: number
}

export function topLosses(lineId: string, w: ShiftWindow, now: number, n = 3): LossRow[] {
  const ms = MACHINES.filter((m) => m.lineId === lineId)
  const i0 = idxOf(source, w.start)
  const i1 = idxOf(source, Math.min(now, w.end))
  const agg = new Map<string, number>()
  for (const m of ms) {
    for (const [r, sec] of downtimeByReason(source.machineSeries(m.id), i0, i1)) {
      if (REASON_BY_ID[r]?.planned) continue
      const label = REASON_BY_ID[r]?.label ?? '?'
      agg.set(label, (agg.get(label) ?? 0) + sec / 60)
    }
  }
  const speedMin = lineShiftKpi(lineId, w, now).loss.speed / 60
  if (speedMin > 0) agg.set('Yavaş çalışma (hız kaybı)', speedMin)
  return [...agg.entries()].map(([label, minutes]) => ({ label, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, n)
}

/** Saat saat tablo satırı için o saatteki en büyük kayıp */
export function mainLossInHour(lineId: string, start: number, end: number): string {
  const ms = MACHINES.filter((m) => m.lineId === lineId)
  const agg = new Map<number, number>()
  for (const m of ms) for (const [r, sec] of downtimeByReason(source.machineSeries(m.id), idxOf(source, start), idxOf(source, end))) agg.set(r, (agg.get(r) ?? 0) + sec)
  const top = [...agg.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top || top[1] < 120) return '—'
  return `${REASON_BY_ID[top[0]]?.label} · ${Math.round(top[1] / 60)} dk`
}

export interface Handover {
  shift: ShiftWindow
  foreman?: Person
  targetPct: number
  nokRate: number
  failures: number
  worstFailure: string | null
  stillOpen: string[]
}

export function handover(lineId: string, cur: ShiftWindow, snap: Snapshot): Handover {
  const prev = previousShift(cur)
  const ms = MACHINES.filter((m) => m.lineId === lineId)
  const k = lineShiftKpi(lineId, prev, prev.end)
  const target = ms.reduce((a, m) => a + shiftTarget(m), 0)
  const stops = source.stopEvents()
  const ids = new Set(ms.map((m) => m.id))
  const f = failureStats(stops, ids, prev.start, prev.end, k.runSec)
  const worst = stops
    .filter((e) => ids.has(e.machineId) && e.start >= prev.start && e.start < prev.end && REASON_BY_ID[e.reasonId]?.category === 'breakdown')
    .map((e) => ({ e, min: ((e.end ?? snap.now) - e.start) / 60000 }))
    .sort((a, b) => b.min - a.min)[0]
  const stillOpen = snap.machines
    .filter((l) => ids.has(l.machine.id) && l.state !== STATE.RUNNING && l.sinceT < cur.start)
    .map((l) => `${l.machine.code} (${REASON_BY_ID[l.reasonId]?.label}) devam ediyor`)
  return {
    shift: prev,
    foreman: foremanFor(lineId, prev.id),
    targetPct: target ? k.ok / target : 0,
    nokRate: k.total ? k.nok / k.total : 0,
    failures: f.failures,
    worstFailure: worst ? `${MACHINES.find((m) => m.id === worst.e.machineId)?.code} · ${REASON_BY_ID[worst.e.reasonId]?.label} · ${Math.round(worst.min)} dk` : null,
    stillOpen,
  }
}

export const operatorOf = (machineId: string, w: ShiftWindow) => operatorFor(machineId, w.id)

export const bucketAt = (t: number) => Math.floor(t / BUCKET_MS) * BUCKET_MS
