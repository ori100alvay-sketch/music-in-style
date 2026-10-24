# Music in Stil — corrected Node.js service

This repository is configured as a Node.js web service for Render.

## Deploy on Render
1. Create a **Web Service** from this GitHub repository.
2. Runtime: **Node**.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Do not choose Elixir or Static Site.
6. After deployment, open `/health`; it should return JSON showing the service is running.

## Optional music analysis API
Set these environment variables in Render only after confirming the exact API endpoint and authentication format from your provider:
- `MAGIC_CHORDS_API_KEY`
- `MAGIC_CHORDS_API_URL`

The `/api/analyze-url` endpoint expects JSON such as `{ "url": "https://..." }`.

Important: the proxy is a basic integration template. It does not guarantee compatibility with a third-party provider's exact API schema; verify that schema before enabling real analysis.
