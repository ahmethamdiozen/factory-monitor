import { create } from 'zustand'
import { ApiDataSource } from '@/data/api/ApiDataSource'
import { DemoDataSource } from '@/data/demo/DemoDataSource'
import { IS_DEMO } from '@/data/mode'
import type { ConnStatus, LiveSource } from '@/data/DataSource'

export type Theme = 'dark' | 'light'

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('fm-theme')
    if (t === 'light' || t === 'dark') return t
  } catch {
    /* localStorage yoksa varsayılan */
  }
  return 'dark'
}

// Tek veri kaynağı örneği (HMR'de yeniden oluşmasın).
// Demo derlemesinde (GitHub Pages) tüm hat tarayıcıda çalışır; normalde API'den okunur.
const g = globalThis as unknown as { __fmSource?: LiveSource }
export const source: LiveSource = (g.__fmSource ??= IS_DEMO ? new DemoDataSource() : new ApiDataSource())

interface FactoryStore {
  tick: number
  ready: boolean
  conn: ConnStatus
  theme: Theme
  /** Makine/foreman ekranında header'ı gizleyen kiosk modu */
  kiosk: boolean
  toggleTheme: () => void
  setKiosk: (k: boolean) => void
}

const theme0 = initialTheme()
document.documentElement.dataset.theme = theme0

export const useFactory = create<FactoryStore>((set, get) => ({
  tick: 0,
  ready: source.ready,
  conn: source.status(),
  theme: theme0,
  kiosk: false,
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('fm-theme', next)
    } catch {
      /* yoksay */
    }
    set({ theme: next })
  },
  setKiosk: (k) => set({ kiosk: k }),
}))

source.subscribe(() => useFactory.setState((s) => ({ tick: s.tick + 1, ready: source.ready, conn: source.status() })))
source.start()
