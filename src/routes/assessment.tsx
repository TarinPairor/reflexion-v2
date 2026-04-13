import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { addAssessmentEntry } from '../api/assessment'
import {
  type AssessmentStatusKind,
  useOpenAIRealtimeAssessment,
} from '../hooks/useOpenAIRealtimeAssessment'

export const Route = createFileRoute('/assessment')({
  component: AssessmentPage,
})

function statusShellClass(kind: AssessmentStatusKind): string {
  const base =
    'rounded-2xl border px-4 py-3 text-center text-sm font-medium transition-colors'
  switch (kind) {
    case 'listening':
      return `${base} border-[rgba(50,143,151,0.35)] bg-[rgba(79,184,178,0.12)] text-(--lagoon-deep) animate-pulse`
    case 'processing':
      return `${base} border-[rgba(200,140,60,0.35)] bg-[rgba(255,200,120,0.12)] text-(--sea-ink)`
    case 'speaking':
      return `${base} border-[rgba(100,80,140,0.25)] bg-[rgba(120,100,180,0.08)] text-(--sea-ink)`
    case 'error':
      return `${base} border-[rgba(180,60,60,0.35)] bg-[rgba(255,200,200,0.2)] text-(--sea-ink)`
    case 'scoring':
      return `${base} border-[rgba(60,140,80,0.35)] bg-[rgba(150,220,170,0.22)] text-(--sea-ink)`
    case 'countdown':
      return `${base} border-[rgba(240,180,60,0.35)] bg-[rgba(255,240,180,0.5)] text-(--sea-ink) text-lg`
    default:
      return `${base} border-(--chip-line) bg-(--chip-bg) text-(--sea-ink-soft)`
  }
}

