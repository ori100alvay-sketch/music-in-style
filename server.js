const express = require("express");
const cors = require("cors");
const path = require("path");
const theory = require("./music-theory");
const app = express();
const PORT = process.env.PORT || 10000;
const MAGIC_CHORDS = "https://magic-chords.dev/api/v1";
app.disable("x-powered-by");
// Render terminates TLS and forwards one trusted proxy hop.
app.set("trust proxy", 1);
// Security headers: the UI currently uses inline scripts/styles, so the CSP is
// deliberately compatible with the existing app while blocking plugins/frames.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https:");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
// Lightweight per-process rate limiting for API abuse. For multi-instance production,
// use the hosting provider/WAF or a shared store so limits apply across instances.
const rateBuckets = new Map();
let rateLimitRequestsSinceCleanup = 0;
app.use("/api", (req, res, next) => {
  const now = Date.now();
  // Prune expired client buckets periodically, not only after the map grows large.
  // This prevents idle IP addresses from accumulating indefinitely on a long-lived process.
  rateLimitRequestsSinceCleanup += 1;
  if (rateLimitRequestsSinceCleanup >= 100 || rateBuckets.size > 5000) {
    for (const [ip, value] of rateBuckets) {
      if (now - value.startedAt >= 60_000) rateBuckets.delete(ip);
    }
    rateLimitRequestsSinceCleanup = 0;
  }
  const key = String(req.ip || req.socket.remoteAddress || "unknown");
  const windowMs = 60_000;
  const limit = req.path.startsWith("/jobs/") || req.path.startsWith("/separate/") ? 90 : 30;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
  if (bucket.count > limit) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "יותר מדי בקשות בפרק זמן קצר. נסו שוב בעוד דקה." });
  }
  rateBuckets.set(key, bucket);
  next();
});
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(",").map(v => v.trim()).filter(Boolean) : false, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "1mb", strict: true }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0, etag: true }));

async function providerFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000), headers: { Accept: "application/json", ...(options.headers || {}) } });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 1500) }; }
  if (!response.ok) { const error = new Error(data.error || data.detail || data.message || "Music analysis service error"); error.status = response.status; error.details = data; throw error; }
  return data;
}
app.get("/api/music-theory", (req, res) => {
  res.set("Cache-Control", "no-store");
  const result = theory.getTheory({
    mode: String(req.query.mode || "scale"),
    root: String(req.query.root || "C"),
    scale: String(req.query.scale || "major"),
    chord: String(req.query.chord || ""),
    chords: String(req.query.chords || ""),
    maqam: String(req.query.maqam || "hijaz")
  });
  if (result.error) return res.status(400).json(result);
  res.json({ ...result, engine: "Music in Style Theory Engine", engineVersion: 1, note: "תיאוריה וחישוב מוזיקלי; ניתוח שמע בפועל דורש מנוע אודיו נפרד." });
});
app.get("/health", (_req, res) => { res.set("Cache-Control", "no-store"); res.json({ ok: true, service: "music-in-style", message: "Music in Style server is running" }); });
// Honest capability discovery for the UI and support diagnostics. "configured" means
// a server-side credential exists; it does not claim that a provider is healthy or paid.
app.get("/api/capabilities", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const brizmConfigured = Boolean(String(process.env.BRIZM_API_KEY || "").trim());
  const replicateConfigured = Boolean(String(process.env.REPLICATE_API_TOKEN || "").trim());
  res.json({
    service: "music-in-style",
    generatedAt: new Date().toISOString(),
    capabilities: {
      songSearch: { available: true, provider: "Apple iTunes Search", note: "Search metadata and short previews; not full-song access." },
      chordAnalysis: { available: true, provider: "Magic Chords", mode: "async-url", note: "Requires a public URL accepted by the provider; lyrics are not guaranteed." },
      lyricsTranscription: { available: true, provider: "Magic Chords", mode: "async-url", note: "Separate transcription job; accuracy depends on audio and provider output." },
      keyAndTempo: { available: brizmConfigured, configured: brizmConfigured, provider: "Brizm", needs: brizmConfigured ? [] : ["BRIZM_API_KEY"] },
      stemSeparation: { available: replicateConfigured, configured: replicateConfigured, provider: "Replicate Demucs", needs: replicateConfigured ? [] : ["REPLICATE_API_TOKEN"] },
      personalNotebook: { available: true, storage: "browser-local", note: "Data is stored in this browser/device unless exported by the user." }
    },
    security: { credentialsServerSideOnly: true, apiRateLimit: "per-process", requestBodyLimitBytes: 1048576, distributedRateLimit: false }
  });
});

