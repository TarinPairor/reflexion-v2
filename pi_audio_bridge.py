#!/usr/bin/env python3
"""
pi_audio_bridge.py — Reflexion headless audio bridge for Raspberry Pi Zero 2W

Captures mic audio → streams to OpenAI Realtime API → plays back AI voice →
records patient speech → sends recording to Flask ML server → pushes results
to the Mac dashboard.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SETUP (run these once on the Pi before first use)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  sudo apt-get install -y libportaudio2 portaudio19-dev
  pip install websockets sounddevice scipy numpy requests python-dotenv

USAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  python pi_audio_bridge.py

The script reads your .env file automatically (same format as server.js).
Make sure .env contains:
    OPENAI_API_KEY=sk-...
    MAC_IP=172.20.10.x       <-- your Mac's IP on the shared hotspot
"""

import asyncio
import base64
import json
import logging
import os
import signal
import sys
import threading
import wave
from datetime import datetime
from pathlib import Path

import numpy as np
import requests
import sounddevice as sd
import websockets
from scipy.signal import resample_poly

# ── Load .env file (same one used by server.js) ───────────────────────────────
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

# ── CONFIG ────────────────────────────────────────────────────────────────────
# These are read from the .env file above.
# If you need to override one, you can edit the value after the "or" below.

OPENAI_API_KEY  = os.environ.get("OPENAI_API_KEY",  "")
MAC_IP          = os.environ.get("MAC_IP",           "172.20.10.1")  # <-- edit if needed
AUDIO_DEVICE    = os.environ.get("AUDIO_DEVICE",     "")             # e.g. "USB Audio"
MAX_SESSION_MIN = int(os.environ.get("MAX_SESSION_MIN", "25"))

FLASK_URL            = f"http://{MAC_IP}:5001/analyze"
NODE_URL             = f"http://{MAC_IP}:3000"
SESSION_RESULTS_FILE = "session_results.json"
DEBUG_LOG_FILE       = "session_debug.json"       # latest session (overwritten)
DEBUG_LOG_FILE_PREV  = "session_debug_prev.json"  # previous session

# ── AUDIO SETTINGS ────────────────────────────────────────────────────────────
# Hardware is locked at 44.1 kHz mono (Waveshare USB module).
# OpenAI Realtime API requires 24 kHz mono PCM16.
# We resample between the two on the fly.

MIC_RATE   = 44100   # microphone sample rate (hardware-locked)
MIC_CH     = 1       # mono mic
SPK_RATE   = 44100   # speaker sample rate (same device)
SPK_CH     = 1       # mono speaker (hardwired to left channel)
BLOCK_MS   = 50      # how often sounddevice calls our audio functions (ms)
BLOCK_SIZE = int(MIC_RATE * BLOCK_MS / 1000)   # = 2205 samples per block

OPENAI_RATE = 24000  # OpenAI expects this sample rate
# Resample math: gcd(44100, 24000) = 300  →  up = 80, down = 147
_R_UP   = 80
_R_DOWN = 147

OPENAI_WS_URL = (
    "wss://api.openai.com/v1/realtime"
    "?model=gpt-4o-realtime-preview-2024-12-17"
)

# ── LOGGING ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("reflexion")

