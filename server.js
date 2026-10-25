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
app.get("/api/status", (_req, res) => { res.set("Cache-Control", "no-store"); res.json({ ok: true, service: "music-in-style", analysisProvider: "Magic Chords public API" }); });

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
