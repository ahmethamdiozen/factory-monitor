import { between, mulberry32 } from '@/lib/rng'
import type { Rng } from '@/lib/rng'
import type { MrbDisposition, MrbRow, NcrRow, OpEventRow } from '@/pipeline/rows'
import type { Machine } from '@/lib/types'
import { DEFECT_TYPES, PART_FAMILIES } from './factoryDef'
import type { PartFamily } from './factoryDef'

/**
 * SERİ NUMARASI YÖNLENDİRİCİSİ — fabrika tarafının MES'i (simülasyon).
 * Her parçanın bir seri numarası ve rotası vardır. Bir makine parçayı (fırında şarjı) bitirince:
 *   - parçanın operasyon kaydı kapanır (OK / NOK),
 *   - uygun parça rotadaki sıradaki makinenin kuyruğuna girer (FIFO),
 *   - uygunsuz parça için uygunsuzluk raporu (NCR) açılır; MRB birkaç saat içinde karar verir
 *     (olduğu gibi kullan → rotaya devam, yeniden işle → aynı operasyona geri, hurda),
 *   - makine kuyruğundan sıradaki parçayı (fırında 12 parçalık şarjı) alır.
 * Rotanın ilk makinesi kuyruğu boşsa yeni ham parça (yeni seri no) başlatır. Diğer makinelerin
 * kuyruğu boşsa sistem devreye alınmadan önce başlamış bir parça işlenir ("eski" — önceki
 * operasyon kayıtları yoktur).
 *
 * Tüm makineler aynı zaman sırasıyla ilerletilmelidir (simülatör, web demo ve yerel hat bunu yapar);
 * böylece aynı tohumla her yerde aynı seri numaraları oluşur.
 */

interface Part {
  serial: string
  family: PartFamily
  heat: string
  /** Rotadaki sıradaki adımın indeksi */
  step: number
  legacy: boolean
}

interface InProcess {
  parts: Part[]
  start: number
  batchNo: string | null
}

export interface RouterRows {
  opEvents: OpEventRow[]
  ncrs: NcrRow[]
  mrb: MrbRow[]
}

export interface RouterOptions {
  /** t anında makinenin operatörünün sicil numarası */
  operatorAt(machineId: string, t: number): string | null
}

const HOUR = 3600 * 1000

export class SerialRouter {
  private readonly machines: Map<string, Machine>
  private readonly opts: RouterOptions
  private readonly rng: Rng
  private queues = new Map<string, Part[]>()
  private current = new Map<string, InProcess>()
  private seq = new Map<string, number>()
  private batchSeq = new Map<string, number>()
  private ncrSeq = 0
  private pendingMrb: { ncrNo: string; part: Part; due: number; disposition: MrbDisposition }[] = []
  /** Son bilinen malzeme partisi (ısıl no) — makinenin PLC'sinden */
  private lots = new Map<string, string>()
  private readonly year: string

  constructor(machines: Machine[], t0: number, opts: RouterOptions) {
    this.machines = new Map(machines.map((m) => [m.id, m]))
    this.opts = opts
    this.rng = mulberry32(424242)
    this.year = String(new Date(t0).getFullYear()).slice(2)
    for (const m of machines) this.queues.set(m.id, [])
  }

  private familiesAt(machineId: string): { f: PartFamily; step: number }[] {
    const out: { f: PartFamily; step: number }[] = []
    for (const f of PART_FAMILIES) f.steps.forEach((s, i) => s.machineId === machineId && out.push({ f, step: i }))
    return out
  }

  private newSerial(f: PartFamily): string {
    const n = (this.seq.get(f.id) ?? 0) + 1
    this.seq.set(f.id, n)
    return `${f.prefix}${this.year}-${String(n).padStart(5, '0')}`
  }

  /** Makineye sıradaki parçayı / şarjı yükler ve START kayıtlarını yazar */
  private load(machineId: string, t: number, out: RouterRows): void {
    const m = this.machines.get(machineId)
    if (!m) return
    const q = this.queues.get(machineId)!
    const parts: Part[] = []
    while (parts.length < m.batchSize && q.length) parts.push(q.shift()!)
    const at = this.familiesAt(machineId)
    while (parts.length < m.batchSize && at.length) {
      const first = at.find((x) => x.step === 0)
      if (first) {
        parts.push({ serial: this.newSerial(first.f), family: first.f, heat: this.heatFor(machineId), step: 0, legacy: false })
      } else {
        const pick = at[Math.floor(this.rng() * at.length)]
        parts.push({ serial: this.newSerial(pick.f), family: pick.f, heat: `H${this.year}-${String(1000 + Math.floor(this.rng() * 9000))}`, step: pick.step, legacy: true })
      }
    }
    if (!parts.length) {
      this.current.delete(machineId)
      return
    }
    let batchNo: string | null = null
    if (m.batchSize > 1) {
      const n = (this.batchSeq.get(machineId) ?? 0) + 1
      this.batchSeq.set(machineId, n)
      batchNo = `${m.code}-${this.year}${String(n).padStart(4, '0')}`
    }
    this.current.set(machineId, { parts, start: t, batchNo })
    const op = (p: Part) => p.family.steps[p.step].op
    for (const p of parts)
      out.opEvents.push({ serialNo: p.serial, partNumber: p.family.partNumber, operationNo: op(p), machineId, operatorId: this.opts.operatorAt(machineId, t), t, eventType: 'START', result: null, heatNo: p.heat, batchNo })
  }

