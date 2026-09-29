import { create } from 'zustand'
import type { DataSource } from '@/data/DataSource'
import { MockDataSource } from '@/data/mock/simulator'

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

// Tek veri kaynağı örneği (HMR'de yeniden oluşmasın)
const g = globalThis as unknown as { __fmSource?: MockDataSource }
export const source: DataSource = (g.__fmSource ??= new MockDataSource())

interface FactoryStore {
  tick: number
  speed: number
  paused: boolean
  theme: Theme
  setSpeed: (n: number) => void
  setPaused: (p: boolean) => void
  reset: () => void
  toggleTheme: () => void
}

const theme0 = initialTheme()
document.documentElement.dataset.theme = theme0

export const useFactory = create<FactoryStore>((set, get) => ({
  tick: 0,
  speed: source.controls?.getSpeed() ?? 6,
  paused: false,
  theme: theme0,
  setSpeed: (n) => {
    source.controls?.setSpeed(n)
    set({ speed: n })
  },
  setPaused: (p) => {
    source.controls?.setPaused(p)
    set({ paused: p })
  },
  reset: () => {
    source.controls?.reset()
    set({ paused: false })
  },
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
}))

source.subscribe(() => useFactory.setState((s) => ({ tick: s.tick + 1, paused: source.controls?.isPaused() ?? s.paused })))
