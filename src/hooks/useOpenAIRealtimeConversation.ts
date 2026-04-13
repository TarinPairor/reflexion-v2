import { useCallback, useRef, useState } from 'react'
import { addConversationEntry } from '#/api/conversations';
import { conversationPrompt } from '#/constants/prompts';
import { REALTIME_URL, DEFAULT_TURN_DETECTION } from '#/constants/ai';


function metricsFromSegment(
  rawSeconds: number,
  wordCount: number,
): { durationDisplay: string; wordsPerSecond: number | null } {
  const vadTailSec = DEFAULT_TURN_DETECTION.silence_duration_ms / 1000
  const netSeconds = Math.max(0, rawSeconds - vadTailSec)
  const durationDisplay = `${netSeconds.toFixed(2)}s`
  const wordsPerSecond =
    netSeconds > 0 && wordCount > 0
      ? parseFloat((wordCount / netSeconds).toFixed(2))
      : null
  return { durationDisplay, wordsPerSecond }
}

export type ConversationLanguage = 'en' | 'zh'

export type ChatRole = 'system' | 'user' | 'assistant'

/** Shown under user bubbles: "6 words • Spoke for 4.10s • 1.46 words/sec" */
export type UserUtteranceMetrics = {
  wordCount: number
  /** Display like "4.10s" or "N/A" */
  durationDisplay: string
  wordsPerSecond: number | null
}

export type ChatMessage = {
  id: string
  role: ChatRole
  text: string
  streaming?: boolean
  userMetrics?: UserUtteranceMetrics
}

export type StatusKind =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error'

type RealtimePayload = {
  type: string
  delta?: string
  transcript?: string
  /** Server VAD: ms offset into session buffer when speech starts/stops */
  audio_start_ms?: number
  audio_end_ms?: number
  item?: {
    created_at?: string | number
    started_at?: string | number
    type?: string
  }
  created_at?: string | number
}

/** API may send ISO strings or Unix seconds/ms. */
function parseEventTime(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 10_000_000_000) return Math.round(value * 1000)
    return Math.round(value)
  }
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : t
  }
  return null
}

function instructionsForLanguage(lang: ConversationLanguage): string {
  return conversationPrompt[lang] || conversationPrompt['en']
}

