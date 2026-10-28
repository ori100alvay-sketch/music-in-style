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
# Set only after this process successfully separates a real uploaded audio file into four valid stems.
SMOKE_TEST_PASSED = False
WORKER_TOKEN = os.environ.get("DEMUCS_WORKER_TOKEN", "").strip()
MAX_BYTES = 25 * 1024 * 1024
MAX_SECONDS = 8 * 60
ALLOWED_SUFFIXES = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus", ".aac"}


def smoke_test_state():
    # Set these flags only after processing a real licensed audio file and
    # verifying four non-empty stems in the returned ZIP.
    smoke_ok = os.getenv("DEMUCS_SMOKE_TEST_OK", "").strip().lower() == "true"
    try:
        stem_count = int(os.getenv("DEMUCS_SMOKE_TEST_STEM_COUNT", "0"))
    except ValueError:
        stem_count = 0
    runtime_installed = all(shutil.which(name) is not None for name in ("demucs", "ffmpeg", "ffprobe"))
    ready = bool(runtime_installed and ((smoke_ok and stem_count >= 4) or SMOKE_TEST_PASSED))
    return ready, (max(4, stem_count) if ready else 0), runtime_installed


@app.get("/health")
def health():
    ready, stem_count, runtime_installed = smoke_test_state()
    return {
        "ok": runtime_installed,
        "service": "mis-demucs-worker",
        "engine": "demucs" if runtime_installed else None,
        "device": "cpu",
        "model": os.getenv("DEMUCS_MODEL", "mdx_q"),
        "readyForSeparation": ready,
        "smokeTest": {"ok": ready, "stemCount": stem_count},
    }


@app.get("/capabilities")
def capabilities():
    ready, stem_count, runtime_installed = smoke_test_state()
    return {
        "available": ready,
        "runtime_installed": runtime_installed,
        "engine": "Demucs 4 (open source)" if runtime_installed else None,
        "paid_provider": False,
        "ready_for_production": ready,
        "smoke_test_stem_count": stem_count,
        "note": "A real audio smoke test must be verified before production separation is enabled."
    }


@app.post("/separate")
async def separate(audio: UploadFile = File(...), x_worker_token: str | None = Header(default=None)):
    if not WORKER_TOKEN:
        await audio.close()
        raise HTTPException(503, "Worker is not configured with an access token.")
    if not x_worker_token or not hmac.compare_digest(x_worker_token, WORKER_TOKEN):
        await audio.close()
        raise HTTPException(401, "Unauthorized.")
    if any(shutil.which(name) is None for name in ("demucs", "ffprobe", "ffmpeg")):
        await audio.close()
        raise HTTPException(503, "Demucs runtime is not installed.")
    suffix = Path(audio.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        await audio.close()
        raise HTTPException(415, "Unsupported audio type. Upload MP3, WAV, FLAC, M4A, OGG, OPUS or AAC.")

    tmp = tempfile.mkdtemp(prefix="mis-demucs-")
    root = Path(tmp)
    source = root / ("input" + suffix)
    archive = root / "stems.zip"
    response_ready = False
    try:
        size = 0
        with source.open("wb") as out:
            while True:
                chunk = await audio.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Audio upload exceeds the 25 MB limit.")
                out.write(chunk)
        await audio.close()
        if size == 0:
            raise HTTPException(400, "The uploaded audio file is empty.")

        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                 "default=noprint_wrappers=1:nokey=1", str(source)],
                capture_output=True, text=True, timeout=15, check=False
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(415, "Could not inspect this audio file.")
        try:
            duration = float(probe.stdout.strip())
        except (ValueError, TypeError):
            raise HTTPException(415, "Could not read this audio file.")
        if probe.returncode != 0 or duration <= 0:
            raise HTTPException(415, "Could not read this audio file.")
        if duration > MAX_SECONDS:
            raise HTTPException(413, "Audio duration must not exceed 8 minutes.")

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
            print("Demucs failed:", (run.stderr or run.stdout)[-1000:])
            raise HTTPException(503, "Demucs could not separate this audio on the current server resources.")

        stem_dir = output / "mdx_q" / source.stem
        expected = ["vocals.wav", "drums.wav", "bass.wav", "other.wav"]
        if not stem_dir.is_dir() or not all(
            (stem_dir / name).is_file() and (stem_dir / name).stat().st_size > 44 for name in expected
        ):
            raise HTTPException(502, "Demucs did not produce all four expected stems.")
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name in expected:
                zf.write(stem_dir / name, arcname=name)

        # This is the real-audio smoke test: only mark ready after all four
        # non-empty WAV files were created and packaged successfully.
        global SMOKE_TEST_PASSED
        SMOKE_TEST_PASSED = True

        from starlette.background import BackgroundTask
        response_ready = True
        return FileResponse(
            archive, media_type="application/zip", filename="music-in-style-stems.zip",
            background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True)
        )
    finally:
        if not response_ready:
            shutil.rmtree(tmp, ignore_errors=True)
        # Starlette UploadFile does not expose a public .closed attribute.
        # Closing directly is supported and safe even after a failed request.
        await audio.close()
