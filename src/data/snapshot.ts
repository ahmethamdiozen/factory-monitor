import { useMemo } from 'react'
import { source, useFactory } from '@/data/store'
import { DOWNTIME_REASONS, LINES, MACHINES, PEOPLE, REASON_BY_ID, SLOW_REASONS, foremanFor, operatorFor, shiftOf } from '@/data/registry'
import { detectViolations, referenceLimits } from '@/lib/spc'
import type { Kpi, ProjectionInfo } from '@/lib/kpi'
import { dayStartOf, idxOf, machineKpi, projection, shiftStartOf, sumKpi } from '@/lib/kpi'
import { BUCKET_MS, BUCKET_SEC, STATE, STATE_KEYS } from '@/lib/types'
import type { Machine, MachineStateKey, Person, ShiftId, StateCode } from '@/lib/types'

export interface MachineLive {
  machine: Machine
  state: StateCode
  stateKey: MachineStateKey
  reasonId: number
  sinceT: number
  /** Son 60 sn ürün/sn */
  ratePerSec: number
  /** Son 5 dk (çalışırken) hız / ideal */
  speedPct: number
  slow: boolean
  slowReasonId: number
  proj: ProjectionInfo
  kpiShift: Kpi
  kpiDay: Kpi
  operator?: Person
  foreman?: Person
  /** Son 60 dk, 1 dk'lık dilimler: ürün/sn (sparkline) */
  spark: number[]
}

export type Severity = 'critical' | 'serious' | 'warning' | 'info'
export interface Alert {
  id: string
  t: number
  severity: Severity
  machineId: string
  title: string
  detail: string
  open: boolean
}

export interface Snapshot {
  now: number
  shiftId: ShiftId
  machines: MachineLive[]
  byId: Record<string, MachineLive>
  factoryDay: Kpi
  factoryShift: Kpi
  lineDay: Record<string, Kpi>
  counts: Record<MachineStateKey, number>
  behindCount: number
  alerts: Alert[]
}

const SEV_RANK: Record<Severity, number> = { critical: 0, serious: 1, warning: 2, info: 3 }

function machineLive(m: Machine, now: number): MachineLive {
  const s = source.machineSeries(m.id)
  const last = s.length - 1
  const state = s.state[last] as StateCode
  const reasonId = s.downReason[last]
  let i = last
  while (i > 0 && s.state[i - 1] === state && s.downReason[i - 1] === reasonId && last - i < 8640) i--
  const sinceT = s.startT + i * BUCKET_MS

  const rWin = 6
  let rc = 0
  for (let k = Math.max(0, s.length - rWin); k < s.length; k++) rc += s.ok[k] + s.nok[k]
  const ratePerSec = rc / (rWin * BUCKET_SEC)

  let sp = 0
  let spN = 0
  const counts: Record<number, number> = {}
  for (let k = Math.max(0, s.length - 30); k < s.length; k++) {
    if (s.state[k] === STATE.RUNNING) {
      sp += s.speed[k]
      spN++
    }
  }
  for (let k = Math.max(0, s.length - 60); k < s.length; k++) {
    const r = s.slowReason[k]
    if (r) counts[r] = (counts[r] ?? 0) + 1
  }
  const speedPct = spN > 0 ? sp / spN : 0
  const slow = state === STATE.RUNNING && spN > 0 && speedPct < 0.9
  let slowReasonId = 0
  let best = 0
  for (const [k, v] of Object.entries(counts)) {
    if (v > best) {
      best = v
      slowReasonId = Number(k)
    }
  }

  const spark: number[] = []
  for (let a = Math.max(0, s.length - 360); a < s.length; a += 6) {
    let c = 0
    for (let k = a; k < Math.min(a + 6, s.length); k++) c += s.ok[k] + s.nok[k]
    spark.push(c / (6 * BUCKET_SEC))
  }

  const sh = shiftOf(now)
  const i1 = s.length
  return {
    machine: m,
    state,
    stateKey: STATE_KEYS[state],
    reasonId,
    sinceT,
    ratePerSec,
    speedPct,
    slow,
    slowReasonId: slow ? slowReasonId : 0,
    proj: projection(s, m, now),
    kpiShift: machineKpi(s, m, Math.max(0, idxOf(source, shiftStartOf(now))), i1),
    kpiDay: machineKpi(s, m, Math.max(0, idxOf(source, dayStartOf(now))), i1),
    operator: operatorFor(m.id, sh),
    foreman: foremanFor(m.lineId, sh),
    spark,
  }
}

