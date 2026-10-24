const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "music-in-stil", message: "Music in Stil API is running" });
});

// Safe diagnostic endpoint: confirms the service is deployed without exposing secrets.
app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    service: "music-in-stil",
    magicChordsConfigured: Boolean(process.env.MAGIC_CHORDS_API_KEY)
  });
});

// A clear response instead of a generic "Failed to fetch" if the external API is not configured.
app.post("/api/analyze-url", async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Please provide a song URL in the 'url' field." });
  }

  const apiKey = process.env.MAGIC_CHORDS_API_KEY;
  const apiUrl = process.env.MAGIC_CHORDS_API_URL;

  if (!apiKey || !apiUrl) {
    return res.status(503).json({
      error: "The server is running, but the Magic Chords API is not configured yet.",
      nextStep: "Add MAGIC_CHORDS_API_KEY and MAGIC_CHORDS_API_URL in the Render environment settings."
    });
  }

  try {
    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({ url })
    });
    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!upstream.ok) {
      return res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502)
        .json({ error: "The music analysis provider returned an error.", providerStatus: upstream.status, details: data });
    }
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ error: "Could not reach the music analysis provider.", details: err.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Music in Stil server listening on port ${PORT}`);
});
