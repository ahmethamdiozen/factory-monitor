import { FEATURE_NAMES } from './features'
import type { MachineType } from '@/lib/types'
import type { ModeId } from '@/lib/failureModes'

/** ml/train.py'nin ürettiği modelin biçimi (src/ml/modelData.ts) */
export interface TreeJson {
  /** düğümün baktığı özellik (yaprakta -2) */
  f: number[]
  /** eşik: x <= t ise sol */
  t: number[]
  /** sol / sağ çocuk (yaprakta -1) */
  l: number[]
  r: number[]
  /** yaprak değeri */
  v: number[]
}

export interface EvalMetrics {
  failures: number
  caught: number
  caughtPct: number
  predictableFailures: number
  caughtPredictablePct: number
  suddenFailures: number
  caughtSuddenPct: number
  leadHoursMedian: number
  leadHoursMean: number
  alarmEpisodes: number
  falseAlarms: number
  falseAlarmsPerMachineWeek: number
  precision: number
}

export interface ModelData {
  version: number
  trainedAt: string
  algorithm: string
  horizonHours: number
  features: string[]
  thresholds: { watch: number; alarm: number }
  init: number
  learningRate: number
  trees: TreeJson[]
  reference: number[]
  importances: { feature: string; value: number }[]
  dataset: {
    days: number
    machines: number
    rows: number
    failures: number
    predictableFailures: number
    start: number
    end: number
    horizonHours: number
    trainRows: number
    testRows: number
    testDays: number
    trainFailures: number
  }
  metrics: EvalMetrics
  metricsWatch: EvalMetrics
  baseline: { logisticCaughtPct: number; boostingCaughtPct: number }
  learningCurve: { months: number; trainFailures: number; caughtPct: number; caughtPredictablePct: number; leadHoursMedian: number; averagePrecision: number }[]
  /** Makine tipine göre özellik → olası arıza türü eşlemesi */
  sources: Partial<Record<MachineType, Partial<Record<string, ModeId>>>>
  /** Test döneminde arıza türüne göre yakalama */
  byMode: { mode: ModeId | 'sudden'; failures: number; caught: number; leadHoursMedian: number }[]
  /** Yakalanan arızalarda olası kaynağın doğru bulunma oranı */
  sourceAccuracy: { checked: number; correct: number }
  samples: { x: number[]; p: number }[]
}

export const EXPECTED_FEATURES: readonly string[] = FEATURE_NAMES