export function useOpenAIRealtimeConversation() {
  const [language, setLanguage] = useState<ConversationLanguage>('en')
  const [statusKind, setStatusKind] = useState<StatusKind>('idle')
  const [statusText, setStatusText] = useState('Ready to start your conversation')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessionActive, setSessionActive] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const userAudioTrackRef = useRef<MediaStreamTrack | null>(null)
  const userStreamRef = useRef<MediaStream | null>(null)
  const serverAudioStreamRef = useRef<MediaStream | null>(null)

  const messageTextRef = useRef('')
  const streamingMsgIdRef = useRef<string | null>(null)
  const userSpeakingStartRef = useRef<number | null>(null)
  const aiResponseStartRef = useRef<number | null>(null)
  /** From input_audio_buffer.speech_started / speech_stopped — same timeline, best duration source */
  const utteranceAudioStartMsRef = useRef<number | null>(null)
  const utteranceAudioEndMsRef = useRef<number | null>(null)

  // Metrics refs to accumulate database metrics for start/stop time, user speaking duration, and user turn data
  const sessionStartTimeRef = useRef<number | null>(null)
  const totalSpeakingDurationRef = useRef<number>(0)
  const userMetricsRef = useRef<UserUtteranceMetrics[]>([])

  // Patch addUserMessage and handleMessage to store userMetrics, update totalSpeakingDurationRef
  const updateStatus = useCallback((kind: StatusKind, text: string) => {
    setStatusKind(kind)
    setStatusText(text)
  }, [])

  const removeStreamingAssistant = useCallback(() => {
    const id = streamingMsgIdRef.current
    streamingMsgIdRef.current = null
    if (!id) return
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const appendAssistantStreaming = useCallback((text: string) => {
    if (!streamingMsgIdRef.current) {
      const newId = crypto.randomUUID()
      streamingMsgIdRef.current = newId
      setMessages((prev) => [
        ...prev,
        {
          id: newId,
          role: 'assistant' as const,
          text,
          streaming: true,
        },
      ])
      return
    }
    const id = streamingMsgIdRef.current
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, text } : m)),
    )
  }, [])

  const addMessage = useCallback((role: ChatRole, text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role,
        text,
      },
    ])
  }, [])

  const addUserMessage = useCallback(
    (text: string, userMetrics: UserUtteranceMetrics) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'user' as const,
          text,
          userMetrics,
        },
      ])

      // We only store metrics if it's a normal finished user message:
      userMetricsRef.current.push(userMetrics)

      // Extract duration in seconds from string (e.g., "4.10s")
      if (userMetrics.durationDisplay && userMetrics.durationDisplay !== 'N/A') {
        const sec = parseFloat(userMetrics.durationDisplay)
        if (!isNaN(sec) && typeof sec === 'number') {
          totalSpeakingDurationRef.current += sec * 1000 // store in ms for calculations
        }
      }
    },
    [],
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    userMetricsRef.current = []
    totalSpeakingDurationRef.current = 0
  }, [])

  const handleMessage = useCallback(
    (message: RealtimePayload) => {
      if (import.meta.env.DEV) {
        const t = message.type
        if (
          (t && t.includes('input_audio')) ||
          (t && t.includes('transcription'))
        ) {
          const matchesLooseInputAudio =
            Boolean(t?.includes('input_audio')) && !t.includes('completed')
          console.log('[Realtime VAD/transcription]', t, {
            matchesLooseHtmlCheck: matchesLooseInputAudio,
            payload: message,
          })
        }
      }

      if (
        message.type === 'response.audio_transcript.delta' &&
        message.delta
      ) {
        messageTextRef.current += message.delta
        appendAssistantStreaming(messageTextRef.current)
      } else if (message.type === 'response.audio_transcript.done') {
        const final = messageTextRef.current
        messageTextRef.current = ''
        if (final) {
          removeStreamingAssistant()
          streamingMsgIdRef.current = null
          addMessage('assistant', final)
        }
        updateStatus('listening', 'Listening…')
      } else if (message.type === 'input_audio_buffer.speech_started') {
        utteranceAudioEndMsRef.current = null
        if (typeof message.audio_start_ms === 'number') {
          utteranceAudioStartMsRef.current = message.audio_start_ms
        }
        if (!userSpeakingStartRef.current) {
          userSpeakingStartRef.current = Date.now()
        }
        aiResponseStartRef.current = null
      } else if (message.type === 'input_audio_buffer.speech_stopped') {
        if (typeof message.audio_end_ms === 'number') {
          utteranceAudioEndMsRef.current = message.audio_end_ms
        }
      } else if (
        message.type === 'conversation.item.input_audio_transcription.started'
      ) {
        if (!userSpeakingStartRef.current) {
          userSpeakingStartRef.current = Date.now()
        }
        aiResponseStartRef.current = null
      } else if (
        message.type === 'conversation.item.input_audio_transcription.completed'
      ) {
        const transcript = message.transcript
        if (transcript) {
          const wordCount = transcript
            .trim()
            .split(/\s+/)
            .filter((w) => w.length > 0).length

          const transcriptionCompleteTime = Date.now()
          const bufStart = utteranceAudioStartMsRef.current
          const bufEnd = utteranceAudioEndMsRef.current
          utteranceAudioStartMsRef.current = null
          utteranceAudioEndMsRef.current = null

          let durationDisplay = 'N/A'
          let wordsPerSecond: number | null = null

          if (
            typeof bufStart === 'number' &&
            typeof bufEnd === 'number' &&
            bufEnd > bufStart
          ) {
            const rawSeconds = (bufEnd - bufStart) / 1000
            const m = metricsFromSegment(rawSeconds, wordCount)
            durationDisplay = m.durationDisplay
            wordsPerSecond = m.wordsPerSecond
          } else {
            let actualStartTime = userSpeakingStartRef.current

            if (!actualStartTime && message.item) {
              actualStartTime =
                parseEventTime(message.item.created_at) ??
                parseEventTime(message.item.started_at)
            }
            if (!actualStartTime) {
              actualStartTime = parseEventTime(message.created_at)
            }

            if (actualStartTime) {
              const aiStart = aiResponseStartRef.current
              const endTime =
                aiStart &&
                aiStart < transcriptionCompleteTime &&
                aiStart > actualStartTime
                  ? aiStart
                  : transcriptionCompleteTime
              const durationMs = endTime - actualStartTime
              if (durationMs > 0) {
                const rawSeconds = durationMs / 1000
                const m = metricsFromSegment(rawSeconds, wordCount)
                durationDisplay = m.durationDisplay
                wordsPerSecond = m.wordsPerSecond
              }
            }
          }

          addUserMessage(transcript, {
            wordCount,
            durationDisplay,
            wordsPerSecond,
          })
          updateStatus('processing', 'AI is thinking…')
        }
        userSpeakingStartRef.current = null
        aiResponseStartRef.current = null
      } else if (
        message.type === 'conversation.item.input_audio_transcription.delta' ||
        message.type === 'input_audio_transcription.delta' ||
        (message.type === 'conversation.item.input_audio_transcription' &&
          message.delta)
      ) {
        if (!userSpeakingStartRef.current) {
          userSpeakingStartRef.current = Date.now()
          aiResponseStartRef.current = null
        }
      } else if (
        message.type === 'conversation.item.created' &&
        message.item?.type === 'input_audio_transcription'
      ) {
        if (!userSpeakingStartRef.current) {
          userSpeakingStartRef.current =
            parseEventTime(message.item.created_at) ?? Date.now()
          aiResponseStartRef.current = null
        }
      } else if (
        message.type?.includes('input_audio') &&
        !message.type.includes('completed')
      ) {
        if (!userSpeakingStartRef.current) {
          userSpeakingStartRef.current = Date.now()
          aiResponseStartRef.current = null
        }
      } else if (message.type === 'response.audio.delta') {
        if (userSpeakingStartRef.current && !aiResponseStartRef.current) {
          aiResponseStartRef.current = Date.now()
        }
        updateStatus('speaking', 'AI is speaking…')
      } else if (message.type === 'response.audio.done') {
        updateStatus('listening', 'Listening…')
      }
    },
    [
      addMessage,
      addUserMessage,
      appendAssistantStreaming,
      removeStreamingAssistant,
      updateStatus,
    ],
  )

  const cleanupResources = useCallback(() => {
    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close()
      } catch {
        /* ignore */
      }
      dataChannelRef.current = null
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.getSenders().forEach((s) => {
        s.track?.stop()
      })
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }

    if (audioElementRef.current) {
      audioElementRef.current.pause()
      audioElementRef.current.srcObject = null
      audioElementRef.current.remove()
      audioElementRef.current = null
    }

    userStreamRef.current?.getTracks().forEach((t) => t.stop())
    userStreamRef.current = null
    userAudioTrackRef.current = null
    serverAudioStreamRef.current = null

    messageTextRef.current = ''
    streamingMsgIdRef.current = null
    userSpeakingStartRef.current = null
    aiResponseStartRef.current = null
    utteranceAudioStartMsRef.current = null
    utteranceAudioEndMsRef.current = null

    setSessionActive(false)
    setConnecting(false)
  }, [])

  function getConversationMetrics() {
    const sessionEndDate = new Date()
    const sessionEndTime = sessionEndDate.getTime()

    // Start time
    const sessionStartTime = sessionStartTimeRef.current

    // Duration in seconds
    const sessionDurationSec =
      sessionStartTime && sessionEndTime
        ? Math.max(0, Math.round((sessionEndTime - sessionStartTime) / 1000))
        : 0

    // Total user speaking duration (ms, tracked as sum)
    const userSpeakingMs = totalSpeakingDurationRef.current ?? 0

    // Average speech activity
    const speechActivity =
      sessionDurationSec > 0
        ? userSpeakingMs / 1000 / sessionDurationSec
        : 0

    // Words spoken: sum of wordCount across all user utterances
    const userMetrics = userMetricsRef.current
    const totalWords = userMetrics.reduce(
      (sum, m) => sum + (m.wordCount ?? 0),
      0,
    )

    // Average words/sec: accumulated average of all user utterance wordsPerSecond
    const avgSpeechRate =
      userMetrics.length > 0
        ? (
            userMetrics.reduce(
              (sum, m) => sum + (m.wordsPerSecond ?? 0),
              0,
            ) / userMetrics.length
          ).toFixed(2)
        : '0.00'

    // Helper: pad to 2 digits
    function pad2(n: number) {
      return n < 10 ? '0' + n : String(n)
    }
    const d = sessionEndDate
    // Format: 2026-01-14 21:27:21
    const formattedDate = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
      d.getDate(),
    )}`
    const formattedTime = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(
      d.getSeconds(),
    )}`


    return {
      date: formattedDate,
      time: formattedTime,
      duration: `${sessionDurationSec}s`,
      speechActivity: `${(speechActivity * 100).toFixed(1)}%`,
      avgSpeechRate: `${avgSpeechRate} words/sec`,
      wordsSpoken: totalWords,
    }
  }


  const stopConversation = useCallback(async () => {
    const metrics = getConversationMetrics()
    cleanupResources()
    updateStatus('idle', 'Conversation ended')
    if (typeof window !== 'undefined') {
      console.log(
        `Date\tTime\tDuration\tSpeech Activity\tAvg Speech Rate\tWords Spoken`,
      )
      console.log(
        `${metrics.date}\t${metrics.time}\t${metrics.duration}\t${metrics.speechActivity}\t${metrics.avgSpeechRate}\t${metrics.wordsSpoken}`,
      )

      // Persist conversation metrics to the database
      try {
        // Adapt metrics to match AddConversationInput type expected by API
        await addConversationEntry({
          data: {
            date: metrics.date,
            time: metrics.time,
            duration:
              typeof metrics.duration === 'string'
                ? parseInt(metrics.duration, 10) || 0
                : metrics.duration,
            speechActivity:
              typeof metrics.speechActivity === 'string'
                ? parseFloat(metrics.speechActivity) / 100
                : metrics.speechActivity,
            avgSpeechRate:
              typeof metrics.avgSpeechRate === 'string'
                ? parseFloat(metrics.avgSpeechRate)
                : metrics.avgSpeechRate,
            wordsSpoken: metrics.wordsSpoken,
          },
        })
      } catch (e) {
        console.error('Failed to save conversation entry:', e)
      }

      return metrics
    }
    return null
  }, [cleanupResources, updateStatus])

  const startConversation = useCallback(async () => {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY
    if (!apiKey) {
      window.alert(
        'Set VITE_OPENAI_API_KEY in your .env file (same value as your OpenAI API key).',
      )
      return
    }

    setConnecting(true)
    updateStatus('processing', 'Connecting…')

    try {
      const pc = new RTCPeerConnection()
      peerConnectionRef.current = pc

      const audioEl = document.createElement('audio')
      audioEl.autoplay = true
      audioEl.muted = false
      document.body.appendChild(audioEl)
      audioElementRef.current = audioEl

      pc.ontrack = (event: RTCTrackEvent) => {
        if (event.track.kind === 'audio' && event.streams[0]) {
          serverAudioStreamRef.current = event.streams[0]
          audioEl.srcObject = event.streams[0]
          void audioEl.play().catch((e: unknown) => {
            console.error('Audio play failed:', e)
          })
          updateStatus('speaking', 'AI is speaking…')
        }
      }

      const dc = pc.createDataChannel('oai-events', { ordered: true })
      dataChannelRef.current = dc

      dc.onopen = () => {
        setSessionActive(true)
        updateStatus('listening', 'Listening…')
        sessionStartTimeRef.current = Date.now()
        userMetricsRef.current = []
        totalSpeakingDurationRef.current = 0

        const sessionConfig = {
          modalities: ['text', 'audio'] as const,
          instructions: instructionsForLanguage(language),
          input_audio_transcription: { model: 'whisper-1' as const },
          turn_detection: DEFAULT_TURN_DETECTION,
        }

        dc.send(
          JSON.stringify({
            type: 'session.update',
            session: sessionConfig,
          }),
        )

        if (userAudioTrackRef.current) {
          userAudioTrackRef.current.enabled = true
        }
      }

      dc.onmessage = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as RealtimePayload
          handleMessage(parsed)
        } catch {
          /* ignore */
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      userStreamRef.current = stream
      const track = stream.getAudioTracks()[0]
      userAudioTrackRef.current = track
      pc.addTrack(track, stream)
      track.enabled = true

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpRes = await fetch(REALTIME_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/sdp',
        },
      })

      if (!sdpRes.ok) {
        const errText = await sdpRes.text()
        throw new Error(`SDP exchange failed: ${sdpRes.status} — ${errText}`)
      }

      const answerSdp = await sdpRes.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      clearMessages()
      addMessage('system', 'Connected. You can speak naturally.')
      setConnecting(false)
    } catch (err: unknown) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      cleanupResources()
      updateStatus('error', `Error: ${msg}`)
    }
  }, [
    addMessage,
    clearMessages,
    cleanupResources,
    handleMessage,
    language,
    updateStatus,
  ])

  const toggleLanguage = useCallback(() => {
    setLanguage((l) => (l === 'en' ? 'zh' : 'en'))
  }, [])

  return {
    language,
    toggleLanguage,
    statusKind,
    statusText,
    messages,
    startConversation,
    stopConversation,
    connecting,
    sessionActive,
  }
}
