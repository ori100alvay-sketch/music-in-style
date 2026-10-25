# Local stem separation decision

## Decision
Use Demucs as the first open-source candidate, but keep the feature disabled until a real end-to-end test succeeds. The current app is a Node.js service on Render's free plan; it does not include Python, PyTorch, model weights, or a Demucs runtime.

## Why it cannot safely be switched on in the current deployment
- Demucs is a Python/PyTorch application. The current `render.yaml` uses the Node runtime, `npm install`, and `npm start`; it does not install Python dependencies.
- Demucs CPU separation is computationally heavy and can take longer than the song duration. A free web instance that sleeps when idle and has constrained memory is not a reliable production worker for this workload.
- Render documents that persistent disks are not available to free services. Model weights and generated stems would need to be downloaded/re-created after restarts, or stored elsewhere.
- No paid inference provider is called by the current endpoint. Do not add Replicate or another metered inference API without explicit approval.

## Recommended architecture
1. Keep the Node app as the UI/API gateway.
2. Add a separate self-hosted Python worker using Demucs (MIT-licensed upstream implementation) on a machine with sufficient RAM/CPU, or a GPU if available.
3. Send only user-selected audio files that the user has rights to process; impose upload size, duration, and timeout limits.
4. Return four tested stems (vocals, drums, bass, other) with temporary download URLs or stream them securely. Clean up temporary audio on a schedule.
5. Configure the worker URL only after health checks and a real sample song test. The UI must continue to say “not active” until that test passes.

## Current verified state
- `GET /api/separation-status` returns `available: false`, `mode: "disabled"`.
- `POST /api/separate` returns HTTP 501 in free-safe mode.
- The mixer UI checks the status endpoint and explains that separation is inactive.
- No audio is sent to paid inference services.

## References
- Demucs project and CPU/GPU usage notes: https://github.com/facebookresearch/demucs
- Render free services and ephemeral filesystem: https://render.com/docs/free
- Render background workers: https://render.com/docs/background-workers

## Activation checklist
- [ ] Python worker deployed on explicitly chosen compute (no surprise metered API).
- [ ] Health endpoint confirms the Demucs model is loaded.
- [ ] Test a short, rights-cleared audio file and verify all expected stems exist and are playable.
- [ ] Test timeout, oversized upload, malformed audio, cleanup, and concurrent requests.
- [ ] Only then return `available: true` from the gateway and enable the upload/mixer flow.
