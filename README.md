# Music in Stil — corrected Node.js service

This repository is configured as a Node.js web service for Render.

## Deploy on Render
1. Create a **Web Service** from this GitHub repository.
2. Runtime: **Node**.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Do not choose Elixir or Static Site.
6. After deployment, open `/health`; it should return JSON showing the service is running.

## Instrument separation (Demucs via Replicate)
To enable the new **Analyze playback / separate instruments** option:
1. Create a Replicate account and generate an API token at https://replicate.com/account/api-tokens.
2. In Render, open the web service → **Environment** and add `REPLICATE_API_TOKEN` with that token as its value.
3. Save changes and redeploy.
4. Test with a public, direct HTTPS audio-file URL. Spotify/YouTube page URLs and Apple's short preview URLs may not be accepted as direct audio sources.
The token must remain in Render Environment and must never be added to frontend code or committed to GitHub. Replicate usage may incur charges.

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
