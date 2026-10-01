import type { PartDone } from '@/data/shiftView'

/**
 * Vardiya zaman çizgisi: her makine için 5 dk'lık durum bandı ve tamamlanan parçalar.
 * Saatler süren parçalarda "saat saat adet" anlamsız olduğundan, ne zaman çalışılıp
 * ne zaman durulduğu ve parçaların ne zaman bittiği gösterilir.
 */

export interface TimelineRow {
  id: string
  label: string
  sub?: string
  track: { t: number; state: number }[]
  parts: PartDone[]
}

const STATE_FILL = ['var(--good)', 'var(--critical)', 'var(--maint)', 'var(--warning)']
const hh = (t: number) => String(new Date(t).getHours()).padStart(2, '0')
const hhmm = (t: number) => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })

export function ShiftTimeline({ rows, from, to, now, big = false }: { rows: TimelineRow[]; from: number; to: number; now: number; big?: boolean }) {
  const labelW = big ? 0 : 92
  const W = 1000
  const rowH = big ? 46 : 30
  const bandH = big ? 22 : 12
  const top = big ? 26 : 6
  const axisH = 22
  const H = top + rows.length * rowH + axisH
  const x = (t: number) => labelW + ((t - from) / (to - from)) * (W - labelW - 8)
  const step = (5 * 60 * 1000 * (W - labelW - 8)) / (to - from)
  const hours: number[] = []
  for (let t = from; t <= to; t += 3600e3) hours.push(t)
  const total = rows.reduce((a, r) => a + r.parts.reduce((b, p) => b + p.ok + p.nok, 0), 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Vardiya zaman çizgisi: ${total} parça tamamlandı`} className="block">
      {hours.map((t, k) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top} y2={H - axisH} stroke="var(--grid)" strokeWidth={1} />
          <text x={x(t)} y={H - 6} textAnchor={k === 0 ? 'start' : k === hours.length - 1 ? 'end' : 'middle'} fontSize={big ? 15 : 11} fill="var(--fg-3)">
            {hh(t)}
          </text>
        </g>
      ))}
      {rows.map((r, ri) => {
        const y = top + ri * rowH + (rowH - bandH) / 2
        return (
          <g key={r.id}>
            {!big && (
              <>
                <text x={0} y={y + bandH / 2 + 1} dominantBaseline="middle" fontSize={12} fontWeight={600} fill="var(--fg)">
                  {r.label}
                </text>
              </>
            )}
            <rect x={labelW} y={y} width={W - labelW - 8} height={bandH} rx={3} fill="var(--wash)" />
            {r.track.map((p) => (
              <rect key={p.t} x={x(p.t)} y={y} width={Math.max(1, step - 0.5)} height={bandH} fill={STATE_FILL[p.state]} opacity={p.state === 0 ? 0.55 : 0.9} />
            ))}
            {r.parts.map((p) => (
              <g key={p.t}>
                <title>{`${hhmm(p.t)} · ${p.ok + p.nok} parça tamamlandı${p.nok ? ` · ${p.nok} uygunsuz` : ''}${p.sinceLastSec ? ` · ${Math.round(p.sinceLastSec / 60)} dk` : ''}`}</title>
                <line x1={x(p.t)} x2={x(p.t)} y1={y - 3} y2={y + bandH + 3} stroke={p.nok ? 'var(--critical)' : 'var(--fg)'} strokeWidth={big ? 3 : 2} />
                <circle cx={x(p.t)} cy={y - 4} r={big ? 6 : 4} fill={p.nok ? 'var(--critical)' : 'var(--fg)'} />
                {big && (
                  <text x={x(p.t)} y={y - 13} textAnchor="middle" fontSize={13} fill="var(--fg-2)">
                    {hhmm(p.t)}
                  </text>
                )}
              </g>
            ))}
          </g>
        )
      })}
      {now > from && now < to && <line x1={x(now)} x2={x(now)} y1={top - 2} y2={H - axisH} stroke="var(--series-1)" strokeWidth={2} strokeDasharray="4 3" />}
    </svg>
  )
}

/** Zaman çizgisinin renk açıklaması */
export function ShiftTimelineLegend() {
  const items: [string, string][] = [
    ['Çalışıyor', 'var(--good)'],
    ['Durdu', 'var(--critical)'],
    ['Bakımda', 'var(--maint)'],
    ['Ayarda / şarj', 'var(--warning)'],
  ]
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-fg-2">
      {items.map(([l, c]) => (
        <span key={l} className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: c }} />
          {l}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="size-2 rounded-full bg-fg" /> Parça tamamlandı
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="size-2 rounded-full bg-critical" /> Uygunsuz
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-0.5 w-3 bg-s1" /> Şimdi
      </span>
    </div>
  )
}
