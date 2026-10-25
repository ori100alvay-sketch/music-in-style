#!/usr/bin/env python3
"""Local, self-hosted Demucs worker. No external inference API is called."""
import os
import shutil
import subprocess
import tempfile
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

APP_VERSION = "0.1.0"
MAX_UPLOAD_BYTES = int(os.getenv("DEMUCS_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
MAX_DURATION_SECONDS = int(os.getenv("DEMUCS_MAX_DURATION_SECONDS", "300"))
WORK_DIR = Path(os.getenv("DEMUCS_WORK_DIR", "/tmp/music-in-style-demucs"))
MODEL = os.getenv("DEMUCS_MODEL", "htdemucs")
DEVICE = "cpu"  # intentionally CPU-only; never attempts paid or remote inference
app = FastAPI(title="Music in Style Local Demucs", docs_url=None, redoc_url=None)


def remove_tree(path: Path):
    shutil.rmtree(path, ignore_errors=True)


@app.get("/health")
def health():
    try:
        import torch
        import demucs
        # Importing the runtime is not proof that separation works. The service
        # stays unavailable to the UI until an explicit real-audio smoke test is recorded.
        smoke_ok = os.getenv("DEMUCS_SMOKE_TEST_OK", "").strip().lower() == "true"
        try:
            stem_count = int(os.getenv("DEMUCS_SMOKE_TEST_STEM_COUNT", "0"))
        except ValueError:
            stem_count = 0
        ready = smoke_ok and stem_count >= 4
        return {"ok": True, "engine": "demucs", "version": APP_VERSION,
                "model": MODEL, "device": DEVICE, "torch": torch.__version__,
                "readyForSeparation": ready,
                "smokeTest": {"ok": ready, "stemCount": stem_count if ready else 0}}
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Demucs runtime is not ready") from exc


@app.post("/separate")
async def separate(file: UploadFile = File(...)):
    if not file.filename or Path(file.filename).suffix.lower() not in {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}:
        raise HTTPException(status_code=415, detail="Upload a supported audio file (WAV, MP3, FLAC, OGG, M4A or AAC).")
    job_dir = WORK_DIR / uuid.uuid4().hex
    job_dir.mkdir(parents=True, exist_ok=False)
    input_path = job_dir / ("input" + Path(file.filename).suffix.lower())
    output_path = job_dir / "output"
    output_path.mkdir()
    try:
        total = 0
        with input_path.open("wb") as target:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"Audio file exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
                target.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="The uploaded audio file is empty.")

        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(input_path)],
            capture_output=True, text=True, timeout=20, check=False
        )
        try:
            duration = float(probe.stdout.strip())
        except (ValueError, TypeError):
            duration = 0
        if probe.returncode != 0 or duration <= 0:
            raise HTTPException(status_code=400, detail="The file could not be read as audio.")
        if duration > MAX_DURATION_SECONDS:
            raise HTTPException(status_code=413, detail=f"Audio is longer than the {MAX_DURATION_SECONDS // 60}-minute limit.")

        command = [
            "python", "-m", "demucs", "--device", DEVICE,
            "-n", MODEL, "-o", str(output_path), str(input_path)
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True,
                                    timeout=max(180, int(duration * 5)), check=False)
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail="Separation took too long on this CPU instance.") from exc
        if result.returncode != 0:
            # Do not leak server paths or raw internal command output to the client.
            print("Demucs failed:", (result.stderr or result.stdout)[-2000:])
            raise HTTPException(status_code=503, detail="Local Demucs could not complete this file. The instance may not have enough memory.")
        stems = list(output_path.rglob("*.wav"))
        if not stems:
            raise HTTPException(status_code=502, detail="Demucs finished without producing stem files.")
        archive = job_dir / "stems.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for stem in stems:
                zf.write(stem, arcname=stem.name)
        return FileResponse(str(archive), media_type="application/zip",
                            filename="music-in-style-stems.zip",
                            background=BackgroundTask(remove_tree, job_dir))
    except Exception:
        remove_tree(job_dir)
        raise
    finally:
        await file.close()
