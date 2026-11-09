import type { AD_QUANTITY_UNITS, AdBrief, AdClaim } from "./contracts.js";

/**
 * D-AD1: the brief is the only source of an ad's facts. The copy check of D-AD12, pure.
 *
 * ── THE RULE IS "EVERY DIGIT IS ACCOUNTED FOR", NOT "THE FIGURES WE RECOGNISE MATCH" ──────────────
 * A checker that only validates the money and units it can parse passes everything it cannot parse —
 * "earn up to 85" or "1500 weekly" would sail through a money regex. So the check runs the other way
 * round: every digit sequence in the copy must belong to a recognised figure (money, a number with a
 * unit, an age floor, or a listed term such as "401k"), and every recognised figure must equal a claim
 * in the brief. A digit nobody can explain is a finding on its own (`unrecognised_number`). Spelled-out
 * numbers ("two weeks", "dos semanas") are read when a unit follows them, so a model cannot route a
 * figure around the check by writing it in words.
 *
 * ── PROMISES, NOT JUST NUMBERS ─────────────────────────────────────────────────────────────────────
 * `PROMISE_TERMS` is the vocabulary of things an ad can promise without a digit — "home weekly",
 * "sign-on bonus", "no-touch freight", "health insurance". The copy may use one only when the brief
 * lists it as a `term` claim. A term outside the vocabulary is not policed (the model must be free to
 * write "join our team"); the vocabulary grows as the evaluation set (§4R, L3) finds new promises.
 *
 * ── FORBIDDEN WORDING (Title VII, ADEA, ADA, state ban-the-box; plan §2 legal) ─────────────────────
 * Age preference beyond the legal floor, gendered wording, health and disability, criminal history,
 * citizenship and national origin. A legal age floor ("23+") is allowed ONLY as an `age` claim — that
 * is the counsel fallback G12 records ("the ad states must be 23+"). English and Spanish both, since
 * every ad carries both (D-AD12). Matching is on whole words, case- and accent-insensitive.
 */

export type ClaimFindingKind =
  | "money_not_in_brief"
  | "quantity_not_in_brief"
  | "age_not_in_brief"
  | "term_not_in_brief"
  | "unrecognised_number"
  | "forbidden_wording"
  | "foreign_unit";

export interface ClaimFinding {
  kind: ClaimFindingKind;
  /** The words in the copy that caused it, as written. */
  text: string;
  /** Offset into the checked text, so the review screen can mark the span. */
  index: number;
  /** For forbidden wording: which rule. */
  rule?: ForbiddenRule;
}

export interface ClaimCheck {
  ok: boolean;
  findings: ClaimFinding[];
}

// ── normalising ─────────────────────────────────────────────────────────────────────────────────
/** Lower case, accents stripped, typographic dashes and quotes made plain. Length-preserving. */
function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const plain = base.length === 1 ? base : ch;
    out += plain.replace(/[\u2010-\u2015]/, "-").replace(/[\u2018\u2019]/, "'").toLowerCase();
  }
  return out.length === text.length ? out : text.toLowerCase();
}

// ── units ───────────────────────────────────────────────────────────────────────────────────────
type QuantityUnit = (typeof AD_QUANTITY_UNITS)[number];
const UNIT_WORDS: Record<string, QuantityUnit> = {
  day: "day", days: "day", dia: "day", dias: "day",
  week: "week", weeks: "week", wk: "week", wks: "week", semana: "week", semanas: "week",
  month: "month", months: "month", mes: "month", meses: "month",
  year: "year", years: "year", yr: "year", yrs: "year", ano: "year", anos: "year",
  mile: "mile", miles: "mile", mi: "mile", milla: "mile", millas: "mile",
  state: "state", states: "state", estado: "state", estados: "state",
  "%": "percent", percent: "percent",
  hour: "hour", hours: "hour", hr: "hour", hrs: "hour", hora: "hour", horas: "hour",
  load: "load", loads: "load", carga: "load", cargas: "load",
};

/** What a money figure is per, as the copy says it. */
const PER_WORDS: Record<string, "mile" | "week" | "year" | "hour" | "day" | "load"> = {
  mile: "mile", mi: "mile", milla: "mile", week: "week", wk: "week", weekly: "week", semana: "week", semanal: "week",
  year: "year", yr: "year", annually: "year", ano: "year", anual: "year", hour: "hour", hr: "hour", hora: "hour",
  day: "day", daily: "day", dia: "day", load: "load", carga: "load",
};

