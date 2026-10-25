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
  res.setHeader("Content-Security-Policy", "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https:");
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
// Extra throttling for authentication endpoints to reduce password guessing and signup abuse.
const authRateBuckets = new Map();
app.use("/api/auth", (req, res, next) => {
  const now = Date.now();
  const key = String(req.ip || req.socket.remoteAddress || "unknown");
  for (const [ip, value] of authRateBuckets) if (now - value.startedAt >= 15 * 60_000) authRateBuckets.delete(ip);
  let bucket = authRateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 15 * 60_000) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  authRateBuckets.set(key, bucket);
  res.setHeader("RateLimit-Auth-Limit", "12");
  res.setHeader("RateLimit-Auth-Remaining", String(Math.max(0, 12 - bucket.count)));
  if (bucket.count > 12) {
    res.setHeader("Retry-After", "900");
    return res.status(429).json({ error: "יותר מדי ניסיונות התחברות או הרשמה. נסו שוב בעוד 15 דקות." });
  }
  next();
});

app.use(cors({ origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(",").map(v => v.trim()).filter(Boolean) : false, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "1mb", strict: true }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0, etag: true }));

// Accept only known public music platforms for provider-side URL analysis.
function validatePublicMusicUrl(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = [
    "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com",
    "soundcloud.com", "www.soundcloud.com", "open.spotify.com",
    "music.apple.com", "itunes.apple.com", "bandcamp.com", "www.bandcamp.com",
    "archive.org", "www.archive.org"
  ];
  return allowed.includes(host) ? url : null;
}

async function providerFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000), headers: { Accept: "application/json", ...(options.headers || {}) } });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 1500) }; }
  if (!response.ok) { const error = new Error(data.error || data.detail || data.message || "Music analysis service error"); error.status = response.status; error.details = data; throw error; }
  return data;
}

// Authentication is delegated to Supabase Auth: passwords and recovery tokens are
// never stored by this app. Configure SUPABASE_URL and SUPABASE_ANON_KEY on Render.
function authConfig() {
  const base = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_ANON_KEY || "").trim();
  return base && key ? { base, key } : null;
}
app.get("/api/auth/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const cfg = authConfig();
  res.json({ configured: Boolean(cfg), provider: "Supabase Auth", features: ["signup", "email/password login", "email password recovery"], message: cfg ? "Authentication provider configured." : "יש להגדיר SUPABASE_URL ו-SUPABASE_ANON_KEY ב-Render." });
});
async function supabaseAuth(pathname, body) {
  const cfg = authConfig();
  if (!cfg) { const e = new Error("מערכת החשבונות עדיין לא הוגדרה. יש להוסיף SUPABASE_URL ו-SUPABASE_ANON_KEY ב-Render."); e.status = 503; throw e; }
  const response = await fetch(cfg.base + "/auth/v1/" + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": cfg.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = new Error(data.msg || data.message || data.error_description || data.error || "בקשת החשבון נכשלה.");
    e.status = response.status;
    throw e;
  }
  return data;
}
app.post("/api/auth/signup", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const password = String((req.body || {}).password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "יש להזין כתובת מייל תקינה." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "הסיסמה חייבת להכיל לפחות 10 תווים ועד 128 תווים." });
  try {
    const data = await supabaseAuth("signup", { email, password });
    res.set("Cache-Control", "no-store");
    res.status(201).json({ ok: true, needsEmailConfirmation: !data.access_token, message: data.access_token ? "החשבון נוצר בהצלחה." : "נשלח מייל לאימות החשבון. יש לפתוח אותו כדי להשלים הרשמה.", user: data.user ? { id: data.user.id, email: data.user.email } : null, session: data.access_token ? { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at } : null });
  } catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.status === 429 ? "יותר מדי ניסיונות. נסו שוב מאוחר יותר." : e.message }); }
});

