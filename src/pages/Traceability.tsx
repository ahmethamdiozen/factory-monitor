import { CheckCircle2, CircleDot, Search, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardHeader } from '@/components/ui/card'
import { Meter } from '@/components/ui/meter'
import { StatTile } from '@/components/ui/stat-tile'
import { MACHINES, MACHINE_BY_ID } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'
import { source } from '@/data/store'
import { allPartStates, cycleFor, familyOf, fmtDev, maxAbsDev, ncrOf, personName } from '@/data/traceView'
import type { PartStateKind } from '@/data/traceView'
import { fmtDuration } from '@/lib/kpi'
import { cn } from '@/lib/utils'
import { DISPOSITION_LABEL } from '@/pipeline/trace'
import type { FurnaceCycle, PartOp } from '@/pipeline/trace'

/**
 * İZLENEBİLİRLİK (AS9100) — her seri numaralı parçanın hangi makinede, hangi operatörle, hangi
 * malzeme partisinden (ısıl no) ve hangi fırın şarjıyla üretildiği; fırın şarjlarının reçete uyumu
 * (AMS 2750) ve uygunsuz parçaların MRB kararları.
 */

const HOUR = 3600e3
const dt = (t: number) => new Date(t).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const code = (id: string) => MACHINE_BY_ID[id]?.code ?? id

const STATE_STYLE: Record<PartStateKind, string> = {
  process: 'bg-s1/15 text-s1',
  queue: 'bg-wash text-fg-2',
  mrb: 'bg-warning/20 text-warning-text',
  scrap: 'bg-critical/15 text-critical-text',
  done: 'bg-good/15 text-good-text',
}

function Compliance({ c }: { c: FurnaceCycle }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap font-medium', c.ok ? 'text-good-text' : 'text-critical-text')}>
      {c.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
      {c.ok ? 'Reçeteye uygun' : 'Reçete dışı'}
    </span>
  )
}

function cycleText(c: FurnaceCycle): string {
  return `tutma ${Math.round(c.holdMin)} dk (gerekli ${c.requiredHoldMin}) · sapma ${fmtDev(c.minDev)} / ${fmtDev(c.maxDev)} (tolerans ±${c.toleranceC} °C)`
}

