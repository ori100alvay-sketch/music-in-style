"""Opt-in local Demucs service. It is not enabled by the Node app by default."""
import os
import hmac
import shutil
import subprocess
import tempfile
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI(title="Music in Style Local Stem Separation", version="0.1.0")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(40 * 1024 * 1024)))
SEPARATION_TIMEOUT_SECONDS = int(os.getenv("SEPARATION_TIMEOUT_SECONDS", "900"))
MODEL_NAME = os.getenv("DEMUCS_MODEL", "htdemucs")
API_TOKEN = os.getenv("DEMUCS_API_TOKEN", "").strip()
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".opus", ".aac"}

@app.get("/health")
def health():
    # This checks the local runtime executable, not that model weights are cached.
    demucs = shutil.which("demucs")
    ffmpeg = shutil.which("ffmpeg")
    return {
        "ok": bool(demucs and ffmpeg),
        "engine": "Demucs",
        "model": MODEL_NAME,
        "demucsInstalled": bool(demucs),
        "ffmpegInstalled": bool(ffmpeg),
        "modelWeightsDownloaded": False,
        "readyForSeparation": False,
        "note": "A real audio separation smoke test is required before marking this service ready."
    }

@app.post("/separate")
async def separate(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    if not API_TOKEN:
        raise HTTPException(status_code=503, detail="Local separation service is not configured with an API token.")
    expected = "Bearer " + API_TOKEN
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized.")
    name = Path(file.filename or "audio.wav").name
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported audio format.")
    if not shutil.which("demucs") or not shutil.which("ffmpeg"):
        raise HTTPException(status_code=503, detail="Local Demucs runtime is not installed.")

    job_dir = Path(tempfile.mkdtemp(prefix="mis-demucs-"))
    input_path = job_dir / ("input" + suffix)
    output_dir = job_dir / "output"
    output_dir.mkdir()
    total = 0
    try:
        with input_path.open("wb") as target:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Audio file exceeds the configured upload limit.")
                target.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="The uploaded audio file is empty.")

        # No shell=True; paths and model name are passed as separate argv elements.
        command = [
            shutil.which("demucs"), "--name", MODEL_NAME,
            "--out", str(output_dir), str(input_path)
        ]
        try:
            completed = subprocess.run(
                command, check=False, capture_output=True, text=True,
                timeout=SEPARATION_TIMEOUT_SECONDS
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Local separation timed out. Try a shorter file.")
        if completed.returncode != 0:
            # Avoid returning raw subprocess logs, which may contain paths or internals.
            raise HTTPException(status_code=502, detail="Demucs could not separate this audio file.")

        stem_files = list(output_dir.rglob("*.wav"))
        expected = {"vocals.wav", "drums.wav", "bass.wav", "other.wav"}
        if not expected.issubset({p.name for p in stem_files}):
            raise HTTPException(status_code=502, detail="Demucs finished without returning all expected stems.")

        archive = job_dir / "stems.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for stem in sorted(stem_files):
                zf.write(stem, arcname=stem.name)

        return FileResponse(
            archive, media_type="application/zip",
            filename="music-in-style-stems.zip",
            background=BackgroundTask(shutil.rmtree, job_dir, ignore_errors=True)
        )
    except Exception:
        # The FileResponse background task owns cleanup after successful response.
        if not (job_dir / "stems.zip").exists():
            shutil.rmtree(job_dir, ignore_errors=True)
        raise
    finally:
        await file.close()