app.post("/api/auth/verify-email", async (req, res) => {
  const tokenHash = String((req.body || {}).token_hash || "").trim();
  const type = String((req.body || {}).type || "signup").trim();
  if (!tokenHash || tokenHash.length > 4096 || !["signup", "email", "recovery", "invite", "magiclink"].includes(type)) {
    return res.status(400).json({ error: "קישור האימות חסר או אינו תקף." });
  }
  try {
    const data = await supabaseAuth("verify", { token_hash: tokenHash, type });
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, user: data.user ? { id: data.user.id, email: data.user.email } : null, session: data.access_token ? { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at } : null, message: type === "recovery" ? "קישור האיפוס אומת." : "כתובת המייל אומתה בהצלחה. אפשר להתחבר." });
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.status === 403 || e.status === 422 ? "קישור האימות פג תוקף או שכבר נוצל. בקשו קישור חדש." : e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const password = String((req.body || {}).password || "");
  if (!email || !password || password.length > 128) return res.status(400).json({ error: "יש להזין מייל וסיסמה." });
  try {
    const data = await supabaseAuth("token?grant_type=password", { email, password });
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, user: { id: data.user.id, email: data.user.email }, session: { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at } });
  } catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.status === 400 || e.status === 401 ? "המייל או הסיסמה אינם נכונים, או שהמייל טרם אומת." : e.status === 429 ? "יותר מדי ניסיונות. נסו שוב מאוחר יותר." : e.message }); }
});
app.post("/api/auth/forgot-password", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "יש להזין כתובת מייל תקינה." });
  const cfg = authConfig();
  if (!cfg) return res.status(503).json({ error: "מערכת איפוס הסיסמה עדיין לא הוגדרה בשרת." });
  try {
    const recoveryUrl = new URL(cfg.base + "/auth/v1/recover");
    recoveryUrl.searchParams.set("redirect_to", String(process.env.AUTH_REDIRECT_URL || "https://music-in-style.onrender.com/"));
    const response = await fetch(recoveryUrl.toString(), {
      method: "POST", headers: { "Content-Type": "application/json", "apikey": cfg.key },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const e = new Error(data.msg || data.message || "לא הצלחנו לשלוח מייל איפוס כרגע.");
      e.status = response.status; throw e;
    }
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, message: "אם הכתובת קיימת במערכת, נשלח אליה מייל עם קישור מאובטח לאיפוס הסיסמה." });
  } catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.status === 429 ? "יותר מדי ניסיונות. נסו שוב מאוחר יותר." : e.message }); }
});
app.post("/api/auth/update-password", async (req, res) => {
  const token = String((req.body || {}).access_token || "");
  const password = String((req.body || {}).password || "");
  if (!token || token.length > 4096) return res.status(401).json({ error: "קישור האיפוס חסר או פג תוקף. בקשו מייל חדש." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "הסיסמה חייבת להכיל לפחות 10 תווים ועד 128 תווים." });
  const cfg = authConfig();
  if (!cfg) return res.status(503).json({ error: "מערכת איפוס הסיסמה עדיין לא הוגדרה בשרת." });
  try {
    const response = await fetch(cfg.base + "/auth/v1/user", {
      method: "PUT", headers: { "Content-Type": "application/json", "apikey": cfg.key, "Authorization": "Bearer " + token },
      body: JSON.stringify({ password }), signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const e = new Error(data.msg || data.message || "קישור האיפוס אינו תקף."); e.status = response.status; throw e; }
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, message: "הסיסמה עודכנה בהצלחה. אפשר להתחבר עם הסיסמה החדשה." });
  } catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.status === 401 || e.status === 403 ? "קישור האיפוס פג תוקף. בקשו מייל חדש." : e.message }); }
});

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
  res.json({
    service: "music-in-style",
    generatedAt: new Date().toISOString(),
    capabilities: {
      songSearch: { available: true, provider: "Apple iTunes Search", note: "Search metadata and short previews; not full-song access." },
      freeLyricsSearch: { available: true, provider: "LRCLIB", keyRequired: false, endpoint: "/api/lyrics-search" },
      freeMusicMetadata: { available: true, provider: "MusicBrainz", keyRequired: false, endpoint: "/api/music-metadata", note: "Free for non-commercial use; rate limited to about one request per second." },
      freeTrackSearch: { available: true, provider: "Deezer", keyRequired: false, endpoint: "/api/deezer-search", note: "Public track metadata and preview URLs when supplied by the provider." },
      freeRadioDirectory: { available: true, provider: "Radio Browser", keyRequired: false, endpoint: "/api/radio-search" },
      freeCoverArt: { available: true, provider: "Cover Art Archive", keyRequired: false, endpoint: "/api/cover-art/:releaseId" },
      musicTheory: { available: true, provider: "Built-in Music in Style Theory Engine", features: ["scales and modes", "chord construction", "diatonic triads", "progression analysis", "transposition", "maqam approximations"], note: "Rule-based theory calculations; not a replacement for audio recognition or expert maqam performance analysis." },
      chordAnalysis: { available: true, provider: "Magic Chords", mode: "async-url", note: "Requires a public URL accepted by the provider; lyrics are not guaranteed." },
      lyricsTranscription: { available: true, provider: "Magic Chords", mode: "async-url", note: "Separate transcription job; accuracy depends on audio and provider output." },
      keyAndTempo: { available: brizmConfigured, configured: brizmConfigured, provider: "Brizm", needs: brizmConfigured ? [] : ["BRIZM_API_KEY"] },
      stemSeparation: { available: false, configured: false, provider: "Disabled in free-safe mode", needs: ["A local/open-source Demucs runtime"], note: "No audio is sent to paid inference services." },
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


// Free, keyless lyrics search via LRCLIB. Respect its rate limits and identify the client.
app.get("/api/lyrics-search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 180);
  if (!q) return res.status(400).json({ error: "יש להזין שם שיר או אמן." });
  try {
    const url = new URL("https://lrclib.net/api/search");
    url.searchParams.set("q", q);
    const data = await providerFetch(url.toString(), { headers: { "User-Agent": "MusicInStyle/1.0 (https://music-in-style.onrender.com)" } });
    res.set("Cache-Control", "public, max-age=300");
    res.json({ provider: "LRCLIB", free: true, results: Array.isArray(data) ? data.slice(0, 10).map(x => ({
      id: x.id, title: x.trackName || x.name || "", artist: x.artistName || "",
      album: x.albumName || "", duration: x.duration || null,
      instrumental: Boolean(x.instrumental), synced: Boolean(x.syncedLyrics),
      lyrics: x.plainLyrics || null, syncedLyrics: x.syncedLyrics || null
    })) : [] });
  } catch (e) {
    const status = e.status === 429 ? 429 : 502;
    res.status(status).json({ error: status === 429 ? "שירות המילים ביקש להמתין. נסו שוב בעוד מעט." : "שירות המילים החינמי לא זמין כרגע." });
  }
});

// Free music metadata lookup via MusicBrainz. Non-commercial use; one request per second.
app.get("/api/music-metadata", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 180);
  if (!q) return res.status(400).json({ error: "יש להזין שם שיר או אמן." });
  try {
    const url = new URL("https://musicbrainz.org/ws/2/recording/");
    url.searchParams.set("query", q);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "8");
    const data = await providerFetch(url.toString(), { headers: { "User-Agent": "MusicInStyle/1.0 (https://music-in-style.onrender.com)" } });
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ provider: "MusicBrainz", free: true, results: (data.recordings || []).slice(0, 8).map(x => ({
      id: x.id, title: x.title || "", artist: (x["artist-credit"] || []).map(a => a.name || a.artist?.name || "").join(""),
      lengthMs: x.length || null, firstReleaseDate: x["first-release-date"] || null,
      disambiguation: x.disambiguation || ""
    })) });
  } catch (e) {
    res.status(e.status === 503 ? 503 : 502).json({ error: "שירות פרטי המוזיקה לא זמין כרגע. נסו שוב מאוחר יותר." });
  }
});

