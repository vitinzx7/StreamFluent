import data from "../data/word-levels.en.json";
import specialWords from "../data/special-words.en.json";
import { wordKey } from "./word-normalization.ts";
import { CEFR_LEVELS, type CefrLevel } from "./cefr.ts";
import { isSpecialWord } from "./special-words.ts";

/**
 * CEFR levels of English words, from the bundled CEFR-J + Octanove list
 * (see docs/word-levels-sources.md). The list has base forms only, so the
 * inflections subtitles actually show ("went", "children", "bigger") are
 * generated here: regular rules plus explicit irregular tables. Every form
 * keeps the lowest level it is reached from — "found" is A1 (find) even
 * though "found" (to establish) is C1 — so a word is never shown above the
 * user's level just because a rarer homograph exists.
 */
export { CEFR_LEVELS, LEVEL_LABELS, isCefrLevel, type CefrLevel } from "./cefr.ts";

/** Rank of the 100 bundled special words missing from the list: above C2. */
export const BEYOND_C2 = CEFR_LEVELS.length;

/** Past tense and past participle of irregular verbs: base, past, participle (extra forms after). */
const IRREGULAR_VERBS = `
be was,were been am,is,are,being|have had had has,having|do did done does,doing|go went gone goes,going
arise arose arisen|awake awoke awoken|bear bore borne,born|beat beat beaten|become became become
begin began begun|bend bent bent|bet bet bet|bind bound bound|bite bit bitten|bleed bled bled
blow blew blown|break broke broken|breed bred bred|bring brought brought|broadcast broadcast broadcast
build built built|burn burnt,burned burnt,burned|burst burst burst|buy bought bought|cast cast cast
catch caught caught|choose chose chosen|cling clung clung|come came come|cost cost cost
creep crept crept|cut cut cut|deal dealt dealt|dig dug dug|draw drew drawn|dream dreamt,dreamed dreamt,dreamed
drink drank drunk|drive drove driven|dwell dwelt dwelt|eat ate eaten|fall fell fallen|feed fed fed
feel felt felt|fight fought fought|find found found|flee fled fled|fling flung flung|fly flew flown
forbid forbade forbidden|forecast forecast forecast|foresee foresaw foreseen|forget forgot forgotten
forgive forgave forgiven|freeze froze frozen|get got got,gotten|give gave given|grind ground ground
grow grew grown|hang hung,hanged hung,hanged|hear heard heard|hide hid hidden|hit hit hit
hold held held|hurt hurt hurt|keep kept kept|kneel knelt knelt|know knew known|lay laid laid
lead led led|lean leant,leaned leant,leaned|leap leapt,leaped leapt,leaped|learn learnt,learned learnt,learned
leave left left|lend lent lent|let let let|lie lay lain lying|light lit,lighted lit,lighted|lose lost lost
make made made|mean meant meant|meet met met|mislead misled misled|mistake mistook mistaken
misunderstand misunderstood misunderstood|overcome overcame overcome|overhear overheard overheard
oversee oversaw overseen|overtake overtook overtaken|overthrow overthrew overthrown|pay paid paid
prove proved proven,proved|put put put|quit quit quit|read read read|rid rid rid|ride rode ridden
ring rang rung|rise rose risen|run ran run|say said said|see saw seen|seek sought sought
sell sold sold|send sent sent|set set set|sew sewed sewn|shake shook shaken|shed shed shed
shine shone shone|shoot shot shot|show showed shown|shrink shrank shrunk|shut shut shut|sing sang sung
sink sank sunk|sit sat sat|sleep slept slept|slide slid slid|sling slung slung|smell smelt,smelled smelt,smelled
sow sowed sown|speak spoke spoken|speed sped sped|spell spelt,spelled spelt,spelled|spend spent spent
spill spilt,spilled spilt,spilled|spin spun spun|spit spat spat|split split split|spoil spoilt,spoiled spoilt,spoiled
spread spread spread|spring sprang sprung|stand stood stood|steal stole stolen|stick stuck stuck
sting stung stung|stink stank stunk|stride strode stridden|strike struck struck|string strung strung
strive strove striven|swear swore sworn|sweep swept swept|swell swelled swollen|swim swam swum
swing swung swung|take took taken|teach taught taught|tear tore torn|tell told told|think thought thought
throw threw thrown|thrust thrust thrust|tread trod trodden|undergo underwent undergone|understand understood understood
undertake undertook undertaken|undo undid undone|upset upset upset|wake woke woken|wear wore worn
weave wove woven|weep wept wept|wet wet wet|win won won|wind wound wound|withdraw withdrew withdrawn
withhold withheld withheld|withstand withstood withstood|wring wrung wrung|write wrote written
`;

const IRREGULAR_NOUNS = `
child children|man men|woman women|person people|foot feet|tooth teeth|goose geese|mouse mice|ox oxen
knife knives|wife wives|life lives|leaf leaves|half halves|wolf wolves|shelf shelves|thief thieves
loaf loaves|calf calves|self selves|scarf scarves|crisis crises|analysis analyses|thesis theses
hypothesis hypotheses|phenomenon phenomena|criterion criteria|medium media|datum data|cactus cacti
fungus fungi|nucleus nuclei|radius radii|stimulus stimuli|appendix appendices|index indices
`;

