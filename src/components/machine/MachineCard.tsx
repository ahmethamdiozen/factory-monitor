import { AlertTriangle, CheckCircle2, Clock, HeartPulse } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/machine/OperatorChip'
import { Sparkline } from '@/components/machine/Sparkline'
import { StatusBadge, STATE_STYLE } from '@/components/machine/StatusBadge'
import { Meter } from '@/components/ui/meter'
import { REASON_BY_ID, SLOW_REASONS } from '@/data/registry'
import { activeRisk, sourceLabel } from '@/data/predictiveView'
import { currentLabel, fmtDev, lastCycle, maxAbsDev } from '@/data/traceView'
import type { MachineLive } from '@/data/snapshot'
import { dayStartOf, fmtDuration, hoursLabel, num, parts, pct } from '@/lib/kpi'
import { idealCycleHours } from '@/lib/types'
import { cn } from '@/lib/utils'

const hhmm = (t: number, now: number) => {
  const d = new Date(t)
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  return d.getDate() !== new Date(now).getDate() ? `yarın ${time}` : time
}

export function MachineCard({ live, now }: { live: MachineLive; now: number }) {
  const { machine: m, proj } = live
  const cur = currentLabel(m.id)
  const cycle = m.type === 'furnace' ? lastCycle(m.id) : undefined
  const st = STATE_STYLE[live.stateKey]
  const running = live.state === 0
  const durSec = (now - live.sinceT) / 1000
  const elapsed = (now - dayStartOf(now)) / 86400e3
  const r = activeRisk(m.id, live.state, live.reasonId)
  const risk = r?.level === 'alarm' ? r : null
  const etaAt = proj.etaSec !== null && proj.etaSec > 0 ? now + proj.etaSec * 1000 : null

  let planLine: React.ReactNode
  if (proj.verdict === 'done') {
    planLine = (
      <span className="flex items-center gap-1 text-good-text">
        <CheckCircle2 className="size-3.5" /> Günlük hedef tamamlandı
      </span>
    )
  } else if (proj.verdict === 'ontrack') {
    planLine = (
      <span className="flex items-center gap-1 text-fg-2">
        <Clock className="size-3.5" /> Hedef tahmini <b className="tnum text-fg">{etaAt ? hhmm(etaAt, now) : '—'}</b> · yetişir
      </span>
    )
  } else {
    planLine = (
      <span className="flex items-center gap-1 text-warning-text">
        <AlertTriangle className="size-3.5" /> Yetişmez · <b className="tnum">−{parts(proj.shortfall)}</b> parça
      </span>
    )
  }

  return (
    <Link
      to={`/makine/${m.id}`}
      className="group relative flex flex-col gap-2.5 overflow-hidden rounded-xl border bg-card p-3.5 pl-4 transition-colors hover:bg-wash focus-visible:outline-2 focus-visible:outline-s1"
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', st.dot)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 leading-tight">
          <div className="flex items-baseline gap-1.5">
            <span className="shrink-0 whitespace-nowrap text-sm font-semibold">{m.code}</span>
            <span className="truncate text-xs text-fg-2">{m.product}</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-fg-2">
            {cur ?? `${m.partNumber} · ${m.operation}`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge state={live.stateKey} />
          {risk && (
            <span className="inline-flex items-center gap-1 rounded-full bg-critical/15 px-1.5 py-0.5 text-[11px] font-medium text-critical-text" title={[risk.source ? `Olası kaynak: ${sourceLabel(risk.source)}` : null, ...risk.factors.map((f) => f.text)].filter(Boolean).join(' · ')}>
              <HeartPulse className="size-3" /> Arıza riski %{Math.round(risk.risk * 100)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1">
            <span className="tnum text-2xl font-semibold leading-none">{pct(live.cycle.progress, 0)}</span>
            <span className="text-xs text-fg-2">{m.batchSize > 1 ? 'şarj' : 'parça'} tamam</span>
          </div>
          <div className="mt-1 text-[11px] text-fg-2">
            {live.cycle.remainingSec !== null && running ? <>kalan ~{fmtDuration(live.cycle.remainingSec)}</> : <>ideal çevrim {hoursLabel(idealCycleHours(m))}</>}
            {running && (
              <>
                {' · '}hız <b className={cn('tnum', live.slow ? 'text-warning-text' : 'text-fg')}>{pct(live.speedPct, 0)}</b>
              </>
            )}
          </div>
        </div>
        <Sparkline data={live.spark} ideal={1} color={st.var === 'var(--good)' ? 'var(--series-1)' : 'var(--fg-3)'} label="Son 2 saat ilerleme hızı" />
      </div>
      <div className="-mt-1 h-1 w-full overflow-hidden rounded-full bg-wash" aria-hidden>
        <div className="h-full rounded-full bg-s1/60" style={{ width: `${live.cycle.progress * 100}%` }} />
      </div>

      <div className="min-h-[22px] text-xs">
        {running ? (
          live.slow ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-warning/20 px-1.5 py-0.5 font-medium text-warning-text">
              <AlertTriangle className="size-3 shrink-0" />
              <span className="truncate">Yavaş · {SLOW_REASONS[live.slowReasonId]?.label ?? 'neden belirsiz'}</span>
            </span>
          ) : (
            <span className="text-fg-2">Hız normal · {fmtDuration(durSec)}'dir çalışıyor</span>
          )
        ) : (
          <span className={cn('inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 font-medium', st.bg, st.text)}>
            <span className="truncate">
              {REASON_BY_ID[live.reasonId]?.label} · {fmtDuration(durSec)}
            </span>
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-fg-2">
        <span>
          Bugün <b className="tnum text-fg">{num(live.kpiDay.ok)}</b> parça
        </span>
        <span>
          Uygunsuz <b className={cn('tnum', live.kpiDay.nok > 0 ? 'text-warning-text' : 'text-fg')}>{num(live.kpiDay.nok)}</b>
        </span>
        <span>
          OEE <b className="tnum text-fg">{pct(live.kpiShift.oee, 0)}</b>
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-2">Günlük hedef</span>
          <span className="tnum font-medium">
            {num(proj.produced)} <span className="font-normal text-fg-2">/ {num(m.dailyTarget)} parça</span>
          </span>
        </div>
        <Meter value={proj.progress} marker={Math.min(1, Math.max(0, elapsed))} color={proj.verdict === 'behind' ? 'var(--serious)' : 'var(--series-1)'} />
        <div className="text-xs">{planLine}</div>
        {cycle && (
          <div className={cn('flex items-center gap-1 text-xs', cycle.ok ? 'text-good-text' : 'font-medium text-critical-text')} title="AMS 2750: tutma süresi ve set değerinden sapma">
            {cycle.ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            Son şarj {cycle.ok ? 'reçeteye uygun' : 'reçete dışı'} · maks. sapma {fmtDev(maxAbsDev(cycle) === Math.abs(cycle.minDev) ? cycle.minDev : cycle.maxDev)}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t pt-2.5">
        {live.operator && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar person={live.operator} size={26} />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium">{live.operator.name}</div>
              <div className="text-[11px] text-fg-2">Operatör</div>
            </div>
          </div>
        )}
        {live.foreman && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar person={live.foreman} size={26} />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium">{live.foreman.name}</div>
              <div className="text-[11px] text-fg-2">Foreman</div>
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}
