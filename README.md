# Music in Style — Node.js app with an optional local Demucs worker

The Render Blueprint (`render.yaml`) deploys the website/API on the free plan. The main web container is intentionally lightweight and **does not install or start Demucs/PyTorch**. The separate open-source worker scaffold is in `demucs-worker/`; it must be deployed separately on a host with enough CPU, RAM, and disk. No paid inference provider is called.

## Instrument separation: deliberately disabled until verified

The website checks `/api/separation-status` and enables the upload action only when a local Demucs worker responds as ready after a real audio smoke test. Without that proof, the feature remains unavailable and the API returns a clear disabled response. This is intentional: automated CI mocks inference and validates upload handling and ZIP packaging, but does not prove that a neural model can run on the production host.

The first successful authenticated separation of an audio file you own or are licensed to use is the smoke test. The worker marks itself ready only after creating and packaging four non-empty files: `vocals.wav`, `drums.wav`, `bass.wav`, and `other.wav`. Readiness resets if the worker process restarts.

### Hosting limitation

Render documents the free web service as 512 MB RAM and 0.1 CPU, which is not a realistic target for dependable Demucs inference. The main site stays lightweight and does not run CPU inference on the free instance. A separate Demucs worker may incur hosting/storage costs; do not deploy it on a paid plan without explicit budget approval.

## Basic deployment checks
- `/health`: confirms the Node.js app is running.
- `/api/separation-status`: reports whether a local worker has passed its readiness gate.
- `/api/separate`: returns a ZIP only when the local worker is verified ready.

## Optional music analysis API
Set these environment variables in Render only after confirming the exact API endpoint and authentication format from your provider:
- `MAGIC_CHORDS_API_KEY`
- `MAGIC_CHORDS_API_URL`

The `/api/analyze-url` endpoint expects JSON such as `{ "url": "https://..." }`.

Important: the proxy is a basic integration template. It does not guarantee compatibility with a third-party provider's exact API schema; verify that schema before enabling real analysis.

## User accounts and password recovery (Supabase Auth)

The app now includes account creation, email/password sign-in, and a "Forgot password" flow. Authentication is handled by Supabase Auth; this app does not store plaintext passwords or recovery codes.

**Required setup before account features can work:**
1. Create a project at https://supabase.com/ and open **Project Settings → API**.
2. In Render → your service → **Environment**, add:
   - `SUPABASE_URL` = your project's Project URL.
   - `SUPABASE_ANON_KEY` = the project's publishable/anon key (never use a service-role key here).
   - `AUTH_REDIRECT_URL` = `https://music-in-style.onrender.com/`
3. In Supabase **Authentication → URL Configuration**, add `https://music-in-style.onrender.com/` to the allowed redirect URLs.
4. In Supabase **Authentication → Email / SMTP**, configure email delivery. For dependable delivery, use a verified SMTP provider and set its credentials in Supabase. Customize the password recovery email template to clearly identify Music in Style.
5. Save settings and redeploy/restart the Render service. Test signup, confirmation email, login, password recovery email, and setting a new password from the recovery link.

Security notes:
- Use Supabase's built-in rate limits and email protections; do not expose any service-role secret in browser code or GitHub.
- The app enforces a 10-character minimum password length and limits request sizes/rates, but the provider configuration and real email delivery must be tested before announcing account support as live.
- Email delivery, allowed redirect URLs, and recovery-link behavior depend on Supabase project settings. Until those environment variables and SMTP settings are configured, the UI reports that account setup is unavailable.

## Local/open-source stem separation

The current integration uses the separate Docker/Python worker in `demucs-worker/` and the main app's `/api/separate` route. It is designed for local open-source Demucs inference only; no audio is sent to Replicate or another paid inference API.

The feature deliberately stays unavailable until the worker is deployed, the main app has the worker HTTPS URL and matching `DEMUCS_WORKER_TOKEN`, and a real licensed audio file produces four valid, non-empty WAV stems. Automated tests mock inference and do not prove that a Render instance has enough CPU/RAM to run Demucs. The free Render tier may be insufficient. Do not select a paid plan without explicit budget approval.

See [DEMucs-DEPLOYMENT.md](DEMucs-DEPLOYMENT.md) for exact Render settings and the smoke-test procedure. The main app's Render Blueprint uses `sync: false` for the worker URL and token so dashboard settings are not reset by future deployments. There is no separate manual enable flag: the main app checks the worker's HTTPS health response, and the worker itself remains unavailable until its real-audio smoke-test gate is satisfied. BPM/key analysis of a selected local file runs in the browser and does not upload the file.

## BPM and key analysis

The current BPM/key-by-song-name endpoint depends on Brizm. Without a valid `BRIZM_API_KEY`, that provider cannot return data; no API key is generated by this repository. Do not expose a fake success or infer BPM/key from metadata. The key must be supplied by the account owner, or a local audio-analysis engine must be implemented and validated against real audio. The current app keeps the missing-key state explicit.