// Free public catalogue search (metadata + preview URLs where available).
app.get("/api/deezer-search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 180);
  if (!q) return res.status(400).json({ error: "יש להזין שם שיר או אמן." });
  try {
    const url = new URL("https://api.deezer.com/search/track");
    url.searchParams.set("q", q); url.searchParams.set("limit", "10");
    const data = await providerFetch(url.toString());
    res.set("Cache-Control", "public, max-age=300");
    res.json({ provider: "Deezer", free: true, results: (data.data || []).slice(0, 10).map(x => ({
      id: x.id, title: x.title || "", artist: x.artist?.name || "",
      album: x.album?.title || "", artwork: x.album?.cover_medium || "",
      previewUrl: x.preview || "", duration: x.duration || null,
      link: x.link || ""
    })) });
  } catch (e) {
    res.status(502).json({ error: "חיפוש Deezer אינו זמין כרגע." });
  }
});

// Free community-maintained internet radio directory.
app.get("/api/radio-search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const country = String(req.query.country || "").trim().slice(0, 2).toUpperCase();
  try {
    const url = new URL("https://de1.api.radio-browser.info/json/stations/search");
    if (q) url.searchParams.set("name", q);
    if (country && /^[A-Z]{2}$/.test(country)) url.searchParams.set("countrycode", country);
    url.searchParams.set("hidebroken", "true"); url.searchParams.set("limit", "15");
    const data = await providerFetch(url.toString());
    res.set("Cache-Control", "public, max-age=300");
    res.json({ provider: "Radio Browser", free: true, results: (Array.isArray(data) ? data : []).slice(0, 15).map(x => ({
      name: x.name || "", country: x.country || "", language: x.language || "",
      tags: x.tags || "", codec: x.codec || "", bitrate: x.bitrate || 0,
      streamUrl: x.url_resolved || x.url || "", homepage: x.homepage || ""
    })).filter(x => /^https?:\/\//i.test(x.streamUrl)) });
  } catch (e) {
    res.status(502).json({ error: "ספריית תחנות הרדיו לא זמינה כרגע." });
  }
});

// Cover Art Archive: artwork lookup by MusicBrainz release ID.
app.get("/api/cover-art/:releaseId", async (req, res) => {
  const id = String(req.params.releaseId || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "מזהה הוצאה לא תקין." });
  try {
    const data = await providerFetch("https://coverartarchive.org/release/" + encodeURIComponent(id));
    res.set("Cache-Control", "public, max-age=86400");
    res.json({ provider: "Cover Art Archive", free: true, images: (data.images || []).slice(0, 8).map(x => ({
      front: Boolean(x.front), back: Boolean(x.back),
      image: x.image || "", thumbnails: x.thumbnails || {}
    })) });
  } catch (e) {
    res.status(e.status === 404 ? 404 : 502).json({ error: e.status === 404 ? "לא נמצאה עטיפה להוצאה הזאת." : "מאגר העטיפות לא זמין כרגע." });
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
  const songUrl = validatePublicMusicUrl(input);
  if (!songUrl) return res.status(400).json({ error: "מטעמי אבטחה, ניתן לנתח רק קישורי HTTPS ציבוריים מפלטפורמות מוזיקה נתמכות (YouTube, SoundCloud, Spotify, Apple Music, Bandcamp או Archive.org)." });
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
  const songUrl = validatePublicMusicUrl(input);
  if (!songUrl) return res.status(400).json({ error: "מטעמי אבטחה, ניתן לתמלל רק קישורי HTTPS ציבוריים מפלטפורמות מוזיקה נתמכות." });
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

// Free-safe mode: do not submit inference jobs to paid third-party services.
// True AI stem separation needs a model runtime; this Node/Render setup has no local
// Demucs runtime configured. Return an honest explanation instead of causing charges.
app.post("/api/separate", async (_req, res) => {
  return res.status(501).json({
    error: "הפרדת כלים ב-AI אינה זמינה כרגע במצב חינמי. כדי למנוע חיובים, האתר לא שולח את השמע לשירות חיצוני בתשלום. צריך לחבר מנוע הפרדה חינמי שרץ על השרת או במכשיר לפני שאפשר להפריד שיר אוטומטית.",
    providerStatus: null,
    freeMode: true
  });
});

// No paid Replicate polling route is exposed in free-safe mode.
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
