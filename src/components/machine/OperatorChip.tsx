import type { Person } from '@/lib/types'
import { avatarUri } from '@/lib/avatar'
import { cn } from '@/lib/utils'

export function Avatar({ person, size = 28, className }: { person: Person; size?: number; className?: string }) {
  return <img src={avatarUri(person.avatarSeed)} alt="" width={size} height={size} className={cn('shrink-0 rounded-full bg-wash', className)} style={{ width: size, height: size }} />
}

export function OperatorChip({ person, role, size = 28 }: { person?: Person; role: string; size?: number }) {
  if (!person) return null
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar person={person} size={size} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-xs font-medium text-fg">{person.name}</div>
        <div className="text-[11px] text-fg-2">{role}</div>
      </div>
    </div>
  )
}
