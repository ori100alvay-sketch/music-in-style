# Local/open-source stem separation

## Current production state

The production service in `render.yaml` is a **Node.js free web service**. It has no Python runtime, PyTorch, Demucs model weights, or local audio-processing worker. Therefore `/api/separation-status` must keep returning `available: false`, and `POST /api/separate` must keep returning HTTP 501 until an actual worker is deployed and passes a real audio test.

The site must not silently fall back to Replicate or any other paid inference provider. Do not add `REPLICATE_API_TOKEN` or turn the feature on just to make the status look green.

## Why Demucs is not enabled in the current service

Demucs is open-source software, but inference still needs compute, disk space for model weights, memory, temporary audio storage, and enough time to process each song. The current Node-only Render service does not provide those dependencies. A free web service may sleep or lack enough RAM/CPU for reliable separation; the fact that the code is free does not make the compute free or available.

## Safe path to enable it

1. Run a dedicated Python worker on hardware you control or on a hosting plan whose available memory, CPU, disk, timeout, and terms have been verified. Do not assume the current free Node service can run it.
2. Install an open-source Demucs inference package in that worker and pin tested versions. Keep model weights outside Git.
3. Accept **uploaded audio files** rather than arbitrary URLs. Enforce a strict file-size and duration limit, validate media by decoding it, use random temporary filenames, and delete source/output files after processing.
4. Protect the worker with a server-only shared secret. Never expose the secret in browser code. Add queue/concurrency limits and a timeout.
5. Produce a real four-stem output (vocals, drums, bass, other) for a licensed test file. Check that all output files exist, are non-empty, have matching duration/sample rate, can be decoded, and can be mixed in sync.
6. Only then configure the main service to use the worker and let `/api/separation-status` report `available: true`. Add end-to-end tests before exposing the mixer.

## Manual smoke test checklist

- [ ] Worker health endpoint responds successfully.
- [ ] A short, licensed WAV/MP3 upload completes on CPU without a paid API.
- [ ] The response contains all expected stems and valid downloadable audio.
- [ ] Invalid, oversized, and unsupported uploads are rejected safely.
- [ ] Temporary files are deleted after success and failure.
- [ ] The web app can play all stems from the same start time and synchronize pause/seek.
- [ ] With no worker configured, the website clearly reports that separation is unavailable and sends no audio to a paid provider.

Until all checks pass, the feature remains intentionally unavailable rather than pretending that disabled sliders are doing AI separation.
