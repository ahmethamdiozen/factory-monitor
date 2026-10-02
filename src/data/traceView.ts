import { source } from '@/data/store'
import { MACHINE_BY_ID, PEOPLE } from '@/data/registry'
import { EMPLOYEE_NO, FAMILY_BY_PN } from '@/sim/factoryDef'
import type { PartFamily } from '@/sim/factoryDef'
import type { FurnaceCycle, Ncr, PartOp } from '@/pipeline/trace'

/** İzlenebilirlik ekranları için türetilmiş görünümler (parça durumu, geçmiş, şarj uyumu). */

export function personName(employeeNo: string | null): string {
  if (!employeeNo) return '—'
  const p = PEOPLE.find((x) => x.id === employeeNo || EMPLOYEE_NO[x.id] === employeeNo)
  return p?.name ?? employeeNo
}

export function familyOf(partNumber: string): PartFamily | undefined {
  return FAMILY_BY_PN[partNumber]
}

/** Makinede şu an işlenen parça(lar) */
export function currentOps(machineId: string): PartOp[] {
  const ops = source.partOps()
  const out: PartOp[] = []
  for (let i = ops.length - 1; i >= 0 && out.length < 6; i--) if (ops[i].machineId === machineId && ops[i].end === null) out.push(ops[i])
  return out.reverse()
}

/** Makinedeki işin kısa etiketi: "S/N TD26-00042" ya da "Şarj FRN-01-260012 · 12 parça" */
export function currentLabel(machineId: string): string | null {
  const cur = currentOps(machineId)
  if (!cur.length) return null
  if (cur[0].batchNo) return `Şarj ${cur[0].batchNo} · ${cur.length} parça`
  return `S/N ${cur[0].serial}`
}

/** Fırının son tamamlanan şarjının reçete uyumu */
export function lastCycle(machineId: string): FurnaceCycle | undefined {
  const c = source.furnaceCycles()
  for (let i = c.length - 1; i >= 0; i--) if (c[i].machineId === machineId) return c[i]
  return undefined
}

/** Tamamlanan parça olayının seri numaraları (makine + bitiş anı) */
export function serialsDoneAt(machineId: string, t: number): PartOp[] {
  return source.partOps().filter((o) => o.machineId === machineId && o.end !== null && Math.abs(o.end - t) <= 10_000)
}

export function serialHistory(serial: string): PartOp[] {
  return source.partOps().filter((o) => o.serial === serial)
}

export function ncrOf(serial: string): Ncr[] {
  return source.ncrs().filter((n) => n.serial === serial)
}

/** Operasyonun yapıldığı fırın çevrimi (tutma bu operasyonun içinde bitmişse) */
export function cycleFor(op: PartOp): FurnaceCycle | undefined {
  if (!op.batchNo) return undefined
  const end = op.end ?? Infinity
  return source.furnaceCycles().find((c) => c.machineId === op.machineId && c.end > op.start && c.end <= end)
}

export type PartStateKind = 'process' | 'queue' | 'mrb' | 'scrap' | 'done'

export interface PartState {
  kind: PartStateKind
  text: string
  machineId?: string
}

/** Parçanın şu anki durumu: işlemde / kuyrukta / MRB / hurda / rota tamamlandı */
export function partState(serial: string, history = serialHistory(serial)): PartState {
  const last = history[history.length - 1]
  if (!last) return { kind: 'queue', text: 'Kayıt yok' }
  const code = (id: string) => MACHINE_BY_ID[id]?.code ?? id
  if (last.end === null) return { kind: 'process', text: `İşlemde: ${code(last.machineId)} · ${last.op}`, machineId: last.machineId }
  const f = familyOf(last.partNumber)
  const stepIdx = f ? f.steps.findIndex((s) => s.machineId === last.machineId) : -1
  if (last.result === 'NOK') {
    const n = ncrOf(serial).filter((x) => x.t >= last.end!).at(0) ?? ncrOf(serial).at(0)
    if (!n?.disposition) return { kind: 'mrb', text: `MRB kararı bekleniyor (${n?.ncrNo ?? 'NCR'})` }
    if (n.disposition === 'scrap') return { kind: 'scrap', text: `Hurda (${n.ncrNo})` }
    if (n.disposition === 'rework') return { kind: 'queue', text: `Yeniden işleme bekliyor: ${code(last.machineId)} · ${last.op}`, machineId: last.machineId }
  }
  const next = f?.steps[stepIdx + 1]
  if (!next) return { kind: 'done', text: 'Rota tamamlandı — sevke hazır' }
  return { kind: 'queue', text: `Kuyrukta: ${code(next.machineId)} · ${next.op} bekliyor`, machineId: next.machineId }
}

/** Tüm parçaların son durumu (seri no → durum) */
export function allPartStates(): Map<string, { history: PartOp[]; state: PartState }> {
  const by = new Map<string, PartOp[]>()
  for (const o of source.partOps()) {
    const l = by.get(o.serial)
    if (l) l.push(o)
    else by.set(o.serial, [o])
  }
  const out = new Map<string, { history: PartOp[]; state: PartState }>()
  for (const [s, h] of by) out.set(s, { history: h, state: partState(s, h) })
  return out
}

export const fmtDev = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')} °C`

/** Fırın çevriminin en büyük mutlak sapması */
export const maxAbsDev = (c: FurnaceCycle) => Math.max(Math.abs(c.minDev), Math.abs(c.maxDev))
