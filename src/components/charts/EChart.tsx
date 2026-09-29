import * as echarts from 'echarts/core'
import type { EChartsCoreOption } from 'echarts/core'
import { BarChart, CustomChart, GaugeChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

echarts.use([
  BarChart, CustomChart, GaugeChart, HeatmapChart, LineChart, ScatterChart,
  GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, TooltipComponent, VisualMapComponent,
  CanvasRenderer,
])

interface Props {
  option: EChartsCoreOption
  height?: number | string
  className?: string
  onPointClick?: (params: { name?: string; dataIndex?: number; seriesIndex?: number }) => void
  /** Erişilebilirlik: grafiğin kısa açıklaması */
  label?: string
}

export function EChart({ option, height = 240, className, onPointClick, label }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const clickRef = useRef(onPointClick)
  clickRef.current = onPointClick

  useEffect(() => {
    const el = ref.current!
    const c = echarts.init(el, undefined, { renderer: 'canvas' })
    chart.current = c
    c.on('click', (p) => clickRef.current?.(p as never))
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={ref} role="img" aria-label={label} className={className} style={{ height, width: '100%' }} />
}