export default function Traceability() {
  const snap = useSnapshot()
  const now = snap.now
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string | null>(null)

  const parts = useMemo(() => allPartStates(), [snap]) // eslint-disable-line react-hooks/exhaustive-deps
  const cycles = useMemo(() => [...source.furnaceCycles()].reverse(), [snap]) // eslint-disable-line react-hooks/exhaustive-deps
  const ops = source.partOps()

  // Varsayılan seçim: en çok operasyondan geçmiş, sistemde baştan beri izlenen bir parça
  const defaultSerial = useMemo(() => {
    let best: string | null = null
    let score = -1
    for (const [s, p] of parts) {
      const f = familyOf(p.history[0].partNumber)
      const fromStart = f?.steps[0].machineId === p.history[0].machineId
      const sc = p.history.length * 10 + (fromStart ? 5 : 0) + (p.history.some((o) => o.batchNo) ? 3 : 0)
      if (fromStart && sc > score) {
        score = sc
        best = s
      }
    }
    return best
  }, [parts])
  const serial = sel ?? defaultSerial
  const part = serial ? parts.get(serial) : undefined
  const fam = part ? familyOf(part.history[0].partNumber) : undefined
  const legacy = !!part && !!fam && fam.steps[0].machineId !== part.history[0].machineId

  const counts = useMemo(() => {
    const c = { total: parts.size, process: 0, queue: 0, mrb: 0, done: 0, scrap: 0 }
    for (const p of parts.values()) c[p.state.kind]++
    return c
  }, [parts])
  const okCycles = cycles.filter((c) => c.ok).length

  const queues = useMemo(() => {
    const q = new Map<string, number>()
    for (const p of parts.values()) if (p.state.kind === 'queue' && p.state.machineId) q.set(p.state.machineId, (q.get(p.state.machineId) ?? 0) + 1)
    return MACHINES.map((m) => ({ m, n: q.get(m.id) ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
  }, [parts])
  const qMax = Math.max(1, ...queues.map((x) => x.n))

  const list = useMemo(() => {
    const q = query.trim().toLocaleUpperCase('tr-TR')
    return [...parts.entries()]
      .filter(([s, p]) => !q || s.includes(q) || p.history[0].partNumber.includes(q) || p.history.some((o) => o.heatNo?.includes(q) || o.batchNo?.includes(q)))
      .sort((a, b) => b[1].history[b[1].history.length - 1].start - a[1].history[a[1].history.length - 1].start)
      .slice(0, 40)
  }, [parts, query])

  const batchOf = (c: FurnaceCycle) => ops.find((o) => o.machineId === c.machineId && o.batchNo && o.start < c.end && (o.end ?? Infinity) >= c.end)?.batchNo ?? '—'

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">İzlenebilirlik</h1>
        <p className="text-xs text-fg-2">
          Seri numaralı parça geçmişi (AS9100) · fırın şarjlarının reçete uyumu (AMS 2750) · uygunsuz parçalar ve MRB kararları. Kaynak: MES operasyon kayıtları (dbo.OperationEvents).
        </p>
      </div>

      <section className="grid grid-cols-6 gap-4">
        <StatTile label="İzlenen parça" value={String(counts.total)} sub="Son 48 saatte kaydı olan" />
        <StatTile label="İşlemde" value={String(counts.process)} sub="Makinede, şu an" />
        <StatTile label="Kuyrukta (WIP)" value={String(counts.queue)} sub="Sıradaki operasyonu bekliyor" />
        <StatTile label="MRB kararı bekleyen" value={String(counts.mrb)} valueClass={counts.mrb ? 'text-warning-text' : ''} sub={`Hurda ${counts.scrap}`} />
        <StatTile label="Rota tamamlandı" value={String(counts.done)} valueClass="text-good-text" sub="Son ölçümden geçti, sevke hazır" />
        <StatTile
          label="Fırın şarjı · reçete uyumu"
          value={`${okCycles} / ${cycles.length}`}
          valueClass={okCycles < cycles.length ? 'text-critical-text' : 'text-good-text'}
          sub="AMS 2750 · tutma süresi ve sıcaklık toleransı"
        />
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          {part && serial ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                <div>
                  <div className="text-xs text-fg-2">Seri no</div>
                  <div className="tnum text-2xl font-semibold">{serial}</div>
                  <div className="text-xs text-fg-2">
                    {fam?.name ?? part.history[0].partNumber} · P/N {part.history[0].partNumber} · ısıl no <b className="text-fg">{part.history[0].heatNo ?? '—'}</b>
                  </div>
                </div>
                <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', STATE_STYLE[part.state.kind])}>{part.state.text}</span>
              </div>
              {fam && (
                <ol className="flex items-center gap-1 px-4 pt-3 text-xs" aria-label="Rota">
                  {fam.steps.map((st, i) => {
                    const done = part.history.filter((o) => o.machineId === st.machineId)
                    const last = done.at(-1)
                    const state = !last ? 'todo' : last.end === null ? 'now' : last.result === 'NOK' ? 'nok' : 'ok'
                    return (
                      <li key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="mx-1 h-px w-6 bg-border" />}
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1',
                            state === 'ok' && 'border-good/40 bg-good/10',
                            state === 'now' && 'border-s1 bg-s1/10',
                            state === 'nok' && 'border-critical/50 bg-critical/10',
                            state === 'todo' && 'text-fg-3',
                          )}
                        >
                          {state === 'ok' ? <CheckCircle2 className="size-3.5 text-good-text" /> : state === 'nok' ? <XCircle className="size-3.5 text-critical-text" /> : <CircleDot className="size-3.5" />}
                          <b className="whitespace-nowrap">{code(st.machineId)}</b> <span className="whitespace-nowrap">{st.op}</span>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
              {legacy && <p className="px-4 pt-2 text-[11px] text-fg-3">Bu parçanın önceki operasyonları sistem devreye alınmadan önce yapıldı; kaydı buradan itibaren başlıyor.</p>}
              <table className="mt-3 w-full text-xs">
                <thead className="text-fg-2">
                  <tr className="border-y">
                    <th className="px-4 py-2 text-left font-medium">Operasyon</th>
                    <th className="px-2 py-2 text-left font-medium">Makine</th>
                    <th className="px-2 py-2 text-left font-medium">Operatör</th>
                    <th className="px-2 py-2 text-left font-medium">Başlangıç</th>
                    <th className="px-2 py-2 text-left font-medium">Bitiş</th>
                    <th className="px-2 py-2 text-right font-medium">Süre</th>
                    <th className="px-2 py-2 text-left font-medium">Sonuç</th>
                    <th className="px-4 py-2 text-left font-medium">Ayrıntı</th>
                  </tr>
                </thead>
                <tbody>
                  {part.history.map((o: PartOp) => {
                    const c = cycleFor(o)
                    const ncr = o.result === 'NOK' ? ncrOf(o.serial).find((n) => n.machineId === o.machineId && Math.abs(n.t - (o.end ?? 0)) < 60_000) : undefined
                    return (
                      <tr key={`${o.machineId}-${o.start}`} className="border-b align-top last:border-0">
                        <td className="px-4 py-2 font-medium">{o.op}</td>
                        <td className="px-2 py-2">
                          <Link to={`/makine/${o.machineId}`} className="whitespace-nowrap font-medium text-s1 hover:underline">
                            {code(o.machineId)}
                          </Link>
                        </td>
                        <td className="px-2 py-2">{personName(o.operatorId)}</td>
                        <td className="tnum whitespace-nowrap px-2 py-2">{dt(o.start)}</td>
                        <td className="tnum whitespace-nowrap px-2 py-2">{o.end ? dt(o.end) : '—'}</td>
                        <td className="tnum whitespace-nowrap px-2 py-2 text-right">{fmtDuration(((o.end ?? now) - o.start) / 1000)}</td>
                        <td className="px-2 py-2">
                          {o.result === null ? <span className="text-s1">işlemde</span> : o.result === 'OK' ? <span className="text-good-text">Uygun</span> : <span className="font-medium text-critical-text">Uygunsuz</span>}
                        </td>
                        <td className="px-4 py-2 text-fg-2">
                          {o.batchNo && (
                            <div>
                              Şarj <b className="text-fg">{o.batchNo}</b>
                              {c && (
                                <>
                                  {' '}
                                  · <Compliance c={c} />
                                  <div className="text-[11px]">{cycleText(c)}</div>
                                </>
                              )}
                            </div>
                          )}
                          {ncr && (
                            <div>
                              <b className="text-fg">{ncr.ncrNo}</b> · {ncr.defectType} · MRB: {ncr.disposition ? DISPOSITION_LABEL[ncr.disposition] : 'karar bekleniyor'}
                            </div>
                          )}
                          {!o.batchNo && !ncr && '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-fg-2">Henüz parça kaydı yok</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Kuyruklar (WIP)" subtitle="Sıradaki operasyonunu bekleyen parçalar · makineye göre" />
          <ul className="space-y-2.5 px-4 pb-4 pt-3">
            {queues.map(({ m, n }) => (
              <li key={m.id}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>
                    <b>{m.code}</b> <span className="text-fg-2">{m.operation}</span>
                  </span>
                  <span className="tnum font-medium">{n} parça</span>
                </div>
                <Meter value={n / qMax} height={6} />
              </li>
            ))}
            {!queues.length && <li className="text-xs text-fg-2">Kuyrukta parça yok</li>}
          </ul>
          <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-fg-3">
            Fırınlar 12 parçalık şarjla birden çok parça ailesine hizmet eder; şarj dolana kadar parçalar bekler. Son ölçüm (CMM-01) tüm parçaların ortak istasyonudur.
          </p>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader
            title="Parçalar"
            subtitle="Son hareket edene göre · seri no, P/N, ısıl no veya şarj no ile ara"
            right={
              <label className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                <Search className="size-3.5 text-fg-3" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ör. TD26-00012" className="w-36 bg-transparent outline-none" aria-label="Parça ara" />
              </label>
            }
          />
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-fg-2">
                <tr className="border-y">
                  <th className="px-4 py-2 text-left font-medium">Seri no</th>
                  <th className="px-2 py-2 text-left font-medium">Parça</th>
                  <th className="px-2 py-2 text-left font-medium">Durum</th>
                  <th className="px-4 py-2 text-right font-medium">Son hareket</th>
                </tr>
              </thead>
              <tbody>
                {list.map(([s, p]) => (
                  <tr key={s} onClick={() => setSel(s)} className={cn('cursor-pointer border-b hover:bg-wash', s === serial && 'bg-wash')}>
                    <td className="tnum whitespace-nowrap px-4 py-1.5 font-medium">{s}</td>
                    <td className="px-2 text-fg-2">{familyOf(p.history[0].partNumber)?.name ?? p.history[0].partNumber}</td>
                    <td className="px-2">
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', STATE_STYLE[p.state.kind])}>{p.state.text.replace(' bekliyor', '')}</span>
                    </td>
                    <td className="tnum whitespace-nowrap px-4 text-right text-fg-2">{dt(Math.max(...p.history.map((o) => o.end ?? o.start)))}</td>
                  </tr>
                ))}
                {!list.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-fg-2">
                      Eşleşen parça yok
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Fırın şarjları · reçete uyumu (AMS 2750)" subtitle="Tutma süresi gereken süreyi karşılıyor mu, sıcaklık set değerinin toleransı içinde mi" />
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-fg-2">
                <tr className="border-y">
                  <th className="px-4 py-2 text-left font-medium">Fırın · şarj</th>
                  <th className="px-2 py-2 text-left font-medium">Tutma bitişi</th>
                  <th className="px-2 py-2 text-right font-medium">Tutma</th>
                  <th className="px-2 py-2 text-right font-medium">Sapma</th>
                  <th className="px-4 py-2 text-left font-medium">Sonuç</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={`${c.machineId}-${c.start}`} className="border-b">
                    <td className="px-4 py-1.5">
                      <b>{code(c.machineId)}</b> <span className="whitespace-nowrap text-fg-2">{batchOf(c)}</span>
                      <div className="text-[11px] text-fg-3">
                        {c.setpointC} °C · sınıf {c.furnaceClass} · ±{c.toleranceC} °C
                      </div>
                    </td>
                    <td className="tnum whitespace-nowrap px-2">{dt(c.end)}</td>
                    <td className={cn('tnum whitespace-nowrap px-2 text-right', c.holdMin < c.requiredHoldMin && 'font-semibold text-critical-text')}>
                      {Math.round(c.holdMin)} / {c.requiredHoldMin} dk
                    </td>
                    <td className={cn('tnum whitespace-nowrap px-2 text-right', maxAbsDev(c) > c.toleranceC && 'font-semibold text-critical-text')}>
                      {fmtDev(c.minDev)} / {fmtDev(c.maxDev)}
                    </td>
                    <td className="px-4">
                      <Compliance c={c} />
                    </td>
                  </tr>
                ))}
                {!cycles.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-fg-2">
                      Henüz tamamlanan şarj yok
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-fg-3">
            Tutma: sıcaklığın set değerine ±15 °C yakın olduğu süre (ısınma ve soğutma rampaları hariç). Kesintiye uğrayan şarj (arıza) reçete dışı sayılır ve ilgili parçalar değerlendirilmelidir. Son {Math.round((now - (cycles.at(-1)?.start ?? now)) / HOUR)} saat.
          </p>
        </Card>
      </section>
    </div>
  )
}
