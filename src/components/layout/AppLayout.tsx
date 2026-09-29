import { Activity, BookOpen, FlaskConical, ListChecks, LayoutDashboard, Moon, Pause, Play, RotateCcw, ShieldCheck, Sun, TrendingDown, Users } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { source, useFactory } from '@/data/store'
import { SHIFTS, shiftOf } from '@/data/mock/factory'
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

const SPEEDS = [
  { value: 1, label: '10×' },
  { value: 6, label: '60×' },
  { value: 30, label: '300×' },
]

function Clock() {
  useFactory((s) => s.tick)
  const now = source.now()
  const d = new Date(now)
  const date = d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const sh = SHIFTS.find((s) => s.id === shiftOf(now))!
  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <div className="tnum text-[15px] font-semibold">{time}</div>
        <div className="text-[11px] text-fg-2">{date}</div>
      </div>
      <div className="rounded-md bg-wash px-2 py-1 text-xs font-medium">
        {sh.name} <span className="text-fg-2">{String(sh.startHour).padStart(2, '0')}–{String(sh.endHour).padStart(2, '0')}</span>
      </div>
    </div>
  )
}

export function AppLayout() {
  const { pathname } = useLocation()
  const { speed, paused, theme, setSpeed, setPaused, reset, toggleTheme } = useFactory()
  const title = pathname.startsWith('/makine/') ? 'Makine Detayı' : (TITLES[pathname] ?? 'Fabrika Monitör')
  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="grid size-8 place-items-center rounded-lg bg-s1 text-white">
            <Activity className="size-4.5" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Fabrika Monitör</div>
            <div className="text-[11px] text-fg-2">Üretim izleme prototipi</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 py-2" aria-label="Ana menü">
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
        <div className="mt-auto space-y-2 p-3">
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-2.5 text-[11px] leading-snug text-fg-2">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-warning-text" />
            <span>
              <b className="text-fg">Simüle veri.</b> Tüm değerler yer tutucudur; SQL Server bağlanınca aynı arayüz gerçek veriyi gösterecek.
            </span>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-card px-5">
          <h1 className="text-[15px] font-semibold">{title}</h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon" onClick={() => setPaused(!paused)} aria-label={paused ? 'Devam et' : 'Duraklat'} title={paused ? 'Devam et' : 'Duraklat'}>
                {paused ? <Play className="size-3.5" fill="currentColor" /> : <Pause className="size-3.5" fill="currentColor" />}
              </Button>
              <Segmented value={speed} onChange={setSpeed} options={SPEEDS} label="Simülasyon hızı" />
              <Button variant="ghost" size="icon" onClick={reset} aria-label="Simülasyonu sıfırla" title="Sıfırla (17:40)">
                <RotateCcw className="size-3.5" />
              </Button>
            </div>
            <div className="h-6 w-px bg-border" />
            <Clock />
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Temayı değiştir" title="Tema">
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
