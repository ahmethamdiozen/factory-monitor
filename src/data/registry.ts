import * as def from '@/sim/factoryDef'
import type { DowntimeReason, FactoryMeta, Line, Machine, Person, ShiftId } from '@/lib/types'

/**
 * Arayüzün kullandığı referans verisi (hatlar, makineler, nedenler, personel).
 * Açılışta /api/meta ile YERİNDE doldurulur (hydrate); böylece bu dizileri import eden
 * sayfalar değişmeden gerçek veriyle çalışır. Varsayılan değerler statik tanımdır.
 */

export { SHIFTS, DAY_START_HOUR, CATEGORY_LABEL, SLOW_REASONS, DEFECT_TYPES, shiftOf } from '@/sim/factoryDef'

export const LINES: Line[] = def.LINES.map((l) => ({ ...l }))
export const MACHINES: Machine[] = def.MACHINES.map((m) => ({ ...m }))
export const DOWNTIME_REASONS: DowntimeReason[] = def.DOWNTIME_REASONS.map((r) => ({ ...r }))
export const PEOPLE: Person[] = def.PEOPLE.map((p) => ({ ...p }))

export const MACHINE_BY_ID: Record<string, Machine> = {}
export const LINE_BY_ID: Record<string, Line> = {}
export const REASON_BY_ID: Record<number, DowntimeReason> = {}

function reindex(): void {
  for (const rec of [MACHINE_BY_ID, LINE_BY_ID, REASON_BY_ID] as Record<string | number, unknown>[]) {
    for (const k of Object.keys(rec)) delete rec[k]
  }
  for (const m of MACHINES) MACHINE_BY_ID[m.id] = m
  for (const l of LINES) LINE_BY_ID[l.id] = l
  for (const r of DOWNTIME_REASONS) REASON_BY_ID[r.id] = r
}
reindex()

const replace = <T,>(arr: T[], next: T[]) => arr.splice(0, arr.length, ...next)

export function hydrate(meta: FactoryMeta): void {
  replace(LINES, meta.lines)
  replace(MACHINES, meta.machines)
  replace(DOWNTIME_REASONS, meta.reasons)
  replace(PEOPLE, meta.people)
  reindex()
}

export function operatorFor(machineId: string, shiftId: ShiftId): Person | undefined {
  return PEOPLE.find((p) => p.role === 'operator' && p.machineId === machineId && p.shiftId === shiftId)
}

export function foremanFor(lineId: string, shiftId: ShiftId): Person | undefined {
  return PEOPLE.find((p) => p.role === 'foreman' && p.lineId === lineId && p.shiftId === shiftId)
}
