# Music in Style — Node.js app with a guarded local Demucs worker

The Render Blueprint (`render.yaml`) describes a free Docker web service. The image includes a CPU-only open-source Demucs runtime, but the worker process is **disabled by default** (`DEMUCS_ENABLE_LOCAL_WORKER=false`) so it does not compete with the website for the free instance's limited RAM/CPU. The browser UI calls the local worker only after `/api/separation-status` confirms that the worker reports readiness.

## Instrument separation: deliberately health-gated

The integration is committed, but **separation must remain unavailable until a real smoke test has run against an actual audio file and produced all four expected stems**. Automated CI mocks Demucs inference to test upload validation, error handling and ZIP packaging; it does not prove that the neural model can run successfully on the deployed host.

No Replicate or other paid inference API is called by this worker. Do not set `DEMUCS_SMOKE_TEST_OK=true` just to enable the UI: only set it after a real separation test succeeds and the four output files have been verified.

### Hosting limitation

Render's free web service plan has 512 MB RAM and 0.1 CPU, which is not a realistic target for reliable Demucs CPU inference. The worker process is not started unless `DEMUCS_ENABLE_LOCAL_WORKER=true`; even then, the UI stays disabled until the worker passes a real smoke test and returns four stems. A dependable self-hosted Demucs service likely needs a host with substantially more memory/CPU. Do not upgrade or enable paid services without explicit budget approval.

## Basic deployment checks
- `/health`: confirms the Node.js app is running.
- `/api/separation-status`: reports whether the local worker has passed its readiness gate.
- `/api/separate`: accepts only supported audio uploads, and returns a ZIP only when the local worker is verified ready.

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
