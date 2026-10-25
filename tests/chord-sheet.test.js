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
