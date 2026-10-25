"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const theory = require("../music-theory");

test("note aliases normalize enharmonic spellings", () => {
  assert.equal(theory.normalizeNote("Db"), "C#");
  assert.equal(theory.normalizeNote("B#"), "C");
  assert.equal(theory.normalizeNote("F♭"), "E");
  assert.equal(theory.normalizeNote("H"), null);
});

test("major and natural minor scales return expected pitch classes", () => {
  assert.deepEqual(theory.scaleNotes("C", "major"), ["C","D","E","F","G","A","B"]);
  assert.deepEqual(theory.scaleNotes("A", "natural_minor"), ["A","B","C","D","E","F","G"]);
  assert.equal(theory.scaleNotes("H", "major"), null);
  assert.equal(theory.scaleNotes("C", "unknown"), null);
});

test("chord parsing handles common extensions and rejects malformed symbols", () => {
  assert.deepEqual(theory.parseChord("Am").notes, ["A","C","E"]);
  assert.equal(theory.parseChord("F#m7").quality, "minor-seventh");
  assert.deepEqual(theory.parseChord("G7").notes, ["G","B","D","F"]);
  assert.equal(theory.parseChord("Cxyz"), null);
  assert.equal(theory.parseChord("C".repeat(40)), null);
});

test("transposition preserves chord quality and slash bass", () => {
  assert.equal(theory.transposeChord("Am7/G", 2), "Bm7/A");
  assert.equal(theory.transposeChord("C", -1), "B");
  assert.equal(theory.transposeChord("nonsense", 2), null);
  assert.equal(theory.transposeChord("C", 49), null);
});

test("progression analysis never invents unsupported chords", () => {
  const result = theory.analyzeProgression(["C", "Am", "G7", "Hfoo"], "C", "major");
  assert.equal(result[0].valid, true);
  assert.equal(result[0].roman, "I");
  assert.equal(result[1].roman, "vi");
  assert.equal(result[3].valid, false);
});

test("maqam approximations are labeled and return expected pitch classes", () => {
  const result = theory.getTheory({mode:"maqam", root:"D", maqam:"hijaz"});
  assert.deepEqual(result.notes, ["D","D#","F#","G","A","A#","C"]);
  assert.match(result.note, /קירוב/);
});

test("invalid roots and unknown scales return helpful errors", () => {
  assert.match(theory.getTheory({root:"H"}).error, /תו בסיס לא תקין/);
  assert.match(theory.getTheory({root:"C", scale:"made_up"}).error, /סולם לא מוכר/);
});
