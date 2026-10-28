# Music in Style — Demucs deployment and verification

The public Node.js app and the optional open-source Demucs worker are separate services. Stem separation uses the local worker only; this integration must never send audio to a paid inference provider.

## Render worker service

Create a separate Docker Web Service from this repository:
- Name: `music-in-stil-demucs`
- Branch: `main`
- Runtime: Docker
- Dockerfile path: `demucs-worker/Dockerfile`
- Docker context: repository root (`.`) if Render asks for it

The worker needs substantial CPU, RAM, disk space, and a first-run model download. A free instance may not be able to perform inference. Check the selected Render plan and expected costs before deploying or changing plans; do not choose a paid plan without explicit budget approval.

## Environment variables

In the worker service's Render **Environment** page:
- `DEMUCS_WORKER_TOKEN`: a long random secret.

In the main `music-in-stil-api` service's **Environment** page:
- `DEMUCS_WORKER_URL`: the worker's HTTPS service URL, without a trailing slash.
- `DEMUCS_WORKER_TOKEN`: exactly the same secret as the worker.

The main app's Render Blueprint uses `sync: false` for the worker URL and token so future Blueprint deployments do not replace the worker URL with localhost or overwrite dashboard-managed settings. Never commit the token to GitHub or put it in browser code.

## Required verification before enabling

1. Open the worker's `/health` and `/capabilities` endpoints. Confirm the runtime is installed; process health alone is not proof of separation.
2. Upload a short audio file that you own or are licensed to use to the worker's authenticated `POST /separate` endpoint.
3. Confirm the response is a ZIP containing four non-empty WAV files: `vocals.wav`, `drums.wav`, `bass.wav`, and `other.wav`. Listen to the files and check that they are valid audio, not merely files with the right names.
4. Only after that succeeds, set worker `DEMUCS_SMOKE_TEST_OK=true` and `DEMUCS_SMOKE_TEST_STEM_COUNT=4`.
5. Check `https://music-in-style.onrender.com/api/separation-status` and `/api/capabilities`. Both should report separation as available. Upload a file through the website and confirm that the returned ZIP downloads and contains the same four stems.

The smoke-test environment flags are a readiness gate, not a substitute for performing the real audio test. Do not set them until the output has been inspected. If any check fails, leave separation disabled; the app should report that it is unavailable rather than claim it works.

## Limits and tests

- Maximum upload: 25 MB.
- Maximum duration: 8 minutes.
- Accepted audio extensions: MP3, WAV, FLAC, M4A, OGG, OPUS, AAC.
- Automated tests mock Demucs inference to test authentication, input validation, readiness gating, and ZIP handling. They do not prove the production host can run the model.
- CI runs the deployed worker's unit tests with no model download and no paid API calls.
