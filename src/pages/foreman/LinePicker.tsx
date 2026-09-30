import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/machine/OperatorChip'
import { Meter } from '@/components/ui/meter'
import { LINES, foremanFor } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'
import { interventions, shiftProgress, shiftWindowAt } from '@/data/shiftView'
import { pct } from '@/lib/kpi'

export default function LinePicker() {
  const snap = useSnapshot()
  const w = shiftWindowAt(snap.now)
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[1200px]">
        <h1 className="text-xl font-semibold">Foreman ekranı</h1>
        <p className="mt-1 text-sm text-fg-2">Hat seçin. Ekran o hattın şu anki vardiyasını ve başındaki foreman'i otomatik gösterir ({w.name}).</p>
        <div className="mt-6 grid grid-cols-3 gap-4">
          {LINES.map((l) => {
            const f = foremanFor(l.id, w.id)
            const ms = snap.machines.filter((m) => m.machine.lineId === l.id)
            const ps = ms.map((m) => shiftProgress(m.machine, w, snap.now))
            const ok = ps.reduce((a, p) => a + p.ok, 0)
            const target = ps.reduce((a, p) => a + p.target, 0)
            const urgent = interventions(snap, l.id, w).filter((x) => x.tone === 'critical').length
            return (
              <Link key={l.id} to={`/foreman/${l.id}`} className="group flex flex-col gap-4 rounded-xl border bg-card p-5 hover:bg-wash focus-visible:outline-2 focus-visible:outline-s1">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-lg font-semibold">{l.short}</div>
                    <div className="text-xs text-fg-2">{l.name.split('·')[1]?.trim()}</div>
                  </div>
                  <ChevronRight className="size-5 text-fg-3 group-hover:text-fg" />
                </div>
                {f && (
                  <div className="flex items-center gap-3">
                    <Avatar person={f} size={44} />
                    <div className="leading-tight">
                      <div className="font-medium">{f.name}</div>
                      <div className="text-xs text-fg-2">Foreman · {w.name}</div>
                    </div>
                  </div>
                )}
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-fg-2">Vardiya hedefi</span>
                    <span className="tnum font-semibold">{pct(target ? ok / target : 0, 0)}</span>
                  </div>
                  <Meter value={target ? ok / target : 0} marker={ps[0]?.timeProgress} />
                </div>
                <div className="flex justify-between text-xs text-fg-2">
                  <span>{ms.filter((m) => m.state === 0).length}/{ms.length} makine çalışıyor</span>
                  {urgent > 0 && <span className="font-medium text-critical-text">{urgent} acil müdahale</span>}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
