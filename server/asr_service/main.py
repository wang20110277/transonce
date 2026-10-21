"""TransOnce ASR microservice — FunASR + SenseVoiceSmall (Python 3.12).

Runs separately from the main backend (which is Python 3.14 and has no torch).
Loads the local SenseVoice model once at startup; exposes POST /asr.

Run:
  server/asr_service/.venv/bin/uvicorn main:app \\
    --app-dir server/asr_service --port 8001
Env:
  MODEL_DIR (default server/models/SenseVoiceSmall), SENSEVOICE_LANGUAGE, FFMPEG_BIN
"""
import logging
import os
import re
import subprocess
import tempfile

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from funasr import AutoModel

MODEL_DIR = os.environ.get(
    "MODEL_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models", "SenseVoiceSmall")),
)
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
LANGUAGE = os.environ.get("SENSEVOICE_LANGUAGE", "zh")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("asr")

app = FastAPI(title="transonce-asr")
_model = None


@app.on_event("startup")
def _load() -> None:
    global _model
    log.info("loading SenseVoice from %s", MODEL_DIR)
    _model = AutoModel(model=MODEL_DIR, disable_update=True)
    log.info("SenseVoice loaded")


@app.get("/health")
def health():
    return {"ok": _model is not None, "model_dir": MODEL_DIR, "language": LANGUAGE}


@app.post("/asr")
async def asr(file: UploadFile = File(...)):
    if _model is None:
        raise HTTPException(503, "model not loaded yet")
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty audio")
    ext = (file.filename or "audio.webm").rsplit(".", 1)[-1].lower() or "webm"

    with tempfile.TemporaryDirectory() as d:
        raw = os.path.join(d, f"in.{ext}")
        wav = os.path.join(d, "in.wav")
        with open(raw, "wb") as f:
            f.write(data)

        # Decode any container (webm/opus/mp3/m4a/wav) → 16kHz mono WAV.
        rc = subprocess.run(
            [FFMPEG, "-y", "-i", raw, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
            capture_output=True,
        )
        if rc.returncode != 0 or not os.path.exists(wav):
            raise HTTPException(
                400, f"ffmpeg decode failed: {rc.stderr.decode(errors='ignore')[:300]}"
            )

        with torch.no_grad():
            result = _model.generate(input=wav, language=LANGUAGE, batch_size_s=300)
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()

    text = result[0]["text"] if result else ""
    # Strip SenseVoice special tokens: <|zh|>, <|EMO_UNKNOWN|>, <|Speech|>, <|woitn|>, ...
    text = re.sub(r"<\|[^|]*\|>", "", text).strip()
    return {"text": text}
