# Music in Stil v0.3 — backend-ready starter

This package includes the website and a small Node/Express backend proxy. The browser calls the same-origin `/api/...` routes; the server calls Magic Chords, avoiding browser CORS restrictions.

## What is included
- Existing Hebrew/English responsive website and Apple/iTunes search.
- Three-page local notebook.
- Analysis request through `POST /api/analyze-url`.
- Status/result proxy routes through `/api/jobs/:jobId` and `/api/jobs/:jobId/result`.
- `/health` health check.

## Run locally
Requires Node.js 20+.

```bash
npm install
npm start
```
Then open `http://localhost:3000`.

## Deploy on Render
1. Upload this folder to a GitHub repository (or create a repository and upload the files).
2. Sign in to https://render.com and choose **New + → Blueprint**.
3. Connect the GitHub repository containing `render.yaml`.
4. Accept the service creation. Render builds with `npm install` and runs `npm start`.
5. Open the Render URL and test `/health` — it should return `{"ok":true,...}`.

## Important
- No API key is included or required by the public Magic Chords quick-start docs for basic anonymous fair-use access. Verify current provider limits/terms before commercial use.
- The current implementation analyzes the Apple/iTunes `previewUrl` when one exists, not the full song. Preview links may be inaccessible to the provider or too short for reliable analysis.
- This package has not been deployed or verified against a live analysis job from this environment. Do not treat the API integration as confirmed until tested on the deployed URL.
- Add rate limiting and abuse protection before a public launch. Do not expose provider secrets in browser code.
- The `transcribe` endpoint is not yet wired to the UI; lyrics transcription and lyric/chord alignment need a separate tested integration and rights-compliant source handling.
