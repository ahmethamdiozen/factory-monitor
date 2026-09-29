import { cn } from '@/lib/utils'

/** Yatay ölçer: oran/limit. `marker` (0-1) hedef çizgisini gösterir. */
export function Meter({ value, marker, className, color = 'var(--series-1)', height = 6 }: { value: number; marker?: number; className?: string; color?: string; height?: number }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className={cn('relative w-full overflow-visible rounded-full bg-wash', className)} style={{ height }} role="meter" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${v * 100}%`, background: color }} />
      {marker !== undefined && <div className="absolute -top-0.5 h-[calc(100%+4px)] w-0.5 rounded bg-fg-3" style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }} />}
    </div>
  )
}
