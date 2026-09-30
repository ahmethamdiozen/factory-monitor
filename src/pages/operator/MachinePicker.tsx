import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/machine/OperatorChip'
import { StatusBadge } from '@/components/machine/StatusBadge'
import { LINES } from '@/data/registry'
import { useSnapshot } from '@/data/snapshot'

/** Tablete hangi makinenin ekranı açılacağını seçme sayfası. */
export default function MachinePicker() {
  const snap = useSnapshot()
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-[1200px]">
        <h1 className="text-xl font-semibold">Makine ekranı</h1>
        <p className="mt-1 text-sm text-fg-2">Makinenin başındaki tablette açılacak ekranı seçin. Sayfa adresini yer imi olarak kaydedin; tablet her açılışta o makineyi gösterir.</p>
        {LINES.map((l) => (
          <section key={l.id} className="mt-6">
            <h2 className="mb-2 text-[13px] font-semibold text-fg-2">{l.name}</h2>
            <div className="grid grid-cols-4 gap-4">
              {snap.machines
                .filter((m) => m.machine.lineId === l.id)
                .map((m) => (
                  <Link key={m.machine.id} to={`/makine-ekrani/${m.machine.id}`} className="group flex flex-col gap-3 rounded-xl border bg-card p-4 hover:bg-wash focus-visible:outline-2 focus-visible:outline-s1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-lg font-semibold">{m.machine.code}</div>
                        <div className="text-xs text-fg-2">{m.machine.name}</div>
                      </div>
                      <ChevronRight className="size-5 text-fg-3 group-hover:text-fg" />
                    </div>
                    <StatusBadge state={m.stateKey} />
                    {m.operator && (
                      <div className="flex items-center gap-2 text-xs">
                        <Avatar person={m.operator} size={24} />
                        {m.operator.name}
                      </div>
                    )}
                  </Link>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
