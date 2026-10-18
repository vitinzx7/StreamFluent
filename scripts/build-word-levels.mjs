// Builds src/data/word-levels.en.json from the Open Language Profiles CSVs:
//
//   https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv
//   https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv
//
// Usage: node scripts/build-word-levels.mjs <cefrj.csv> <octanove.csv>
//
// Only single words are kept (subtitle words are coloured one at a time), each
// under the lowest level listed for it per part of speech. Inflections are
// generated at runtime by src/core/word-levels.ts.
import { readFileSync, writeFileSync } from "node:fs";

const [cefrjPath, octanovePath] = process.argv.slice(2);
if (!cefrjPath || !octanovePath) {
  console.error("Usage: node scripts/build-word-levels.mjs <cefrj.csv> <octanove.csv>");
  process.exit(1);
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Minimal RFC 4180 reader: quoted fields may hold commas and doubled quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((cells) => cells.some((cell) => cell.trim()));
  return body.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), (cells[index] ?? "").trim()])));
}

/** n: noun, v: verb, j: adjective, x: no inflection. */
function posGroup(pos) {
  if (pos === "noun") return "n";
  if (pos === "verb" || pos === "vern" || pos.endsWith("-verb")) return "v";
  if (pos === "adjective") return "j";
  return "x";
}

const WORD = /^[a-zà-öø-ÿ]+(?:['-][a-zà-öø-ÿ]+)*$/;
const best = new Map(); // "group:word" -> level index
const skipped = { multiword: 0, other: 0 };

for (const path of [cefrjPath, octanovePath]) {
  for (const row of parseCsv(readFileSync(path, "utf8"))) {
    const level = LEVELS.indexOf(row.CEFR);
    if (level < 0) { skipped.other++; continue; }
    for (const variant of row.headword.split("/")) {
      const word = variant.trim().toLowerCase().normalize("NFC");
      if (/\s/.test(word)) { skipped.multiword++; continue; }
      if (!WORD.test(word)) { skipped.other++; continue; }
      const key = `${posGroup(row.pos)}:${word}`;
      if (!best.has(key) || best.get(key) > level) best.set(key, level);
    }
  }
}

const entries = Object.fromEntries(LEVELS.map((level) => [level, { n: [], v: [], j: [], x: [] }]));
for (const [key, level] of best) {
  const [group, word] = key.split(":");
  entries[LEVELS[level]][group].push(word);
}
for (const level of LEVELS) {
  for (const group of ["n", "v", "j", "x"]) entries[level][group] = entries[level][group].sort().join(" ");
}

const output = {
  schemaVersion: 1,
  language: "en",
  levels: LEVELS,
  sources: [
    {
      name: "CEFR-J Wordlist Ver1.5 (A1–B2)",
      url: "https://github.com/openlanguageprofiles/olp-en-cefrj",
      copyright: "Tono Laboratory, Tokyo University of Foreign Studies",
      terms: "Free for research and commercial use, provided the dataset is cited.",
    },
    {
      name: "Octanove Vocabulary Profile C1/C2 1.0",
      url: "https://github.com/openlanguageprofiles/olp-en-cefrj",
      copyright: "Octanove Labs",
      terms: "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).",
    },
  ],
  license: "This derived list is distributed under CC BY-SA 4.0, as required by the Octanove part.",
  skipped,
  entries,
};

const target = new URL("../src/data/word-levels.en.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(output, null, 1)}\n`);
const counts = LEVELS.map((level) => `${level} ${Object.values(entries[level]).reduce((sum, list) => sum + (list ? list.split(" ").length : 0), 0)}`);
console.log(`word-levels.en.json: ${counts.join(", ")}; skipped ${JSON.stringify(skipped)}`);
