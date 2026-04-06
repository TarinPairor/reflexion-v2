import { useCallback, useRef, useState } from 'react'

const REALTIME_URL =
  'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17'

/** Default from original HTML when no custom silence delay: server VAD 2000ms. */
const DEFAULT_TURN_DETECTION = {
  type: 'server_vad' as const,
  threshold: 0.7,
  prefix_padding_ms: 300,
  silence_duration_ms: 2000,
}

export type ConversationLanguage = 'en' | 'zh'

export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatMessage = {
  id: string
  role: ChatRole
  text: string
  streaming?: boolean
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
  item?: {
    created_at?: string
    started_at?: string
    type?: string
  }
  created_at?: string
}

function instructionsForLanguage(lang: ConversationLanguage): string {
  if (lang === 'zh') {
    return '你是一个友好、乐于助人的 AI 伙伴。请保持回答简洁、自然，适合语音交流，并在合适的情况下主动维持对话的进行。每次回复控制在 2–3 句话以内。'
  }
  return 'You are a friendly, helpful AI companion. Keep responses concise and conversational, suitable for voice interaction, and try to keep the conversation going. Limit responses to 2–3 sentences.'
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

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  const handleMessage = useCallback(
    (message: RealtimePayload) => {
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
      } else if (
        message.type === 'conversation.item.input_audio_transcription.completed'
      ) {
        const transcript = message.transcript
        if (transcript) {
          addMessage('user', transcript)
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
          userSpeakingStartRef.current = message.item.created_at
            ? new Date(message.item.created_at).getTime()
            : Date.now()
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

    setSessionActive(false)
    setConnecting(false)
  }, [])

  const stopConversation = useCallback(() => {
    cleanupResources()
    updateStatus('idle', 'Conversation ended')
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
