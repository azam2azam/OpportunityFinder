'use client'

import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, LabelList, ZAxis,
} from 'recharts'

/**
 * Chart primitives.
 *
 * One categorical palette is used across every chart so a colour means the same
 * thing on the dashboard as in analytics. Axis and grid colours come from fixed
 * values rather than CSS variables because Recharts renders SVG attributes, not
 * styled elements, and cannot resolve a custom property at paint time.
 */

export const SERIES = [
  '#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626',
  '#7c3aed', '#db2777', '#0284c7', '#65a30d', '#ea580c',
]

const AXIS = { stroke: '#94a3b8', fontSize: 11 }
const GRID = '#e2e8f0'

function TooltipBox({
  active, payload, label, formatter,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>
  label?: string | number
  formatter?: (v: number, key: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-ink-200 bg-white px-2.5 py-2 text-xs shadow-pop dark:border-ink-700 dark:bg-ink-900">
      {label != null && (
        <p className="mb-1 font-medium text-ink-900 dark:text-ink-100">{String(label)}</p>
      )}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 text-ink-600 dark:text-ink-300">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span>{p.name}:</span>
          <span className="tabular font-medium text-ink-900 dark:text-ink-100">
            {formatter && typeof p.value === 'number'
              ? formatter(p.value, String(p.dataKey ?? ''))
              : String(p.value)}
          </span>
        </p>
      ))}
    </div>
  )
}

const compactSar = (v: number) =>
  Math.abs(v) >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : Math.abs(v) >= 1_000
      ? `${(v / 1_000).toFixed(0)}K`
      : String(Math.round(v))

export function HorizontalBars({
  data, height = 260, valueKey = 'value', labelKey = 'label', money = false, tone = 0,
}: {
  data: Array<Record<string, string | number>>
  height?: number
  valueKey?: string
  labelKey?: string
  money?: boolean
  tone?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
        <XAxis type="number" {...AXIS} tickFormatter={money ? compactSar : undefined} />
        <YAxis type="category" dataKey={labelKey} width={140} {...AXIS} />
        <Tooltip
          cursor={{ fill: 'rgba(99,102,241,0.06)' }}
          content={<TooltipBox formatter={(v) => (money ? `SAR ${compactSar(v)}` : v.toLocaleString())} />}
        />
        <Bar dataKey={valueKey} fill={SERIES[tone]} radius={[0, 3, 3, 0]} maxBarSize={22}>
          <LabelList
            dataKey={valueKey}
            position="right"
            className="fill-ink-500"
            fontSize={11}
            formatter={(v: number) => (money ? compactSar(v) : v.toLocaleString())}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function GroupedBars({
  data, series, height = 280, money = false,
}: {
  data: Array<Record<string, string | number>>
  series: Array<{ key: string; name: string }>
  height?: number
  money?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="label" {...AXIS} interval={0} angle={-18} textAnchor="end" height={54} />
        <YAxis {...AXIS} tickFormatter={money ? compactSar : undefined} />
        <Tooltip
          cursor={{ fill: 'rgba(99,102,241,0.06)' }}
          content={<TooltipBox formatter={(v) => (money ? `SAR ${compactSar(v)}` : v.toLocaleString())} />}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={SERIES[i]} radius={[3, 3, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TrendLines({
  data, series, height = 260, money = false,
}: {
  data: Array<Record<string, string | number>>
  series: Array<{ key: string; name: string }>
  height?: number
  money?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="period" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={money ? compactSar : undefined} />
        <Tooltip content={<TooltipBox formatter={(v) => (money ? `SAR ${compactSar(v)}` : v.toLocaleString())} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={SERIES[i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function AreaTrend({
  data, dataKey, name, height = 200, money = false, tone = 0,
}: {
  data: Array<Record<string, string | number>>
  dataKey: string
  name: string
  height?: number
  money?: boolean
  tone?: number
}) {
  const id = `area-${dataKey}-${tone}`
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[tone]} stopOpacity={0.28} />
            <stop offset="100%" stopColor={SERIES[tone]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="period" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={money ? compactSar : undefined} width={48} />
        <Tooltip content={<TooltipBox formatter={(v) => (money ? `SAR ${compactSar(v)}` : v.toLocaleString())} />} />
        <Area type="monotone" dataKey={dataKey} name={name} stroke={SERIES[tone]} strokeWidth={2} fill={`url(#${id})`} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function Donut({
  data, height = 240, money = false,
}: {
  data: Array<{ label: string; value: number }>
  height?: number
  money?: boolean
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="56%"
          outerRadius="82%"
          paddingAngle={1.5}
          stroke="none"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={SERIES[i % SERIES.length]} />
          ))}
        </Pie>
        <Tooltip
          content={
            <TooltipBox
              formatter={(v) =>
                `${money ? `SAR ${compactSar(v)}` : v.toLocaleString()} (${total ? ((v / total) * 100).toFixed(0) : 0}%)`
              }
            />
          }
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

/**
 * Value against conversion probability — the spec's scatter (section 19).
 * Reading it: top-right is where the money and the odds agree, and that is
 * where a director should push resource first.
 */
export function ValueScatter({
  data, height = 300,
}: {
  data: Array<{ x: number; y: number; z: number; label: string }>
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 16, bottom: 28, left: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="x"
          name="Conversion probability"
          {...AXIS}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          label={{ value: 'Conversion probability', position: 'insideBottom', offset: -16, fontSize: 11, fill: '#94a3b8' }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Potential value"
          {...AXIS}
          tickFormatter={compactSar}
          width={56}
        />
        <ZAxis type="number" dataKey="z" range={[40, 420]} name="Opportunities" />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as { label: string; x: number; y: number; z: number }
            return (
              <div className="rounded-md border border-ink-200 bg-white px-2.5 py-2 text-xs shadow-pop dark:border-ink-700 dark:bg-ink-900">
                <p className="font-medium text-ink-900 dark:text-ink-100">{p.label}</p>
                <p className="text-ink-600 dark:text-ink-300">
                  {p.z.toLocaleString()} opportunities · SAR {compactSar(p.y)} · {Math.round(p.x * 100)}% likely
                </p>
              </div>
            )
          }}
        />
        <Scatter data={data} fill={SERIES[0]} fillOpacity={0.65} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

/**
 * Hospital × opportunity-type heatmap (section 19). Intensity is scaled to the
 * grid's own maximum: absolute counts differ by an order of magnitude between a
 * 420-bed hospital and a 150-bed one, and an absolute scale would render the
 * small hospitals uniformly blank.
 */
export function Heatmap({
  rows, columns, values, money = false,
}: {
  rows: string[]
  columns: string[]
  values: number[][]
  money?: boolean
}) {
  const max = Math.max(1, ...values.flat())
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[640px] border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="th sticky left-0 bg-white dark:bg-ink-900" />
            {columns.map((c) => (
              <th key={c} className="th text-center">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <th className="th sticky left-0 whitespace-nowrap bg-white text-left dark:bg-ink-900">{r}</th>
              {columns.map((c, ci) => {
                const v = values[ri]?.[ci] ?? 0
                const intensity = v / max
                return (
                  <td key={c} className="p-0">
                    <div
                      className="grid h-9 place-items-center rounded text-2xs tabular font-medium"
                      style={{
                        background: `rgba(79, 70, 229, ${0.06 + intensity * 0.82})`,
                        color: intensity > 0.55 ? '#fff' : '#334155',
                      }}
                      title={`${r} · ${c}: ${money ? `SAR ${compactSar(v)}` : v.toLocaleString()}`}
                    >
                      {v === 0 ? '·' : money ? compactSar(v) : v.toLocaleString()}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
