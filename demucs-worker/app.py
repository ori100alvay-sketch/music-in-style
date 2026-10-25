import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import hmac
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

app = FastAPI(title="Music in Style local Demucs worker", docs_url=None, redoc_url=None)
WORKER_TOKEN = os.environ.get("DEMUCS_WORKER_TOKEN", "").strip()
MAX_BYTES = 25 * 1024 * 1024
MAX_SECONDS = 8 * 60
ALLOWED_SUFFIXES = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus", ".aac"}


@app.get("/health")
def health():
    return {"ok": True, "service": "mis-demucs-worker", "engine_ready": shutil.which("demucs") is not None}


@app.get("/capabilities")
def capabilities():
    ready = shutil.which("demucs") is not None
    return {
        "available": ready,
        "engine": "Demucs 4 (open source)" if ready else None,
        "paid_provider": False,
        "note": "A real audio separation test is still required before production activation."
    }


@app.post("/separate")
async def separate(audio: UploadFile = File(...), x_worker_token: str | None = Header(default=None)):
    if not WORKER_TOKEN:
        raise HTTPException(503, "Worker is not configured with an access token.")
    if not x_worker_token or not hmac.compare_digest(x_worker_token, WORKER_TOKEN):
        raise HTTPException(401, "Unauthorized.")
    if shutil.which("demucs") is None or shutil.which("ffprobe") is None or shutil.which("ffmpeg") is None:
        raise HTTPException(503, "Demucs runtime is not installed.")
    suffix = Path(audio.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(415, "Unsupported audio type. Upload MP3, WAV, FLAC, M4A, OGG, OPUS or AAC.")
    with tempfile.TemporaryDirectory(prefix="mis-demucs-") as tmp:
        root = Path(tmp)
        source = root / ("input" + suffix)
        size = 0
        try:
            with source.open("wb") as out:
                while True:
                    chunk = await audio.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise HTTPException(413, "Audio upload exceeds the 25 MB limit.")
                    out.write(chunk)
        finally:
            await audio.close()
        if size == 0:
            raise HTTPException(400, "The uploaded audio file is empty.")

        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(source)],
            capture_output=True, text=True, timeout=15, check=False
        )
        try:
            duration = float(probe.stdout.strip())
        except (ValueError, TypeError):
            raise HTTPException(415, "Could not read this audio file.")
        if probe.returncode != 0 or duration <= 0 or duration > MAX_SECONDS:
            raise HTTPException(413, "Audio duration must be between 1 second and 8 minutes.")

        output = root / "separated"
        try:
            run = subprocess.run(
                ["python", "-m", "demucs", "-n", "mdx_q", "--device", "cpu", "--out", str(output), str(source)],
                capture_output=True, text=True, timeout=max(180, int(duration * 4)), check=False,
                env={**os.environ, "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2"}
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "Local separation timed out. Try a shorter audio file.")
        if run.returncode != 0:
            print("Demucs failed:", (run.stderr or run.stdout)[-3000:])
            raise HTTPException(503, "Demucs could not separate this audio on the current server resources.")

        stem_dir = output / "mdx_q" / source.stem
        expected = ["vocals.wav", "drums.wav", "bass.wav", "other.wav"]
        if not stem_dir.is_dir() or not all((stem_dir / name).is_file() and (stem_dir / name).stat().st_size > 44 for name in expected):
            raise HTTPException(502, "Demucs did not produce all four expected stems.")
        archive = root / "stems.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name in expected:
                zf.write(stem_dir / name, arcname=name)
        # FileResponse is sent before the TemporaryDirectory exits; background cleanup
        # is required so the archive still exists while Starlette streams it.
        from starlette.background import BackgroundTask
        return FileResponse(archive, media_type="application/zip", filename="music-in-style-stems.zip",
                            background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True))
