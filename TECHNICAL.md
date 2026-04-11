# Reflexion — Technical Description
**Voice-Based Cognitive Screening Device**
Last updated: April 2026

---

## 1. Overview

Reflexion is a physical dementia screening prototype that conducts an automated
cognitive assessment through natural voice conversation. A Raspberry Pi Zero 2W
acts as the patient-facing device — no screen, no touch input, voice only. The
patient speaks with an AI assistant called Aria, which administers a structured
assessment, scores the responses in real time, and sends the results to a web
dashboard for clinicians to review.

The assessment is based on the Telephone Interview for Cognitive Status —
Modified (TICS-m) protocol, extended with free conversation segments to capture
natural speech for acoustic machine learning analysis.

---

## 2. Hardware

| Component | Details |
|---|---|
| Main device | Raspberry Pi Zero 2W |
| Audio module | Waveshare USB Sound Card (mic + speaker) |
| Sample rate | 44,100 Hz mono (hardware-locked) |
| Form factor | Headless — no screen, no keyboard |
| Network | Phone hotspot (Pi and Mac on same network) |
| Physical note | Speaker is approximately 10 cm from the microphone — causes echo, partially mitigated in software |

The Pi runs entirely without a display. All interaction is through the speaker
and microphone. The clinician's Mac hosts the backend servers and dashboard.

---

## 3. System Architecture

```
┌─────────────────────────────────┐       ┌──────────────────────────────┐
│   Raspberry Pi Zero 2W          │       │   Clinician's Mac            │
│                                 │       │                              │
│  pi_audio_bridge.py             │◄─────►│  node server.js  (port 3000) │
│  ├─ Mic capture (sounddevice)   │  HTTP │  python audio_server.py      │
│  ├─ Resample 44.1→24 kHz        │       │         (port 5001)          │
│  ├─ WebSocket → OpenAI          │       │  dashboard.html              │
│  ├─ Audio playback (speaker)    │       │  session_results.json        │
│  └─ WAV recording (patient only)│       └──────────────────────────────┘
└─────────────────────────────────┘
              │
              │ WebSocket (WSS)
              ▼
   OpenAI Realtime API
   (gpt-4o-realtime-preview-2024-12-17)
```

**Data flow per session:**
1. Pi captures mic audio and streams it to OpenAI Realtime API via WebSocket
2. OpenAI processes speech, generates Aria's voice responses, and returns audio
3. Pi plays Aria's voice through the speaker
4. Patient speech segments are recorded locally (AI voice excluded)
5. After the session ends, Pi POSTs the WAV file to the Mac Flask server for ML analysis
6. Flask server extracts acoustic features and returns an MCI/Healthy prediction
7. Pi POSTs all results (TICS-m scores + ML result) to the Mac Node server
8. Results are saved to `session_results.json` and displayed on the dashboard

---

## 4. Pi Audio Bridge (`pi_audio_bridge.py`)

This is the core script that runs on the Pi. It manages the full session lifecycle.

### 4.1 Audio Pipeline

The Waveshare USB audio module is hardware-locked at 44,100 Hz mono. OpenAI
Realtime API requires 24,000 Hz mono PCM16. The bridge resamples in both
directions on the fly using `scipy.signal.resample_poly` with a ratio of 80/147
(derived from GCD of 44,100 and 24,000).

- **Mic → OpenAI:** 44,100 Hz captured in 50 ms blocks (2,205 samples) → resampled to 24,000 Hz → base64-encoded → sent as `input_audio_buffer.append`
- **OpenAI → Speaker:** base64 PCM16 audio deltas received → decoded → resampled from 24,000 Hz to 44,100 Hz → queued for playback via sounddevice

### 4.2 Echo Prevention

Because the speaker and microphone are physically close, Aria's voice is picked
up by the mic. Three layers of protection prevent this from being sent back to
OpenAI as patient speech:

1. **`ai_speaking` flag** — set to True when audio playback begins, False when the buffer drains. Mic streaming is paused while this flag is True.
2. **Buffer drain check** — even after `ai_speaking` is cleared, mic streaming only resumes once the play buffer is confirmed empty (`len(self._play_buf) == 0`).
3. **30-second deadline** — the buffer drain wait has a 30-second timeout to prevent the system hanging if playback stalls.

