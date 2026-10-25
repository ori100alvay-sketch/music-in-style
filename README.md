# Music in Stil — corrected Node.js service

This repository is configured as a Node.js web service for Render.

## Deploy on Render
1. Create a **Web Service** from this GitHub repository.
2. Runtime: **Node**.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Do not choose Elixir or Static Site.
6. After deployment, open `/health`; it should return JSON showing the service is running.

## Instrument separation — free-safe mode

Automatic AI stem separation is intentionally disabled by default to prevent unexpected third-party inference charges. The current Node.js/Render service does not include a local Demucs model runtime, and Replicate inference is a paid service. The `/api/separate` endpoint now returns a clear `501` explanation without submitting audio to Replicate.

To enable genuinely no-charge separation, a local/open-source model runtime must be deployed somewhere with enough CPU/RAM/GPU capacity, or the browser app must run a compatible model locally. Do not add a paid API token or route audio to a paid inference provider if zero cost is a strict requirement. A free hosting tier may still have compute limits and cannot be assumed to run Demucs reliably.

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