const SPELLED: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30,
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, catorce: 14, quince: 15, veinte: 20, treinta: 30,
};

// ── promises without digits ─────────────────────────────────────────────────────────────────────
/** Canonical term → the ways copy says it (EN + ES, folded). The claim's `term` is compared folded. */
export const PROMISE_TERMS: Record<string, readonly string[]> = {
  "home daily": ["home daily", "home every night", "en casa cada noche", "en casa diario"],
  "home weekly": ["home weekly", "home every week", "en casa cada semana", "en casa semanal"],
  "home weekends": ["home weekends", "home every weekend", "fines de semana en casa", "en casa los fines de semana"],
  "sign-on bonus": ["sign-on bonus", "sign on bonus", "signing bonus", "bono de contratacion", "bono de firma"],
  "referral bonus": ["referral bonus", "bono por referido", "bono de referido"],
  "no-touch freight": ["no-touch freight", "no touch freight", "no-touch", "carga sin tocar", "sin tocar la carga"],
  "drop and hook": ["drop and hook", "drop & hook"],
  "health insurance": ["health insurance", "medical insurance", "seguro medico", "seguro de salud"],
  "dental and vision": ["dental and vision", "dental & vision", "dental y vision"],
  "401k": ["401k", "401(k)", "401 k"],
  "paid orientation": ["paid orientation", "orientacion pagada"],
  "paid time off": ["paid time off", "pto", "vacaciones pagadas"],
  "pet policy": ["pet policy", "pets allowed", "mascotas permitidas"],
  "rider policy": ["rider policy", "riders allowed", "pasajero permitido"],
  "automatic transmission": ["automatic transmission", "automatic trucks", "transmision automatica"],
  "late-model equipment": ["late-model", "late model", "new trucks", "camiones nuevos", "equipo nuevo"],
  "guaranteed pay": ["guaranteed pay", "pay guarantee", "pago garantizado"],
  "weekly pay": ["weekly pay", "paid weekly", "pago semanal"],
  "dedicated": ["dedicated", "dedicada", "dedicado"],
};

/**
 * The quantities a person typed into a free-text fact ("Out 2 weeks, home 4 days" → 2 week, 4 day; "within 500
 * miles" → 500 mile), in digits or in words, so a brief source can make them claims (CQ2): the copy may then
 * repeat what the opening says and nothing it does not. A number with no unit word is not a quantity and is not
 * returned — it cannot be stated either way.
 */
export function quantitiesIn(text: string): Array<{ value: number; unit: QuantityUnit }> {
  const t = fold(text);
  const out: Array<{ value: number; unit: QuantityUnit }> = [];
  // A range shares its unit: "10 to 12 days", "10-12 days", "10 a 12 dias" make both numbers quantities.
  for (const m of t.matchAll(RANGE)) {
    const unit = UNIT_WORDS[m[3]!];
    if (unit) out.push({ value: Number(m[1]!.replace(/,/g, "")), unit });
  }
  for (const m of t.matchAll(QUANTITY)) {
    const unit = UNIT_WORDS[m[3]!];
    if (unit) out.push({ value: Number(m[1]!.replace(/,/g, "") + (m[2] ? `.${m[2]}` : "")), unit });
  }
  for (const m of t.matchAll(SPELLED_QUANTITY)) {
    const unit = UNIT_WORDS[m[2]!];
    if (unit) out.push({ value: SPELLED[m[1]!]!, unit });
  }
  return out;
}

/**
 * The listed term a whole phrase IS ("Home weekly" → "home weekly"), or null. For a brief source turning a
 * person's free text into a `term` claim (recruiting's `openingBrief`): exact phrasings only, so text that
 * merely mentions a promise never becomes one. Whitespace is collapsed; case and accents fold as above.
 */
export function promiseTermOf(text: string): string | null {
  const t = fold(text.replace(/\s+/g, " ").trim());
  for (const [term, phrasings] of Object.entries(PROMISE_TERMS)) {
    if (fold(term) === t || phrasings.some((p) => fold(p) === t)) return term;
  }
  return null;
}

