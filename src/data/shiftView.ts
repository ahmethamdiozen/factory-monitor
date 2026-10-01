import { downtimeByReason } from '@/data/machineView'
import { MACHINES, REASON_BY_ID, SHIFTS, SLOW_REASONS, foremanFor, operatorFor, shiftOf } from '@/data/registry'
import type { MachineLive, Snapshot } from '@/data/snapshot'
import { source } from '@/data/store'
import { activeRisk } from '@/data/predictiveView'
import { failureStats, idxOf, machineKpi, parts, sumKpi } from '@/lib/kpi'
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
/** Vardiya hedefi (parça). Uzun çevrimli makinelerde kesirli olabilir (ör. 0,7 parça). */
export const shiftTarget = (m: Machine) => m.dailyTarget / 3

export interface ShiftProgress {
  ok: number
  nok: number
  target: number
  /** Şu ana kadar üretilmiş olması gereken (doğrusal plan) */
  expected: number
  /** ok − expected (negatif: geride) */
  diff: number
  /** Yarım kalan parça dahil şu ana kadar yapılan iş (parça cinsinden) */
  done: number
  /** Son 4 saatin çalışma etkinliğiyle vardiya sonu tahmini */
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
  const expected = (target * elapsed) / SHIFT_MS
  // Uzun çevrimlerde yarım kalan parça da sayılır: bu vardiyada yapılan iş = Σ(çalışma süresi × hız),
  // parça cinsinden. (Önceki vardiyada başlamış parçanın o vardiyaya ait kısmı buraya yazılmaz.)
  let work = 0
  for (let i = Math.max(0, i0); i < Math.min(s.length, i1); i++) if (s.state[i] === STATE.RUNNING) work += s.speed[i] * BUCKET_SEC
  const done = work * m.idealRate
  const iEff = Math.max(0, i1 - (4 * 3600) / BUCKET_SEC)
  let w4 = 0
  for (let i = iEff; i < i1; i++) if (s.state[i] === STATE.RUNNING) w4 += s.speed[i]
  const eff = i1 > iEff ? w4 / (i1 - iEff) : 0
  const remainingMs = Math.max(0, w.end - now)
  return {
    ok,
    nok,
    target,
    expected,
    diff: done - expected,
    done,
    projected: done + (m.idealRate * eff * remainingMs) / 1000,
    progress: Math.min(1, done / target),
    timeProgress: elapsed / SHIFT_MS,
    remainingMs,
  }
}

/** Tamamlanan parça / şarj */
export interface PartDone {
  machineId: string
  /** tamamlanma anı */
  t: number
  ok: number
  nok: number
  /** bir önceki tamamlanmadan bu yana geçen süre (sn) */
  sinceLastSec: number | null
}

