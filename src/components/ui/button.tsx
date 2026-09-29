import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-s1 disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost: 'text-fg-2 hover:bg-wash hover:text-fg',
        outline: 'border bg-card text-fg hover:bg-wash',
      },
      size: { sm: 'h-8 px-2.5', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'ghost', size: 'sm' },
  },
)

export function Button({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant, size }), className)} {...p} />
}
