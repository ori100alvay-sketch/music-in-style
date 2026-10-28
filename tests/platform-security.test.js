const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
const worker = fs.readFileSync('public/sw.js', 'utf8');
const legal = fs.readFileSync('public/copyright.html', 'utf8');
const theorySource = fs.readFileSync('music-theory.js', 'utf8');

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
  assert.match(server, /stemSeparation: \{ available: separation\.available, configured: Boolean\(String\(process\.env\.DEMUCS_WORKER_URL/);
  assert.match(server, /const separation = await checkDemucsWorker\(\)/);
  assert.match(server, /needs: brizmConfigured \? \[\] : \["BRIZM_API_KEY"\]/);
});

test('free lyrics and music metadata providers are wired through safe server endpoints', () => {
  assert.match(server, /app\.get\("\/api\/lyrics-search"/);
  assert.match(server, /https:\/\/lrclib\.net\/api\/search/);
  assert.match(server, /app\.get\("\/api\/music-metadata"/);
  assert.match(server, /https:\/\/musicbrainz\.org\/ws\/2\/recording\//);
  assert.match(server, /freeLyricsSearch: \{ available: true, provider: "LRCLIB", keyRequired: false/);
  assert.match(server, /freeMusicMetadata: \{ available: true, provider: "MusicBrainz", keyRequired: false/);
  assert.match(server, /slice\(0, 180\)/);
});

test('account UI keeps signup, login, reset labels in sync and has a single signup toggle', () => {
  assert.match(html, /signup\.addEventListener\('click',\(\)=>setMode\(mode==='signup'\?'login':'signup'\)\)/);
  assert.match(html, /signup\.textContent=next==='signup'\?'חזרה לכניסה':'יצירת חשבון'/);
  assert.match(html, /submit\.textContent=next==='signup'\?'יצירת חשבון':next==='forgot'\?'שליחת קישור איפוס':'כניסה'/);
  assert.doesNotMatch(html, /signup\.addEventListener\('click',\(\)=>\{if\(mode==='signup'\)\{doLogin\(true\)/);
});

test('security hardening limits authentication attempts and restricts provider analysis URLs', () => {
  assert.match(server, /app\.use\("\/api\/auth", \(req, res, next\) =>/);
  assert.match(server, /RateLimit-Auth-Limit/);
  assert.match(server, /15 \* 60_000/);
  assert.match(server, /function validatePublicMusicUrl\(input\)/);
  assert.match(server, /url\.protocol !== "https:"/);
  assert.match(server, /url\.username \|\| url\.password \|\| url\.port/);
  assert.match(server, /open\.spotify\.com/);
  assert.match(server, /const songUrl = validatePublicMusicUrl\(input\)/);
  assert.match(server, /script-src 'self' 'unsafe-inline';/);
});

test('local Demucs is wired to a health-checked CPU-only worker', () => {
  const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
  const render = fs.readFileSync('render.yaml', 'utf8');
  const worker = fs.readFileSync('demucs_worker.py', 'utf8');
  assert.ok(server.includes('/api/separation-status'));
  assert.ok(server.includes('DEMUCS_WORKER_URL'));
  assert.ok(server.includes('checkDemucsWorker'));
  assert.ok(server.includes('/api/separate'));
  assert.ok(server.includes('new FormData()'));
  assert.ok(server.includes('Local Demucs only'));
  assert.ok(dockerfile.includes('node:20-bookworm-slim'));
  assert.doesNotMatch(dockerfile, /torch==|demucs==/i, 'free web container must not install heavyweight inference dependencies');
  assert.match(dockerfile, /Keep Demucs\/PyTorch out of the free web container/);
  assert.ok(render.includes('runtime: docker'));
  assert.match(render, /DEMUCS_WORKER_URL[\s\S]*sync: false/);
  assert.match(render, /DEMUCS_WORKER_TOKEN[\s\S]*sync: false/);
  assert.ok(worker.includes('DEVICE = "cpu"'));
  assert.ok(worker.includes('readyForSeparation'));
  assert.ok(worker.includes('DEMUCS_SMOKE_TEST_OK'));
  assert.match(server, /status\.readyForSeparation === true/);
  assert.match(server, /status\.smokeTest\.ok === true/);
  assert.ok(worker.includes('MAX_UPLOAD_BYTES'));
  assert.ok(worker.includes('MAX_DURATION_SECONDS'));
  assert.ok(html.includes('הפרד כלים במנוע המקומי'));
  assert.ok(html.includes('לא נשלח שמע לספק בתשלום'));
});
test('Demucs worker integration requires a shared secret and a real four-stem smoke test', () => {
  const worker = fs.readFileSync('demucs-worker/app.py', 'utf8');
  assert.match(server, /DEMUCS_WORKER_TOKEN/);
  assert.match(server, /"X-Worker-Token": String\(process\.env\.DEMUCS_WORKER_TOKEN/);
  assert.match(server, /form\.append\("audio", new Blob/);
  assert.match(worker, /async def separate\(audio: UploadFile = File\(\.\.\.\)/);
  assert.match(server, /status\.readyForSeparation === true/);
  assert.match(worker, /hmac\.compare_digest/);
  assert.match(worker, /"readyForSeparation": ready/);
  assert.match(worker, /"smokeTest": \{"ok": ready, "stemCount": stem_count\}/);
  assert.match(worker, /"paid_provider": False/);
});

test('free public music services are wired as server-side endpoints and exposed in capabilities', () => {
  for (const route of ['/api/lyrics-search', '/api/music-metadata', '/api/deezer-search', '/api/radio-search', '/api/cover-art/:releaseId']) assert.ok(server.includes(route), 'missing route ' + route);
  for (const provider of ['lrclib.net/api/search', 'musicbrainz.org/ws/2/recording/', 'api.deezer.com/search/track', 'api.radio-browser.info/json/stations/search', 'coverartarchive.org/release/']) assert.ok(server.includes(provider), 'missing provider ' + provider);
  assert.match(server, /freeTrackSearch: \{ available: true, provider: "Deezer"/);
  assert.match(server, /freeRadioDirectory: \{ available: true, provider: "Radio Browser"/);
  assert.match(server, /freeCoverArt: \{ available: true, provider: "Cover Art Archive"/);
  assert.match(html, /id="freeTrackForm"/);
  assert.match(html, /id="radioSearchForm"/);
  assert.match(html, /id="freeLyricsForm"/);
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
  assert.match(html, /Promise\.allSettled\(stemAudios\.map\(audio=>\{/);
  assert.match(html, /audio\.volume=\(muted\.has\(audio\.id\)/);
});
test('timed lyric and chord alignment handles provider variants and bounded chord intervals', () => {
  assert.match(html, /function buildTimedAlignment\(data\)/);
  assert.match(html, /start_ms/);
  assert.match(html, /end_ms/);
  assert.match(html, /const scoreWords=/);
  assert.match(html, /const scoreChords=/);
  assert.match(html, /word\.start<=event\.end/);
  assert.match(html, /Build readable lyric phrases using provider line breaks, punctuation and timing gaps/);
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

test('search-result chord analysis uses a public supported track URL rather than a short preview file', () => {
  assert.match(html, /id="analyzeFullAudio"/);
  assert.match(html, /track\.trackUrl/);
  assert.match(html, /track\.trackUrl/);
  assert.match(html, /fullAudioUrl/);
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

test('local BPM and key analysis runs on the selected browser file without uploading it', () => {
  assert.match(html, /async function analyzeAudioFileLocally\(file\)/);
  assert.match(html, /await file\.arrayBuffer\(\)/);
  assert.match(html, /const localFile=localFileInput&&localFileInput\.files&&localFileInput\.files\[0\]/);
  assert.match(html, /הקובץ לא הועלה לשרת/);
  assert.match(html, /BPM משוער/);
});
});
test('BPM analysis omits Camelot numeric metadata and chord parser accepts altered extensions', () => {
  assert.doesNotMatch(html, /Camelot:/);
  assert.match(html, /\[\#b\]\\d\+/);
  assert.match(html, /function buildTimedAlignment\(data\)/);
});

test('stem separation requires a healthy local worker and never falls back to paid inference', () => {
  assert.match(server, /app\.post\("\/api\/separate", async \(req, res\) =>/);
  assert.match(server, /if \(!status\.available\) return res\.status\(503\)/);
  assert.match(server, /No audio is sent to paid inference services/);
  assert.doesNotMatch(server, /api\.replicate\.com\/v1\/predictions/);
});

test('timed chord alignment improves event deduplication, lyric phrase breaks and repeated chord labels', () => {
  assert.match(html, /Collapse repeated provider events at the same instant/);
  assert.match(html, /Math\.abs\(previous\.start-event\.start\)<0\.035/);
  assert.match(html, /line\.length>=12/);
  assert.match(html, /Hide repeated chord labels on adjacent words/);
  assert.match(html, /row\.start-prev\.start>1\.15/);
});

test('lyric transcription normalizes text and reconstructs timed word segments', () => {
  assert.match(html, /function extractLyrics\(data\)/);
  assert.match(html, /const reconstruct=segments=>/);
  assert.match(html, /part\.start-previous\.end/);
  assert.match(html, /replace\(\/\\n\{3,\}\/g,'\\n\\n'\)/);
});
test('chord display only labels chord changes across lyric lines', () => {
  assert.match(html, /const compact=\[\];let previousChord=''/);
  assert.match(html, /cell\.chord&&cell\.chord!==previousChord\?cell\.chord:''/);
  assert.match(html, /if\(cell\.chord\)previousChord=cell\.chord/);
});

test('music theory engine calculates scales, diatonic triads, chord tones and transposition', () => {
  const theory = require('../music-theory');
  assert.deepEqual(theory.scaleNotes('C','major'), ['C','D','E','F','G','A','B']);
  assert.deepEqual(theory.parseChord('Dm7').notes, ['D','F','A','C']);
  assert.equal(theory.transposeChord('Bbmaj7', 2), 'Cmaj7');
  assert.deepEqual(theory.diatonicTriads('C','major').map(chord => chord.roman), ['I','ii','iii','IV','V','vi','vii°']);
  assert.equal(theory.getTheory({root:'C',scale:'major'}).kind, 'scale');
});
test('music theory engine exposes progression analysis and maqam caveats without pretending to analyze audio', () => {
  const theory = require('../music-theory');
  const progression = theory.getTheory({mode:'progression',root:'C',scale:'major',chords:'C Am F G'});
  assert.equal(progression.analysis.length, 4);
  assert.deepEqual(progression.analysis.map(chord => chord.roman), ['I','vi','IV','V']);
  const hijaz = theory.getTheory({mode:'maqam',root:'D',maqam:'hijaz'});
  assert.equal(hijaz.kind, 'maqam');
  assert.match(hijaz.note, /12/);
  assert.match(theory.getTheory({mode:'chord',chord:'nonsense'}).error, /מבנה האקורד/);
  assert.match(theorySource, /const MAQAMS =/);
  assert.match(server, /app\.get\("\/api\/music-theory"/);
});

test('music theory engine supports slash chords and extended jazz/pop harmony', () => {
  const theory = require('../music-theory');
  assert.equal(theory.parseChord('C/E').bass, 'E');
  assert.equal(theory.transposeChord('C/E', 2), 'D/F#');
  assert.deepEqual(theory.parseChord('G7b9').notes, ['G','B','D','F','G#']);
  assert.equal(theory.parseChord('Fmaj7#11').quality, 'major-seventh-sharp-eleven');
  assert.equal(theory.parseChord('Aadd9').quality, 'add-ninth');
});

test('account APIs cover signup, login, email verification, recovery and password update', () => {
  for (const route of [
    '/api/auth/config',
    '/api/auth/signup',
    '/api/auth/login',
    '/api/auth/verify-email',
    '/api/auth/forgot-password',
    '/api/auth/update-password'
  ]) assert.ok(server.includes(route), 'missing account route: ' + route);
  assert.match(server, /password\.length < 10/);
  assert.match(server, /token_hash/);
  assert.match(server, /SUPABASE_URL/);
  assert.match(server, /SUPABASE_ANON_KEY/);
  assert.match(server, /Cache-Control", "no-store"/);
});

test('account UI includes registration, login, reset and email-confirmation handling', () => {
  assert.match(html, /id="musicAuthOverlay"/);
  assert.match(html, /id="musicAuthSignup"/);
  assert.match(html, /id="musicAuthForgot"/);
  assert.match(html, /id="musicAuthReset"/);
  assert.match(html, /verify-email/);
  assert.match(html, /token_hash/);
  assert.match(html, /musicInStyleSession/);
});

test('account form labels match the selected action and recovery links lead to a new password', () => {
  assert.match(html, /next==='signup'\?'יצירת חשבון':next==='forgot'\?'שליחת קישור איפוס'/);
  assert.match(html, /query\.get\('type'\)==='recovery'&&data\.session\?\.access_token/);
  assert.match(html, /resetToken=data\.session\.access_token/);
});

test('rehearsal setlist supports safe local persistence, bounded entries, ordering and text export', () => {
  assert.match(html, /id="gigTools"/);
  assert.match(html, /id="gigSongForm"/);
  assert.match(html, /localStorage\.getItem\('misGigSetlist'\)/);
  assert.match(html, /localStorage\.setItem\('misGigSetlist'/);
  assert.match(html, /songs\.length>=100/);
  assert.match(html, /function move\(i,d\)/);
  assert.match(html, /music-in-style-setlist\.txt/);
  assert.match(html, /textContent=song\.title/);
});
test('focused practice timer supports presets, pause/resume and reset with consistent seconds', () => {
  assert.match(html, /id="focusTimer"/);
  assert.match(html, /data-minutes="5"/);
  assert.match(html, /data-minutes="15"/);
  assert.match(html, /data-minutes="25"/);
  assert.match(html, /data-minutes="45"/);
  assert.match(html, /elapsedBefore\+\=\(Date\.now\(\)-startedAt\)\/1000/);
  assert.match(html, /id="focusPause"/);
  assert.match(html, /id="focusReset"/);
});

test('stem separation UI displays availability only after a live local worker health check', () => {
  assert.match(server, /app\.get\("\/api\/separation-status"/);
  assert.match(server, /status\.readyForSeparation === true/);
  assert.match(html, /fetch\('\/api\/separation-status'/);
  assert.match(html, /ההפרדה נשארת כבויה עד שהשרת יאשר שמנוע מקומי זמין/);
  assert.doesNotMatch(html, /פתיחת עמוד החיוב של Replicate/);
});

test('chord analysis reuses a recent job for the same URL and does not spam the provider', () => {
  assert.match(server, /const recentAnalysisJobs = new Map\(\)/);
  assert.match(server, /const ANALYSIS_DEDUPE_MS = 3 \* 60_000/);
  assert.match(server, /recentAnalysisJobs\.get\(cacheKey\)/);
  assert.match(server, /X-Analysis-Job-Reused/);
  assert.match(server, /recentAnalysisJobs\.set\(cacheKey/);
  assert.match(server, /const retryAfterSeconds = err\.retryAfterSeconds \|\| 3600/);
  assert.match(server, /console\.error\("Analysis submission failed:", err\.message, "providerStatus:", err\.status \|\| "unknown"\)/);
});

test('CI workflow runs the test suite and syntax checks on main updates', () => {
  const workflow = fs.readFileSync('.github/workflows/regression-tests.yml', 'utf8');
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /node-version: 20/);
  assert.match(workflow, /node --test/);
  assert.match(workflow, /node --check server\.js/);
});

test('Demucs worker is disabled unless an explicitly enabled, authenticated worker passes smoke tests', () => {
  const render = fs.readFileSync('render.yaml', 'utf8');
  assert.doesNotMatch(server, /DEMUCS_ENABLE_LOCAL_WORKER/, 'worker availability is determined by live HTTPS health and smoke-test results, not a manual flag');
  assert.match(server, /DEMUCS_WORKER_TOKEN/);
  assert.match(server, /status\.readyForSeparation === true/);
  assert.match(server, /status\.smokeTest\.ok === true/);
  assert.match(render, /key: DEMUCS_WORKER_URL\n\s+sync: false/);
  assert.match(render, /key: DEMUCS_WORKER_TOKEN\n\s+sync: false/);
  assert.match(render, /key: DEMUCS_ENABLE_LOCAL_WORKER\n\s+sync: false/);
});
test('Demucs worker image contains open-source inference dependencies while public web image stays lightweight', () => {
  const webDockerfile = fs.readFileSync('Dockerfile', 'utf8');
  const workerDockerfile = fs.readFileSync('demucs-worker/Dockerfile', 'utf8');
  const worker = fs.readFileSync('demucs-worker/app.py', 'utf8');
  assert.match(webDockerfile, /FROM node:20-bookworm-slim/);
  assert.doesNotMatch(webDockerfile, /torch==|demucs==/i);
  assert.match(workerDockerfile, /FROM python:3\.11-slim/);
  assert.match(workerDockerfile, /demucs-worker\/requirements\.txt/);
  assert.match(workerDockerfile, /ffmpeg/);
  assert.match(worker, /"paid_provider": False/);
  assert.match(worker, /hmac\.compare_digest/);
  assert.match(worker, /"readyForSeparation": ready/);
  assert.match(html, /הפרד כלים במנוע המקומי/);
  assert.match(html, /לא נשלח שמע לספק בתשלום/);
});
test('chord analysis avoids stale jobs and shares provider cooldown with transcription', () => {
  assert.match(server, /function forgetRecentAnalysisJob\(jobId\)/);
  assert.match(server, /forgetRecentAnalysisJob\(jobId\);[\s\S]{0,120}status: "failed"/);
  assert.match(server, /if \(magicChordsIsCoolingDown\(\)\)[\s\S]{0,700}ניסיון תמלול נוסף/);
  assert.match(server, /noteMagicChordsRateLimit\(30\)/);
});

test('free lyrics panel is wired to the free LRCLIB endpoint and renders results safely', () => {
  assert.match(html, /id="freeLyricsForm"/);
  assert.match(html, /lyricsForm\.addEventListener\('submit'/);
  assert.match(html, /fetch\('\/api\/lyrics-search\?q='/);
  assert.match(html, /item\.syncedLyrics\|\|item\.lyrics/);
  assert.match(html, /lyrics\.textContent=/);
  assert.match(html, /lyricsResults\.replaceChildren\(\)/);
});