The unmute trigger fires on `response.done` (once per complete AI response),
not on `response.audio.done` (which fires once per audio chunk, and would cause
the mic to briefly open between chunks mid-sentence).

### 4.3 Voice Activity Detection

OpenAI Server VAD is used (server-side, not local). The Pi streams raw mic
audio continuously and lets OpenAI detect when the patient starts and stops
speaking.

### 4.4 Watchdog

An asynchronous watchdog task runs throughout the session and handles two
failure scenarios:

**AI silence (Aria stops generating for >30 seconds):**
Injects a `[SYSTEM: Please continue...]` message and triggers a new
`response.create`. This recovers from cases where OpenAI stops without
completing the assessment.

**Patient silence (patient does not respond after Aria speaks):**
- 15 seconds of silence → Aria checks in ("Are you still there?")
- Another 15 seconds of silence → Aria is instructed to say goodbye and call `end_session_early`

### 4.5 OpenAI Function Calling

Aria uses two functions to report results back to the system:

**`submit_assessment_results`** — called at the end of a complete session.
- `tics_scores`: object containing per-question scores and total (0–7)
- `notes`: optional string for transcription issues observed

**`end_session_early`** — called when the session does not complete.
- `reason`: `"patient requested to leave"` or `"patient unresponsive"`
- `tics_scores`: same structure, with `null` for any questions not yet reached

### 4.6 Patient-Initiated Early End

If the patient says they want to leave, Aria asks once to confirm. Any
subsequent response (including repeating that they want to go) is treated as
confirmation. Aria then says a warm goodbye before calling `end_session_early`.
Partial sessions are saved to the dashboard with NIL shown for unanswered
questions and an ⚠ incomplete flag.

### 4.7 Recording

Patient speech is recorded in segments gated by OpenAI's VAD events
(`input_speech_started` / `input_speech_stopped`). Aria's voice is never
included — recording is blocked while `ai_speaking` is True. Segments are
concatenated at the end into a single `session_audio.wav` (44,100 Hz mono,
16-bit PCM).

### 4.8 Debug Logging

After each session, `session_debug.json` is saved locally with a timestamped
log of key events (response start/end, ai_speaking transitions, speech
detection, buffer state). The previous session's log is kept as
`session_debug_prev.json`.

---

## 5. Assessment Protocol

The assessment follows a 4-stage structure based on TICS-m.

### Stage 1 — Free Conversation (~2–3 minutes)
Aria introduces herself and engages the patient in warm open-ended conversation
(how they are feeling, hobbies, recent activities). Acts as a warm-up and
captures baseline natural speech for the ML model.

### Stage 2 — TICS-m Cognitive Questions

| # | Question | Points |
|---|---|---|
| Q1 | What is today's date? (day, month, year) | 1 |
| Q2 | What city or town are you in right now? | 1 |
| Q3 | Repeat digits forward: 8, 1, 4 | 1 |
| Q4 | Repeat digits backward: 6, 2, 9 | 1 |
| Q5 | Listen and remember: River, Chair, Mango (scored in Stage 4) | — |

### Stage 3 — Free Conversation (~3–4 minutes)
Aria resumes natural conversation. This is the delay period between word
introduction (Stage 2) and recall (Stage 4), mirroring the standard TICS-m
protocol. Also provides additional patient speech for the ML model.

### Stage 4 — Delayed Word Recall + Goodbye
Aria asks the patient to recall the three words from Stage 2. Each correctly
recalled word scores 1 point. Aria then says goodbye and calls
`submit_assessment_results`.

**Total TICS-m score: 0–7**

---

## 6. Scoring Rules

| Question | Rule |
|---|---|
| Date | 1 point if month and year are correct AND day is within ±1 day. Wrong month or year = 0 regardless. |
| City | 1 point for Singapore (or a named neighbourhood within Singapore). Strict — any other answer = 0. |
| Digits forward/backward | Lenient for transcription errors (e.g. "nine to six" = "9, 2, 6" still counts if intent is clear). |
| Word recall | 1 point per word (River/Chair/Mango), only if said during Stage 4. Words repeated in Stage 2 do not count. Lenient for transcription errors. |

---

## 7. ML Analysis (`audio_server.py`)

A Flask server on the Mac receives the patient WAV file and returns a
prediction.

