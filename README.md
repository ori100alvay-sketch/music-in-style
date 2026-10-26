# Music in Style — Node.js app with an optional local Demucs worker

The Render Blueprint (`render.yaml`) deploys the website/API on the free plan. The main web container is intentionally lightweight and **does not install or start Demucs/PyTorch**. The separate open-source worker scaffold is in `demucs-worker/`; it must be deployed separately on a host with enough CPU, RAM, and disk. No paid inference provider is called.

## Instrument separation: deliberately disabled until verified

The website checks `/api/separation-status` and enables the upload action only when a local Demucs worker responds as ready after a real audio smoke test. Without that proof, the feature remains unavailable and the API returns a clear disabled response. This is intentional: automated CI mocks inference and validates upload handling and ZIP packaging, but does not prove that a neural model can run on the production host.

Do not set smoke-test flags simply to turn the feature on. Only record a successful smoke test after processing an audio file you own or are licensed to use and verifying that the ZIP contains four non-empty files: `vocals.wav`, `drums.wav`, `bass.wav`, and `other.wav`.

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

## Local/open-source stem separation prototype

An opt-in Demucs service scaffold is available in [`separation-service/`](separation-service/README.md). It uses an open-source model locally and does not call Replicate or another paid inference API. It is intentionally **not connected to the production UI/API yet**.

Before enabling it, run the Python unit tests in GitHub Actions and then perform a real audio smoke test on a machine with adequate RAM/CPU (or GPU). The service health endpoint deliberately reports `readyForSeparation: false` until that real model-and-audio test is done. Hosting compute, storage, and model downloads may still incur costs; do not deploy to a paid host without explicit budget approval.

## Optional local Demucs worker (not active until deployed and tested)

A separate Docker/Python worker scaffold is available in `demucs-worker/`. It uses open-source Demucs locally and does not call paid inference providers. It is intentionally **not reported as active** by the main app. Render must deploy this as a separate Docker service, with sufficient RAM/disk, and a real audio test must produce all four stems before the app can safely enable it. The worker requires a `DEMUCS_WORKER_TOKEN` secret for inference. See [demucs-worker/README.md](demucs-worker/README.md).

The existing app's `/api/separate` route is still disabled until a secure integration to that worker is implemented and tested. Adding the scaffold alone does not activate separation.

## BPM and key analysis

The current BPM/key-by-song-name endpoint depends on Brizm. Without a valid `BRIZM_API_KEY`, that provider cannot return data; no API key is generated by this repository. Do not expose a fake success or infer BPM/key from metadata. The key must be supplied by the account owner, or a local audio-analysis engine must be implemented and validated against real audio. The current app keeps the missing-key state explicit.
