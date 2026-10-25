const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
const worker = fs.readFileSync('public/sw.js', 'utf8');
const legal = fs.readFileSync('public/copyright.html', 'utf8');

test('app has responsive viewport, Hebrew RTL, reduced motion support and mobile breakpoints', () => {
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1"/);
  assert.match(html, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /@media\s*\(max-width:\s*640px\)/);
  assert.match(html, /:focus-visible|focus-visible/);
});

test('Apple and installable web app metadata is configured', () => {
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-mobile-web-app-status-bar-style/);
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.src === '/icon.svg'));
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /request\.mode === "navigate"/);
});

test('server sets baseline browser security headers and request limits', () => {
  for (const header of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy']) {
    assert.ok(server.includes(header), 'missing security header: ' + header);
  }
  assert.match(server, /app\.use\("\/api",\s*\(req, res, next\)/);
  assert.match(server, /Retry-After/);
  assert.match(server, /rateLimitRequestsSinceCleanup >= 100/);
  assert.match(server, /now - value\.startedAt >= 60_000/);
  assert.match(server, /express\.json\(\{ limit: "1mb", strict: true \}\)/);
  assert.match(server, /process\.env\.ALLOWED_ORIGIN/);
});

test('legal notice page is linked and covers user permissions and takedown reports', () => {
  assert.match(html, /href="\/copyright\.html"/);
  assert.match(legal, /חוק זכות יוצרים/);
  assert.match(legal, /ההרשאות הנדרשות/);
  assert.match(legal, /דיווח על הפרת זכויות/);
});

test('no API credentials are embedded in public frontend source', () => {
  assert.doesNotMatch(html, /(?:sk-[A-Za-z0-9]{20,}|REPLICATE_API_TOKEN\s*=\s*["'][^"']+|BRIZM_API_KEY\s*=\s*["'][^"']+)/);
});

test('capabilities endpoint distinguishes built-in features from credential-gated AI services', () => {
  assert.match(server, /app\.get\("\/api\/capabilities"/);
  assert.match(server, /credentialsServerSideOnly: true/);
  assert.match(server, /distributedRateLimit: false/);
  assert.match(server, /lyricsTranscription:/);
  assert.match(server, /stemSeparation:/);
  assert.match(server, /needs: replicateConfigured \? \[\] : \["REPLICATE_API_TOKEN"\]/);
  assert.match(server, /needs: brizmConfigured \? \[\] : \["BRIZM_API_KEY"\]/);
});

test('music notebook supports validated backup export and cross-device import', () => {
  assert.match(html, /exportNotebookBackup/);
  assert.match(html, /importNotebookBackup/);
  assert.match(html, /schemaVersion:1/);
  assert.match(html, /file\.size>2097152/);
  assert.match(html, /data\.pages\.length>100/);
  assert.match(html, /data\.songs\.length>500/);
  assert.match(html, /ייבוא הגיבוי יחליף את המחברת/);
});

test('accessibility panel offers keyboard-friendly visual adjustments and reset controls', () => {
  assert.match(html, /id="accessToggle"/);
  assert.match(html, /aria-controls="accessPanel"/);
  assert.match(html, /id="a11yContrast"/);
  assert.match(html, /id="a11yMotion"/);
  assert.match(html, /id="a11yScale"/);
  assert.match(html, /e\.key==='Escape'/);
});

test('chord QA lab checks syntax, duplicate chords, transposition and round-trip consistency', () => {
  assert.match(html, /id='chordQaLab'/);
  assert.match(html, /const chordPattern=/);
  assert.match(html, /אקורדים שחוזרים ברצף/);
  assert.match(html, /בדיקת חזרה לסולם המקורי/);
  assert.match(html, /מבנה האקורדים תקין לפי בדיקת התחביר הבסיסית/);
});

test('stem separation playback validates HTTPS URLs and exposes group transport controls', () => {
  assert.match(html, /https:/i);
  assert.match(html, /id="stemPlayAll"/);
  assert.match(html, /id="stemPauseAll"/);
  assert.match(html, /id="stemResetAll"/);
  assert.match(html, /Promise\.allSettled\(stemAudios\.map\(audio=>audio\.play\(\)\)\)/);
  assert.match(html, /audio\.volume=Number\(input\.value\)\/100/);
});
test('timed lyric and chord alignment handles provider variants and bounded chord intervals', () => {
  assert.match(html, /function buildTimedAlignment\(data\)/);
  assert.match(html, /start_ms/);
  assert.match(html, /end_ms/);
  assert.match(html, /const scoreWords=/);
  assert.match(html, /const scoreChords=/);
  assert.match(html, /word\.start<=event\.end\+0\.08/);
  assert.match(html, /Keep lyric lines readable even when the transcription has no punctuation/);
  assert.match(html, /if\(words\.length<2\|\|!events\.length\)return null/);
});
test('stem mixer supports nested provider outputs, mute, solo and independent channel gain', () => {
  assert.match(html, /const flattenStemOutput=/);
  assert.match(html, /const labels=\{drums:/);
  assert.match(html, /id="stemSoloClear"/);
  assert.match(html, /class="stem-mute"/);
  assert.match(html, /class="stem-solo"/);
  assert.match(html, /const muted=new Set\(\),soloed=new Set\(\)/);
  assert.match(html, /audio\.volume=\(muted\.has\(audio\.id\)/);
  assert.match(html, /class="stem-channel"/);
});

test('search-result chord and lyric analysis can start directly from an available audio preview', () => {
  assert.match(html, /id="analyzePreview"/);
  assert.match(html, /track\.previewUrl/);
  assert.match(html, /analyzeUrl\(track\.previewUrl/);
  assert.match(html, /id="analyzeFullAudio"/);
});

test('stem mixer synchronizes playback, seeking, pause and playback rate to a master track', () => {
  assert.match(html, /const masterAudio=stemAudios\[0\]/);
  assert.match(html, /const syncTracks=\(\)=>/);
  assert.match(html, /Math\.abs\(drift\)>0\.22/);
  assert.match(html, /masterAudio\?\.addEventListener\('seeking'/);
  assert.match(html, /audio\.playbackRate=masterAudio\.playbackRate/);
  assert.match(html, /const stopSync=\(\)=>/);
});

test('BPM analysis omits Camelot numeric metadata and chord parser accepts altered extensions', () => {
  assert.doesNotMatch(html, /Camelot:/);
  assert.match(html, /\[\#b\]\\d\+/);
  assert.match(html, /function buildTimedAlignment\(data\)/);
});
