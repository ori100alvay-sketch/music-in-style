"use strict";

const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const NOTE_ALIASES = {
  "C":"C","B#":"C","C#":"C#","Db":"C#","D":"D","D#":"D#","Eb":"D#","E":"E","Fb":"E","E#":"F","F":"F","F#":"F#","Gb":"F#","G":"G","G#":"G#","Ab":"G#","A":"A","A#":"A#","Bb":"A#","B":"B","Cb":"B"
};
const SCALES = {
  major: { name:"Major / Ionian", he:"מז'ור (יוני)", intervals:[0,2,4,5,7,9,11] },
  natural_minor: { name:"Natural minor / Aeolian", he:"מינור טבעי (אאולי)", intervals:[0,2,3,5,7,8,10] },
  harmonic_minor: { name:"Harmonic minor", he:"מינור הרמוני", intervals:[0,2,3,5,7,8,11] },
  melodic_minor: { name:"Melodic minor (ascending)", he:"מינור מלודי עולה", intervals:[0,2,3,5,7,9,11] },
  dorian: { name:"Dorian", he:"דורי", intervals:[0,2,3,5,7,9,10] },
  phrygian: { name:"Phrygian", he:"פריגי", intervals:[0,1,3,5,7,8,10] },
  lydian: { name:"Lydian", he:"לידי", intervals:[0,2,4,6,7,9,11] },
  mixolydian: { name:"Mixolydian", he:"מיקסולידי", intervals:[0,2,4,5,7,9,10] },
  locrian: { name:"Locrian", he:"לוקריאני", intervals:[0,1,3,5,6,8,10] },
  major_pentatonic: { name:"Major pentatonic", he:"פנטטוני מז'ורי", intervals:[0,2,4,7,9] },
  minor_pentatonic: { name:"Minor pentatonic", he:"פנטטוני מינורי", intervals:[0,3,5,7,10] },
  blues: { name:"Blues", he:"סולם בלוז", intervals:[0,3,5,6,7,10] },
  phrygian_dominant: { name:"Phrygian dominant / Hijaz-like", he:"פריגי דומיננטי / צבע חיג'אזי", intervals:[0,1,4,5,7,8,10] },
  double_harmonic: { name:"Double harmonic major", he:"מז'ור כפול הרמוני", intervals:[0,1,4,5,7,8,11] }
};
const MAQAMS = {
  hijaz: { name:"Hijaz", he:"חיג'אז", intervals:[0,1,4,5,7,8,10], note:"קירוב של 12 צלילים; ביצועים מסורתיים עשויים לכלול גובהי צליל גמישים או מיקרוטונים." },
  nahawand: { name:"Nahawand", he:"נהוואנד", intervals:[0,2,3,5,7,8,11], note:"דמיון מקורב למינור הרמוני; המקאם אינו רק סולם עולה ויורד." },
  rast: { name:"Rast", he:"ראסט", intervals:[0,2,4,5,7,9,10], note:"קירוב שווה-מרווח בלבד; דרגות מסורתיות מסוימות אינן מיוצגות במדויק ב-12-TET." },
  bayati: { name:"Bayati", he:"ביאתי", intervals:[0,1,3,5,7,8,10], note:"קירוב בלבד; הדרגה השנייה המסורתית יכולה להיות נמוכה מחצי טון." },
  saba: { name:"Saba", he:"צַבָּא", intervals:[0,1,3,5,6,8,10], note:"קירוב 12-צלילי; מסורת המקאם כוללת התנהגות מלודית שאינה נלכדת ברשימת תווים בלבד." }
};
const CHORDS = [
  {suffix:"maj7#11", aliases:["maj7#11"], intervals:[0,4,7,11,18], quality:"major-seventh-sharp-eleven"},
  {suffix:"mMaj7", aliases:["mMaj7","m(maj7)"], intervals:[0,3,7,11], quality:"minor-major-seventh"},
  {suffix:"m7b5", aliases:["m7b5","ø"], intervals:[0,3,6,10], quality:"half-diminished"},
  {suffix:"dim7", aliases:["dim7","°7"], intervals:[0,3,6,9], quality:"diminished-seventh"},
  {suffix:"7b9", aliases:["7b9"], intervals:[0,4,7,10,13], quality:"dominant-flat-nine"},
  {suffix:"7#9", aliases:["7#9"], intervals:[0,4,7,10,15], quality:"dominant-sharp-nine"},
  {suffix:"7#11", aliases:["7#11"], intervals:[0,4,7,10,18], quality:"dominant-sharp-eleven"},
  {suffix:"7b5", aliases:["7b5"], intervals:[0,4,6,10], quality:"dominant-flat-five"},
  {suffix:"7#5", aliases:["7#5"], intervals:[0,4,8,10], quality:"dominant-sharp-five"},
  {suffix:"maj9", aliases:["maj9","M9"], intervals:[0,4,7,11,14], quality:"major-ninth"},
  {suffix:"m13", aliases:["m13"], intervals:[0,3,7,10,14,21], quality:"minor-thirteenth"},
  {suffix:"m11", aliases:["m11"], intervals:[0,3,7,10,14,17], quality:"minor-eleventh"},
  {suffix:"m9", aliases:["m9","min9"], intervals:[0,3,7,10,14], quality:"minor-ninth"},
  {suffix:"add9", aliases:["add9"], intervals:[0,4,7,14], quality:"add-ninth"},
  {suffix:"7sus4", aliases:["7sus4"], intervals:[0,5,7,10], quality:"dominant-suspended-fourth"},
  {suffix:"sus2", aliases:["sus2"], intervals:[0,2,7], quality:"suspended-second"},
  {suffix:"sus4", aliases:["sus4","sus"], intervals:[0,5,7], quality:"suspended-fourth"},
  {suffix:"maj7", aliases:["maj7","M7","Δ7"], intervals:[0,4,7,11], quality:"major-seventh"},
  {suffix:"13", aliases:["13"], intervals:[0,4,7,10,14,21], quality:"dominant-thirteenth"},
  {suffix:"11", aliases:["11"], intervals:[0,4,7,10,14,17], quality:"dominant-eleventh"},
  {suffix:"9", aliases:["9"], intervals:[0,4,7,10,14], quality:"dominant-ninth"},
  {suffix:"7", aliases:["7"], intervals:[0,4,7,10], quality:"dominant-seventh"},
  {suffix:"m7", aliases:["m7","min7"], intervals:[0,3,7,10], quality:"minor-seventh"},
  {suffix:"m6", aliases:["m6"], intervals:[0,3,7,9], quality:"minor-sixth"},
  {suffix:"6", aliases:["6"], intervals:[0,4,7,9], quality:"major-sixth"},
  {suffix:"aug", aliases:["aug","+","+"], intervals:[0,4,8], quality:"augmented"},
  {suffix:"dim", aliases:["dim","°"], intervals:[0,3,6], quality:"diminished"},
  {suffix:"m", aliases:["m","min","-"], intervals:[0,3,7], quality:"minor"},
  {suffix:"", aliases:["","maj"], intervals:[0,4,7], quality:"major"}
];
function normalizeNote(note) {
  if (typeof note !== "string") return null;
  const cleaned = note.trim().replace(/♯/g,"#").replace(/♭/g,"b");
  return NOTE_ALIASES[cleaned] || null;
}
function noteAt(root, semitones) {
  const n = normalizeNote(root);
  if (!n || !Number.isFinite(Number(semitones))) return null;
  return NOTES[(NOTES.indexOf(n) + Number(semitones) % 12 + 120) % 12];
}
function scaleNotes(root, scaleName="major") {
  const tonic = normalizeNote(root), scale = SCALES[scaleName];
  if (!tonic || !scale) return null;
  return scale.intervals.map(i => noteAt(tonic,i));
}
function parseChord(symbol) {
  if (typeof symbol !== "string" || symbol.length > 32) return null;
  const cleaned = symbol.trim().replace(/♯/g,"#").replace(/♭/g,"b");
  const match = cleaned.match(/^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/);
  if (!match) return null;
  const root = normalizeNote(match[1]), bass = match[3] ? normalizeNote(match[3]) : null;
  if (!root || (match[3] && !bass)) return null;
  let suffix = match[2].replace(/^\s+/,"");
  if (suffix.startsWith("min")) suffix = "m" + suffix.slice(3);
  const chord = CHORDS.find(c => c.aliases.includes(suffix));
  if (!chord) return null;
  const notes = [...new Set(chord.intervals.map(i => noteAt(root,i)))];
  return { symbol: match[1] + suffix + (match[3] ? "/" + match[3] : ""), root, bass, suffix, quality: chord.quality, intervals: chord.intervals.slice(), notes };
}
function diatonicTriads(root, scaleName="major") {
  const notes = scaleNotes(root,scaleName), scale = SCALES[scaleName];
  if (!notes || !scale || notes.length !== 7) return null;
  return notes.map((note,i) => {
    const triad = [notes[i],notes[(i+2)%7],notes[(i+4)%7]];
    const offsets = triad.map(n => (NOTES.indexOf(n)-NOTES.indexOf(note)+12)%12);
    const quality = offsets[1]===4 && offsets[2]===7 ? "major" : offsets[1]===3 && offsets[2]===7 ? "minor" : offsets[1]===3 && offsets[2]===6 ? "diminished" : offsets[1]===4 && offsets[2]===8 ? "augmented" : "other";
    const roman = ["I","II","III","IV","V","VI","VII"][i];
    return {degree:i+1, roman:quality==="major"?roman:quality==="minor"?roman.toLowerCase():quality==="diminished"?roman.toLowerCase()+"°":roman+"+", root:note, quality, notes:triad};
  });
}
function transposeChord(symbol, semitones) {
  const chord = parseChord(symbol);
  if (!chord || !Number.isInteger(semitones) || Math.abs(semitones)>48) return null;
  const root = noteAt(chord.root,semitones);
  const bass = chord.bass ? "/" + noteAt(chord.bass,semitones) : "";
  return root + chord.suffix + bass;
}
function analyzeProgression(symbols, root, scaleName="major") {
  if (!Array.isArray(symbols) || symbols.length>128) return null;
  const key = normalizeNote(root), scale = SCALES[scaleName], triads = diatonicTriads(root,scaleName);
  if (!key || !scale || !triads) return null;
  return symbols.map(symbol => {
    const chord = parseChord(symbol);
    if (!chord) return {symbol, valid:false, explanation:"לא זוהה מבנה אקורד מוכר; אין לנחש."};
    const degree = triads.find(t=>t.root===chord.root && t.quality===chord.quality);
    const inScale = scaleNotes(key,scaleName).includes(chord.root) && chord.notes.every(n=>scaleNotes(key,scaleName).includes(n));
    return {symbol,valid:true,root:chord.root,quality:chord.quality,notes:chord.notes,degree:degree?.degree||null,roman:degree?.roman||null,inScale,explanation:degree ? "האקורד מתאים לשלשה הדיאטונית בדרגה "+degree.degree+"." : inScale ? "צלילי האקורד בתוך הסולם, אך האיכות או ההרחבה אינה שלשה דיאטונית רגילה." : "האקורד כולל צלילים מחוץ לסולם; ייתכן שמדובר בדומיננטה משנית, מודאליות, השאלה או שינוי סולם."};
  });
}
function getTheory(input={}) {
  const root = normalizeNote(input.root || "C");
  const scaleName = String(input.scale || "major");
  if (!root) return {error:"תו בסיס לא תקין. השתמשו למשל ב-C, F# או Bb."};
  if (input.mode === "chord") {
    const chord = parseChord(input.chord);
    return chord ? {kind:"chord",...chord} : {error:"מבנה האקורד אינו נתמך או אינו תקין."};
  }
  if (input.mode === "progression") {
    const symbols = Array.isArray(input.chords) ? input.chords : String(input.chords || "").split(/[\s,]+/).filter(Boolean);
    const analysis = analyzeProgression(symbols,root,scaleName);
    return analysis ? {kind:"progression",root,scale:scaleName,analysis} : {error:"לא ניתן לנתח את רצף האקורדים."};
  }
  if (input.mode === "maqam") {
    const maqam = MAQAMS[String(input.maqam || "hijaz").toLowerCase()];
    return maqam ? {kind:"maqam",root,maqam:maqam.name,he:maqam.he,notes:maqam.intervals.map(i=>noteAt(root,i)),intervals:maqam.intervals,note:maqam.note} : {error:"מקאם לא מוכר. אפשרויות: hijaz, nahawand, rast, bayati, saba."};
  }
  const scale = SCALES[scaleName];
  if (!scale) return {error:"סולם לא מוכר.",availableScales:Object.keys(SCALES)};
  return {kind:"scale",root,scale:scaleName,name:scale.name,he:scale.he,intervals:scale.intervals,notes:scale.intervals.map(i=>noteAt(root,i)),diatonicTriads:diatonicTriads(root,scaleName),availableScales:Object.keys(SCALES),availableMaqams:Object.keys(MAQAMS)};
}
module.exports = { NOTES, SCALES, MAQAMS, normalizeNote, noteAt, scaleNotes, parseChord, diatonicTriads, transposeChord, analyzeProgression, getTheory };