  private heatFor(machineId: string): string {
    const lot = this.lots.get(machineId) ?? `L${machineId.slice(1)}-0001`
    // PLC'deki malzeme partisi → ısıl no (dövme parti)
    return `H${this.year}-${lot.replace(/^L/, '').replace('-', '')}`
  }

  /** İlk yükleme: her makinede bir parça / şarj işlemde başlar */
  init(t: number, out: RouterRows): void {
    for (const id of this.machines.keys()) this.load(id, t, out)
  }

  /** Makine PLC'si malzeme partisini bildirdi */
  setLot(machineId: string, lot: string): void {
    this.lots.set(machineId, lot)
  }

  /** Makine t anında `produced` parça bitirdi, `rejects` tanesi uygunsuz */
  complete(machineId: string, t: number, produced: number, rejects: number, out: RouterRows): void {
    if (produced <= 0) return
    let cur = this.current.get(machineId)
    if (!cur) {
      this.load(machineId, t, out)
      cur = this.current.get(machineId)
      if (!cur) return
    }
    const done = cur.parts.slice(0, produced)
    const m = this.machines.get(machineId)!
    done.forEach((p, k) => {
      const nok = k >= done.length - rejects
      const op = p.family.steps[p.step].op
      out.opEvents.push({
        serialNo: p.serial,
        partNumber: p.family.partNumber,
        operationNo: op,
        machineId,
        operatorId: this.opts.operatorAt(machineId, t),
        t,
        eventType: 'END',
        result: nok ? 'NOK' : 'OK',
        heatNo: p.heat,
        batchNo: cur!.batchNo,
      })
      if (nok) this.openNcr(p, m, op, t, out)
      else this.advance(p, t)
    })
    this.load(machineId, t, out)
  }

  private advance(p: Part, t: number): void {
    p.step++
    void t
    if (p.step >= p.family.steps.length) return // rota tamamlandı: sevke hazır
    this.queues.get(p.family.steps[p.step].machineId)?.push(p)
  }

  private openNcr(p: Part, m: Machine, op: string, t: number, out: RouterRows): void {
    this.ncrSeq++
    const ncrNo = `NCR-${this.year}-${String(this.ncrSeq).padStart(4, '0')}`
    // Ölçüm makinesinde bulunan uygunsuzluk parçanın geldiği hücrenin türlerinden
    const lineId = m.type === 'cmm' ? (this.machines.get(p.family.steps[0].machineId)?.lineId ?? m.lineId) : m.lineId
    const types = DEFECT_TYPES[lineId] ?? []
    let u = this.rng() * types.reduce((a, d) => a + d.weight, 0)
    let defect = types[0]?.label ?? 'Uygunsuzluk'
    for (const d of types) {
      u -= d.weight
      if (u <= 0) {
        defect = d.label
        break
      }
    }
    out.ncrs.push({ ncrNo, serialNo: p.serial, partNumber: p.family.partNumber, machineId: m.id, operationNo: op, t, defectType: defect })
    const r = this.rng()
    const disposition: MrbDisposition = r < 0.5 ? 'use-as-is' : r < 0.8 ? 'rework' : 'scrap'
    this.pendingMrb.push({ ncrNo, part: p, due: t + between(this.rng, 4, 24) * HOUR, disposition })
  }

  /** Zamanı gelen MRB kararlarını uygular */
  tick(t: number, out: RouterRows): void {
    if (!this.pendingMrb.length) return
    const due = this.pendingMrb.filter((x) => x.due <= t)
    if (!due.length) return
    this.pendingMrb = this.pendingMrb.filter((x) => x.due > t)
    for (const d of due) {
      out.mrb.push({ ncrNo: d.ncrNo, t, disposition: d.disposition })
      if (d.disposition === 'use-as-is') this.advance(d.part, t)
      else if (d.disposition === 'rework') this.queues.get(d.part.family.steps[d.part.step].machineId)?.push(d.part)
    }
  }

  /** Kuyruktaki parça sayısı (makine başına) */
  queueLength(machineId: string): number {
    return this.queues.get(machineId)?.length ?? 0
  }
}
