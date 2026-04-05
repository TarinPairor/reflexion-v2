# 1) Init: device + pyannote diarization + embedding model
import os
import warnings

warnings.filterwarnings("ignore")

import numpy as np
import torch
import torchaudio
from pyannote.audio import Pipeline, Inference, Model

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

HUGGINGFACE_TOKEN = ''
if not HUGGINGFACE_TOKEN:
    raise RuntimeError(
        "Set HUGGINGFACE_TOKEN or HF_TOKEN in the environment (Hugging Face read token)."
    )

print("Loading diarization pipeline...")
diarization_pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    token=HUGGINGFACE_TOKEN,
)
diarization_pipeline.to(device)

print("Loading embedding model...")
embedding_model = Model.from_pretrained("pyannote/embedding", token=HUGGINGFACE_TOKEN)
embedding_model.to(device)
embedding_inference = Inference(embedding_model, window="whole")

print("Diarization and embedding models initialized.")



# 2) Registry + chunk processing (diarization -> per-turn embeddings, normalized)
from sklearn.metrics.pairwise import cosine_similarity

# Cosine similarity in [0, 1] for unit vectors; raise threshold if you get too many false merges.
SCORE_MATCH_THRESHOLD = 0.72
MIN_SEGMENT_SEC = 1.0


def to_waveform_tensor(mono_float: np.ndarray) -> torch.Tensor:
    x = np.asarray(mono_float, dtype=np.float32).reshape(1, -1)
    return torch.from_numpy(x).to(device)


def _normalize_embedding(emb) -> np.ndarray:
    v = np.asarray(emb, dtype=np.float64).flatten()
    n = np.linalg.norm(v) or 1.0
    return (v / n).astype(np.float64)


class AudioPersonRegistry:
    """One centroid embedding per global person id (cosine similarity match)."""

    def __init__(self, match_threshold: float = SCORE_MATCH_THRESHOLD):
        self.match_threshold = match_threshold
        self._next_id = 1
        self.persons = []  # {"id": int, "embedding": np.ndarray (L2-normalized)}

    def identify(self, embedding: np.ndarray):
        emb = _normalize_embedding(embedding)
        if not self.persons:
            pid = self._next_id
            self._next_id += 1
            self.persons.append({"id": pid, "embedding": emb.copy()})
            return pid, 1.0, True, None
        mat = np.vstack([p["embedding"] for p in self.persons])
        sims = cosine_similarity(emb.reshape(1, -1), mat)[0]
        j = int(np.argmax(sims))
        best_sim = float(sims[j])
        best_id = self.persons[j]["id"]
        if best_sim >= self.match_threshold:
            return best_id, best_sim, False, best_sim
        pid = self._next_id
        self._next_id += 1
        self.persons.append({"id": pid, "embedding": emb.copy()})
        return pid, best_sim, True, best_sim


def extract_segments_from_chunk(
    waveform_1d: np.ndarray,
    sample_rate: int,
    min_segment_sec: float = MIN_SEGMENT_SEC,
):
    """Run diarization on one mono chunk; return list of dicts with embedding + metadata."""
    waveform_1d = np.asarray(waveform_1d, dtype=np.float32).flatten()
    w = to_waveform_tensor(waveform_1d)
    diarization = diarization_pipeline({"waveform": w, "sample_rate": sample_rate})
    # Access the speaker_diarization attribute first (DiarizeOutput object)
    annotation = diarization.speaker_diarization
    out = []
    for segment, _, speaker_label in annotation.itertracks(yield_label=True):
        duration = segment.end - segment.start
        if duration < min_segment_sec:
            continue
        i0 = int(segment.start * sample_rate)
        i1 = int(segment.end * sample_rate)
        i0, i1 = max(0, i0), min(waveform_1d.shape[0], i1)
        if i1 <= i0:
            continue
        segment_audio = waveform_1d[i0:i1]
        seg_t = to_waveform_tensor(segment_audio)
        emb = embedding_inference({"waveform": seg_t, "sample_rate": sample_rate})
        if hasattr(emb, "cpu"):
            emb = emb.cpu().numpy()
        emb = _normalize_embedding(emb)
        out.append(
            {
                "local_speaker_label": speaker_label,
                "start": float(segment.start),
                "end": float(segment.end),
                "embedding": emb,
            }
        )
    return out


db = AudioPersonRegistry()
print(
    f"AudioPersonRegistry ready (match if cosine similarity >= {SCORE_MATCH_THRESHOLD}). "
    "Run the next cell to record live."
)

# 3) Live recording loop: each chunk logs embedding preview + match score / new id
import json
import time

import sounddevice as sd

SAMPLE_RATE = 16000
CHUNK_SEC = 15.0
MAX_CHUNKS = 1  # or Ctrl+C to stop early

log_rows = []

print(
    f"Recording {CHUNK_SEC}s chunks at {SAMPLE_RATE} Hz mono. "
    f"Up to {MAX_CHUNKS} chunks. Ctrl+C to stop."
)

try:
    for chunk_i in range(MAX_CHUNKS):
        print(f"\n--- Chunk {chunk_i + 1}/{MAX_CHUNKS}: listening ({CHUNK_SEC}s) ---")
        audio = sd.rec(
            int(CHUNK_SEC * SAMPLE_RATE),
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
        )
        sd.wait()
        mono = audio.flatten()

        segments = extract_segments_from_chunk(mono, SAMPLE_RATE)
        if not segments:
            print("  (no segments >= {:.1f}s; try speaking longer or increase CHUNK_SEC)".format(MIN_SEGMENT_SEC))
            continue

        for seg in segments:
            pid, best_sim, is_new, _ = db.identify(seg["embedding"])
            preview = np.round(seg["embedding"][:8], 4).tolist()
            row = {
                "chunk": chunk_i + 1,
                "local_speaker": str(seg["local_speaker_label"]),
                "t0": round(seg["start"], 2),
                "t1": round(seg["end"], 2),
                "global_person_id": pid,
                "is_new_person": is_new,
                "best_cosine_sim_to_registry": round(best_sim, 4),
                "embedding_preview": preview,
            }
            log_rows.append(row)
            print(
                f"  speaker={row['local_speaker']} [{row['t0']:.2f}-{row['t1']:.2f}]s -> "
                f"person_id={pid} new={is_new} score={row['best_cosine_sim_to_registry']} "
                f"emb[:8]={preview}"
            )

        time.sleep(0.05)

except KeyboardInterrupt:
    print("\nStopped by user.")

print(f"\nLogged {len(log_rows)} segment events.")

# 4) Print session log + current database (person ids and embedding previews)
print("=== Session log (JSON) ===")
print(json.dumps(log_rows, indent=2))

print("\n=== Registry (one row per global person) ===")
registry_dump = []
for p in db.persons:
    e = p["embedding"]
    registry_dump.append(
        {
            "id": p["id"],
            "dim": int(e.size),
            "embedding_preview": np.round(e[:8], 4).tolist(),
        }
    )
print(json.dumps(registry_dump, indent=2))
print(f"\nTotal persons in registry: {len(db.persons)}")