const BRIZM_API = "https://api.brizm.dev";
function brizmHeaders(extra = {}) {
  const key = process.env.BRIZM_API_KEY;
  if (!key) return null;
  return { Authorization: "Bearer " + key, ...extra };
}
app.get("/api/brizm-status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ configured: Boolean(process.env.BRIZM_API_KEY), provider: "Brizm", features: ["song metadata analysis", "BPM/key", "4-stem separation for supported audio inputs"] });
});
app.get("/api/brizm/key-bpm", async (req, res) => {
  const headers = brizmHeaders();
  if (!headers) return res.status(503).json({ error: "Brizm עדיין לא מוגדר. הוסף BRIZM_API_KEY ב-Environment של Render." });
  const song = String(req.query.song || "").trim().slice(0, 180);
  const artist = String(req.query.artist || "").trim().slice(0, 180);
  if (!song || !artist) return res.status(400).json({ error: "נדרשים שם שיר ושם אמן." });
  try {
    const url = new URL(BRIZM_API + "/v1/audio-features");
    url.searchParams.set("song", song);
    url.searchParams.set("artist", artist);
    const data = await providerFetch(url.toString(), { headers });
    res.set("Cache-Control", "no-store");
    res.json({ provider: "Brizm", song: data.title || song, artist: data.artist || artist, tempo: data.tempo ?? null, key: data.key ?? null, mode: data.mode ?? null, camelot: data.camelot ?? null, energy: data.energy ?? null, meta: data._meta ?? null });
  } catch (err) {
    console.error("Brizm key/BPM error:", err.status, err.message);
    const status = err.status === 404 ? 404 : err.status === 402 ? 402 : err.status === 401 ? 503 : 502;
    res.status(status).json({ error: err.status === 404 ? "Brizm לא מצא נתוני ניתוח לשיר הזה." : err.status === 402 ? "אין מספיק קרדיטים בחשבון Brizm." : err.status === 401 ? "מפתח Brizm אינו תקין." : "Brizm לא הצליח לנתח את השיר כרגע.", providerStatus: err.status || null });
  }
});

