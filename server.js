const express = require("express");
const cors = require("cors");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 10000;
const MAGIC_CHORDS = "https://magic-chords.dev/api/v1";
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0, etag: true }));

async function providerFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000), headers: { Accept: "application/json", ...(options.headers || {}) } });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 1500) }; }
  if (!response.ok) { const error = new Error(data.error || data.detail || data.message || "Music analysis service error"); error.status = response.status; error.details = data; throw error; }
  return data;
}
app.get("/health", (_req, res) => { res.set("Cache-Control", "no-store"); res.json({ ok: true, service: "music-in-style", message: "Music in Style server is running" }); });
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
    const response = await fetch("https://api.replicate.com/v1/models/cjwbw/demucs/predictions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Prefer": "wait=5" },
      body: JSON.stringify({ input: { audio: audioUrl.toString(), model_name: "htdemucs", output_format: "mp3", mp3_bitrate: 320 } }),
      signal: AbortSignal.timeout(25000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
      console.error("Demucs submission failed:", response.status, JSON.stringify(data).slice(0, 1200));
      const providerMessage = String(data.detail || data.error || data.title || "").slice(0, 240);
      let message = "מנוע הפרדת הכלים דחה את השמע.";
      if (response.status === 401 || response.status === 403) message = "מנוע ההפרדה דחה את הרשאת השרת. יש לבדוק את REPLICATE_API_TOKEN ב-Render.";
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