# ── SYSTEM PROMPT (instructions given to the AI) ─────────────────────────────
SYSTEM_PROMPT = """
You are a warm, patient clinical assistant named Aria, conducting the Reflexion
cognitive screening assessment on behalf of a healthcare team. The patient
cannot see a screen — this is a voice-only interaction. Speak clearly and at a
comfortable pace suitable for an elderly patient. Never rush. Be encouraging
and warm throughout.

IMPORTANT RULES:
- Do NOT tell the patient whether their answers are correct or incorrect.
- Complete ALL FOUR stages fully in order. Do not skip any stage or any question.
- Do NOT call submit_assessment_results until you have: completed Stage 1 free
  conversation, asked ALL FIVE questions in Stage 2 (Q1 through Q5 including the
  three-word repetition), completed Stage 3 free conversation, asked the delayed
  word recall in Stage 4, said the full goodbye. Only then call submit_assessment_results.
- If anything interrupts you mid-sentence, continue from where you left off.
  Never skip ahead or end early.
- SCORING — DATE: The patient gets 1 point if they give the correct month and
  year, and their day is within ±1 day of the actual date. Be strict on month
  and year — wrong month or wrong year = 0 points regardless.
- SCORING — CITY: The expected answer is Singapore. Any answer that is not
  Singapore (or a neighbourhood within Singapore) scores 0. Be strict.
- SCORING — DIGITS FORWARD AND BACKWARD: Be lenient for transcription errors.
  The speech-to-text system may mishear numbers — for example "nine two six"
  may appear as "9 to 6" or "nine to six". Use context to judge correctness —
  if the patient clearly attempted the right answer, give credit even if the
  wording looks slightly off.
- SCORING — WORD RECALL: Only give credit for river, chair, and mango if the
  patient says each word AFTER you ask them to recall the words in Stage 4.
  Do NOT give credit based on the patient repeating the words in Stage 2 when
  you first introduced them — that is immediate repetition, not delayed recall.
  Be lenient for transcription errors (e.g. "mango" heard as "man go" still
  counts), but only if said during the Stage 4 recall.
- WORD RECALL CLARIFICATION: If the patient's recall answer seems cut off or
  incomplete, gently ask: "Sorry, could you say those words again for me?"
  before scoring.
- EARLY END — PATIENT REQUEST: If the patient says they want to leave or stop
  (e.g. "I need to go", "I'm done", "end the session", "bye"), respond with
  exactly: "Of course, I completely understand. Just to confirm — would you
  like to end today's session?" Then wait for their reply.
  - If they say yes, or repeat that they want to leave (e.g. "yes", "I gotta
    go", "yep", "please"), treat that as confirmation. Say a warm, brief
    goodbye (e.g. "It was lovely chatting with you. Take care and have a
    wonderful day!"), then immediately call end_session_early with whatever
    scores you have so far, using null for questions not yet reached.
  - If they say no or seem unsure, continue the session normally.
  - Do NOT ask for confirmation a second time — once you have asked, the next
    response is always treated as their answer.
- EARLY END — SYSTEM PROMPT: If you receive a [SYSTEM: ...] message instructing
  you to check on the patient or end the session, follow those instructions
  immediately and precisely.

════════════════════════════════════════
STAGE 1 — FREE CONVERSATION (~2-3 minutes)
════════════════════════════════════════
Begin by warmly greeting the patient. Introduce yourself as Aria. Have a
natural, friendly conversation — ask how they are feeling today, what they have
been up to recently, what they enjoy doing. Keep it light and warm.

After approximately 2-3 minutes, transition naturally:
"That's lovely to hear. Now I'd like to ask you a few simple questions if
that's alright with you."

════════════════════════════════════════
STAGE 2 — TICS-m COGNITIVE QUESTIONS
════════════════════════════════════════
Ask each question one at a time. Wait for the full response before continuing.

Q1: "What is today's date? Please tell me the day, month, and year."
Q2: "What city or town are you in right now?"
Q3: "I'll read you some numbers. Please repeat them back in the same order.
     Ready? Eight... one... four."
Q4: "Now I'll read three numbers, and I'd like you to say them back in reverse —
     backwards. Ready? Six... two... nine."
Q5: "I'm going to say three words. Please listen carefully and try to remember
     them — I'll ask about them again later. The words are:
     River... Chair... Mango.
     Can you repeat those three words back to me now?"

After Q5, transition warmly back to conversation:
"Wonderful, thank you so much. Let's just have a bit more of a chat."

════════════════════════════════════════
STAGE 3 — FREE CONVERSATION (~3-4 minutes)
════════════════════════════════════════
Continue with warm, natural conversation for another 3-4 minutes. Ask about
their family, hobbies, favourite foods, happy memories, or anything they seem
enthusiastic about. Keep it relaxed and enjoyable for the patient.

════════════════════════════════════════
STAGE 4 — DELAYED WORD RECALL + GOODBYE
════════════════════════════════════════
After approximately 3-4 minutes of conversation, transition naturally:
"Now — do you remember the three words I asked you to remember earlier?"

Wait for their response.

Then say: "Wonderful. Thank you so much for taking part in today's session.
You have been absolutely wonderful, and I really appreciate your time.
Have a lovely rest of your day. Goodbye!"

Immediately after the goodbye, call submit_assessment_results with your scores.
""".strip()