function AssessmentPage() {
  const addAssessmentEntryFn = useServerFn(addAssessmentEntry)
  const {
    language,
    toggleLanguage,
    statusKind,
    statusText,
    messages,
    connecting,
    sessionActive,
    scoring,
    scoreData,
    startAssessment,
    stopAssessment,
  } = useOpenAIRealtimeAssessment()
  const [submittingAssessment, setSubmittingAssessment] = useState(false)
  const [assessmentSubmitted, setAssessmentSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const busy = connecting || sessionActive || scoring
  const canStart = !busy
  const canStop = sessionActive || connecting
  const summary = scoreData?.summary ?? null
  const canSubmit = Boolean(summary) && !submittingAssessment && !assessmentSubmitted

  const handleStartAssessment = async () => {
    setAssessmentSubmitted(false)
    setSubmitError(null)
    await startAssessment()
  }

  const handleSubmitAssessment = async () => {
    if (!summary) return

    setSubmittingAssessment(true)
    setSubmitError(null)

    const now = new Date()
    const date = now.toISOString().split('T')[0] || ''
    const time = now.toTimeString().split(' ')[0] || ''

    try {
      const result = await addAssessmentEntryFn({
        data: {
          date,
          time,
          orientation: summary.orientationScore,
          attention: summary.attentionScore,
          immediateRecall: summary.immediateRecallScore,
          totalScore: summary.totalScore,
        },
      })

      if (!result.inserted) {
        setSubmitError(result.reason)
        return
      }

      setAssessmentSubmitted(true)
    } catch {
      setSubmitError('submit_failed')
    } finally {
      setSubmittingAssessment(false)
    }
  }

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in relative overflow-hidden rounded-4xl px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />

        <h1 className="display-title mb-4 max-w-3xl text-3xl leading-[1.05] font-bold tracking-tight text-(--sea-ink) sm:text-5xl">
          Cognitive Assessment
        </h1>
        <p className="mb-8 max-w-2xl text-base text-(--sea-ink-soft) sm:text-lg">
          We&apos;ll ask you a few simple questions. Please answer naturally and
          take your time.
        </p>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-(--sea-ink-soft)">
            AI language
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={toggleLanguage}
            className="rounded-full border border-[rgba(50,143,151,0.35)] bg-[rgba(79,184,178,0.12)] px-4 py-2 text-sm font-semibold text-(--lagoon-deep) transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.22)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {language === 'en' ? 'English 🇺🇸' : '中文 🇨🇳'}
          </button>
        </div>

        <div className={statusShellClass(statusKind)}>{statusText}</div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void handleStartAssessment()}
            className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-(--lagoon-deep) transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting ? 'Connecting...' : 'Begin assessment'}
          </button>
          <button
            type="button"
            disabled={!canStop}
            onClick={stopAssessment}
            className="rounded-full border border-[rgba(180,80,80,0.35)] bg-[rgba(255,200,200,0.25)] px-5 py-2.5 text-sm font-semibold text-(--sea-ink) transition hover:-translate-y-0.5 hover:bg-[rgba(255,200,200,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Complete assessment
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void handleSubmitAssessment()}
            className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-(--lagoon-deep) transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submittingAssessment
              ? 'Submitting...'
              : assessmentSubmitted
                ? 'Assessment submitted'
                : 'Submit assessment'}
          </button>
        </div>
        {assessmentSubmitted ? (
          <p className="mt-3 text-sm text-(--sea-ink-soft)">
            Assessment score saved.
          </p>
        ) : null}
        {submitError ? (
          <p className="mt-3 text-sm text-red-600">Submit error: {submitError}</p>
        ) : null}
      </section>

      <section className="island-shell mt-8 rounded-2xl p-5 sm:p-6">
        <p className="island-kicker mb-3">Assessment transcript</p>
        <div className="max-h-[min(50vh,24rem)] space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            <p className="m-0 py-6 text-center text-sm text-(--sea-ink-soft)">
              Your assessment conversation will appear here once you begin.
            </p>
          ) : (
            messages.map(m => (
              <article
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'ml-4 rounded-2xl border border-[rgba(50,143,151,0.25)] bg-[rgba(79,184,178,0.14)] px-4 py-3.5 sm:ml-12'
                    : m.role === 'assistant'
                      ? 'mr-4 rounded-2xl border border-[rgba(23,58,64,0.12)] bg-white/60 px-4 py-3 sm:mr-12'
                      : 'rounded-2xl border border-(--chip-line) bg-(--chip-bg) px-4 py-3 text-center text-sm text-(--sea-ink-soft)'
                }
              >
                <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-(--sea-ink-soft)">
                  {m.role === 'assistant'
                    ? m.streaming
                      ? 'Assistant (streaming)'
                      : 'Assistant'
                    : m.role === 'user'
                      ? 'You'
                      : 'System'}
                </p>
                <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-(--sea-ink)">
                  {m.text}
                </p>
              </article>
            ))
          )}
        </div>
      </section>

      {scoreData ? (
        <section className="island-shell mt-8 rounded-2xl p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-(--sea-ink) sm:text-xl">
            Assessment Results
          </h2>

          {summary ? (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <article className="rounded-2xl border border-(--chip-line) bg-(--chip-bg) p-4 text-center">
                <p className="text-xs font-semibold tracking-wide text-(--sea-ink-soft) uppercase">
                  Orientation
                </p>
                <p className="mt-2 text-2xl font-bold text-(--sea-ink)">
                  {summary.orientationScore}/2
                </p>
              </article>
              <article className="rounded-2xl border border-(--chip-line) bg-(--chip-bg) p-4 text-center">
                <p className="text-xs font-semibold tracking-wide text-(--sea-ink-soft) uppercase">
                  Attention
                </p>
                <p className="mt-2 text-2xl font-bold text-(--sea-ink)">
                  {summary.attentionScore}/2
                </p>
              </article>
              <article className="rounded-2xl border border-(--chip-line) bg-(--chip-bg) p-4 text-center">
                <p className="text-xs font-semibold tracking-wide text-(--sea-ink-soft) uppercase">
                  Immediate Recall
                </p>
                <p className="mt-2 text-2xl font-bold text-(--sea-ink)">
                  {summary.immediateRecallScore}/1
                </p>
              </article>
              <article className="rounded-2xl border border-(--chip-line) bg-(--chip-bg) p-4 text-center">
                <p className="text-xs font-semibold tracking-wide text-(--sea-ink-soft) uppercase">
                  Total Score
                </p>
                <p className="mt-2 text-2xl font-bold text-(--sea-ink)">
                  {summary.totalScore}/5
                </p>
              </article>
            </div>
          ) : null}

          <div className="space-y-3">
            {scoreData.questions.map((q, index) => (
              <article
                key={`${q.question}-${index}`}
                className="rounded-2xl border border-(--chip-line) bg-(--chip-bg) p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-(--sea-ink) sm:text-base">
                    {q.question}
                  </h3>
                  <span
                    className={
                      q.correct
                        ? 'rounded-full border border-[rgba(76,175,80,0.35)] bg-[rgba(76,175,80,0.18)] px-3 py-1 text-xs font-semibold text-(--sea-ink)'
                        : 'rounded-full border border-[rgba(220,90,90,0.35)] bg-[rgba(255,200,200,0.26)] px-3 py-1 text-xs font-semibold text-(--sea-ink)'
                    }
                  >
                    {q.correct ? 'Correct' : 'Incorrect'}
                  </span>
                </div>
                <p className="mt-3 text-sm text-(--sea-ink-soft)">
                  <span className="font-semibold text-(--sea-ink)">
                    Your answer:
                  </span>{' '}
                  {q.userAnswer || 'No answer recorded'}
                </p>
                <p className="mt-1 text-sm text-(--sea-ink-soft)">
                  <span className="font-semibold text-(--sea-ink)">
                    Explanation:
                  </span>{' '}
                  {q.explanation}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}
