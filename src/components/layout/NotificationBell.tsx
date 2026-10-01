import { Bell, CheckCircle2, OctagonAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { LINES, LINE_BY_ID } from '@/data/registry'
import { ago } from '@/data/predictiveView'
import { source, useFactory } from '@/data/store'
import { RECIPIENT_LABEL } from '@/ml/notify'
import { NOTIFICATION_STATUS_LABEL } from '@/ml/types'
import type { MaintNotification, NotificationStatus } from '@/ml/types'
import { cn } from '@/lib/utils'

const hhmm = (t: number) => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
const lineShort = (id: string) => LINE_BY_ID[id]?.short ?? id

const STATUS_CLS: Record<NotificationStatus, string> = {
  new: 'bg-critical/15 text-critical-text',
  read: 'bg-wash text-fg-2',
  planned: 'bg-good/15 text-good-text',
  closed: 'bg-wash text-fg-3',
}

function Item({ n, onClose }: { n: MaintNotification; onClose: () => void }) {
  const set = (st: NotificationStatus) => source.setNotificationStatus(n.id, st)
  return (
    <li className={cn('rounded-lg border p-3', n.status === 'new' && 'border-critical/40 bg-critical/5')}>
      <div className="flex items-start gap-2.5">
        <OctagonAlert className="mt-0.5 size-4 shrink-0 text-critical-text" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/makine/${n.machineId}`} onClick={onClose} className="text-[13px] font-semibold hover:underline">
              {n.title}
            </Link>
            <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_CLS[n.status])}>{NOTIFICATION_STATUS_LABEL[n.status]}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-fg-3">
            {hhmm(n.t)} · {ago(Date.now() - n.t)} · {n.recipients.map((r) => RECIPIENT_LABEL(r, lineShort)).join(', ')}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-2">{n.message}</p>
          {n.failureAt && (
            <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-good-text">
              <CheckCircle2 className="size-3.5" /> Uyarı doğrulandı: {Math.round(((n.failureAt - n.t) / 3600000) * 10) / 10} saat sonra arıza oldu
            </p>
          )}
          {n.status !== 'closed' && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {n.status === 'new' && (
                <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => set('read')}>
                  Okundu
                </Button>
              )}
              {n.status !== 'planned' && (
                <Button variant="outline" className="h-7 px-2 text-xs" onClick={() => set('planned')}>
                  Bakım planlandı
                </Button>
              )}
              <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => set('closed')}>
                Kapat
              </Button>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

/** Header'daki bildirim merkezi: öngörücü bakım uyarıları, role göre filtre */
export function NotificationBell() {
  useFactory((s) => s.tick)
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState('all')
  const ref = useRef<HTMLDivElement>(null)
  const all = source.notifications()
  const unread = all.filter((n) => n.status === 'new').length
  const list = role === 'all' ? all : all.filter((n) => n.recipients.includes(role))

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const roles = [{ value: 'all', label: 'Tümü' }, { value: 'bakim', label: 'Bakım' }, ...LINES.map((l) => ({ value: `foreman:${l.id}`, label: `${l.short} foreman` }))]

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="icon" onClick={() => setOpen(!open)} aria-label={`Bildirimler${unread ? `, ${unread} yeni` : ''}`} aria-expanded={open} title="Bakım bildirimleri">
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="tnum absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white">{unread}</span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-10 z-50 flex max-h-[75vh] w-[440px] flex-col rounded-xl border bg-card shadow-2xl" role="dialog" aria-label="Bakım bildirimleri">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <div className="text-sm font-semibold">Bakım bildirimleri</div>
              <div className="text-[11px] text-fg-2">Öngörücü bakım modeli · son 7 gün</div>
            </div>
            <Link to="/ongorucu-bakim" onClick={() => setOpen(false)} className="text-xs font-medium text-s1 hover:underline">
              Tümünü gör
            </Link>
          </div>
          <div className="overflow-x-auto border-b px-3 py-2">
            <Segmented value={role} onChange={setRole} options={roles} label="Alıcı" />
          </div>
          <ul className="flex flex-col gap-2 overflow-y-auto p-3">
            {list.length === 0 && <li className="py-8 text-center text-xs text-fg-2">Bildirim yok</li>}
            {list.map((n) => (
              <Item key={n.id} n={n} onClose={() => setOpen(false)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
