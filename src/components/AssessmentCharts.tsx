type AssessmentRecord = {
  date?: string
  time?: string
  orientation?: number
  attention?: number
  immediateRecall?: number
  totalScore?: number
}

type TrendPoint = {
  label: string
  value: number
}

type TrendCardConfig = {
  title: string
  legend: string
  points: TrendPoint[]
  valueFormatter?: (value: number) => string
}

type AssessmentChartsProps = {
  assessments: AssessmentRecord[]
}

const DEFAULT_VALUE_FORMATTER = (value: number) => value.toFixed(1)
const CHART_COLOR = '#4FB8B2'

function toSafeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function formatDateLabel(dateValue: string | undefined, fallbackIndex: number): string {
  if (!dateValue) return `Assessment ${fallbackIndex + 1}`
  const parsed = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return dateValue
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getAssessmentTimestamp(assessment: AssessmentRecord): number | null {
  if (!assessment.date) return null
  const dateTime = assessment.time
    ? new Date(`${assessment.date}T${assessment.time}`)
    : new Date(`${assessment.date}T00:00:00`)
  const timestamp = dateTime.getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function sortAssessmentsChronologically(
  assessments: AssessmentRecord[],
): AssessmentRecord[] {
  return assessments
    .map((assessment, index) => ({ assessment, index }))
    .sort((a, b) => {
      const aTimestamp = getAssessmentTimestamp(a.assessment)
      const bTimestamp = getAssessmentTimestamp(b.assessment)
      if (aTimestamp == null && bTimestamp == null) return a.index - b.index
      if (aTimestamp == null) return 1
      if (bTimestamp == null) return -1
      if (aTimestamp !== bTimestamp) return aTimestamp - bTimestamp
      return a.index - b.index
    })
    .map(item => item.assessment)
}

function buildMetricSeries(
  assessments: AssessmentRecord[],
  selectValue: (assessment: AssessmentRecord) => unknown,
): TrendPoint[] {
  return assessments.reduce<TrendPoint[]>((acc, assessment, index) => {
    const numeric = parseNumeric(selectValue(assessment))
    if (numeric == null) return acc
    acc.push({
      label: formatDateLabel(assessment.date, index),
      value: numeric,
    })
    return acc
  }, [])
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
  points,
  valueFormatter = DEFAULT_VALUE_FORMATTER,
}: TrendCardConfig) {
  const width = 520
  const height = 250
  const padding = { top: 30, right: 24, bottom: 48, left: 24 }
  const { linePath, areaPath, scaled } = buildLinePath(points, width, height, padding)
  const gradientId = `fill-${toSafeId(title)}`
  const xLabels = points.length
    ? [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]]
    : []

  return (
    <article className="rounded-2xl border border-(--chip-line) bg-(--chip-bg) p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-(--sea-ink) sm:text-base">{title}</h3>
        <span
          className="rounded-full border px-2.5 py-1 text-xs font-medium"
          style={{ color: CHART_COLOR, borderColor: `${CHART_COLOR}55` }}
        >
          {legend}
        </span>
      </div>

      {points.length === 0 ? (
        <div className="flex h-[190px] items-center justify-center rounded-2xl border border-dashed border-[rgba(50,143,151,0.3)] text-sm text-(--sea-ink-soft)">
          Not enough data yet.
        </div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] w-full" role="img" aria-label={title}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLOR} stopOpacity="0.34" />
              <stop offset="100%" stopColor={CHART_COLOR} stopOpacity="0.05" />
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

          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path d={linePath} fill="none" stroke={CHART_COLOR} strokeWidth="3" strokeLinecap="round" />

          {scaled.map((point, index) => (
            <g key={`${point.x}-${point.y}-${index}`}>
              <circle cx={point.x} cy={point.y} r="3.5" fill={CHART_COLOR} />
            </g>
          ))}

          {scaled.length > 0 && (
            <text
              x={scaled[scaled.length - 1].x}
              y={Math.max(18, scaled[scaled.length - 1].y - 10)}
              textAnchor="end"
              fill={CHART_COLOR}
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

export function AssessmentCharts({ assessments }: AssessmentChartsProps) {
  const chronologicalAssessments = sortAssessmentsChronologically(assessments)

  const cards: TrendCardConfig[] = [
    {
      title: 'Orientation Score Trend',
      legend: 'Orientation (0-2)',
      points: buildMetricSeries(chronologicalAssessments, assessment => assessment.orientation),
      valueFormatter: value => value.toFixed(0),
    },
    {
      title: 'Attention Score Trend',
      legend: 'Attention (0-2)',
      points: buildMetricSeries(chronologicalAssessments, assessment => assessment.attention),
      valueFormatter: value => value.toFixed(0),
    },
    {
      title: 'Immediate Recall Score Trend',
      legend: 'Immediate Recall (0-1)',
      points: buildMetricSeries(
        chronologicalAssessments,
        assessment => assessment.immediateRecall,
      ),
      valueFormatter: value => value.toFixed(0),
    },
    {
      title: 'Total Score Trend',
      legend: 'Total Score (0-5)',
      points: buildMetricSeries(chronologicalAssessments, assessment => assessment.totalScore),
      valueFormatter: value => value.toFixed(0),
    },
  ]

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-lg font-semibold text-(--sea-ink) sm:text-xl">Assessment Insights</h2>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {cards.map(card => (
          <TrendCard key={card.title} {...card} />
        ))}
      </div>
    </section>
  )
}
