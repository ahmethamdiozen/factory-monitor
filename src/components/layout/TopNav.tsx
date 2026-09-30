import { Database, Factory, HardHat, Wrench } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

const KIOSK_PREFIXES = ['/makine-ekrani', '/foreman', '/sql']

export const VIEWS = [
  { to: '/makine-ekrani', label: 'Makine', icon: Wrench, hint: 'Makine başındaki operatör ekranı' },
  { to: '/foreman', label: 'Foreman', icon: HardHat, hint: 'Hat ve vardiya sorumlusu ekranı' },
  { to: '/', label: 'Mühendis', icon: Factory, hint: 'Analiz ve raporlar' },
  { to: '/sql', label: 'SQL Veri', icon: Database, hint: 'SQL Server tabloları ve veri hattı' },
]

export function isEngineerPath(pathname: string): boolean {
  return !KIOSK_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** Header ortasındaki 4 ekran butonu */
export function TopNav() {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Ekranlar" className="inline-flex rounded-lg border bg-background p-0.5">
      {VIEWS.map((v) => {
        const active = v.to === '/' ? isEngineerPath(pathname) : pathname === v.to || pathname.startsWith(`${v.to}/`)
        return (
          <NavLink
            key={v.to}
            to={v.to}
            title={v.hint}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-s1',
              active ? 'bg-card text-fg shadow-[inset_0_0_0_1px_var(--border)]' : 'text-fg-2 hover:text-fg',
            )}
          >
            <v.icon className="size-3.5" />
            {v.label}
          </NavLink>
        )
      })}
    </nav>
  )
}