### 7.1 Feature Extraction

Uses **openSMILE** with the **eGeMAPSv02** feature set (Functionals level) to
extract 7 acoustic features:

| Feature | Captures |
|---|---|
| F0semitoneFrom27.5Hz_sma3nz_amean | Mean pitch |
| F0semitoneFrom27.5Hz_sma3nz_stddevNorm | Pitch variability |
| loudness_sma3_amean | Mean loudness |
| loudness_sma3_stddevNorm | Loudness variability |
| HNRdBACF_sma3nz_amean | Harmonics-to-noise ratio (voice stability) |
| mfcc1_sma3_amean | Spectral envelope (MFCC 1) |
| mfcc2_sma3_amean | Spectral envelope (MFCC 2) |

### 7.2 Model

- **Algorithm:** Random Forest classifier
- **Training data:** DementiaBank dataset
- **Classes:** Healthy Control (HC) vs. Mild Cognitive Impairment (MCI)
- **Preprocessing:** StandardScaler (saved as `dementiabank_scaler.joblib`)
- **Model file:** `dementiabank_model.joblib`
- **Trained by:** Tarin Pairor — github.com/TarinPairor/tigerlaunch

### 7.3 API Endpoints

`POST /analyze` — accepts WAV file as multipart form data, returns:
```json
{
  "prediction": "MCI",
  "probabilities": { "HC": 0.11, "MCI": 0.89 },
  "status": "success"
}
```

`GET /health` — returns model load status.

---

## 8. Dashboard (`server.js` + `dashboard.html`)

The Node.js server (port 3000) serves the web dashboard and exposes a REST API.

### 8.1 Session Results

`POST /save-results` — Pi POSTs session results here after each session. The
server appends to `session_results.json` (array format — all past sessions are
kept).

`GET /get-results` — returns the full array of all past sessions.

### 8.2 Dashboard Display

The Live Sessions tab shows all past sessions, newest first. Each session is
expandable and shows:

- Timestamp
- TICS-m score with colour coding: green (6–7), yellow (4–5), red (0–3)
- ML prediction: green (Healthy) or red (MCI) with probability
- Per-question breakdown (✅ / ❌ / NIL)
- ⚠ Incomplete session flag and early end reason for partial sessions

---

## 9. Network Setup

The Pi and Mac must be on the same network during sessions (phone hotspot
recommended).

- Mac IP stored on Pi as `MAC_IP` in `~/.env` (check with `ipconfig getifaddr en0`)
- Pi accessible at `ssh pi@reflexion.local`
- Pi virtualenv at `~/reflexion-env/`
- Pi script at `~/pi_audio_bridge.py`

---

## 10. Running a Session

**Mac — first time only:**
Double-click `setup.command` — installs Homebrew, Node.js, Python packages, and
creates `.env` with API key prompt.

**Mac — every session:**
Double-click `start.command` — starts both servers and opens the dashboard.

**Pi — every session:**
```bash
# Only needed if pi_audio_bridge.py was updated:
scp /Users/justinwong/tigerlaunch/pi_audio_bridge.py pi@reflexion.local:~/pi_audio_bridge.py

ssh pi@reflexion.local
source ~/reflexion-env/bin/activate && python ~/pi_audio_bridge.py
```

Wait for "All done." in the Pi terminal. View results at
`http://localhost:3000/dashboard` → Live Sessions tab.

---

## 11. Known Limitations

| Issue | Cause | Status |
|---|---|---|
| Occasional tail-end echo | Speaker physically close to mic | Hardware fix planned (extend speaker wire) |
| Transcription errors | Whisper mishears short/accented words | Lenient scoring rules partially compensate |
| RF interference | USB audio module picks up radio noise | Hardware limitation, no software fix |
| Language detection | Occasionally picks wrong language | Not restricted to English (Singapore is multilingual) |
| ML accuracy | 65% overall (HC recall 0.50, MCI recall 0.89) | Larger dataset planned (target >80%) |

---

## 12. Planned Improvements

- Deploy dashboard to Vercel (publicly accessible URL)
- Add patient name/ID field to sessions
- Pi auto-start on boot (eliminate need for SSH per session)
- Extend speaker wire to reduce echo
- Improve ML model with full DementiaBank dataset (target >80% accuracy)
