import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border bg-card', className)} {...p} />
}

export function CardHeader({ title, subtitle, right, className }: { title: string; subtitle?: string; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 pt-3.5', className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-fg-2">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}