# ── TOOL: the AI calls this when the assessment is finished ───────────────────
# This is how the script knows the assessment is done and what the scores are.
TOOLS = [
    {
        "type": "function",
        "name": "submit_assessment_results",
        "description": (
            "Submit the final TICS-m scores after completing all three stages "
            "of the assessment. Call this immediately after saying goodbye."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tics_scores": {
                    "type": "object",
                    "description": "Score for each TICS-m question (1 = correct, 0 = incorrect)",
                    "properties": {
                        "date_orientation":       {"type": "integer", "minimum": 0, "maximum": 1,
                                                   "description": "1 if day, month, and year all correct"},
                        "city_orientation":        {"type": "integer", "minimum": 0, "maximum": 1},
                        "digits_forward":          {"type": "integer", "minimum": 0, "maximum": 1,
                                                   "description": "1 if repeated 8-1-4 correctly"},
                        "digits_backward":         {"type": "integer", "minimum": 0, "maximum": 1,
                                                   "description": "1 if said 9-2-6 correctly"},
                        "three_word_recall_river": {"type": "integer", "minimum": 0, "maximum": 1},
                        "three_word_recall_chair": {"type": "integer", "minimum": 0, "maximum": 1},
                        "three_word_recall_mango": {"type": "integer", "minimum": 0, "maximum": 1},
                        "total":                   {"type": "integer", "minimum": 0, "maximum": 7},
                    },
                    "required": [
                        "date_orientation", "city_orientation",
                        "digits_forward", "digits_backward",
                        "three_word_recall_river", "three_word_recall_chair",
                        "three_word_recall_mango", "total",
                    ],
                },
                "notes": {
                    "type": "string",
                    "description": "Optional brief clinical observations",
                },
            },
            "required": ["tics_scores"],
        },
    },
    {
        "type": "function",
        "name": "end_session_early",
        "description": (
            "End the session early because the patient needs to leave or is "
            "unresponsive. Use null for any TICS-m questions not yet reached."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Why the session ended early (e.g. 'patient requested to leave', 'patient unresponsive')",
                },
                "tics_scores": {
                    "type": "object",
                    "description": "Partial TICS-m scores — use null for questions not yet reached",
                    "properties": {
                        "date_orientation":        {"type": ["integer", "null"]},
                        "city_orientation":         {"type": ["integer", "null"]},
                        "digits_forward":           {"type": ["integer", "null"]},
                        "digits_backward":          {"type": ["integer", "null"]},
                        "three_word_recall_river":  {"type": ["integer", "null"]},
                        "three_word_recall_chair":  {"type": ["integer", "null"]},
                        "three_word_recall_mango":  {"type": ["integer", "null"]},
                        "total":                    {"type": ["integer", "null"]},
                    },
                },
                "notes": {
                    "type": "string",
                    "description": "Optional brief notes about why the session ended early",
                },
            },
            "required": ["reason"],
        },
    },
]


# ── AUDIO BRIDGE ──────────────────────────────────────────────────────────────

