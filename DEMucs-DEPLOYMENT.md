# Optional local Demucs deployment

This repository's current `render.yaml` deliberately remains a Node.js native service. The optional `Dockerfile` installs CPU-only PyTorch + Demucs and a local FastAPI worker, without Replicate or any paid inference API.

## Important hosting limitation
Do **not** switch the public Render service to this Dockerfile on a low-memory/free instance and assume it works. Demucs needs a Python/PyTorch runtime, model downloads, FFmpeg, and substantial RAM; CPU separation is slow. The worker caps uploads at 25 MB and audio at 5 minutes by default. A successful build is not proof that inference works.

## Validation before enabling in the public UI
1. Deploy the Docker image only to a separate test service/branch.
2. Confirm `GET /health` reports `engine=demucs`, `device=cpu`, and a PyTorch version.
3. Upload a short, legally usable WAV/MP3 to the worker's `POST /separate`; expect a ZIP containing `drums.wav`, `bass.wav`, `vocals.wav`, and `other.wav`.
4. Run the worker tests with `python -m unittest tests/test_demucs_worker.py` after installing the dependencies.
5. Measure peak RAM, run time, and output quality. Only then wire the UI to the worker and advertise the feature as available.

The current Node service intentionally continues to report separation as disabled until a reachable worker is health-checked and integrated. This avoids falsely promising a working feature or uploading user audio to a paid provider.
