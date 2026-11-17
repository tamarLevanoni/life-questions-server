export type SourceCatalog = { id: string; name: string; kind: 'shas' | 'shu' };

export type SourceReference = SourceCatalog & {
  number: number;
  subdivision?: number;
};

const SECTION_ALIASES: Record<string, string[]> = {
  'חושן משפט': ['חו"מ', 'חומ'],
  'אורח חיים': ['או"ח', 'אוח'],
  'יורה דעה': ['יו"ד', 'יוד'],
  'אבן העזר': ['אה"ע', 'אהע'],
};

const TRACTATE_ALIASES: Record<string, string[]> = {
  'בבא קמא': ['ב"ק', 'בק'],
  'בבא מציעא': ['ב"מ', 'במ'],
  'בבא בתרא': ['ב"ב', 'בב'],
  'מועד קטן': ['מו"ק', 'מוק'],
  'ראש השנה': ['ר"ה', 'רה'],
  'עבודה זרה': ['ע"ז', 'עז'],
};

const HEBREW_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400];
const HEBREW_NUMBERS = Object.fromEntries(
  [...'אבגדהוזחטיכלמנסעפצקרשת'].map((letter, index) => [letter, HEBREW_VALUES[index]]),
);
const NUMERAL = String.raw`(?:\d{1,4}|[א-ת](?:["']?[א-ת]){0,5}['"]?)`;
const SOURCE_END = String.raw`(?=$|[^\p{L}\p{N}])`;
const MAX_REFERENCES = 5;
const OTHER_WORK = /(?:יביע אומר|חזון איש|חזו"א|יחוה דעת|אגרות משה|שמירת שבת כהלכתה)\s*[^.;\n]{0,35}$/u;
export const SECTION_CONTEXT_NAMES = ['שו"ע', 'שולחן ערוך', 'שלחן ערוך', 'השולחן ערוך', 'השלחן ערוך'];

/** מנקה ניקוד ומאחד רווחים וסוגי גרשיים תוך שמירה על הפיסוק שעוזר לזהות הפניה. */
function sourceText(text: string) {
  return text.normalize('NFC')
    .replace(/[\u0591-\u05BD\u05BF-\u05C2\u05C4\u05C5\u05C7]/g, '')
    .replace(/[״“”]/g, '"')
    .replace(/[׳‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** ממיר ספרות או אותיות עבריות למספר ובודק שערכי האותיות מופיעים בסדר יורד. */
function parseNumber(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text) || undefined;
  const letters = text.replace(/["']/g, '');
  const values = Array.from(letters, (letter) => HEBREW_NUMBERS[letter]);
  if (values.some((value, i) => !value || (i > 0 && value > values[i - 1]))) return undefined;
  return values.reduce((sum, value) => sum + value, 0) || undefined;
}

/** מאפשר לשלב שם מהקטלוג בביטוי רגולרי תוך פירוש התווים שלו כלשונם. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** מחזיר את השם הרשמי ואת הכינויים המוכרים לאותו מקור. */
export function sourceNames(catalog: SourceCatalog): string[] {
  const aliases = catalog.kind === 'shu' ? SECTION_ALIASES : TRACTATE_ALIASES;
  return [catalog.name, ...(aliases[catalog.name] ?? [])];
}

/** מחלץ מיקומים בחיבור מסוים ומחזיר גם את גבולות ההפניה בתוך הטקסט. */
function referenceMatches(text: string, catalog: SourceCatalog, sectionContext = false) {
  const names = [...sourceNames(catalog), ...(sectionContext ? SECTION_CONTEXT_NAMES : [])].map((name) => escapeRegex(sourceText(name))).join('|');
  const beginning = String.raw`(?<![\p{L}\p{N}])ו?[במל]?(?:${names})[\s(]+`;
  const suffix = catalog.kind === 'shas'
    ? String.raw`(?:(דף)\s+)?(${NUMERAL})${SOURCE_END}(?:\s*(?:(?:,\s*|עמוד\s+|עמ?["']?\s*)([אב12])['"]?${SOURCE_END}|([.:])))?`
    : String.raw`(?:(סימן|סי['"]?)\s*)?(${NUMERAL})${SOURCE_END}(?:\s*(?:,\s*(?:סעיף\s+)?|\s+ס(?:עיף\s+|ע?["']\s*))(${NUMERAL})${SOURCE_END})?`;
  return Array.from(text.matchAll(new RegExp(beginning + suffix, 'giu'))).flatMap((match) => {
    if (OTHER_WORK.test(text.slice(0, match.index))) return [];
    const [, marker, numeral, subdivision, punctuation] = match;
    // Bare Hebrew numerals need citation punctuation or the end of the phrase.
    if (!marker && !subdivision && !punctuation && !/[0-9"']/.test(numeral)
      && /[\p{L}\p{N}]/u.test(text.slice(match.index + match[0].length))) return [];
    const number = parseNumber(numeral);
    if (!number) return [];
    const sub = punctuation ? (punctuation === ':' ? 2 : 1)
      : subdivision ? parseNumber(subdivision) : undefined;
    if (subdivision && !sub) return [];
    return [{ start: match.index, end: match.index + match[0].length, reference: {
      ...catalog, number, subdivision: sub,
    } }];
  });
}

function workMatches(text: string, work: SourceCatalog) {
  const names = sourceNames(work).map(sourceText).sort((a, b) => b.length - a.length);
  const label = work.kind === 'shas' ? 'מסכת' : 'חלק|שו"ע|שולחן ערוך|שלחן ערוך';
  const pattern = String.raw`(?<![\p{L}\p{N}])(?:(ו?[במל]?(?:${label}))\s+|ו?[במל]?)(${names.map(escapeRegex).join('|')})${SOURCE_END}`;
  return Array.from(text.matchAll(new RegExp(pattern, 'giu'))).flatMap((match) => {
    const [phrase, marker, name] = match;
    if (OTHER_WORK.test(text.slice(0, match.index))) return [];
    // מילים כמו "שבת" יכולות להיות נושא החיפוש גם בלי לציין מסכת.
    const specific = /[\s"]/.test(name) || (name.length >= 3 && name !== sourceText(work.name));
    if (!marker && text !== phrase && !specific) return [];
    return [{ start: match.index, end: match.index + phrase.length, work }];
  });
}

/** מחלץ שמות מקורות גם כאשר לא צוין מספר דף או סימן. */
function parseWorks(text: string, catalog: SourceCatalog[]) {
  const spans = catalog.flatMap((work) => workMatches(text, work))
    .sort((a, b) => b.end - a.end || a.start - b.start);
  const works = new Map<string, SourceCatalog>();
  let remainder = text;
  let nextMatchStart = text.length;
  for (const { start, end, work } of spans) {
    const key = `${work.kind}:${work.id}`;
    if (end > nextMatchStart || (!works.has(key) && works.size >= MAX_REFERENCES)) continue;
    works.set(key, work);
    remainder = remainder.slice(0, start) + ' ' + remainder.slice(end);
    nextMatchStart = start;
  }
  return {
    works: [...works.values()],
    remainder: remainder.replace(/^[\s,;:().־–—-]+|[\s,;:().־–—-]+$/gu, ''),
  };
}

/** מאחד הפניות כפולות ומסיר את ההפניות שזוהו כדי להשאיר את הטקסט לחיפוש תוכן. */
export function parseSourceSearch(query: string, catalog: SourceCatalog[]) {
  const text = sourceText(query);
  const matches = catalog.flatMap((source) => referenceMatches(text, source))
    .sort((a, b) => b.start - a.start);
  const references: SourceReference[] = [];
  const seen = new Set<string>();
  let remainder = text;
  let nextMatchStart = text.length;
  for (const match of matches) {
    const { reference, start, end } = match;
    if (end > nextMatchStart) continue;
    const key = [reference.kind, reference.id, reference.number, reference.subdivision].join(':');
    if (!seen.has(key)) {
      if (references.length >= MAX_REFERENCES) continue;
      seen.add(key);
      references.push(reference);
    }
    remainder = remainder.slice(0, start) + ' ' + remainder.slice(end);
    nextMatchStart = start;
  }
  if (!references.length) {
    const broad = parseWorks(text, catalog);
    return { references, works: broad.works, remainder: broad.works.length ? broad.remainder : query };
  }

  // אחרי הסרת ההפניות, רווחים וסימני פיסוק לבדם אינם טקסט לחיפוש.
  return { references, works: [], remainder: /[\p{L}\p{N}]/u.test(remainder) ? remainder.trim() : '' };
}

/** מחלץ הפניות מתוך טקסט קטלוג או הרחבה. */
export function parseSourceCitations(text: string, source: SourceCatalog, sectionContext: boolean) {
  return referenceMatches(sourceText(text), source, sectionContext).map(({ reference }) => reference);
}
