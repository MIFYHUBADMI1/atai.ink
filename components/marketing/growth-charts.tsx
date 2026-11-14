"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatDayLabel, type DayPoint } from "@/lib/marketing/ads/center-model"

/**
 * Chart primitives for the Ads & Growth Center. They mirror the Competition
 * dashboard's conventions exactly: a `useMounted` guard so server render and
 * first client paint agree (no hydration mismatch), fixed-size placeholders
 * pre-mount, `dir="ltr"` containers, `isAnimationActive={false}`, and themed
 * tooltips built from CSS variables so every theme stays readable.
 *
 * Every chart here renders ONLY real recorded data. Callers pass empty arrays
 * when nothing was measured and render an honest empty state instead.
 */

export const GROWTH_CHART_COLORS = ["#7c5cfa", "#38a1f7", "#10b981", "#f59e0b", "#ec4899", "#94a3b8"]

const TOOLTIP_STYLE = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 11,
} as const

function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

/** Compact sparkline for a KPI card. Renders a placeholder when < 2 points. */
export function GrowthSparkline({ values, color }: { values: number[]; color: string }) {
  const mounted = useMounted()
  const data = useMemo(() => {
    const series = values.length === 1 ? [values[0], values[0]] : values
    return series.map((value, i) => ({ i, value }))
  }, [values])
  if (!mounted || data.length < 2) return <div className="h-12 w-28" aria-hidden />
  return (
    <div className="h-12 w-28" dir="ltr" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={0.12}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface TrendSeries {
  key: string
  label: string
  color: string
  points: DayPoint[]
}

/**
 * Multi-line trend chart over a shared day axis. Each series carries its own
 * recorded-per-day points; days are aligned by UTC day start.
 */
export function GrowthTrendChart({ series, height = 260 }: { series: TrendSeries[]; height?: number }) {
  const mounted = useMounted()
  const data = useMemo(() => {
    const days = new Map<number, Record<string, number | string>>()
    for (const entry of series) {
      for (const point of entry.points) {
        if (!days.has(point.day)) days.set(point.day, { day: point.day, label: formatDayLabel(point.day) })
        days.get(point.day)![entry.key] = point.value
      }
    }
    return [...days.values()].sort((a, b) => (a.day as number) - (b.day as number))
  }, [series])

  if (!mounted || data.length === 0) {
    return <div style={{ height }} className="w-full rounded-xl border border-dashed border-border" aria-hidden />
  }

  return (
    <div style={{ height }} dir="ltr" className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "var(--foreground)" }}
            itemStyle={{ fontSize: 11 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
          {series.map((entry) => (
            <Line
              key={entry.key}
              type="monotone"
              dataKey={entry.key}
              name={entry.label}
              stroke={entry.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface DonutSlice {
  name: string
  value: number
}

/** Donut with a center total overlay, used for recorded reach by campaign. */
export function GrowthDonut({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[]
  centerLabel: string
  centerValue: string
}) {
  const mounted = useMounted()
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  if (!mounted || slices.length === 0 || total === 0) {
    return <div className="size-44 rounded-full border border-dashed border-border" aria-hidden />
  }
  return (
    <div className="relative size-44" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--foreground)" }} itemStyle={{ fontSize: 11 }} />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="64%"
            outerRadius="96%"
            paddingAngle={2}
            isAnimationActive={false}
          >
            {slices.map((slice, i) => (
              <Cell key={slice.name} fill={GROWTH_CHART_COLORS[i % GROWTH_CHART_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums">{centerValue}</span>
        <span className="text-xs text-muted-foreground">{centerLabel}</span>
      </div>
    </div>
  )
}