export function completions(ids: string[], from: number, to: number): PartDone[] {
  const out: PartDone[] = []
  for (const id of ids) {
    const s = source.machineSeries(id)
    const i0 = Math.max(0, idxOf(source, from))
    const i1 = Math.min(s.length, idxOf(source, to))
    // bir önceki tamamlanmayı bulmak için pencereden geriye bak
    let prev: number | null = null
    for (let i = i0 - 1; i >= Math.max(0, i0 - 8640); i--) {
      if (s.ok[i] + s.nok[i] > 0) {
        prev = s.startT + (i + 1) * BUCKET_MS
        break
      }
    }
    for (let i = i0; i < i1; i++) {
      if (s.ok[i] + s.nok[i] === 0) continue
      const t = s.startT + (i + 1) * BUCKET_MS
      out.push({ machineId: id, t, ok: s.ok[i], nok: s.nok[i], sinceLastSec: prev === null ? null : (t - prev) / 1000 })
      prev = t
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Vardiya boyunca 5 dk'lık dilimlerde baskın durum (zaman çizgisi için) */
export function stateTrack(machineId: string, from: number, to: number, stepMin = 5): { t: number; state: number }[] {
  const s = source.machineSeries(machineId)
  const step = (stepMin * 60) / BUCKET_SEC
  const out: { t: number; state: number }[] = []
  for (let a = Math.max(0, idxOf(source, from)); a < Math.min(s.length, idxOf(source, to)); a += step) {
    const counts = [0, 0, 0, 0]
    for (let k = a; k < Math.min(a + step, s.length); k++) counts[s.state[k]]++
    out.push({ t: s.startT + a * BUCKET_MS, state: counts.indexOf(Math.max(...counts)) })
  }
  return out
}

// ---------- Sade dil: öneriler ----------

/** Yavaşlık nedeni → operatörün anlayacağı kısa açıklama ve yapılacak iş */
export const SLOW_ADVICE: Record<number, { what: string; todo: string }> = {
  1: { what: 'Kesici uç aşınıyor', todo: 'Takım ömrünü kontrol et, gerekirse ucu değiştir' },
  2: { what: 'Yeni malzeme partisi daha sert olabilir', todo: 'Parti sertifikasını kaliteye kontrol ettir' },
  3: { what: 'Parametreler standarttan farklı olabilir', todo: 'İş talimatındaki kesme parametrelerini kontrol et' },
  4: { what: 'Soğutma sıvısı / iş mili ısındı', todo: "Soğutma sıvısı seviyesini ve chiller'ı kontrol et" },
  5: { what: 'Duruş sonrası ısınma programı', todo: 'Isınma programı bitince normale döner, bekle' },
  6: { what: 'İlerleme düşürüldü (titreşim / besleme)', todo: 'Takım bağlamasını, titreşimi ve beslemeyi kontrol et' },
  7: { what: 'Neden belli değil', todo: "Foreman'e haber ver" },
}

/** Duruş için "normal" süre (dk). Aşılırsa müdahale gerekir. Arıza her zaman müdahale ister. */
export const NORMAL_STOP_MIN: Record<string, number> = {
  breakdown: 0,
  changeover: 45,
  microstop: 5,
  material: 30,
  staffing: 15,
  quality: 40,
  planned: 120,
}

export const STOP_ADVICE: Record<string, string> = {
  breakdown: 'Bakım ekibini çağır',
  changeover: 'Ayar ekibine sor; ilk parça onayı ne zaman?',
  microstop: 'Talaşı temizle, alarmı kontrol et',
  material: 'Önceki operasyondan parça ne zaman geliyor?',
  staffing: 'Yedek operatör ayarla',
  quality: 'CMM / kalite onayını takip et',
  planned: 'Planlı — bitiş saatini takip et',
}

export type Tone = 'critical' | 'serious' | 'warning' | 'ok' | 'info'

export interface TodoItem {
  tone: Tone
  text: string
}

/** Makine tipine göre ara ölçüm aralığı (dk); fırında ölçüm şarj sonunda yapılır */
const QUALITY_EVERY_MIN: Record<string, number | null> = { cnc: 30, grinder: 20, coating: 30, cmm: 120, furnace: null }

function nextQualityCheck(m: Machine): number | null {
  const every = QUALITY_EVERY_MIN[m.type]
  const pts = source.spc(m.id)
  if (!every || !pts.length) return null
  return pts[pts.length - 1].t + every * 60 * 1000
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
  const risk = activeRisk(m.id, live.state, live.reasonId)
  if (risk?.level === 'alarm') out.push({ tone: 'serious', text: 'Arıza riski yüksek — bakım ekibine haber verildi; olağandışı ses, koku veya titreşim varsa bildir' })
  else if (risk?.level === 'watch') out.push({ tone: 'info', text: 'Makine sağlığı izleniyor — olağandışı bir şey fark edersen foreman\'e söyle' })
  const sp = shiftProgress(m, w, now)
  if (sp.nok > 0) out.push({ tone: 'serious', text: 'Uygunsuz parça çıktı — parçayı karantinaya ayır, kaliteye bildir (MRB)' })
  if (spcAlarm(m)) out.push({ tone: 'warning', text: `${m.spec.characteristic} kayıyor — kaliteye haber ver` })
  const next = live.state === STATE.RUNNING ? nextQualityCheck(m) : null
  if (next !== null) {
    const min = Math.round((next - now) / 60000)
    out.push(min <= 0 ? { tone: 'serious', text: 'Ara ölçüm zamanı geçti — şimdi ölç' } : { tone: 'info', text: `Sıradaki ara ölçüm ${min} dk sonra` })
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
    const risk = activeRisk(m.id, l.state, l.reasonId)
    if (risk && risk.level !== 'good') {
      const alarm = risk.level === 'alarm'
      out.push({
        machineId: m.id,
        code: m.code,
        tone: alarm ? 'serious' : 'warning',
        rank: alarm ? 0.5 : 4.5,
        title: alarm ? `ARIZA RİSKİ YÜKSEK · %${Math.round(risk.risk * 100)}` : `Arıza riski artıyor · %${Math.round(risk.risk * 100)}`,
        detail: risk.factors[0]?.text ?? 'Birden fazla sinyal normalin dışında',
        action: alarm ? 'Bakım ekibiyle bu vardiya kontrol planla' : 'Sonraki planlı bakımda kontrol ettir',
      })
    }
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
        detail: `Bu hızla vardiya sonunda ${parts(p.target - p.projected)} parça eksik`,
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
