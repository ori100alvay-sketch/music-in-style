const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('public/index.html', 'utf8');

function extractFunction(name, nextName) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function: ' + name);
  const end = html.indexOf('function ' + nextName + '(', start + 1);
  assert.notEqual(end, -1, 'missing boundary function: ' + nextName);
  return html.slice(start, end);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  extractFunction('escapeHtml', 'startStemSeparation') +
  extractFunction('collectTextCandidates', 'transposeChord') +
  extractFunction('transposeChord', 'renderTransposedChordSheet') +
  extractFunction('renderTransposedChordSheet', 'findAlignedLyrics') +
  extractFunction('findAlignedLyrics', 'renderChordSheet'),
  sandbox
);

test('analysis result is not dumped as raw JSON into the visible result panel', () => {
  assert.match(html, /resultData\.hidden=true;resultData\.textContent='';/);
  assert.doesNotMatch(html, /resultData\.hidden=false;resultData\.textContent=JSON\.stringify\(currentAnalysis,null,2\)/);
});

test('aligned word/chord data is parsed into word-level cells', () => {
  const fixture = {
    alignedLyrics: [{
      words: [
        { text: 'כשהלב', chord: 'Am' },
        { text: 'מחפש', chord: 'G' },
        { text: 'תשובה', chord: 'F' }
      ]
    }]
  };
  const rows = sandbox.findAlignedLyrics(fixture);
  assert.equal(rows.length, 1);
  assert.deepEqual(Array.from(rows[0], x => [x.text, x.chord]), [
    ['כשהלב', 'Am'], ['מחפש', 'G'], ['תשובה', 'F']
  ]);
});

test('chords render above their corresponding words, not as a raw object', () => {
  const rows = [{ words: [
    { text: 'שלום', chord: 'Am' },
    { text: 'עולם', chord: 'G' }
  ] }];
  const aligned = sandbox.findAlignedLyrics({ alignedLyrics: rows });
  const rendered = sandbox.renderTransposedChordSheet(aligned, 0);
  assert.match(rendered, /class="chord-above">Am<\/span><span class="word-below">שלום/);
  assert.match(rendered, /class="chord-above">G<\/span><span class="word-below">עולם/);
  assert.doesNotMatch(rendered, /\[object Object\]|\{\s*"alignedLyrics"/);
});

test('semitone transposition changes chord roots correctly', () => {
  assert.equal(sandbox.transposeChord('Am', 2), 'Bm');
  assert.equal(sandbox.transposeChord('F#m7', 1), 'Gm7');
  assert.equal(sandbox.transposeChord('Bb', -1), 'A');
});

test('untrusted lyrics and chord strings are HTML escaped', () => {
  const rows = sandbox.findAlignedLyrics({ alignedLyrics: [{
    words: [{ text: '<script>alert(1)</script>', chord: '<b>Am</b>' }]
  }] });
  const rendered = sandbox.renderTransposedChordSheet(rows, 0);
  assert.doesNotMatch(rendered, /<script>|<b>Am<\/b>/);
  assert.match(rendered, /&lt;script&gt;/);
});

test('the UI explicitly refuses to invent word alignment when provider data is missing', () => {
  assert.match(html, /אין שיוך אמין של אקורד לכל מילה/);
  assert.match(html, /לא נציג רשימת אקורדים אקראית/);
});

test('nested transcription text is found even when provider calls it transcription.text', () => {
  assert.equal(sandbox.extractLyrics({ transcription: { text: 'מילים אמיתיות של השיר שחזרו משירות התמלול' } }), 'מילים אמיתיות של השיר שחזרו משירות התמלול');
});

test('timestamped transcription words are aligned to timestamped chord events', () => {
  const data = {
    transcription: { words: [
      { word: 'שלום', start: 0.2 },
      { word: 'עולם', start: 2.5 }
    ] },
    chords: [
      { chord: 'Am', start: 0 },
      { chord: 'G', start: 2 }
    ]
  };
  const rows = sandbox.findAlignedLyrics(data);
  assert.ok(rows);
  assert.deepEqual(Array.from(rows[0], word => [word.text, word.chord]), [['שלום', 'Am'], ['עולם', 'G']]);
});

test('nested provider envelopes are searched for timestamped words and chord events', () => {
  const data = { data: { result: {
    transcription: { words: [
      { text: 'בית', start_ms: 100 },
      { text: 'ופזמון', start_ms: 2100 }
    ] },
    chord_events: [
      { chord_name: 'Dm', start_ms: 0 },
      { chord_name: 'C', start_ms: 2000 }
    ]
  } } };
  const rows = sandbox.findAlignedLyrics(data);
  assert.ok(rows);
  assert.deepEqual(Array.from(rows.flat(), word => [word.text, word.chord]), [['בית', 'Dm'], ['ופזמון', 'C']]);
});

test('the alignment parser does not create chord assignments when timestamps are absent', () => {
  const data = { transcription: { words: [{ text: 'מילה' }] }, chords: [{ chord: 'Am' }] };
  assert.equal(sandbox.findAlignedLyrics(data), null);
});


test('every inline browser script parses as valid JavaScript', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, 'expected at least one inline script');
  for (const [index, match] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(match[1]), 'inline script #' + (index + 1) + ' should parse');
  }
});

test('practice studio exposes all expected controls and accessible status regions', () => {
  for (const id of [
    'practice', 'metronomeBpm', 'metronomeRange', 'metronomeToggle',
    'tapTempo', 'beatsPerBar', 'progressionKey', 'progressionMood',
    'progressionOutput', 'generateProgression', 'copyProgression'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing practice studio control: ' + id);
  }
  assert.match(html, /id="metronomeState"[^>]*aria-live="polite"/);
  assert.match(html, /id="progressionOutput"[^>]*aria-live="polite"/);
});

test('practice studio does not require an API key or external audio library', () => {
  const studioStart = html.indexOf('/* Practice Studio: stable metronome scheduling');
  assert.notEqual(studioStart, -1);
  const studioEnd = html.indexOf('})();', studioStart);
  assert.notEqual(studioEnd, -1);
  const code = html.slice(studioStart, studioEnd);
  assert.match(code, /AudioContext|window\.webkitAudioContext/);
  assert.match(code, /navigator\.clipboard\.writeText/);
  assert.doesNotMatch(code, /BRIZM_API_KEY|REPLICATE_API_TOKEN/);
});