app.get("/api/status", (_req, res) => { res.set("Cache-Control", "no-store"); res.json({ ok: true, service: "music-in-style", analysisProvider: "Magic Chords public API", replicateTokenConfigured: Boolean(String(process.env.REPLICATE_API_TOKEN || "").trim()) }); });
app.get("/api/replicate-status", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const token = String(process.env.REPLICATE_API_TOKEN || "").trim();
  if (!token) return res.status(503).json({ ok: false, configured: false, message: "Replicate token is missing from server environment." });
  try {
    const response = await fetch("https://api.replicate.com/v1/account", {
      headers: { "Authorization": "Bearer " + token, "Accept": "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    if (response.ok) return res.json({ ok: true, configured: true, authenticated: true, message: "Replicate API token is accepted." });
    const status = response.status;
    console.error("Replicate credential check failed:", status);
    return res.status(200).json({ ok: true, configured: true, authenticated: false, providerStatus: status, message: status === 401 || status === 403 ? "Replicate rejected the token. Create a new token and update REPLICATE_API_TOKEN in Render." : "Replicate credential check returned a non-success response." });
  } catch (err) {
    console.error("Replicate credential check error:", err.message);
    return res.status(200).json({ ok: true, configured: true, authenticated: null, message: "Could not reach Replicate to verify the token right now." });
  }
});


app.get("/api/search-song", async (req, res) => {
  const term = String(req.query.q || "").trim();
  if (term.length < 2) return res.status(400).json({ error: "נא להקליד שם שיר או שם אמן." });
  if (term.length > 160) return res.status(400).json({ error: "החיפוש ארוך מדי." });
  try {
    const searchUrl = new URL("https://itunes.apple.com/search");
    searchUrl.searchParams.set("term", term); searchUrl.searchParams.set("entity", "song"); searchUrl.searchParams.set("limit", "8"); searchUrl.searchParams.set("country", "IL");
    const data = await providerFetch(searchUrl.toString());
    const results = (data.results || []).map(track => ({ id: track.trackId, title: track.trackName, artist: track.artistName, album: track.collectionName || "", artwork: track.artworkUrl100 || "", previewUrl: track.previewUrl || "", trackUrl: track.trackViewUrl || "" }));
    res.json({ results });
  } catch (err) { console.error("Song search failed:", err.message); res.status(502).json({ error: "חיפוש השירים לא זמין כרגע. אפשר לנסות שוב או להדביק קישור ישיר לשיר." }); }
});

app.post("/api/analyze-url", async (req, res) => {
  const input = String((req.body || {}).url || "").trim();
  let songUrl;
  try { songUrl = new URL(input); if (!["http:", "https:"].includes(songUrl.protocol)) throw new Error("Unsupported URL protocol"); }
  catch { return res.status(400).json({ error: "יש להדביק קישור תקין לשיר, או לחפש לפי שם השיר או האמן." }); }
  try {
    const job = await providerFetch(MAGIC_CHORDS + "/analyze/url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: songUrl.toString() }) });
    if (!job.job_id) return res.status(502).json({ error: "שירות הניתוח לא החזיר מזהה משימה." });
    res.status(202).json({ job_id: job.job_id, status: job.status || "processing", message: "הניתוח התחיל." });
  } catch (err) {
    console.error("Analysis submission failed:", err.message);
    res.status(err.status === 429 ? 429 : 502).json({ error: err.status === 429 ? "שירות הניתוח הגיע למגבלת הבקשות הזמנית. נסו שוב מאוחר יותר." : "לא הצלחנו להתחיל את ניתוח השיר. ודאו שהקישור מוביל למדיה ציבורית ונסו שוב.", providerStatus: err.status || null });
  }
});


// Start a separate lyrics transcription job. Chord analysis alone does not guarantee lyrics.
app.post("/api/transcribe-url", async (req, res) => {
  const input = String((req.body || {}).url || "").trim();
  let songUrl;
  try { songUrl = new URL(input); if (!["http:", "https:"].includes(songUrl.protocol)) throw new Error("Unsupported URL protocol"); }
  catch { return res.status(400).json({ error: "יש להדביק קישור תקין למדיה ציבורית." }); }
  try {
    const job = await providerFetch(MAGIC_CHORDS + "/transcribe/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: songUrl.toString() })
    });
    if (!job.job_id) return res.status(502).json({ error: "שירות תמלול המילים לא החזיר מזהה משימה." });
    res.status(202).json({ job_id: job.job_id, status: job.status || "processing" });
  } catch (err) {
    console.error("Transcription submission failed:", err.status, err.message);
    res.status(err.status === 429 ? 429 : 502).json({
      error: err.status === 429 ? "שירות התמלול הגיע למגבלת הבקשות. נסו שוב מאוחר יותר." : "לא הצלחנו להתחיל תמלול מילים לשיר הזה.",
      providerStatus: err.status || null
    });
  }
});

// Optional Replicate-backed Demucs separation. Configure REPLICATE_API_TOKEN in Render Environment.
app.post("/api/separate", async (req, res) => {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(503).json({ error: "מנוע הפרדת הכלים עדיין לא הופעל בשרת. יש להוסיף REPLICATE_API_TOKEN בהגדרות Environment של Render." });
  const rawUrl = String((req.body || {}).url || "").trim();
  let audioUrl;
  try {
    audioUrl = new URL(rawUrl);
    if (audioUrl.protocol !== "https:") throw new Error("HTTPS required");
  } catch { return res.status(400).json({ error: "נדרש קישור HTTPS ישיר לקובץ שמע ציבורי (MP3/WAV וכדומה)." }); }
  try {
    // Replicate requires an explicit version for community models such as cjwbw/demucs.
    // Creating through /v1/predictions avoids the old model-scoped endpoint that can return 404.
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Prefer": "wait=5" },
      body: JSON.stringify({
        version: "25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953",
        input: { audio: audioUrl.toString(), model_name: "htdemucs", output_format: "mp3", mp3_bitrate: 320 }
      }),
      signal: AbortSignal.timeout(25000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
      console.error("Demucs submission failed:", response.status, JSON.stringify(data).slice(0, 1200));
      const providerMessage = String(data.detail || data.error || data.title || "").slice(0, 240);
      let message = "מנוע הפרדת הכלים דחה את השמע.";
      if (response.status === 401 || response.status === 403) message = "מנוע ההפרדה דחה את הרשאת השרת. יש לבדוק את REPLICATE_API_TOKEN ב-Render.";
            else if (response.status === 404) message = "מנוע ההפרדה לא נמצא בכתובת השירות. עדכנו את כתובת המנוע או את גרסת המודל.";
      else if (response.status === 429) message = "מנוע ההפרדה עמוס או שמכסת השימוש הסתיימה. נסו שוב מאוחר יותר.";
      else if (response.status === 422 || response.status === 400) message = "מנוע ההפרדה לא הצליח לקבל את קובץ השמע. ייתכן שהקישור אינו קובץ שמע נגיש או שהפורמט אינו נתמך.";
      return res.status(response.status === 429 ? 429 : 502).json({ error: message, providerStatus: response.status, providerMessage });
    }
    res.status(202).json({ id: data.id, status: data.status || "starting" });
  } catch (err) {
    console.error("Demucs submission error:", err.message);
    res.status(502).json({ error: "לא הצלחנו להתחבר למנוע הפרדת הכלים כרגע." });
  }
});
app.get("/api/separate/:predictionId", async (req, res) => {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(503).json({ error: "מנוע הפרדת הכלים לא מוגדר בשרת." });
  const id = String(req.params.predictionId || "");
  if (!/^[a-zA-Z0-9_-]{4,100}$/.test(id)) return res.status(400).json({ error: "מזהה הפרדה לא תקין." });
  try {
    const response = await fetch("https://api.replicate.com/v1/predictions/" + encodeURIComponent(id), {
      headers: { "Authorization": "Bearer " + token, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "לא הצלחנו לקבל את מצב הפרדת הכלים." });
    res.set("Cache-Control", "no-store");
    res.json({ status: data.status, output: data.output || null, error: data.error || null });
  } catch (err) {
    console.error("Demucs status error:", err.message);
    res.status(502).json({ error: "שגיאה בבדיקת מצב הפרדת הכלים." });
  }
});

app.get("/api/jobs/:jobId", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  if (!/^[a-zA-Z0-9_-]{4,160}$/.test(jobId)) return res.status(400).json({ error: "מזהה ניתוח לא תקין." });
  try {
    const status = await providerFetch(MAGIC_CHORDS + "/jobs/" + encodeURIComponent(jobId));
    const state = String(status.status || status.state || "").toLowerCase();
    if (["complete", "completed", "succeeded", "success", "done"].includes(state)) {
      const result = await providerFetch(MAGIC_CHORDS + "/jobs/" + encodeURIComponent(jobId) + "/result");
      return res.json({ status: "complete", result });
    }
    if (["failed", "error", "cancelled", "canceled"].includes(state)) return res.status(422).json({ status: "failed", error: status.error || status.message || "ניתוח השיר נכשל. נסו קישור אחר." });
    return res.json({ status: state || "processing", message: "השיר עדיין בתהליך ניתוח." });
  } catch (err) {
    console.error("Analysis status check failed:", err.message);
    return res.status(err.status === 404 ? 404 : 502).json({ error: err.status === 404 ? "לא נמצא ניתוח עבור השיר הזה." : "לא הצלחנו לבדוק את מצב הניתוח כרגע." });
  }
});
app.use((err, _req, res, _next) => { if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ error: "Request body must contain valid JSON." }); console.error("Unhandled server error:", err.message); res.status(500).json({ error: "Internal server error" }); });
app.listen(PORT, "0.0.0.0", () => console.log(`Music in Style server listening on port ${PORT}`));