const IRREGULAR_ADJECTIVES = `
good better best|bad worse worst|far further,farther furthest,farthest|little less least
many more most|much more most|well better best|ill worse worst
`;

function table(source: string): string[][] {
  return source.split(/[|\n]/).map((entry) => entry.trim()).filter(Boolean).map((entry) => entry.split(" "));
}

const VOWEL = /[aeiou]/;
const CONSONANT = /[bcdfghjklmnpqrstvwxyz]/;

/** "stop" → "stopp": a final consonant–vowel–consonant may double before a suffix. */
function doubled(word: string): string | null {
  const [a, b, c] = word.slice(-3);
  if (word.length < 3 || !CONSONANT.test(a) || !VOWEL.test(b) || !CONSONANT.test(c) || "wxy".includes(c)) return null;
  return word + c;
}

/** Plural and third person: "boxes", "cities", "goes", "cats". */
function sForms(word: string): string[] {
  if (/[^aeiou]y$/.test(word)) return [`${word.slice(0, -1)}ies`];
  if (/(s|x|z|ch|sh)$/.test(word)) return [`${word}es`];
  if (/[^aeiou]o$/.test(word)) return [`${word}es`, `${word}s`];
  return [`${word}s`];
}

function verbForms(word: string): string[] {
  const forms = sForms(word);
  const twice = doubled(word);
  if (word.endsWith("e")) forms.push(`${word}d`);
  else if (/[^aeiou]y$/.test(word)) forms.push(`${word.slice(0, -1)}ied`);
  else forms.push(`${word}ed`);
  if (word.endsWith("ie")) forms.push(`${word.slice(0, -2)}ying`);
  else if (/[^eoy]e$/.test(word)) forms.push(`${word.slice(0, -1)}ing`);
  else forms.push(`${word}ing`);
  // Both spellings: "stopped" and "visited" cannot be told apart by letters alone.
  if (twice) forms.push(`${twice}ed`, `${twice}ing`);
  return forms;
}

function adjectiveForms(word: string): string[] {
  const twice = doubled(word);
  if (word.endsWith("e")) return [`${word}r`, `${word}st`];
  if (/[^aeiou]y$/.test(word)) return [`${word.slice(0, -1)}ier`, `${word.slice(0, -1)}iest`];
  return [`${word}er`, `${word}est`, ...(twice ? [`${twice}er`, `${twice}est`] : [])];
}

type Entries = Record<string, Record<"n" | "v" | "j" | "x", string>>;

function buildIndex(): Map<string, number> {
  const index = new Map<string, number>();
  const put = (form: string, rank: number): void => {
    const known = index.get(form);
    if (known === undefined || rank < known) index.set(form, rank);
  };
  const irregularVerbs = new Map(table(IRREGULAR_VERBS).map(([base, ...rest]) => [base, rest.flatMap((part) => part.split(","))]));
  const irregularNouns = new Map(table(IRREGULAR_NOUNS).map(([base, plural]) => [base, [plural]]));
  const irregularAdjectives = new Map(table(IRREGULAR_ADJECTIVES).map(([base, ...rest]) => [base, rest.flatMap((part) => part.split(","))]));

  const entries = data.entries as Entries;
  CEFR_LEVELS.forEach((level, rank) => {
    const groups = entries[level];
    const words = (list: string): string[] => (list ? list.split(" ") : []);
    for (const word of words(groups.x)) put(word, rank);
    for (const word of words(groups.n)) {
      put(word, rank);
      for (const form of irregularNouns.get(word) ?? sForms(word)) put(form, rank);
    }
    for (const word of words(groups.v)) {
      put(word, rank);
      for (const form of verbForms(word)) put(form, rank);
      for (const form of irregularVerbs.get(word) ?? []) put(form, rank);
    }
    for (const word of words(groups.j)) {
      put(word, rank);
      for (const form of irregularAdjectives.get(word) ?? adjectiveForms(word)) put(form, rank);
    }
  });
  // The bundled hard words keep their CEFR level when listed; the rest are above C2.
  for (const entry of specialWords.entries) {
    const word = wordKey(entry.word);
    if (word && !index.has(word)) index.set(word, BEYOND_C2);
  }
  return index;
}

let levels: Map<string, number> | null = null;

/**
 * Rank of an English word: 0 (A1) … 5 (C2), BEYOND_C2 for the special words,
 * or null when unknown — names, slang and rarer words are never highlighted.
 */
export function wordRank(word: string): number | null {
  levels ??= buildIndex();
  const key = wordKey(word);
  if (!key) return null;
  const direct = levels.get(key);
  if (direct !== undefined) return direct;
  // Possessives and contractions: "teacher's", "you'll", "couldn't".
  const base = key.replace(/n't$|'(?:s|ll|re|ve|d|m)$/, "");
  return base !== key ? levels.get(base) ?? null : null;
}

/**
 * Lilac: an English word above the user's level. Until a level is chosen it
 * stays exactly the original fixed list of 100 special words.
 */
export function isAboveLevel(word: string, sourceLanguage: string, level: CefrLevel | null): boolean {
  if (sourceLanguage !== "en") return false;
  if (!level) return isSpecialWord(word, sourceLanguage);
  const rank = wordRank(word);
  return rank !== null && rank > CEFR_LEVELS.indexOf(level);
}