// ── units the trade does not use ────────────────────────────────────────────────────────────────
/**
 * A US driver is paid by the mile and drives miles; copy that says "kilómetro" or "km" beside a per-mile rate reads
 * as written by somebody who has never been in a cab. Found 2026-11-09 in a PASSING recorded fixture
 * (`p1-otr-bonus`: "$0.72 por milla … cada kilómetro recorrido") — the claim check saw no figure, so it saw nothing.
 * Whole words, folded, EN + ES; `AD_QUANTITY_UNITS` holds no such unit, so no brief can allow one.
 */
const FOREIGN_UNITS: readonly string[] = ["kilometer", "kilometers", "kilometre", "kilometres", "kilometro", "kilometros", "km", "kms"];

// ── forbidden wording ───────────────────────────────────────────────────────────────────────────
export type ForbiddenRule = "age" | "gender" | "health" | "criminal_history" | "national_origin";

/** Folded, whole-word. Ordered longest-first inside a rule so the reported span is the full phrase. */
const FORBIDDEN: Record<ForbiddenRule, readonly string[]> = {
  age: [
    "recent graduates", "recent graduate", "recent grads", "recent grad", "digital natives", "digital native",
    "no older than", "maximum age", "max age", "young", "younger", "youthful", "under 40", "under 50",
    "recien graduados", "recien graduado", "jovenes", "joven",
  ],
  gender: [
    "salesman", "guys", "men only", "women only", "gentlemen", "ladies", "he or she", "his or her",
    "hombres", "mujeres", "caballeros", "damas",
  ],
  health: [
    "no medical conditions", "no disabilities", "able-bodied", "able bodied", "healthy", "pregnant", "pregnancy",
    "sin discapacidad", "saludable", "embarazada",
  ],
  criminal_history: [
    "no criminal record", "criminal record", "criminal history", "no felonies", "felony", "felonies", "felon",
    "no convictions", "conviction", "antecedentes penales", "delito grave", "felonia",
  ],
  national_origin: [
    "us citizens only", "u.s. citizens only", "citizens only", "native english", "english only", "native speaker",
    "solo ciudadanos", "hablante nativo",
  ],
};

// ── the check ───────────────────────────────────────────────────────────────────────────────────
const NUM = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
/** $1,500 · $0.68 · $75k · $75K · $1.2k — the dollar sign is required for a dollar figure. */
const DOLLARS = new RegExp(String.raw`\$\s?(${NUM})(?:\.(\d{1,2}))?(k\b)?`, "g");
/** 68 cents · 68¢ · 68 centavos · 68 cpm (cents per mile, the trade's unit). */
const CENTS = new RegExp(String.raw`\b(\d{1,3})\s?(?:¢|cents?\b|centavos?\b|cpm\b)`, "g");
/** What a money figure is per, right after it: "/mile", "per week", "a year", "por milla". */
const PER_AFTER = /^\s*(?:\/|per\s+|a\s+|an\s+|por\s+|al\s+|a la\s+|each\s+)?([a-z]+)/;
/** A number followed by a unit word or %. */
const QUANTITY = new RegExp(String.raw`\b(${NUM})(?:\.(\d+))?\s?(%|[a-z]+)`, "g");
/** The first number of a range whose unit follows the second: "10 to 12 days", "10-12 days", "10 a 12 dias". */
const RANGE = new RegExp(String.raw`\b(${NUM})\s?(?:-|to|a)\s?(${NUM})\s?([a-z]+)`, "g");
/**
 * A spelled number followed by a unit word — anchored on the number words themselves, so a general
 * "word word" pattern cannot consume the number together with the word before it ("get two weeks").
 */
const SPELLED_QUANTITY = new RegExp(String.raw`\b(${Object.keys(SPELLED).join("|")})\s([a-z]+)\b`, "g");
/**
 * An age floor: "23+", "age 23", "23 years old", "mayores de 23", "mayor de 23 años", "23 anos de edad".
 * "mayor de 23 años" (singular, with the unit) is how a Spanish ad addresses one reader; before C2's eval
 * it was read as a bare "23 años" — a quantity of years — and refused (measured 2026-11-03).
 * "23 or older", "23 years or older", "23 and over", "23 años o más": the same floor in the words a person
 * writes it in. The live model wrote "if you are 23 or older" for an `age` claim of 23 (the 40-brief eval,
 * 2026-11-05) and the check read the 23 as a figure it could not place — a valid ad refused.
 */
