import { createFileRoute } from '@tanstack/react-router'

import {
  type StatusKind,
  useOpenAIRealtimeConversation,
} from '../hooks/useOpenAIRealtimeConversation'

export const Route = createFileRoute('/conversation')({
  component: ConversationPage,
})

function statusShellClass(kind: StatusKind): string {
  const base =
    'rounded-2xl border px-4 py-3 text-center text-sm font-medium transition-colors'
  switch (kind) {
    case 'listening':
      return `${base} border-[rgba(50,143,151,0.35)] bg-[rgba(79,184,178,0.12)] text-[var(--lagoon-deep)] animate-pulse`
    case 'processing':
      return `${base} border-[rgba(200,140,60,0.35)] bg-[rgba(255,200,120,0.12)] text-[var(--sea-ink)]`
    case 'speaking':
      return `${base} border-[rgba(100,80,140,0.25)] bg-[rgba(120,100,180,0.08)] text-[var(--sea-ink)]`
    case 'error':
      return `${base} border-[rgba(180,60,60,0.35)] bg-[rgba(255,200,200,0.2)] text-[var(--sea-ink)]`
    default:
      return `${base} border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--sea-ink-soft)]`
  }
}

function ConversationPage() {
  const {
    language,
    toggleLanguage,
    statusKind,
    statusText,
    messages,
    startConversation,
    stopConversation,
    connecting,
    sessionActive,
  } = useOpenAIRealtimeConversation()

  const busy = connecting || sessionActive
  const canStart = !busy
  const canStop = sessionActive || connecting

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />

        <h1 className="display-title mb-4 max-w-3xl text-3xl leading-[1.05] font-bold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
          Conversation mode
        </h1>
        <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
          Speak naturally with the realtime assistant. Microphone access is required.
        </p>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-[var(--sea-ink-soft)]">
            AI language
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => toggleLanguage()}
            className="rounded-full border border-[rgba(50,143,151,0.35)] bg-[rgba(79,184,178,0.12)] px-4 py-2 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.22)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {language === 'en' ? 'English 🇺🇸' : '中文 🇨🇳'}
          </button>
        </div>

        <div className={statusShellClass(statusKind)}>{statusText}</div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void startConversation()}
            className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting ? 'Connecting…' : 'Start conversation'}
          </button>
          <button
            type="button"
            disabled={!canStop}
            onClick={stopConversation}
            className="rounded-full border border-[rgba(180,80,80,0.35)] bg-[rgba(255,200,200,0.25)] px-5 py-2.5 text-sm font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5 hover:bg-[rgba(255,200,200,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            End conversation
          </button>
        </div>
      </section>

      <section className="island-shell mt-8 rounded-2xl p-5 sm:p-6">
        <p className="island-kicker mb-3">Transcript</p>
        <div className="max-h-[min(50vh,24rem)] space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            <p className="m-0 py-6 text-center text-sm text-[var(--sea-ink-soft)]">
              Your conversation will appear here once you start.
            </p>
          ) : (
            messages.map((m) => (
              <article
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'ml-4 rounded-2xl border border-[rgba(50,143,151,0.2)] bg-[rgba(79,184,178,0.08)] px-4 py-3 sm:ml-12'
                    : m.role === 'assistant'
                      ? 'mr-4 rounded-2xl border border-[rgba(23,58,64,0.12)] bg-white/60 px-4 py-3 sm:mr-12'
                      : 'rounded-2xl border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-3 text-center text-sm text-[var(--sea-ink-soft)]'
                }
              >
                <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--sea-ink-soft)]">
                  {m.role === 'user'
                    ? 'You'
                    : m.role === 'assistant'
                      ? m.streaming
                        ? 'Assistant (streaming)'
                        : 'Assistant'
                      : 'System'}
                </p>
                <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[var(--sea-ink)]">
                  {m.text}
                </p>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  )
}
