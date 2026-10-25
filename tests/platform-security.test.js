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
