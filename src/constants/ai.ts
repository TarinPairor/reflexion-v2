export const REALTIME_URL =
  'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17'

/** Default from original HTML when no custom silence delay: server VAD 2000ms. */
export const DEFAULT_TURN_DETECTION = {
  type: 'server_vad' as const,
  threshold: 0.7,
  prefix_padding_ms: 300,
  silence_duration_ms: 2000,
}