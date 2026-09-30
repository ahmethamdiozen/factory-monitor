import { Activity, Loader2, Maximize2, Minimize2, Moon, Sun, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ConnectionPill } from '@/components/layout/ConnectionPill'
import { TopNav } from '@/components/layout/TopNav'
import { Button } from '@/components/ui/button'
import { SHIFTS, shiftOf } from '@/data/registry'
import { IS_DEMO } from '@/data/DataSource'
import { useFactory } from '@/data/store'

function Clock() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const d = new Date(now)
  const sh = SHIFTS.find((s) => s.id === shiftOf(now))!
  return (
    <div className="flex items-center gap-2.5">
      <div className="text-right leading-tight">
        <div className="tnum text-[15px] font-semibold">{d.toLocaleTimeString('tr-TR')}</div>
        <div className="text-[11px] text-fg-2">{d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
      </div>
      <div className="whitespace-nowrap rounded-md bg-wash px-2 py-1 text-xs font-medium">
        {sh.name} <span className="text-fg-2">{String(sh.startHour).padStart(2, '0')}–{String(sh.endHour).padStart(2, '0')}</span>
      </div>
    </div>
  )
}

function Waiting() {
  const conn = useFactory((s) => s.conn)
  const offline = conn.state === 'offline'
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        {offline ? <WifiOff className="mx-auto size-8 text-warning-text" /> : <Loader2 className="mx-auto size-8 animate-spin text-fg-2" />}
        <h2 className="mt-3 text-base font-semibold">{offline ? 'Veri kaynağına bağlanılamıyor' : 'Veri yükleniyor…'}</h2>
        <p className="mt-1 text-sm text-fg-2">
          {offline ? (
            <>
              API'ye ulaşılamadı, 5 sn'de bir yeniden deneniyor. Veri hattını başlatmak için: <code className="rounded bg-wash px-1">npm run stack</code>
            </>
          ) : (
            IS_DEMO ? 'Makineler tarayıcıda simüle ediliyor, son 24 saat hazırlanıyor…' : 'SQL Server → Collector → API hattından son 30 saat alınıyor.'
          )}
        </p>
        {offline && conn.error && <p className="mt-2 text-xs text-fg-3">{conn.error}</p>}
      </div>
    </div>
  )
}

const KIOSK_CAPABLE = ['/makine-ekrani/', '/foreman/']

/** Tüm sayfaların kabı: üstte ortada 4 ekran butonu, sağda veri durumu ve saat. */
export function AppLayout() {
  const { pathname } = useLocation()
  const { ready, theme, toggleTheme, kiosk, setKiosk } = useFactory()
  const kioskCapable = KIOSK_CAPABLE.some((p) => pathname.startsWith(p))
  const hideHeader = kiosk && kioskCapable

  useEffect(() => {
    if (!kioskCapable && kiosk) setKiosk(false)
  }, [kioskCapable, kiosk, setKiosk])

  return (
    <div className="flex h-full flex-col">
      {!hideHeader && (
        <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b bg-card px-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-s1 text-white">
              <Activity className="size-4.5" strokeWidth={2.4} />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Fabrika Monitör</div>
              <div className="text-[11px] text-fg-2">Üretim izleme</div>
            </div>
          </div>
          <TopNav />
          <div className="flex items-center justify-end gap-3">
            <ConnectionPill />
            <div className="h-6 w-px bg-border" />
            <Clock />
            {kioskCapable && (
              <Button variant="ghost" size="icon" onClick={() => setKiosk(true)} aria-label="Tam ekran" title="Tam ekran (tablet görünümü)">
                <Maximize2 className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Temayı değiştir" title="Tema">
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>
      )}
      {hideHeader && (
        <button
          onClick={() => setKiosk(false)}
          className="fixed right-3 top-3 z-50 grid size-9 place-items-center rounded-full border bg-card/80 text-fg-2 backdrop-blur hover:text-fg focus-visible:outline-2 focus-visible:outline-s1"
          aria-label="Tam ekrandan çık"
          title="Tam ekrandan çık"
        >
          <Minimize2 className="size-4" />
        </button>
      )}
      <div className="min-h-0 flex-1">{ready ? <Outlet /> : <Waiting />}</div>
      {hideHeader && <ConnectionPill floating />}
    </div>
  )
}
