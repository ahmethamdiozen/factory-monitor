import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Info, OctagonAlert } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { HourBars } from '@/components/charts/HourBars'
import { Avatar } from '@/components/machine/OperatorChip'
import { StatusBadge } from '@/components/machine/StatusBadge'
import { Card } from '@/components/ui/card'
import { Meter } from '@/components/ui/meter'
import { LINE_BY_ID, MACHINES, foremanFor } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'
import { handover, hourlyBars, interventions, lineShiftKpi, mainLossInHour, shiftProgress, shiftTarget, shiftWindowAt, topLosses } from '@/data/shiftView'
import type { Tone } from '@/data/shiftView'
import { num, pct } from '@/lib/kpi'
import { cn } from '@/lib/utils'

/**
 * FOREMAN EKRANI — bir hattın şu anki vardiyası. Soru: "Şu an neye müdahale etmeliyim
 * ve vardiyayı kurtarır mıyım?"
 */

const TONE: Record<Tone, { cls: string; Icon: typeof Info; label: string }> = {
  critical: { cls: 'bg-critical/15 text-critical-text', Icon: OctagonAlert, label: 'Acil' },
  serious: { cls: 'bg-serious/20 text-serious-text', Icon: AlertTriangle, label: 'Önemli' },
  warning: { cls: 'bg-warning/20 text-warning-text', Icon: AlertTriangle, label: 'Dikkat' },
  ok: { cls: 'bg-good/15 text-good-text', Icon: CheckCircle2, label: 'Tamam' },
  info: { cls: 'bg-wash text-fg-2', Icon: Info, label: 'Bilgi' },
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
const left = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`
}

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-medium text-fg-2">{label}</div>
      <div className={cn('tnum mt-1 text-3xl font-semibold leading-none', tone === 'good' && 'text-good-text', tone === 'warn' && 'text-warning-text')}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-fg-2">{sub}</div>}
    </Card>
  )
}

export default function ForemanScreen() {
  const { lineId = '' } = useParams()
  const snap = useSnapshot()
  const line = LINE_BY_ID[lineId]
  const now = snap.now
  const w = shiftWindowAt(now)

  const v = useMemo(() => {
    if (!line) return null
    const ms = MACHINES.filter((m) => m.lineId === lineId)
    const progress = ms.map((m) => ({ m, p: shiftProgress(m, w, now), live: snap.byId[m.id] }))
    const ok = progress.reduce((a, x) => a + x.p.ok, 0)
    const target = ms.reduce((a, m) => a + shiftTarget(m), 0)
    const expected = progress.reduce((a, x) => a + x.p.expected, 0)
    const projected = progress.reduce((a, x) => a + x.p.projected, 0)
    const bars = hourlyBars(ms.map((m) => m.id), w, now)
    return {
      ms,
      progress,
      ok,
      target,
      expected,
      projected,
      kpi: lineShiftKpi(lineId, w, now),
      bars,
      rows: bars.filter((b) => !b.future).map((b) => ({ ...b, loss: mainLossInHour(lineId, b.start, Math.min(b.start + 3600e3, now)) })),
      list: interventions(snap, lineId, w),
      losses: topLosses(lineId, w, now),
      hand: handover(lineId, w, snap),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, lineId])

  if (!line || !v) {
    return (
      <div className="grid h-full place-items-center">
        <div className="text-center">
          <p className="text-fg-2">Hat bulunamadı.</p>
          <Link to="/foreman" className="mt-2 inline-block text-s1 underline">Hat seç</Link>
        </div>
      </div>
    )
  }

  const foreman = foremanFor(lineId, w.id)
  const running = v.progress.filter((x) => x.live?.state === 0).length
  const nokRate = v.kpi.total ? v.kpi.nok / v.kpi.total : 0
  const behind = v.projected < v.target * 0.98
  const lossMax = Math.max(1, ...v.losses.map((l) => l.minutes))

  return (
    <div className="h-full overflow-y-auto bg-background p-4">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-3">
        {/* Başlık */}
        <header className="flex items-center justify-between gap-4 rounded-xl border bg-card px-5 py-3">
          <div>
            <div className="text-xl font-semibold">{line.name}</div>
            <div className="text-sm text-fg-2">
              {w.name} {hhmm(w.start)}–{hhmm(w.end)} · bitişe <b className="text-fg">{left(w.end - now)}</b>
            </div>
          </div>
          {foreman && (
            <div className="flex items-center gap-3">
              <div className="text-right leading-tight">
                <div className="font-semibold">{foreman.name}</div>
                <div className="text-xs text-fg-2">Foreman · {foreman.experienceYears} yıl</div>
              </div>
              <Avatar person={foreman} size={46} />
            </div>
          )}
        </header>

        {/* Özet */}
        <section className="grid grid-cols-4 gap-3">
          <Kpi label="Vardiya hedefi" value={pct(v.target ? v.ok / v.target : 0, 0)} sub={<>{num(v.ok)} / {num(v.target)} · olması gereken {pct(v.target ? v.expected / v.target : 0, 0)}</>} tone={v.ok >= v.expected ? 'good' : 'warn'} />
          <Kpi
            label="Vardiya sonu tahmini"
            value={pct(v.target ? v.projected / v.target : 0, 0)}
            sub={behind ? <span className="font-medium text-warning-text">−{num(Math.round((v.target - v.projected) / 10) * 10)} adet eksik kalır</span> : <span className="font-medium text-good-text">Hedef tutar</span>}
            tone={behind ? 'warn' : 'good'}
          />
          <Kpi label="Çalışan makine" value={`${running} / ${v.ms.length}`} sub={v.ms.length - running > 0 ? `${v.ms.length - running} makine duruyor` : 'Hepsi çalışıyor'} tone={running === v.ms.length ? 'good' : 'warn'} />
          <Kpi label="Hatalı ürün · vardiya" value={pct(nokRate, 1)} sub={<>{num(v.kpi.nok)} adet · {nokRate > 0.02 ? 'yüksek' : 'normal'}</>} tone={nokRate > 0.02 ? 'warn' : 'good'} />
        </section>

        <section className="grid grid-cols-5 gap-3">
          {/* Müdahale listesi */}
          <Card className="col-span-3 flex flex-col">
            <div className="flex items-center justify-between px-4 pt-3.5">
              <h2 className="text-[13px] font-semibold">Şimdi müdahale gerekenler</h2>
              <span className="text-xs text-fg-2">öncelik sırasıyla</span>
            </div>
            <ul className="flex flex-col gap-2 p-3">
              {v.list.length === 0 && (
                <li className="flex items-center gap-2 rounded-lg bg-good/10 px-3 py-4 text-sm font-medium text-good-text">
                  <CheckCircle2 className="size-5" /> Müdahale gerektiren bir durum yok
                </li>
              )}
              {v.list.map((x, k) => {
                const s = TONE[x.tone]
                return (
                  <li key={`${x.machineId}-${k}`}>
                    <Link to={`/makine/${x.machineId}`} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-wash focus-visible:outline-2 focus-visible:outline-s1">
                      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', s.cls)} title={s.label}>
                        <s.Icon className="size-4.5" />
                      </span>
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block text-sm font-semibold">
                          {x.code} · {x.title}
                        </span>
                        <span className="block text-xs text-fg-2">{x.detail}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
                        <ArrowRight className="size-3.5 text-fg-3" /> {x.action}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Card>

          {/* Makineler */}
          <Card className="col-span-2">
            <h2 className="px-4 pt-3.5 text-[13px] font-semibold">Hattın makineleri</h2>
            <div className="grid grid-cols-2 gap-2 p-3">
              {v.progress.map(({ m, p, live }) => (
                <Link key={m.id} to={`/makine-ekrani/${m.id}`} className="flex flex-col gap-2 rounded-lg border p-3 hover:bg-wash focus-visible:outline-2 focus-visible:outline-s1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold">{m.code}</span>
                    {live && <StatusBadge state={live.stateKey} size="sm" />}
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-fg-2">
                      <span>Vardiya hedefi</span>
                      <span className="tnum font-medium text-fg">{pct(p.progress, 0)}</span>
                    </div>
                    <Meter value={p.progress} marker={p.timeProgress} height={5} color={p.diff < 0 ? 'var(--serious)' : 'var(--series-1)'} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-fg-2">
                    <span>
                      Hız <b className={cn('tnum', live?.slow ? 'text-warning-text' : 'text-fg')}>{live && live.state === 0 ? `%${Math.round(live.speedPct * 100)}` : '—'}</b>
                    </span>
                    {live?.operator && (
                      <span className="flex min-w-0 items-center gap-1">
                        <Avatar person={live.operator} size={18} />
                        <span className="truncate">{live.operator.name.split(' ')[0]}</span>
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        </section>

        <section className="grid grid-cols-5 gap-3">
          {/* Saat saat */}
          <Card className="col-span-3">
            <h2 className="px-4 pt-3.5 text-[13px] font-semibold">Saat saat üretim · hat</h2>
            <div className="px-2">
              <HourBars bars={v.bars} height={170} />
            </div>
            <table className="w-full text-xs">
              <thead className="text-fg-2">
                <tr className="border-y">
                  <th className="px-4 py-1.5 text-left font-medium">Saat</th>
                  <th className="px-2 py-1.5 text-right font-medium">Plan</th>
                  <th className="px-2 py-1.5 text-right font-medium">Gerçek</th>
                  <th className="px-2 py-1.5 text-right font-medium">Fark</th>
                  <th className="px-4 py-1.5 text-left font-medium">En büyük kayıp</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {v.rows.map((r) => {
                  const d = r.ok - r.target
                  return (
                    <tr key={r.start} className="border-b last:border-0">
                      <td className="px-4 py-1.5">
                        {hhmm(r.start)}
                        {r.partial && <span className="text-fg-3"> · sürüyor</span>}
                      </td>
                      <td className="px-2 text-right text-fg-2">{num(r.target)}</td>
                      <td className="px-2 text-right font-medium">{num(r.ok)}</td>
                      <td className={cn('px-2 text-right font-medium', d < 0 ? 'text-warning-text' : 'text-good-text')}>
                        {d >= 0 ? '+' : '−'}
                        {num(Math.abs(d))}
                      </td>
                      <td className="px-4 text-fg-2">{r.loss}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>

          <div className="col-span-2 flex flex-col gap-3">
            {/* Kayıplar */}
            <Card>
              <h2 className="px-4 pt-3.5 text-[13px] font-semibold">Bu vardiyanın en büyük 3 kaybı</h2>
              <ul className="space-y-2.5 px-4 pb-4 pt-3">
                {v.losses.length === 0 && <li className="text-xs text-fg-2">Kayda değer kayıp yok</li>}
                {v.losses.map((l) => (
                  <li key={l.label}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{l.label}</span>
                      <span className="tnum font-medium">{Math.round(l.minutes)} dk</span>
                    </div>
                    <Meter value={l.minutes / lossMax} height={6} color="var(--series-2)" />
                  </li>
                ))}
              </ul>
            </Card>

            {/* Ekip */}
            <Card>
              <h2 className="px-4 pt-3.5 text-[13px] font-semibold">Ekip</h2>
              <ul className="divide-y px-4 pb-2 pt-1">
                {v.progress.map(({ m, live }) =>
                  live?.operator ? (
                    <li key={m.id} className="flex items-center gap-2.5 py-2">
                      <Avatar person={live.operator} size={30} />
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="truncate text-sm font-medium">{live.operator.name}</div>
                        <div className="text-[11px] text-fg-2">
                          {m.code} · {live.operator.experienceYears < 1 ? <b className="text-warning-text">{Math.round(live.operator.experienceYears * 12)} aylık — destek ver</b> : `${String(live.operator.experienceYears).replace('.', ',')} yıl`}
                        </div>
                      </div>
                    </li>
                  ) : null,
                )}
              </ul>
            </Card>
          </div>
        </section>

        {/* Devir */}
        <Card className="flex items-start gap-3 px-4 py-3.5">
          <ClipboardList className="mt-0.5 size-5 shrink-0 text-fg-2" />
          <div className="text-sm leading-relaxed">
            <b>Önceki vardiyadan devir</b> <span className="text-fg-2">({v.hand.shift.name}{v.hand.foreman ? ` · ${v.hand.foreman.name}` : ''})</span>
            <span className="text-fg-2"> — </span>
            Hedefin <b className="tnum">{pct(v.hand.targetPct, 0)}</b>'i üretildi · hatalı ürün <b className="tnum">{pct(v.hand.nokRate, 1)}</b> · {v.hand.failures} arıza
            {v.hand.worstFailure && <> (en uzunu: {v.hand.worstFailure})</>}
            {v.hand.stillOpen.length > 0 ? (
              <>
                {' '}
                · <span className="font-medium text-warning-text">Açık kalan: {v.hand.stillOpen.join(', ')}</span>
              </>
            ) : (
              <> · açık kalan iş yok</>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
