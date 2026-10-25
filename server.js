const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const REQUEST_TIMEOUT_MS = 25000;

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  etag: true
}));

app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "music-in-style", message: "Music in Style server is running" });
});

app.get("/api/status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    service: "music-in-style",
    magicChordsConfigured: Boolean(process.env.MAGIC_CHORDS_API_KEY && process.env.MAGIC_CHORDS_API_URL)
  });
});

app.post("/api/analyze-url", async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "Please provide a song URL in the 'url' field." });
  }

  let songUrl;
  try {
    songUrl = new URL(url.trim());
    if (!["http:", "https:"].includes(songUrl.protocol)) throw new Error("Unsupported URL protocol");
  } catch {
    return res.status(400).json({ error: "Please provide a valid http or https song URL." });
  }

  const apiKey = process.env.MAGIC_CHORDS_API_KEY;
  const apiUrl = process.env.MAGIC_CHORDS_API_URL;
  if (!apiKey || !apiUrl) {
    return res.status(503).json({
      error: "The server is running, but the music analysis provider is not configured yet.",
      nextStep: "Configure MAGIC_CHORDS_API_KEY and MAGIC_CHORDS_API_URL in the Render environment settings."
    });
  }

  let providerUrl;
  try {
    providerUrl = new URL(apiUrl);
    if (!["http:", "https:"].includes(providerUrl.protocol)) throw new Error("Unsupported provider protocol");
  } catch {
    return res.status(500).json({ error: "The music analysis provider URL is configured incorrectly." });
  }

  try {
    const upstream = await fetch(providerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({ url: songUrl.toString() }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 2000) }; }

    if (!upstream.ok) {
      const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      return res.status(status).json({
        error: "The music analysis provider returned an error.",
        providerStatus: upstream.status,
        details: data
      });
    }
    return res.json(data);
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return res.status(504).json({ error: "The music analysis provider took too long to respond. Please try again." });
    }
    console.error("Music analysis provider request failed:", err.message);
    return res.status(502).json({ error: "Could not reach the music analysis provider. Please try again later." });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Request body must contain valid JSON." });
  }
  console.error("Unhandled server error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Music in Style server listening on port ${PORT}`);
});