function buildAlerts(list: MachineLive[], now: number): Alert[] {
  const out: Alert[] = []
  const byId = Object.fromEntries(list.map((l) => [l.machine.id, l]))
  const stops = source.stopEvents()
  for (let k = stops.length - 1; k >= 0 && out.length < 80; k--) {
    const e = stops[k]
    if (e.end !== null && now - e.end > 45 * 60 * 1000) {
      if (now - e.start > 6 * 3600 * 1000) break
      continue
    }
    const m = byId[e.machineId]?.machine
    if (!m) continue
    const r = REASON_BY_ID[e.reasonId]
    const open = e.end === null
    const durMin = ((e.end ?? now) - e.start) / 60000
    if (r.category === 'microstop') continue
    let severity: Severity = 'info'
    if (open && r.category === 'breakdown') severity = 'critical'
    else if (open && (r.category === 'material' || r.category === 'staffing' || r.category === 'quality')) severity = 'serious'
    else if (!open) severity = 'info'
    out.push({
      id: `s${e.id}`,
      t: e.start,
      severity,
      machineId: m.id,
      title: `${m.code} · ${r.label}`,
      detail: open ? `${Math.round(durMin)} dk'dır devam ediyor` : `Giderildi · ${Math.round(durMin)} dk sürdü`,
      open,
    })
  }
  for (const l of list) {
    const m = l.machine
    if (l.slow) {
      out.push({
        id: `slow-${m.id}`,
        t: now,
        severity: 'warning',
        machineId: m.id,
        title: `${m.code} · Yavaşlık %${Math.round(l.speedPct * 100)}`,
        detail: SLOW_REASONS[l.slowReasonId]?.label ?? 'Neden belirsiz',
        open: true,
      })
    }
    if (l.proj.verdict === 'behind') {
      out.push({
        id: `tgt-${m.id}`,
        t: now - 1,
        severity: 'warning',
        machineId: m.id,
        title: `${m.code} · Hedefin gerisinde`,
        detail: `Gün sonu tahmini ${Math.round((l.proj.projected / m.dailyTarget) * 100)}% — ${Math.round(l.proj.shortfall).toLocaleString('tr-TR')} adet eksik`,
        open: true,
      })
    }
    const pts = source.spc(m.id).slice(-40)
    if (pts.length >= 8) {
      const lim = referenceLimits(m.spec)
      const v = detectViolations(pts, lim)
      const lastV = v[v.length - 1]
      if (lastV && lastV.index >= pts.length - 3) {
        out.push({
          id: `spc-${m.id}`,
          t: pts[lastV.index].t,
          severity: 'warning',
          machineId: m.id,
          title: `${m.code} · SPC alarmı`,
          detail: `${m.spec.characteristic}: Kural ${lastV.rule} ihlali`,
          open: true,
        })
      }
    }
  }
  return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.t - a.t)
}

export function computeSnapshot(): Snapshot {
  const now = source.now()
  const machines = MACHINES.map((m) => machineLive(m, now))
  const counts: Record<MachineStateKey, number> = { running: 0, stopped: 0, maintenance: 0, changeover: 0 }
  for (const m of machines) counts[m.stateKey]++
  const lineDay: Record<string, Kpi> = {}
  for (const l of LINES) lineDay[l.id] = sumKpi(machines.filter((m) => m.machine.lineId === l.id).map((m) => m.kpiDay))
  return {
    now,
    shiftId: shiftOf(now),
    machines,
    byId: Object.fromEntries(machines.map((m) => [m.machine.id, m])),
    factoryDay: sumKpi(machines.map((m) => m.kpiDay)),
    factoryShift: sumKpi(machines.map((m) => m.kpiShift)),
    lineDay,
    counts,
    behindCount: machines.filter((m) => m.proj.verdict === 'behind').length,
    alerts: buildAlerts(machines, now),
  }
}

export function useSnapshot(): Snapshot {
  const tick = useFactory((s) => s.tick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => computeSnapshot(), [tick])
}

export { DOWNTIME_REASONS, PEOPLE }
