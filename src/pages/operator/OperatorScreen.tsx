import { AlertTriangle, CheckCircle2, Clock, HeartPulse, Info, OctagonAlert, Play, RefreshCw, Square, Wrench } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ShiftTimeline, ShiftTimelineLegend } from '@/components/charts/ShiftTimeline'
import { Avatar } from '@/components/machine/OperatorChip'
import { MACHINE_BY_ID, REASON_BY_ID } from '@/data/registry'
import { HORIZON_TEXT, LEVEL_STYLE, activeRisk } from '@/data/predictiveView'
import { currentLabel } from '@/data/traceView'
import { useSnapshot } from '@/data/snapshot'
import { SLOW_ADVICE, completions, operatorTodos, shiftProgress, shiftWindowAt, stateTrack } from '@/data/shiftView'
import { source } from '@/data/store'
import type { Tone } from '@/data/shiftView'
import { fmtDuration, parts } from '@/lib/kpi'
import type { MachineStateKey } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * MAKİNE EKRANI — makinenin başındaki operatör için. 2–3 metreden okunur,
 * jargon yok, her renk bir kelime ve ikonla birlikte. Ufuk: bu vardiya.
 */

const BAND: Record<MachineStateKey, { cls: string; word: string; Icon: typeof Play }> = {
  running: { cls: 'bg-[#0b8a0b] text-white', word: 'ÇALIŞIYOR', Icon: Play },
  stopped: { cls: 'bg-[#c43333] text-white', word: 'DURDU', Icon: Square },
  maintenance: { cls: 'bg-[#4a3aa7] text-white', word: 'BAKIMDA', Icon: Wrench },
  changeover: { cls: 'bg-[#fab219] text-black', word: 'AYAR YAPILIYOR', Icon: RefreshCw },
}

const TONE: Record<Tone, { cls: string; Icon: typeof Info }> = {
  critical: { cls: 'text-critical-text', Icon: OctagonAlert },
  serious: { cls: 'text-serious-text', Icon: AlertTriangle },
  warning: { cls: 'text-warning-text', Icon: AlertTriangle },
  ok: { cls: 'text-good-text', Icon: CheckCircle2 },
  info: { cls: 'text-fg-2', Icon: Clock },
}

