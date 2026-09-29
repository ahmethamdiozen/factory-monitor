import { cn } from '@/lib/utils'

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-s1',
            o.value === value ? 'bg-wash text-fg shadow-[inset_0_0_0_1px_var(--border)]' : 'text-fg-2 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