const AGE = /\b(\d{2})\s?\+|\bage\s(\d{2})\b|\b(\d{2})\s(?:years?\sold|anos\sde\sedad|(?:years?\s)?(?:or|and)\s(?:older|over|up|above)|anos\so\smas)\b|\bmayor(?:es)?\sde\s(\d{2})(?:\sanos)?\b/g;
/**
 * A road's designation is a name, not a figure: "I-80", "US-30", "SR-9", "Highway 20", "Ruta 66". A lane typed on
 * the opening ("I-80 corridor, Joliet to Des Moines") reaches the copy as subject matter, and the copy may name the
 * road. Only these shapes; a bare "80" is still a figure nobody can account for (CQ2, found 2026-11-09).
 */
const ROAD = /\b(?:i|us|sr)-\d{1,3}\b|\b(?:hwy|highway|interstate|route|ruta)\s\d{1,3}\b/g;

function moneyMatches(claims: AdClaim[], cents: number, per: string | null): boolean {
  return claims.some((c) => c.kind === "money" && c.cents === cents && (per === null || c.per === per));
}
function quantityMatches(claims: AdClaim[], value: number, unit: QuantityUnit): boolean {
  return claims.some((c) => c.kind === "quantity" && c.unit === unit && c.value === value);
}

/** Mark [start, end) as explained so the leftover-digit scan does not report it twice. */
function cover(mask: boolean[], start: number, end: number): void {
  for (let i = start; i < end; i++) mask[i] = true;
}