class AudioBridge:
    """
    Manages the full lifecycle of one screening session:
      1. Opens mic + speaker via sounddevice
      2. Connects to OpenAI Realtime API via WebSocket
      3. Streams mic audio to OpenAI; plays AI responses through speaker
      4. Records patient speech segments (not AI speech)
      5. On assessment completion: saves WAV, runs ML, pushes results
    """

    def __init__(self):
        self.loop          = None
        self.ws            = None
        self.session_done  = None   # asyncio.Event — set when assessment ends
        self.shutdown_req  = None   # asyncio.Event — set on Ctrl+C / kill signal
        self.mic_q         = None   # asyncio.Queue — mic audio chunks

        # State flags (accessed from both asyncio thread and sounddevice thread)
        self.ai_speaking       = False   # True while AI audio is playing
        self._recording_active = False   # True while patient VAD speech detected

        # Playback buffer: filled by asyncio, drained by sounddevice callback
        self._play_buf  = bytearray()
        self._play_lock = threading.Lock()

        # Recording buffers: filled by sounddevice, read after session ends
        self._seg_lock = threading.Lock()
        self._cur_seg  = []   # chunks for the current speech utterance
        self._all_segs = []   # completed utterance segments

        # Session results
        self.session_start  = None
        self.tics_scores    = None
        self.assess_notes   = ""
        self._fn_buf        = {}   # call_id → accumulated JSON string for function calls
        self._session_started = False  # only trigger greeting once
        self._playback_done_task = None  # track the unmute countdown task
        self._debug_log = []             # list of events logged this session

        # Patient silence detection
        self._aria_finished_time        = None   # when ai_speaking last went False
        self._patient_spoken_since_aria = False  # True once patient speaks after Aria
        self._patient_silence_warned    = False  # True after first "are you still there?"
        self._patient_silence_warn_time = None   # when we sent the warning

        # Early end tracking
        self._early_end_reason = ""

        # Watchdog: detect when AI stops responding
        self._last_ai_activity    = None   # time of last response.audio.delta / response.created
        self._response_in_progress = False  # True while OpenAI is generating a response

    # ── sounddevice callbacks (called in a real-time audio thread) ────────────

    def _mic_callback(self, indata, frames, time_info, status):
        """Receives a block of mic samples every BLOCK_MS milliseconds."""
        if status:
            log.warning("Mic: %s", status)

        # sounddevice gives us float32 in range [-1.0, 1.0] — convert to int16
        pcm = (indata[:, 0] * 32767).clip(-32768, 32767).astype(np.int16)

        # Forward to asyncio queue so the WebSocket coroutine can send it
        if self.loop and self.mic_q and not self.mic_q.full():
            self.loop.call_soon_threadsafe(self.mic_q.put_nowait, pcm.copy())

        # Also save to recording buffer (only during patient speech, not AI)
        if self._recording_active and not self.ai_speaking:
            with self._seg_lock:
                self._cur_seg.append(pcm.copy())

    def _play_callback(self, outdata, frames, time_info, status):
        """Called every BLOCK_MS ms — must fill outdata with speaker samples."""
        if status:
            log.warning("Speaker: %s", status)

        needed = frames * 2   # 2 bytes per int16 sample (mono)
        with self._play_lock:
            have = len(self._play_buf)
            if have >= needed:
                chunk = bytes(self._play_buf[:needed])
                del self._play_buf[:needed]
            else:
                # Not enough audio yet — output silence to avoid noise/crackling
                chunk = bytes(self._play_buf) + b"\x00" * (needed - have)
                self._play_buf.clear()

        samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
        samples = np.clip(samples * 2.0, -1.0, 1.0)   # volume boost (2.0 = double)
        outdata[:, 0] = samples
        # Zero any extra channels if the device happens to be stereo
        for ch in range(1, outdata.shape[1]):
            outdata[:, ch] = 0.0

    # ── Wait for speaker buffer to drain before unmuting mic ─────────────────

    async def _wait_for_playback_done(self):
        """
        After OpenAI stops sending audio, the play buffer still has audio
        queued for the speaker. Poll until the buffer is empty, then unmute.
        Max wait of 5 seconds to avoid getting stuck if something goes wrong.
        """
        deadline = asyncio.get_event_loop().time() + 30.0
        while asyncio.get_event_loop().time() < deadline:
            with self._play_lock:
                if len(self._play_buf) == 0:
                    break
            await asyncio.sleep(0.05)   # check every 50 ms
        # Extra margin for room echo to die down
        await asyncio.sleep(0.8)
        self.ai_speaking = False
        self._aria_finished_time        = datetime.now()
        self._patient_spoken_since_aria = False
        self._dlog("ai_speaking → FALSE (buffer drained)")
        self._last_ai_activity = datetime.now()   # watchdog starts AFTER speaker finishes
        if self.ws:
            try:
                await self.ws.send(json.dumps({
                    "type": "session.update",
                    "session": {"turn_detection": {
                        "type": "server_vad", "threshold": 0.5,
                        "prefix_padding_ms": 300, "silence_duration_ms": 2000,
                    }}
                }))
            except Exception:
                pass
        log.debug("AI finished speaking — listening for patient")

    # ── Debug logging ─────────────────────────────────────────────────────────

    def _dlog(self, event_type, extra=None):
        """Append a timestamped entry to the debug log."""
        entry = {
            "time":        datetime.now().strftime("%H:%M:%S.%f")[:-3],
            "event":       event_type,
            "ai_speaking": self.ai_speaking,
            "buf_bytes":   len(self._play_buf),
        }
        if extra:
            entry.update(extra)
        self._debug_log.append(entry)

    def _save_debug_log(self):
        """Rotate previous log and save current session log."""
        import shutil
        if os.path.exists(DEBUG_LOG_FILE):
            shutil.move(DEBUG_LOG_FILE, DEBUG_LOG_FILE_PREV)
        with open(DEBUG_LOG_FILE, "w") as f:
            json.dump(self._debug_log, f, indent=2)
        log.info("Debug log saved → %s", DEBUG_LOG_FILE)

    # ── Mic → WebSocket streaming coroutine ───────────────────────────────────

    async def _stream_mic(self):
        """
        Continuously reads mic chunks from the queue, resamples from
        44.1 kHz → 24 kHz, and sends them to OpenAI as base64 PCM16.
        """
        while not self.shutdown_req.is_set():
            try:
                pcm = await asyncio.wait_for(self.mic_q.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue

            # Resample 44100 Hz → 24000 Hz
            resampled = resample_poly(pcm.astype(np.float32), _R_UP, _R_DOWN)
            pcm24 = resampled.clip(-32768, 32767).astype(np.int16)

            # Only send mic audio if Aria is not speaking AND the play buffer
            # is empty — this prevents sending audio while Aria's voice is still
            # physically playing through the speaker, even if ai_speaking flag
            # is temporarily out of sync with the actual buffer state
            with self._play_lock:
                buffer_has_audio = len(self._play_buf) > 0

            if self.ws and not self.ai_speaking and not buffer_has_audio:
                try:
                    await self.ws.send(json.dumps({
                        "type":  "input_audio_buffer.append",
                        "audio": base64.b64encode(pcm24.tobytes()).decode(),
                    }))
                except Exception as e:
                    log.debug("mic→ws error: %s", e)

    # ── OpenAI session setup ──────────────────────────────────────────────────

    async def _configure_session(self):
        """Send the session configuration to OpenAI (instructions, voice, VAD, tools)."""
        await self.ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "modalities":   ["text", "audio"],
                "instructions": SYSTEM_PROMPT,
                "input_audio_format":  "pcm16",
                "output_audio_format": "pcm16",
                "input_audio_transcription": {"model": "whisper-1", "language": "en"},
                "turn_detection": {
                    "type":                "server_vad",
                    "threshold":           0.5,    # speech sensitivity (0–1)
                    "prefix_padding_ms":   300,    # audio kept before speech starts
                    "silence_duration_ms": 2000,   # pause before AI responds
                },
                "tools":       TOOLS,
                "tool_choice": "auto",
            },
        }))
        log.info("Session configuration sent to OpenAI")

    async def _trigger_greeting(self):
        """Tell the AI to start speaking — begins the assessment."""
        await self.ws.send(json.dumps({"type": "response.create"}))
        log.info("AI greeting triggered — assessment is starting")

    async def _ack_function_call(self, call_id):
        """
        After the AI calls submit_assessment_results, we must reply to
        confirm we received it, otherwise the model waits indefinitely.
        """
        await self.ws.send(json.dumps({
            "type": "conversation.item.create",
            "item": {
                "type":    "function_call_output",
                "call_id": call_id,
                "output":  json.dumps({"status": "received"}),
            },
        }))

    # ── OpenAI event handler ──────────────────────────────────────────────────

    async def _handle_event(self, event):
        """Processes a single event received from the OpenAI WebSocket."""
        t = event.get("type", "")

        # ── Connection events ─────────────────────────────────────────────────
        if t == "session.created":
            log.info("OpenAI session created — sending configuration")
            await self._configure_session()

        elif t == "session.updated":
            if not self._session_started:
                self._session_started = True
                log.info("Session configured — starting assessment")
                await self._trigger_greeting()

        # ── Response lifecycle tracking (for watchdog) ───────────────────────
        elif t == "response.created":
            self._response_in_progress = True
            self._last_ai_activity = datetime.now()
            self._dlog("response.created")

        elif t == "response.done":
            self._response_in_progress = False
            self._last_ai_activity = datetime.now()
            self._dlog("response.done")
            # Start the unmute countdown only after the ENTIRE response is done
            # (not per-chunk) to avoid gaps between chunks reopening the mic
            if self.ai_speaking:
                if self._playback_done_task and not self._playback_done_task.done():
                    self._playback_done_task.cancel()
                self._playback_done_task = asyncio.create_task(self._wait_for_playback_done())

        # ── AI audio playback ─────────────────────────────────────────────────
        elif t == "response.audio.delta":
            # A chunk of AI speech audio has arrived
            self._last_ai_activity = datetime.now()
            if not self.ai_speaking:
                self.ai_speaking = True
                self._recording_active = False
                self._patient_spoken_since_aria = False  # reset: waiting for patient after this
                self._dlog("ai_speaking → TRUE")
                try:
                    await self.ws.send(json.dumps({
                        "type": "session.update",
                        "session": {"turn_detection": {
                            "type": "server_vad", "threshold": 0.9,
                            "prefix_padding_ms": 300, "silence_duration_ms": 2000,
                        }}
                    }))
                except Exception:
                    pass
            raw = base64.b64decode(event.get("delta", ""))
            if raw:
                # Resample 24 kHz → 44.1 kHz for the speaker
                arr = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
                resampled = resample_poly(arr, _R_DOWN, _R_UP)
                pcm44 = resampled.clip(-32768, 32767).astype(np.int16)
                with self._play_lock:
                    self._play_buf.extend(pcm44.tobytes())

        elif t == "response.audio.done":
            # Audio chunks are done — but we wait for response.done before
            # starting the unmute countdown, to avoid gaps between chunks
            self._dlog("response.audio.done")

        # ── Patient speech detection (server VAD) ─────────────────────────────
        elif t == "input_audio_buffer.speech_started":
            self._dlog("speech_started")
            self._patient_spoken_since_aria = True  # patient responded
            self._patient_silence_warned    = False  # reset warning for next silence
            if not self.ai_speaking:
                self._recording_active = True
                with self._seg_lock:
                    self._cur_seg = []   # start a fresh segment
                log.debug("Patient speech detected — recording")

        elif t == "input_audio_buffer.speech_stopped":
            # Patient paused — save this utterance as a complete segment
            self._recording_active = False
            with self._seg_lock:
                if self._cur_seg:
                    seg = np.concatenate(self._cur_seg)
                    self._all_segs.append(seg)
                    self._cur_seg = []
                    log.info(
                        "Saved patient speech segment  %.1fs  (total segments: %d)",
                        len(seg) / MIC_RATE, len(self._all_segs)
                    )

        # ── Transcription logs (for debugging) ───────────────────────────────
        elif t == "conversation.item.input_audio_transcription.completed":
            log.info("Patient said: %s", event.get("transcript", "")[:150])

        elif t == "response.audio_transcript.done":
            log.info("AI said:      %s", event.get("transcript", "")[:150])

        # ── Function call: assessment completion ──────────────────────────────
        elif t == "response.function_call_arguments.delta":
            # The AI is streaming the JSON arguments for the function call
            cid = event.get("call_id", "")
            self._fn_buf[cid] = self._fn_buf.get(cid, "") + event.get("delta", "")

        elif t == "response.function_call_arguments.done":
            # Full function call arguments received
            cid      = event.get("call_id", "")
            args_str = self._fn_buf.pop(cid, event.get("arguments", "{}"))
            fn_name  = event.get("name", "")

            if fn_name == "submit_assessment_results":
                log.info("━" * 50)
                log.info("Assessment complete — AI has submitted scores")
                try:
                    args = json.loads(args_str)
                    self.tics_scores  = args.get("tics_scores")
                    self.assess_notes = args.get("notes", "")
                    log.info("TICS-m scores: %s", json.dumps(self.tics_scores, indent=2))
                except Exception as e:
                    log.error("Could not parse scores from AI: %s", e)
                    self.tics_scores = {"parse_error": str(e)}

                await self._ack_function_call(cid)
                # Wait for goodbye audio to fully finish playing before closing
                deadline = asyncio.get_event_loop().time() + 10.0
                while asyncio.get_event_loop().time() < deadline:
                    with self._play_lock:
                        if len(self._play_buf) == 0:
                            break
                    await asyncio.sleep(0.05)
                await asyncio.sleep(1.0)  # small margin after buffer drains
                self.session_done.set()

            elif fn_name == "end_session_early":
                log.info("━" * 50)
                log.info("Session ending early")
                try:
                    args = json.loads(args_str)
                    self._early_end_reason = args.get("reason", "unknown")
                    self.tics_scores       = args.get("tics_scores")
                    self.assess_notes      = args.get("notes", "")
                    log.info("Early end reason: %s", self._early_end_reason)
                    log.info("Partial TICS-m scores: %s",
                             json.dumps(self.tics_scores, indent=2))
                except Exception as e:
                    log.error("Could not parse early end args: %s", e)

                await self._ack_function_call(cid)
                # Wait for Aria's goodbye to finish playing
                deadline = asyncio.get_event_loop().time() + 10.0
                while asyncio.get_event_loop().time() < deadline:
                    with self._play_lock:
                        if len(self._play_buf) == 0:
                            break
                    await asyncio.sleep(0.05)
                await asyncio.sleep(1.0)
                self.session_done.set()

        # ── Errors ────────────────────────────────────────────────────────────
        elif t == "error":
            log.error("OpenAI error: %s", event.get("error", event))

    # ── Watchdog: detect and recover from AI silence ──────────────────────────

    async def _watchdog(self):
        """
        Runs in the background throughout the session.
        If the AI hasn't responded for 30 seconds after it was last active,
        send response.create to nudge it back into action.
        Also enforces the session timeout independently of the event loop.
        """
        await asyncio.sleep(15)   # give session time to start up
        while not self.shutdown_req.is_set() and not self.session_done.is_set():
            await asyncio.sleep(5)

            # Session hard timeout
            if self.session_start:
                elapsed = (datetime.now() - self.session_start).total_seconds()
                if elapsed > MAX_SESSION_MIN * 60:
                    log.warning("Session timeout reached (%d min) — ending", MAX_SESSION_MIN)
                    self.session_done.set()
                    break

            # Skip all checks if AI is already speaking/thinking, or session not started
            if (self.ai_speaking or self._response_in_progress
                    or not self._session_started or not self._last_ai_activity):
                continue

            # ── Patient silence detection ─────────────────────────────────────
            # If Aria finished speaking and patient hasn't responded yet
            if (self._aria_finished_time and not self._patient_spoken_since_aria):
                patient_silence = (datetime.now() - self._aria_finished_time).total_seconds()

                if not self._patient_silence_warned and patient_silence > 15:
                    # First warning — ask Aria to check in
                    log.warning("Patient silent for 15s — asking Aria to check in")
                    self._patient_silence_warned    = True
                    self._patient_silence_warn_time = datetime.now()
                    if self.ws:
                        try:
                            await self.ws.send(json.dumps({
                                "type": "conversation.item.create",
                                "item": {
                                    "type": "message",
                                    "role": "user",
                                    "content": [{"type": "input_text",
                                                 "text": "[SYSTEM: The patient has been silent for 15 seconds. Gently ask if they are still there, e.g. 'Are you still with me?']"}]
                                }
                            }))
                            await self.ws.send(json.dumps({"type": "response.create"}))
                            self._last_ai_activity = datetime.now()
                        except Exception as e:
                            log.warning("Could not send check-in prompt: %s", e)

                elif (self._patient_silence_warned and self._patient_silence_warn_time):
                    warned_silence = (datetime.now() - self._patient_silence_warn_time).total_seconds()
                    if warned_silence > 15:
                        # Second timeout — patient unresponsive, end session
                        log.warning("Patient still silent after check-in — ending session")
                        self._patient_silence_warn_time = None  # prevent re-triggering
                        if self.ws:
                            try:
                                await self.ws.send(json.dumps({
                                    "type": "conversation.item.create",
                                    "item": {
                                        "type": "message",
                                        "role": "user",
                                        "content": [{"type": "input_text",
                                                     "text": "[SYSTEM: Patient is unresponsive. Say a brief goodbye and immediately call end_session_early with reason 'patient unresponsive' and null for any scores not yet collected.]"}]
                                    }
                                }))
                                await self.ws.send(json.dumps({"type": "response.create"}))
                                self._last_ai_activity = datetime.now()
                            except Exception as e:
                                log.warning("Could not send end prompt: %s", e)

            # ── AI silence nudge (existing) ───────────────────────────────────
            silence = (datetime.now() - self._last_ai_activity).total_seconds()
            if silence > 30:
                log.warning(
                    "AI has been silent for %.0fs — sending nudge to continue", silence
                )
                if self.ws:
                    try:
                        await self.ws.send(json.dumps({"type": "response.create"}))
                        self._last_ai_activity = datetime.now()  # reset to avoid spam
                    except Exception as e:
                        log.warning("Could not nudge AI: %s", e)

    # ── WebSocket connection loop ─────────────────────────────────────────────

    async def _run_ws(self):
        """Connect to OpenAI, process events until session is done."""
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "OpenAI-Beta":   "realtime=v1",
        }
        log.info("Connecting to OpenAI Realtime API…")
        try:
            async with websockets.connect(
                OPENAI_WS_URL,
                additional_headers=headers,
                ping_interval=20,
                ping_timeout=60,
            ) as ws:
                self.ws            = ws
                self.session_start = datetime.now()
                log.info("Connected!  Session started at %s", self.session_start.strftime("%H:%M:%S"))

                mic_task      = asyncio.create_task(self._stream_mic())
                watchdog_task = asyncio.create_task(self._watchdog())

                try:
                    async for raw_message in ws:
                        if self.shutdown_req.is_set() or self.session_done.is_set():
                            break
                        try:
                            await self._handle_event(json.loads(raw_message))
                        except Exception as e:
                            log.warning("Error handling event: %s", e)
                finally:
                    mic_task.cancel()
                    watchdog_task.cancel()
                    self.ws = None

        except Exception as e:
            log.error("WebSocket connection error: %s", e)
            log.error("Check that OPENAI_API_KEY is correct and the Pi has internet access.")

    # ── Post-session processing ───────────────────────────────────────────────

    async def _finalize(self):
        """
        After the session ends:
          1. Combine all recorded speech segments into one WAV file
          2. Send the WAV to the Flask ML server for MCI prediction
          3. Save results to session_results.json
          4. Push results to the Node.js dashboard on the Mac
        """
        log.info("═" * 50)
        log.info("Session ended — processing results…")

        # Flush any speech segment that was in progress when session ended
        with self._seg_lock:
            if self._cur_seg:
                self._all_segs.append(np.concatenate(self._cur_seg))
                self._cur_seg = []

        ml_result = None
        wav_path  = ""
        duration  = 0.0

        if not self._all_segs:
            log.warning("No patient speech was recorded — skipping ML analysis")
        else:
            # Combine all segments into one continuous audio array
            combined = np.concatenate(self._all_segs).astype(np.int16)
            duration = len(combined) / MIC_RATE
            log.info("Total patient speech recorded: %.1f seconds across %d segments",
                     duration, len(self._all_segs))

            # Normalise volume to 90% of peak (in Python, not via OS gain)
            peak = int(np.abs(combined).max())
            if peak > 0:
                scale    = (32767 * 0.9) / peak
                combined = (combined.astype(np.float32) * scale) \
                               .clip(-32768, 32767).astype(np.int16)

            # Write WAV file (mono, 44.1 kHz, 16-bit)
            wav_path = "session_audio.wav"
            with wave.open(wav_path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(MIC_RATE)
                wf.writeframes(combined.tobytes())
            log.info("Patient audio saved → %s  (%.1f s)", wav_path, duration)

            # Send WAV to Flask ML server on Mac
            log.info("Sending audio to ML server at %s …", FLASK_URL)
            try:
                with open(wav_path, "rb") as fh:
                    resp = requests.post(
                        FLASK_URL,
                        files={"audio": ("session_audio.wav", fh, "audio/wav")},
                        timeout=20,
                    )
                if resp.ok:
                    ml_result = resp.json()
                    log.info("ML prediction: %s  (probabilities: %s)",
                             ml_result.get("prediction"),
                             ml_result.get("probabilities"))
                else:
                    log.error("ML server returned error %d: %s",
                              resp.status_code, resp.text[:200])
            except Exception as e:
                log.error("Could not reach ML server at %s: %s", FLASK_URL, e)
                log.error("Is audio_server.py running on the Mac?")

        # Build the full results object
        results = {
            "session_id":       self.session_start.strftime("%Y%m%d_%H%M%S")
                                if self.session_start else "unknown",
            "timestamp":        self.session_start.isoformat()
                                if self.session_start else None,
            "completed_at":     datetime.now().isoformat(),
            "early_end":        bool(self._early_end_reason),
            "early_end_reason": self._early_end_reason if self._early_end_reason else None,
            "tics_scores":      self.tics_scores,
            "assessment_notes": self.assess_notes,
            "ml_prediction":    ml_result,
            "speech_metrics": {
                "total_duration_seconds": round(duration, 2),
                "segments_recorded":      len(self._all_segs),
                "audio_file":             wav_path,
            },
        }

        # Save locally on the Pi
        with open(SESSION_RESULTS_FILE, "w") as f:
            json.dump(results, f, indent=2)
        log.info("Results saved locally → %s", SESSION_RESULTS_FILE)

        # Push results to Node.js server on Mac so the dashboard can display them
        try:
            resp = requests.post(f"{NODE_URL}/results", json=results, timeout=10)
            if resp.ok:
                log.info("Results pushed to dashboard → open %s/dashboard to view", NODE_URL)
            else:
                log.warning("Dashboard server returned %d", resp.status_code)
        except Exception as e:
            log.warning("Could not reach dashboard server at %s: %s", NODE_URL, e)
            log.warning("Results are still saved locally in %s", SESSION_RESULTS_FILE)

        self._save_debug_log()
        log.info("═" * 50)
        log.info("All done.")

    # ── Audio device discovery ────────────────────────────────────────────────

    def _find_device(self):
        """
        Find the Waveshare USB audio device.
        Returns a device index, or None to use the system default.
        """
        devices = sd.query_devices()

        log.info("Audio devices on this system:")
        for i, d in enumerate(devices):
            if d["max_input_channels"] > 0 or d["max_output_channels"] > 0:
                log.info("  [%2d] %-40s  in:%d  out:%d",
                         i, d["name"],
                         d["max_input_channels"], d["max_output_channels"])

        # If user specified a device name hint, use that
        hint = AUDIO_DEVICE.lower()
        if hint:
            for i, d in enumerate(devices):
                if hint in d["name"].lower():
                    log.info("Selected device [%d]: %s", i, d["name"])
                    return i
            log.warning("Device '%s' not found — falling back to system default", AUDIO_DEVICE)
            return None

        # Otherwise auto-select the first USB device that has both in and out
        for i, d in enumerate(devices):
            name = d["name"].lower()
            if "usb" in name and d["max_input_channels"] > 0 and d["max_output_channels"] > 0:
                log.info("Auto-selected USB audio device [%d]: %s", i, d["name"])
                return i

        log.warning("No USB audio device found — using system default")
        return None

    # ── Main entry point ──────────────────────────────────────────────────────

    def run(self):
        """Start the bridge. Blocks until the session is complete."""
        if not OPENAI_API_KEY:
            log.error("OPENAI_API_KEY is not set!")
            log.error("Add this line to your .env file:  OPENAI_API_KEY=sk-...")
            sys.exit(1)

        log.info("╔══════════════════════════════════════╗")
        log.info("║     Reflexion  Audio  Bridge  v1     ║")
        log.info("╚══════════════════════════════════════╝")
        log.info("Mac IP        : %s", MAC_IP)
        log.info("ML server     : %s", FLASK_URL)
        log.info("Dashboard     : %s/dashboard", NODE_URL)
        log.info("Max session   : %d minutes", MAX_SESSION_MIN)

        # Set up the asyncio event loop and thread-safe primitives
        self.loop         = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.session_done = asyncio.Event()
        self.shutdown_req = asyncio.Event()
        self.mic_q        = asyncio.Queue(maxsize=200)

        # Graceful shutdown on Ctrl+C or kill signal
        def _on_signal(*_):
            log.info("Shutdown requested — saving what we have…")
            self.loop.call_soon_threadsafe(self.shutdown_req.set)
            self.loop.call_soon_threadsafe(self.session_done.set)

        signal.signal(signal.SIGINT,  _on_signal)
        signal.signal(signal.SIGTERM, _on_signal)

        try:
            self.loop.run_until_complete(self._async_main())
        finally:
            self.loop.close()

    async def _async_main(self):
        """Open audio streams, run the WebSocket session, then finalize."""
        device = self._find_device()

        mic_stream = sd.InputStream(
            device=device,
            samplerate=MIC_RATE,
            channels=MIC_CH,
            dtype="float32",
            blocksize=BLOCK_SIZE,
            callback=self._mic_callback,
            latency="low",
        )
        spk_stream = sd.OutputStream(
            device=device,
            samplerate=SPK_RATE,
            channels=SPK_CH,
            dtype="float32",
            blocksize=BLOCK_SIZE,
            callback=self._play_callback,
            latency="low",
        )

        with mic_stream, spk_stream:
            mic_stream.start()
            spk_stream.start()
            log.info("Microphone and speaker open — waiting for AI greeting…")
            log.info("(The AI will speak first to begin the session)")

            try:
                await asyncio.wait_for(
                    self._run_ws(),
                    timeout=MAX_SESSION_MIN * 60 + 120,   # hard ceiling
                )
            except asyncio.TimeoutError:
                log.warning("Hard timeout reached — ending session")
            except Exception as e:
                log.error("Unexpected error: %s", e)

            # Give the last few seconds of AI audio time to finish playing
            log.info("Waiting for final audio to finish playing…")
            await asyncio.sleep(4)

        # Audio streams are now closed — run post-session processing
        await self._finalize()


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    AudioBridge().run()
