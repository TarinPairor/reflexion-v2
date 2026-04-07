type ConversationRecord = {
  date?: string
  duration?: number
  speechActivity?: number
  avgSpeechRate?: number
}

type TrendPoint = {
  label: string
  value: number
}

type TrendCardConfig = {
  title: string
  legend: string
  stroke: string
  fill: string
  points: TrendPoint[]
  valueFormatter?: (value: number) => string
}

type ConversationChartsProps = {
  conversations: ConversationRecord[]
}

const DEFAULT_VALUE_FORMATTER = (value: number) => value.toFixed(1)

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function formatDateLabel(dateValue: string | undefined, fallbackIndex: number): string {
  if (!dateValue) return `Session ${fallbackIndex + 1}`
  const parsed = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return dateValue
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildMetricSeries(
  conversations: ConversationRecord[],
  selectValue: (conversation: ConversationRecord) => unknown,
): TrendPoint[] {
  return conversations.reduce<TrendPoint[]>((acc, conversation, index) => {
    const numeric = parseNumeric(selectValue(conversation))
    if (numeric == null) return acc

    acc.push({
      label: formatDateLabel(conversation.date, index),
      value: numeric,
    })
    return acc
  }, [])
}

function buildDailySessionSeries(conversations: ConversationRecord[]): TrendPoint[] {
  const grouped = new Map<string, number>()

  conversations.forEach((conversation, index) => {
    const label = formatDateLabel(conversation.date, index)
    grouped.set(label, (grouped.get(label) ?? 0) + 1)
  })

  return Array.from(grouped, ([label, value]) => ({ label, value }))
}

function buildLinePath(
  points: TrendPoint[],
  width: number,
  height: number,
  padding: { top: number; right: number; bottom: number; left: number },
) {
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  if (points.length === 0) {
    return { linePath: '', areaPath: '', scaled: [] as { x: number; y: number }[] }
  }

  const values = points.map(point => point.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = maxValue - minValue || 1

  const scaled = points.map((point, index) => {
    const x =
      points.length === 1
        ? padding.left + chartWidth / 2
        : padding.left + (index / (points.length - 1)) * chartWidth
    const y = padding.top + ((maxValue - point.value) / range) * chartHeight
    return { x, y }
  })

  const linePath = scaled
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')

  const first = scaled[0]
  const last = scaled[scaled.length - 1]
  const areaPath = `${linePath} L ${last.x} ${height - padding.bottom} L ${first.x} ${height - padding.bottom} Z`

  return { linePath, areaPath, scaled }
}

function TrendCard({
  title,
  legend,
  stroke,
  fill,
  points,
  valueFormatter = DEFAULT_VALUE_FORMATTER,
}: TrendCardConfig) {
  const width = 520
  const height = 250
  const padding = { top: 30, right: 24, bottom: 48, left: 24 }
  const { linePath, areaPath, scaled } = buildLinePath(points, width, height, padding)
  const xLabels = points.length
    ? [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]]
    : []

  return (
    <article className="rounded-3xl border border-black/5 bg-white/70 p-5 shadow-[0_10px_25px_rgba(15,23,42,0.08)] backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--sea-ink)] sm:text-base">{title}</h3>
        <span className="rounded-full border px-2.5 py-1 text-xs font-medium" style={{ color: stroke, borderColor: `${stroke}55` }}>
          {legend}
        </span>
      </div>

      {points.length === 0 ? (
        <div className="flex h-[190px] items-center justify-center rounded-2xl border border-dashed border-[rgba(50,143,151,0.3)] text-sm text-[var(--sea-ink-soft)]">
          Not enough data yet.
        </div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] w-full" role="img" aria-label={title}>
          <defs>
            <linearGradient id={`fill-${title.replace(/\s+/g, '-').toLowerCase()}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fill} stopOpacity="0.38" />
              <stop offset="100%" stopColor={fill} stopOpacity="0.04" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
            const y = padding.top + ratio * (height - padding.top - padding.bottom)
            return (
              <line
                key={ratio}
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="rgba(15, 23, 42, 0.08)"
                strokeWidth="1"
              />
            )
          })}

          <path d={areaPath} fill={`url(#fill-${title.replace(/\s+/g, '-').toLowerCase()})`} />
          <path d={linePath} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />

          {scaled.map((point, index) => (
            <g key={`${point.x}-${point.y}-${index}`}>
              <circle cx={point.x} cy={point.y} r="3.5" fill={stroke} />
            </g>
          ))}

          {scaled.length > 0 && (
            <text
              x={scaled[scaled.length - 1].x}
              y={Math.max(18, scaled[scaled.length - 1].y - 10)}
              textAnchor="end"
              fill={stroke}
              fontSize="11"
              fontWeight="600"
            >
              {valueFormatter(points[points.length - 1].value)}
            </text>
          )}

          {xLabels.map((point, index) => {
            const x = index === 0 ? padding.left : index === 1 ? width / 2 : width - padding.right
            return (
              <text key={`${point.label}-${index}`} x={x} y={height - 16} textAnchor="middle" fill="rgba(15, 23, 42, 0.62)" fontSize="11">
                {point.label}
              </text>
            )
          })}
        </svg>
      )}
    </article>
  )
}

export function ConversationCharts({ conversations }: ConversationChartsProps) {
  const cards: TrendCardConfig[] = [
    {
      title: 'Speech Rate Trend (words/sec)',
      legend: 'Speech Rate (words/sec)',
      stroke: '#4FB8B2',
      fill: '#4FB8B2',
      points: buildMetricSeries(conversations, conversation => conversation.avgSpeechRate),
    },
    {
      title: 'Session Duration Trend',
      legend: 'Duration (minutes)',
      stroke: '#F26D9D',
      fill: '#F26D9D',
      points: buildMetricSeries(conversations, conversation => conversation.duration),
    },
    {
      title: 'Speech Activity Trend (%)',
      legend: 'Speech Activity (%)',
      stroke: '#E7BE4A',
      fill: '#E7BE4A',
      points: buildMetricSeries(conversations, conversation => conversation.speechActivity),
      valueFormatter: value => `${value.toFixed(0)}%`,
    },
    {
      title: 'Daily Sessions Count',
      legend: 'Sessions',
      stroke: '#9363F6',
      fill: '#9363F6',
      points: buildDailySessionSeries(conversations),
      valueFormatter: value => value.toFixed(0),
    },
  ]

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-lg font-semibold text-[var(--sea-ink)] sm:text-xl">Conversation Insights</h2>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {cards.map(card => (
          <TrendCard key={card.title} {...card} />
        ))}
      </div>
    </section>
  )
}