function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} dakikadır`
  return `${Math.floor(m / 60)} saat ${m % 60} dakikadır`
}

function left(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col rounded-2xl border bg-card px-5 py-4', className)}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-2">{title}</h2>
      {children}
    </section>
  )
}

export default function OperatorScreen() {
  const { id = '' } = useParams()
  const snap = useSnapshot()
  const live = snap.byId[id]
  const m = MACHINE_BY_ID[id]
  const now = snap.now
  const w = shiftWindowAt(now)

  const data = useMemo(() => {
    if (!m || !live) return null
    return {
      p: shiftProgress(m, w, now),
      track: stateTrack(m.id, w.start, now),
      done: completions([m.id], w.start, now),
      lastMeas: source.spc(m.id).at(-1) ?? null,
      todos: operatorTodos(live, w, now),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap])

  if (!m || !live || !data) {
    return (
      <div className="grid h-full place-items-center">
        <div className="text-center">
          <p className="text-fg-2">Makine bulunamadı.</p>
          <Link to="/makine-ekrani" className="mt-2 inline-block text-s1 underline">Makine seç</Link>
        </div>
      </div>
    )
  }

  const { p, track, done, lastMeas, todos } = data
  const health = activeRisk(m.id, live.state, live.reasonId)
  const band = BAND[live.stateKey]
  const running = live.state === 0
  const cycleSec = m.batchSize / m.idealRate
  // Uzun çevrimlerde fark parça yerine zamanla anlatılır: "planın ~1 sa gerisindesin"
  const lagSec = (-p.diff * cycleSec) / m.batchSize
  const ahead = lagSec <= 10 * 60
  const speedPct = Math.round(live.speedPct * 100)
  const advice = live.slow ? SLOW_ADVICE[live.slowReasonId] ?? SLOW_ADVICE[7] : null
  const nokShift = p.nok > 0
  const measOk = lastMeas ? lastMeas.mean >= m.spec.lsl && lastMeas.mean <= m.spec.usl : true
  const dec = m.spec.sigma < 0.01 ? 3 : m.spec.sigma < 1 ? 2 : 1

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-background p-4">
      {/* Başlık */}
      <header className="flex items-center justify-between gap-4 rounded-2xl border bg-card px-5 py-2.5">
        <div className="min-w-0">
          <div className="text-3xl font-bold tracking-tight">
            {m.code} <span className="font-medium text-fg-2">· {m.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-base text-fg-2">
            <span>
              {m.product}
              {currentLabel(m.id) && (
                <>
                  {' '}
                  · <b className="tnum text-fg">{currentLabel(m.id)}</b>
                </>
              )}{' '}
              · İş emri {m.orderNo}
            </span>
            {health && (
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold', LEVEL_STYLE[health.level].bg, LEVEL_STYLE[health.level].text)} title={`Öngörücü bakım modeli: önümüzdeki ${HORIZON_TEXT} içinde arıza riski`}>
                <HeartPulse className="size-4" /> Makine sağlığı: {LEVEL_STYLE[health.level].word}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-6">
          {live.operator && (
            <div className="flex items-center gap-3">
              <Avatar person={live.operator} size={52} />
              <div className="leading-tight">
                <div className="text-lg font-semibold">{live.operator.name}</div>
                <div className="text-sm text-fg-2">Operatör</div>
              </div>
            </div>
          )}
          <div className="text-right leading-tight">
            <div className="text-lg font-semibold">{w.name}</div>
            <div className="text-sm text-fg-2">bitişe {left(w.end - now)}</div>
          </div>
        </div>
      </header>

      {/* Durum bandı */}
      <div className={cn('flex items-center gap-5 rounded-2xl px-6 py-3', band.cls)} role="status">
        <band.Icon className="size-10 shrink-0" fill="currentColor" strokeWidth={1.5} />
        <div className="min-w-0">
          <div className="text-5xl font-black tracking-tight">{band.word}</div>
          {!running && (
            <div className="mt-1 text-2xl font-semibold opacity-95">
              {REASON_BY_ID[live.reasonId]?.label} · {duration(now - live.sinceT)}
            </div>
          )}
        </div>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3">
        {/* Üretim */}
        <Panel title="Bu vardiya tamamlanan">
          <div className="mt-2 flex items-baseline gap-3">
            <span className="tnum text-6xl font-bold leading-none tracking-tight">{p.ok + p.nok}</span>
            <span className="text-2xl text-fg-2">/ {parts(p.target)} parça</span>
          </div>
          <div className="relative mt-4 h-6 w-full rounded-full bg-wash" role="meter" aria-valuenow={Math.round(p.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Vardiya hedefi ilerlemesi">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${p.progress * 100}%`, background: ahead ? 'var(--series-1)' : 'var(--serious)' }} />
            <div className="absolute -top-1.5 h-9 w-1 rounded bg-fg" style={{ left: `calc(${Math.min(1, p.timeProgress) * 100}% - 2px)` }} title="Şu an olması gereken" />
          </div>
          <div className="mt-2 text-base text-fg-2">
            Şu an olması gereken: <b className="tnum text-fg">{parts(p.expected)}</b> · yapılan (yarım parça dahil) <b className="tnum text-fg">{parts(p.done)}</b>
          </div>
          <div className={cn('mt-auto flex items-center gap-2 pt-3 text-3xl font-bold', ahead ? 'text-good-text' : 'text-warning-text')}>
            {ahead ? <CheckCircle2 className="size-8" /> : <AlertTriangle className="size-8" />}
            {ahead ? (lagSec < -10 * 60 ? <>Planın ~{fmtDuration(-lagSec)} önündesin</> : <>Plana göre ilerliyorsun</>) : <>Planın ~{fmtDuration(lagSec)} GERİSİNDESİN</>}
          </div>
        </Panel>

        {/* Hız */}
        <Panel title="Hız">
          {running ? (
            <>
              <div className={cn('mt-1 flex items-center gap-3 text-5xl font-bold', live.slow ? 'text-warning-text' : 'text-good-text')}>
                {live.slow ? <AlertTriangle className="size-12" /> : <CheckCircle2 className="size-12" />}
                {live.slow ? 'YAVAŞ' : 'NORMAL'}
                <span className="tnum text-fg">%{speedPct}</span>
              </div>
              <div className="relative mt-5 h-4 w-full rounded-full bg-wash">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, speedPct / 1.2)}%`, background: live.slow ? 'var(--warning)' : 'var(--good)' }} />
                <div className="absolute -top-1 h-6 w-0.5 bg-fg-2" style={{ left: `${100 / 1.2}%` }} />
                <span className="absolute -bottom-6 text-xs text-fg-2" style={{ left: `calc(${100 / 1.2}% - 16px)` }}>ideal</span>
              </div>
              <div className="mt-7 text-xl">
                {advice ? (
                  <>
                    <div className="font-semibold">{advice.what}</div>
                    <div className="mt-1 text-warning-text">→ {advice.todo}</div>
                  </>
                ) : (
                  <span className="text-fg-2">
                    {m.batchSize > 1 ? 'Şarj' : 'Parça'} <b className="tnum text-fg">%{Math.round(live.cycle.progress * 100)}</b> tamam
                    {live.cycle.remainingSec !== null && (
                      <>
                        {' · '}tahmini bitiş <b className="tnum text-fg">{new Date(now + live.cycle.remainingSec * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</b>
                      </>
                    )}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="mt-2 flex items-center gap-3 text-5xl font-bold text-fg-2">
              <Square className="size-10" /> Makine duruyor
            </div>
          )}
        </Panel>

        {/* Kalite */}
        <Panel title="Kalite · bu vardiya">
          <div className={cn('mt-1 flex items-center gap-3 text-5xl font-bold', nokShift ? 'text-critical-text' : 'text-good-text')}>
            {nokShift ? <AlertTriangle className="size-12" /> : <CheckCircle2 className="size-12" />}
            <span className="tnum text-fg">{p.nok}</span>
            <span className="text-3xl">uygunsuz parça</span>
          </div>
          {nokShift && <div className="mt-2 text-xl font-semibold text-critical-text">Parçayı karantinaya ayır, kaliteye bildir (MRB)</div>}
          {lastMeas && (
            <div className="mt-auto pt-3 text-lg text-fg-2">
              Son ara ölçüm · {m.spec.characteristic}:{' '}
              <b className={cn('tnum', measOk ? 'text-fg' : 'text-critical-text')}>
                {lastMeas.mean.toFixed(dec).replace('.', ',')} {m.spec.unit}
              </b>{' '}
              <span className="text-base">
                (tolerans {m.spec.lsl.toFixed(dec).replace('.', ',')}–{m.spec.usl.toFixed(dec).replace('.', ',')}) {measOk ? '✓' : '✗'}
              </span>
            </div>
          )}
        </Panel>

        {/* Vardiya zaman çizgisi */}
        <Panel title="Vardiya zaman çizgisi">
          <div className="mt-3 flex-1">
            <ShiftTimeline rows={[{ id: m.id, label: m.code, track, parts: done }]} from={w.start} to={w.end} now={now} big />
          </div>
          <ShiftTimelineLegend />
        </Panel>
      </div>

      {/* Yapılacaklar */}
      <section className="rounded-2xl border bg-card px-5 py-3" aria-label="Yapılacaklar">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-2">Yapılacaklar</h2>
        <ul className="mt-1.5 flex flex-wrap gap-x-8 gap-y-1.5">
          {todos.map((t) => {
            const s = TONE[t.tone]
            return (
              <li key={t.text} className={cn('flex items-center gap-2 text-lg font-medium', s.cls)}>
                <s.Icon className="size-6 shrink-0" />
                <span className={t.tone === 'info' ? 'text-fg' : undefined}>{t.text}</span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
