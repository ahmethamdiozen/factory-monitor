import { AlertTriangle, Loader2, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFactory } from '@/data/store'
import { cn } from '@/lib/utils'

const hms = (t: number) => new Date(t).toLocaleTimeString('tr-TR')

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} sn önce`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} dk önce` : `${Math.round(m / 60)} sa önce`
}

/** Veri tazeliği göstergesi. Bağlantı koparsa eski veri ekranda kalır, bu hap uyarır. */
export function ConnectionPill({ floating = false }: { floating?: boolean }) {
  const conn = useFactory((s) => s.conn)
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const now = Date.now()

  let body: React.ReactNode
  let cls: string
  if (conn.state === 'connecting') {
    cls = 'text-fg-2'
    body = (
      <>
        <Loader2 className="size-3 animate-spin" /> Bağlanıyor…
      </>
    )
  } else if (conn.state === 'live') {
    cls = 'text-fg-2'
    body = (
      <>
        <span className="pulse-dot size-2 rounded-full bg-good" /> Canlı · {conn.dataUntil ? ago(now - conn.dataUntil) : '—'}
      </>
    )
  } else if (conn.state === 'stale') {
    cls = 'bg-warning/20 text-warning-text'
    body = (
      <>
        <AlertTriangle className="size-3" /> Veri gecikiyor · son veri {conn.dataUntil ? hms(conn.dataUntil) : '—'}
      </>
    )
  } else {
    cls = 'bg-warning/20 text-warning-text'
    body = (
      <>
        <WifiOff className="size-3" /> Yeni veri alınamıyor · son veri {conn.dataUntil ? hms(conn.dataUntil) : '—'}
      </>
    )
  }
  if (floating && (conn.state === 'live' || conn.state === 'connecting')) return null
  return (
    <div
      role="status"
      title={conn.error ?? undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        cls,
        floating && 'fixed bottom-4 right-4 z-50 border bg-card shadow-lg',
      )}
    >
      {body}
    </div>
  )
}
