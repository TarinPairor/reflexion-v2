import { useCallback, useRef, useState } from 'react'
import { REALTIME_URL, DEFAULT_TURN_DETECTION } from '#/constants/ai';


export type AssessmentLanguage = 'en' | 'zh'
export type AssessmentMessageRole = 'system' | 'assistant' | 'user'

export type AssessmentStatusKind =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error'
  | 'scoring'
  | 'countdown'

type RealtimePayload = {
  type: string
  delta?: string
  transcript?: string
}

export type AssessmentMessage = {
  id: string
  role: AssessmentMessageRole
  text: string
  streaming?: boolean
}

type QuestionScore = {
  question: string
  category: string
  userAnswer: string
  correct: boolean
  score: number
  explanation: string
}

type ScoreSummary = {
  orientationScore: number
  attentionScore: number
  immediateRecallScore: number
  totalScore: number
}

export type AssessmentScoreData = {
  questions: QuestionScore[]
  summary: ScoreSummary
}

function getTodayDateString(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function ticsInstructionsForLanguage(lang: AssessmentLanguage): string {
  const todayDate = getTodayDateString()
  if (lang === 'zh') {
    return `你正在进行一次 TICS-m（修订版电话认知状态访谈）评估。请严格按照以下脚本执行，并遵守以下规则：

【重要规则】
- 1) 不要告诉用户他们的回答是“正确/错误”（不要评价对错）。
- 2) 除了“今天是几号？”这一题以外：只要对方的回答听得清楚、且与问题有一定关联（即使内容不正确，例如把词/数字顺序说错、说成别的词等），都不要追问，直接进入下一题。
- 3) 只有在回答完全无法理解或与问题毫无关联时才请对方重复（例如：长时间沉默、听不清、胡乱噪音、完全不相关的随机词且无法判断是在回答什么）。

首先说：
"首先，问您几个简短的问题。"

定向力问题（每个问题后都要等待对方回答）：

"今天是几号？"
（正确答案应与：${todayDate} 一致）。
如果他们只说了日期的一部分（例如只说星期，或只说日期 + 月份），请提示他们补充缺失的部分后再继续。
注意：这里可以提示他们补全年份/月份/日期，但仍不要说他们“对/错”。

"我们现在所在的城市是哪里？"
（正确答案是：新加坡）

注意力问题（每个问题后都要等待对方回答）：

"我将说几个数字，请您重复一遍：8–1–4。"
（正确答案：8，1，4）

"现在请您把这些数字倒着说一遍：6–2–9。"
（正确答案：9，2，6）

即时回忆：

"我将说三个词，请您现在重复一遍：河流，椅子，芒果。"
（等待他们重复全部三个词）

在每个问题之后，请等待用户给出完整回答后再继续。
保持耐心和友好的态度。
你的回应要简短，只需中性确认（例如“好的/明白了/谢谢”）然后进入下一题。
如果他们的回答听不清或无法理解，才请他们重复一遍答案。`
  }

  return `You are conducting a TICS-m (Telephone Interview for Cognitive Status-modified) assessment. Follow this script exactly, and obey these rules:

IMPORTANT RULES
- 1) Do NOT tell the user whether they are correct or incorrect (no correctness feedback).
- 2) For EVERYTHING except the "What is today's date?" question: if the answer is intelligible and appears to be an attempt related to the question (even if wrong, e.g., wrong order like "dog, mango, river" or saying the digits incorrectly), do NOT ask again-acknowledge neutrally and move on.
- 3) Only ask them to repeat if the response is completely unintelligible or clearly unrelated to the question (e.g., silence, inaudible audio, gibberish/noise, random words with no connection).

1. First say: "First, a few quick questions."

2. Orientation questions (wait for response after each):
   - "What is today's date?" (The correct answer should match: ${todayDate}). If they say only part of the date (ie Day, Day + Month) urge them to complete the missing component before moving on.
     Note: You may prompt for missing components here (e.g., ask for the year), but still do not say whether they are correct/incorrect.
   - "What city are we in right now?" (The correct answer is: Singapore)

3. Attention questions (wait for response after each):
   - "I'm going to say some digits. Please repeat them back to me: 8-1-4." (Correct: 8, 1, 4)
   - "Now repeat these backwards: 6-2-9." (Correct: 9, 2, 6 backwards)

4. Immediate recall:
   - "I'll say three words. Please repeat them now: river, chair, mango." (Wait for them to repeat all three words)

After each question, wait for the user's complete response before proceeding. Be patient and friendly. Keep your responses brief, use neutral acknowledgements (e.g., "Okay," "Thanks," "I see"), then move to the next question. If they say something unintelligible or unrelated, ask them to repeat.`
}

function scorePromptForConversation(
  conversationHistory: { role: AssessmentMessageRole; content: string }[],
): string {
  const todayDate = getTodayDateString()
  return `You are scoring a TICS-m cognitive assessment. Analyze the conversation and provide scores for each question.

The conversation transcript:
${conversationHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')}

Expected correct answers:
1. Today's date: Should match ${todayDate}
2. City: Singapore
3. Digits forward (8-1-4): Should be "8, 1, 4" or "814" or similar
4. Digits backward (6-2-9): Should be "9, 2, 6" backwards or "926" backwards or similar
5. Three words: Should include "river", "chair", and "mango"

Please provide a JSON response with this exact structure:
{
  "questions": [
    {
      "question": "What is today's date?",
      "category": "Orientation",
      "userAnswer": "[extracted answer]",
      "correct": true/false,
      "score": 1 or 0,
      "explanation": "Brief explanation of why correct/incorrect"
    },
    {
      "question": "What city are we in right now?",
      "category": "Orientation",
      "userAnswer": "[extracted answer]",
      "correct": true/false,
      "score": 1 or 0,
      "explanation": "Brief explanation"
    },
    {
      "question": "Repeat digits forward: 8-1-4",
      "category": "Attention",
      "userAnswer": "[extracted answer]",
      "correct": true/false,
      "score": 1 or 0,
      "explanation": "Brief explanation"
    },
    {
      "question": "Repeat digits backward: 6-2-9",
      "category": "Attention",
      "userAnswer": "[extracted answer]",
      "correct": true/false,
      "score": 1 or 0,
      "explanation": "Brief explanation"
    },
    {
      "question": "Repeat three words: river, chair, mango",
      "category": "Immediate Recall",
      "userAnswer": "[extracted answer]",
      "correct": true/false,
      "score": 1 or 0,
      "explanation": "Brief explanation. Note: all three words must be present for correct"
    }
  ],
  "summary": {
    "orientationScore": 0-2,
    "attentionScore": 0-2,
    "immediateRecallScore": 0-1,
    "totalScore": 0-5
  }
}

Return ONLY valid JSON, no other text.`
}

export function useOpenAIRealtimeAssessment() {
  const [language, setLanguage] = useState<AssessmentLanguage>('en')
  const [statusKind, setStatusKind] = useState<AssessmentStatusKind>('idle')
  const [statusText, setStatusText] = useState('Ready to begin your assessment')
  const [messages, setMessages] = useState<AssessmentMessage[]>([])
  const [connecting, setConnecting] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [scoreData, setScoreData] = useState<AssessmentScoreData | null>(null)

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const userStreamRef = useRef<MediaStream | null>(null)
  const messageTextRef = useRef('')
  const streamingIdRef = useRef<string | null>(null)
  const countdownRef = useRef<number | null>(null)
  const conversationHistoryRef = useRef<
    { role: AssessmentMessageRole; content: string }[]
  >([])

  const updateStatus = useCallback((kind: AssessmentStatusKind, text: string) => {
    setStatusKind(kind)
    setStatusText(text)
  }, [])

  const clearCountdown = useCallback(() => {
    if (countdownRef.current != null) {
      window.clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  const appendMessage = useCallback((role: AssessmentMessageRole, text: string) => {
    setMessages(prev => [
      ...prev,
      { id: crypto.randomUUID(), role, text, streaming: false },
    ])
  }, [])

  const appendAssistantStreaming = useCallback((text: string) => {
    if (!streamingIdRef.current) {
      const newId = crypto.randomUUID()
      streamingIdRef.current = newId
      setMessages(prev => [
        ...prev,
        { id: newId, role: 'assistant', text, streaming: true },
      ])
      return
    }

    const id = streamingIdRef.current
    setMessages(prev => prev.map(msg => (msg.id === id ? { ...msg, text } : msg)))
  }, [])

  const finalizeAssistantStreaming = useCallback(() => {
    const id = streamingIdRef.current
    const final = messageTextRef.current.trim()
    messageTextRef.current = ''
    streamingIdRef.current = null

    if (!id) {
      if (final) {
        appendMessage('assistant', final)
        conversationHistoryRef.current.push({ role: 'assistant', content: final })
      }
      return
    }

    setMessages(prev => prev.filter(msg => msg.id !== id))
    if (final) {
      appendMessage('assistant', final)
      conversationHistoryRef.current.push({ role: 'assistant', content: final })
    }
  }, [appendMessage])

  const showCountdown = useCallback(() => {
    clearCountdown()
    let count = 3
    updateStatus('countdown', String(count))

    countdownRef.current = window.setInterval(() => {
      count -= 1
      if (count > 0) {
        updateStatus('countdown', String(count))
        return
      }

      clearCountdown()
      updateStatus('listening', 'Listening...')
    }, 1000)
  }, [clearCountdown, updateStatus])

  const handleRealtimeMessage = useCallback(
    (message: RealtimePayload) => {
      if (message.type === 'response.audio_transcript.delta' && message.delta) {
        messageTextRef.current += message.delta
        appendAssistantStreaming(messageTextRef.current)
      } else if (message.type === 'response.audio_transcript.done') {
        finalizeAssistantStreaming()
        showCountdown()
      } else if (
        message.type === 'conversation.item.input_audio_transcription.completed'
      ) {
        const transcript = message.transcript?.trim()
        if (!transcript) return

        appendMessage('user', transcript)
        conversationHistoryRef.current.push({ role: 'user', content: transcript })
        updateStatus('processing', 'AI is thinking...')
      } else if (message.type === 'response.audio.delta') {
        clearCountdown()
        updateStatus('speaking', 'AI is speaking...')
      } else if (message.type === 'response.audio.done') {
        updateStatus('listening', 'Listening...')
      }
    },
    [
      appendAssistantStreaming,
      appendMessage,
      clearCountdown,
      finalizeAssistantStreaming,
      showCountdown,
      updateStatus,
    ],
  )

  const getApiKey = useCallback(() => {
    return import.meta.env.VITE_OPENAI_API_KEY as string | undefined
  }, [])

  const cleanupSession = useCallback(() => {
    clearCountdown()

    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close()
      } catch {
        // no-op
      }
      dataChannelRef.current = null
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.getSenders().forEach(sender => sender.track?.stop())
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }

    if (audioElementRef.current) {
      audioElementRef.current.pause()
      audioElementRef.current.srcObject = null
      audioElementRef.current.remove()
      audioElementRef.current = null
    }

    userStreamRef.current?.getTracks().forEach(track => track.stop())
    userStreamRef.current = null

    messageTextRef.current = ''
    streamingIdRef.current = null
    setSessionActive(false)
    setConnecting(false)
  }, [clearCountdown])

  const startAssessment = useCallback(async () => {
    const apiKey = getApiKey()
    if (!apiKey) {
      window.alert('Set VITE_OPENAI_API_KEY in your .env file.')
      return
    }

    setConnecting(true)
    setScoreData(null)
    updateStatus('processing', 'Connecting...')

    try {
      conversationHistoryRef.current = []
      setMessages([])
      appendMessage(
        'system',
        'Assessment started. Please listen carefully and answer each question naturally.',
      )

      const pc = new RTCPeerConnection()
      peerConnectionRef.current = pc

      const audioEl = document.createElement('audio')
      audioEl.autoplay = true
      audioEl.muted = false
      document.body.appendChild(audioEl)
      audioElementRef.current = audioEl

      pc.ontrack = (event: RTCTrackEvent) => {
        if (event.track.kind === 'audio' && event.streams[0]) {
          audioEl.srcObject = event.streams[0]
          void audioEl.play().catch(() => undefined)
          updateStatus('speaking', 'AI is speaking...')
        }
      }

      const dc = pc.createDataChannel('oai-events', { ordered: true })
      dataChannelRef.current = dc

      dc.onopen = () => {
        setSessionActive(true)
        updateStatus('speaking', 'AI is speaking...')
        const sessionConfig = {
          modalities: ['text', 'audio'] as const,
          instructions: ticsInstructionsForLanguage(language),
          input_audio_transcription: { model: 'whisper-1' as const },
          turn_detection: DEFAULT_TURN_DETECTION,
        }
        dc.send(
          JSON.stringify({
            type: 'session.update',
            session: sessionConfig,
          }),
        )
      }

      dc.onmessage = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as RealtimePayload
          handleRealtimeMessage(parsed)
        } catch {
          // ignore malformed events
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      userStreamRef.current = stream
      const track = stream.getAudioTracks()[0]
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
        const errorText = await sdpRes.text()
        throw new Error(`SDP exchange failed: ${sdpRes.status} - ${errorText}`)
      }

      const answerSdp = await sdpRes.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      setConnecting(false)
    } catch (error: unknown) {
      cleanupSession()
      updateStatus(
        'error',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }, [
    appendMessage,
    cleanupSession,
    getApiKey,
    handleRealtimeMessage,
    language,
    updateStatus,
  ])

  const scoreAssessment = useCallback(async () => {
    const apiKey = getApiKey()
    if (!apiKey) {
      updateStatus('error', 'API key missing for scoring')
      return
    }

    if (conversationHistoryRef.current.length === 0) {
      updateStatus('idle', 'Assessment ended')
      return
    }

    setScoring(true)
    updateStatus('scoring', 'Scoring assessment...')

    try {
      const scoringPrompt = scorePromptForConversation(conversationHistoryRef.current)
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content:
                'You are a cognitive assessment scoring expert. Always return valid JSON only.',
            },
            { role: 'user', content: scoringPrompt },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Scoring failed')
      }

      const payload = await response.json()
      const parsed = JSON.parse(payload.choices[0].message.content) as AssessmentScoreData
      setScoreData(parsed)
      updateStatus('idle', 'Assessment complete')
    } catch (error: unknown) {
      updateStatus(
        'error',
        `Scoring error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setScoring(false)
    }
  }, [getApiKey, updateStatus])

  const stopAssessment = useCallback(async () => {
    cleanupSession()
    await scoreAssessment()
  }, [cleanupSession, scoreAssessment])

  const toggleLanguage = useCallback(() => {
    setLanguage(prev => (prev === 'en' ? 'zh' : 'en'))
  }, [])

  return {
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
  }
}
