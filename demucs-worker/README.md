# Music in Style — local Demucs worker

This optional worker runs the open-source Demucs model locally. It does not call Replicate or any paid inference API.

## Deploy separately
Create a **Docker Web Service** in Render from this repository and set the Dockerfile path to `demucs-worker/Dockerfile`. Do not switch the existing Node service to this worker's Dockerfile.

For a secure connection, create one long random secret and set the exact same value as `DEMUCS_WORKER_TOKEN` on **both** the worker service and the main Node service. The main service sends it in `X-Worker-Token`; the worker rejects missing or incorrect tokens. Do not expose the token in frontend code or commit it to GitHub. The main service probes this worker directly; it only reports separation as available when the worker health endpoint confirms a real-audio smoke test with four stems.

Demucs downloads model weights on first use and needs substantial RAM/CPU; the free Render instance may not have enough memory or disk and can time out. Use a plan with adequate resources only if you choose to. The first successful authenticated audio-file separation produces four non-empty stems and automatically marks the worker ready for the current process. Readiness resets after a worker restart.

## API
- `GET /health` — process health only; does not claim the model is loaded.
- `GET /capabilities` — reports whether the Demucs executable is installed.
- `POST /separate` — multipart form upload field `audio`; returns a ZIP containing vocals, drums, bass and other stems.

Maximum upload is 25 MB and maximum audio duration is 8 minutes. The worker uses temporary storage and deletes it after the request. Set a long random `DEMUCS_WORKER_TOKEN` secret in the worker environment. Every `POST /separate` request must send it as the `X-Worker-Token` header. Also put the worker behind a private service or restrict access before using it publicly. Do not expose an unauthenticated compute endpoint to the internet.

## Local smoke test
```bash
docker build -f demucs-worker/Dockerfile -t mis-demucs .
docker run --rm -p 8001:8001 mis-demucs
curl -f http://localhost:8001/health
curl -f http://localhost:8001/capabilities
curl -f -H 'X-Worker-Token: YOUR_LOCAL_TEST_TOKEN' -F 'audio=@sample.mp3' http://localhost:8001/separate -o stems.zip
unzip -l stems.zip
```

This worker is only a deployment scaffold until deployed and tested with a real audio file. The current public app does not mark separation as active automatically.
