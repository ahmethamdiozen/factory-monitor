import { RefreshCw, Play, Square, Wrench } from 'lucide-react'
import type { MachineStateKey } from '@/lib/types'
import { STATE_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'

export const STATE_STYLE: Record<MachineStateKey, { text: string; bg: string; dot: string; var: string; Icon: typeof Play }> = {
  running: { text: 'text-good-text', bg: 'bg-good/15', dot: 'bg-good', var: 'var(--good)', Icon: Play },
  stopped: { text: 'text-critical-text', bg: 'bg-critical/15', dot: 'bg-critical', var: 'var(--critical)', Icon: Square },
  maintenance: { text: 'text-maint', bg: 'bg-maint/15', dot: 'bg-maint', var: 'var(--maint)', Icon: Wrench },
  changeover: { text: 'text-warning-text', bg: 'bg-warning/20', dot: 'bg-warning', var: 'var(--warning)', Icon: RefreshCw },
}

export function StatusBadge({ state, className, size = 'md' }: { state: MachineStateKey; className?: string; size?: 'sm' | 'md' }) {
  const s = STATE_STYLE[state]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full font-medium', s.bg, s.text, size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs', className)}>
      <s.Icon className={size === 'sm' ? 'size-2.5' : 'size-3'} fill="currentColor" strokeWidth={2} />
      {STATE_LABEL[state]}
    </span>
  )
}