function wholeWordIndexes(hay: string, needle: string): number[] {
  const out: number[] = [];
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\p{L}\p{N}])`, "gu");
  for (const m of hay.matchAll(re)) out.push(m.index!);
  return out;
}

/**
 * Check one piece of copy (a headline, a body, a card) against the brief. Run it on every string of
 * every language; a finding anywhere blocks Create (D-AD1).
 */
export function checkClaims(copy: string, brief: Pick<AdBrief, "claims"> & { exempt_phrases?: readonly string[] }): ClaimCheck {
  const text = fold(copy);
  const claims = brief.claims;
  const findings: ClaimFinding[] = [];
  const explained = new Array<boolean>(text.length).fill(false);
  const at = (index: number, len: number) => copy.slice(index, index + len);

  // 0. phrases the brief vouches for as written — the carrier's own name ("360 Logistics"), whose digits are not a
  //    figure (CQ2). Covered first, so no later rule reads a number out of them. Never a whole number alone.
  for (const phrase of brief.exempt_phrases ?? []) {
    const f = fold(phrase).trim();
    if (f.length < 2 || /^\d+$/.test(f)) continue;
    for (const i of wholeWordIndexes(text, f)) cover(explained, i, i + f.length);
  }
  // 0a. road designations are names
  for (const m of text.matchAll(ROAD)) cover(explained, m.index!, m.index! + m[0].length);
  // 0b. units the trade does not use, whatever the brief says
  for (const u of FOREIGN_UNITS) {
    for (const i of wholeWordIndexes(text, u)) {
      if (explained[i]) continue;
      cover(explained, i, i + u.length);
      findings.push({ kind: "foreign_unit", text: at(i, u.length), index: i });
    }
  }

  // 1. forbidden wording, first: it is refused whatever the brief says
  const forbiddenSpans: [number, number][] = [];
  for (const [rule, phrases] of Object.entries(FORBIDDEN) as [ForbiddenRule, readonly string[]][]) {
    for (const p of phrases) {
      for (const i of wholeWordIndexes(text, p)) {
        // Longest phrase first, so "no criminal record" is reported once, not again as "criminal record".
        if (forbiddenSpans.some(([s, e]) => i >= s && i < e)) continue;
        forbiddenSpans.push([i, i + p.length]);
        cover(explained, i, i + p.length);
        findings.push({ kind: "forbidden_wording", text: at(i, p.length), index: i, rule });
      }
    }
  }

  // 2. promise terms: listed vocabulary only with a matching term claim; their digits ("401k") are explained
  const claimedTerms = new Set(claims.flatMap((c) => (c.kind === "term" ? [fold(c.term)] : [])));
  for (const [term, phrasings] of Object.entries(PROMISE_TERMS)) {
    for (const p of phrasings) {
      for (const i of wholeWordIndexes(text, p)) {
        if (explained[i]) continue;
        cover(explained, i, i + p.length);
        if (!claimedTerms.has(fold(term))) findings.push({ kind: "term_not_in_brief", text: at(i, p.length), index: i });
      }
    }
  }

  // 3. money
  for (const m of text.matchAll(DOLLARS)) {
    if (explained[m.index!]) continue;
    const whole = Number(m[1]!.replace(/,/g, ""));
    const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
    const cents = m[3] ? Math.round((whole + frac / 100) * 1000 * 100) : whole * 100 + frac;
    const perWord = PER_AFTER.exec(text.slice(m.index! + m[0].length))?.[1];
    const per = perWord ? (PER_WORDS[perWord] ?? null) : null;
    cover(explained, m.index!, m.index! + m[0].length);
    if (!moneyMatches(claims, cents, per)) findings.push({ kind: "money_not_in_brief", text: at(m.index!, m[0].length), index: m.index! });
  }
  for (const m of text.matchAll(CENTS)) {
    if (explained[m.index!]) continue;
    const isCpm = /cpm/.test(m[0]);
    const perWord = PER_AFTER.exec(text.slice(m.index! + m[0].length))?.[1];
    const per = isCpm ? "mile" : perWord ? (PER_WORDS[perWord] ?? null) : null;
    cover(explained, m.index!, m.index! + m[0].length);
    if (!moneyMatches(claims, Number(m[1]), per)) findings.push({ kind: "money_not_in_brief", text: at(m.index!, m[0].length), index: m.index! });
  }

  // 4. an age floor — only as an `age` claim
  for (const m of text.matchAll(AGE)) {
    if (explained[m.index!]) continue;
    const value = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
    cover(explained, m.index!, m.index! + m[0].length);
    if (!quantityMatches(claims, value, "age")) findings.push({ kind: "age_not_in_brief", text: at(m.index!, m[0].length), index: m.index! });
  }

  // 5. numbers with units, in digits and in words — a range first, so "10 to 12 days" holds both numbers to the unit
  for (const m of text.matchAll(RANGE)) {
    const unit = UNIT_WORDS[m[3]!];
    if (!unit || explained[m.index!]) continue;
    cover(explained, m.index!, m.index! + m[0].length);
    for (const [n, off] of [[m[1]!, 0], [m[2]!, m[0].lastIndexOf(m[2]!)]] as const) {
      if (!quantityMatches(claims, Number(n.replace(/,/g, "")), unit)) findings.push({ kind: "quantity_not_in_brief", text: at(m.index! + off, n.length), index: m.index! + off });
    }
  }
  for (const m of text.matchAll(QUANTITY)) {
    const unit = UNIT_WORDS[m[3]!];
    if (!unit || explained[m.index!]) continue;
    const value = Number(m[1]!.replace(/,/g, "") + (m[2] ? `.${m[2]}` : ""));
    cover(explained, m.index!, m.index! + m[0].length);
    if (!quantityMatches(claims, value, unit)) findings.push({ kind: "quantity_not_in_brief", text: at(m.index!, m[0].length), index: m.index! });
  }
  for (const m of text.matchAll(SPELLED_QUANTITY)) {
    const unit = UNIT_WORDS[m[2]!];
    if (!unit || explained[m.index!]) continue;
    cover(explained, m.index!, m.index! + m[0].length);
    if (!quantityMatches(claims, SPELLED[m[1]!]!, unit)) findings.push({ kind: "quantity_not_in_brief", text: at(m.index!, m[0].length), index: m.index! });
  }

  // 6. any digit left over is a figure nobody can account for
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const start = m.index!;
    let unexplained = false;
    for (let i = start; i < start + m[0].length; i++) if (!explained[i] && /\d/.test(text[i]!)) unexplained = true;
    if (unexplained) findings.push({ kind: "unrecognised_number", text: at(start, m[0].length), index: start });
  }

  findings.sort((a, b) => a.index - b.index);
  return { ok: findings.length === 0, findings };
}
