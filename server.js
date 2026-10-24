import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = 'https://magic-chords.dev/api/v1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

async function forward(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 1000) }; }
  return { status: res.status, body };
}

app.post('/api/analyze-url', async (req, res) => {
  try {
    const mediaUrl = req.body?.url;
    if (typeof mediaUrl !== 'string' || !/^https?:\/\//i.test(mediaUrl)) {
      return res.status(400).json({ error: 'Please provide a public http(s) audio/media URL.' });
    }
    const result = await forward(`${BASE}/analyze/url`, { method: 'POST', body: JSON.stringify({ url: mediaUrl }) });
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Magic Chords API', detail: String(err?.message || err) });
  }
});

app.get('/api/jobs/:jobId', async (req, res) => {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(req.params.jobId)) return res.status(400).json({ error: 'Invalid job id' });
  try {
    const result = await forward(`${BASE}/jobs/${encodeURIComponent(req.params.jobId)}`);
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(502).json({ error: 'Could not check analysis status', detail: String(err?.message || err) });
  }
});

app.get('/api/jobs/:jobId/result', async (req, res) => {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(req.params.jobId)) return res.status(400).json({ error: 'Invalid job id' });
  try {
    const result = await forward(`${BASE}/jobs/${encodeURIComponent(req.params.jobId)}/result`);
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(502).json({ error: 'Could not fetch analysis result', detail: String(err?.message || err) });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'Music in Stil backend' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`Music in Stil listening on ${PORT}`));
