import { BookOpen, FlaskConical, LayoutDashboard, ListChecks, ShieldCheck, TrendingDown, Users } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { IS_DEMO } from '@/data/DataSource'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Fabrika Genel', icon: LayoutDashboard, end: true },
  { to: '/kayip', label: 'Kayıp & Duruş', icon: TrendingDown },
  { to: '/kalite', label: 'Kalite & SPC', icon: ShieldCheck },
  { to: '/personel', label: 'Vardiya & Personel', icon: Users },
  { to: '/olaylar', label: 'Olay Günlüğü', icon: ListChecks },
  { to: '/metrikler', label: 'Metrik Rehberi', icon: BookOpen },
]

const TITLES: Record<string, string> = {
  '/': 'Fabrika Genel',
  '/kayip': 'Kayıp & Duruş Analizi',
  '/kalite': 'Kalite & SPC',
  '/personel': 'Vardiya & Personel',
  '/olaylar': 'Olay Günlüğü',
  '/metrikler': 'Metrik Rehberi',
}

/** Mühendis ekranı: sol menü + analiz sayfaları */
export function EngineerLayout() {
  const { pathname } = useLocation()
  const title = pathname.startsWith('/makine/') ? 'Makine Detayı' : (TITLES[pathname] ?? '')
  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-fg-3">Mühendis</div>
        <nav className="flex flex-col gap-0.5 px-2 py-2" aria-label="Mühendis menüsü">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-s1',
                  isActive ? 'bg-wash text-fg' : 'text-fg-2 hover:bg-wash hover:text-fg',
                )
              }
            >
              <n.icon className="size-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-3">
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-2.5 text-[11px] leading-snug text-fg-2">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-warning-text" />
            <span>
              {IS_DEMO ? (
                <>
                  <b className="text-fg">Demo modu.</b> Makineler ve veri hattı tarayıcıda simüle ediliyor; gerçek kurulumda veri SQL Server'dan gelir.
                </>
              ) : (
                <>
                  <b className="text-fg">Simüle makineler.</b> Veri gerçek hattan akıyor (SQL Server → Collector → API); sadece makineler simülatör.
                </>
              )}
            </span>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-5">
        {title && <h1 className="mx-auto mb-4 max-w-[1500px] text-[17px] font-semibold">{title}</h1>}
        <Outlet />
      </main>
    </div>
  )
}
