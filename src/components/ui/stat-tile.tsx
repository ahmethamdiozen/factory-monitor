import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatTile({ label, value, unit, sub, children, className, valueClass }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; children?: ReactNode; className?: string; valueClass?: string }) {
  return (
    <Card className={cn('flex flex-col gap-1.5 px-4 py-3.5', className)}>
      <span className="text-xs font-medium text-fg-2">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('text-[28px] font-semibold leading-none tracking-tight', valueClass)}>{value}</span>
        {unit && <span className="text-xs text-fg-2">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-fg-2">{sub}</div>}
      {children}
    </Card>
  )
}
