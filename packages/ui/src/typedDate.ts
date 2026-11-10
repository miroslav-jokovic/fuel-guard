/**
 * A date as a person TYPES it — "1001", "10011985", "3/15/85" — read into the calendar day they meant
 * (APPLICATION-SCREEN-MAP §9, D-AM6, owner 2026-11-09).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 * The driver's form had three date controls, and none of them took a date the way a driver gives one:
 *
 * - `AppMemorableDate` was three boxes, and that is three targets to hit on a phone.
 * - `AppDateField` was a calendar whose text input parsed exactly `MM/dd/yyyy`, so "1001" or "10/1/85" did
 *   nothing at all.
 * - `AppMonthField` was the same calendar, by month.
 *
 * The owner's rule is the one people already use on paper: type the digits, and the year is this year
 * unless you say otherwise. So "1001" is October 1 of this year, and "10011985" is October 1, 1985.
 *
 * ── ONE SEGMENTATION, USED FOR BOTH THE MASK AND THE READING ──────────────────────────────────
 * `segmentDigits` decides where the month ends and the day begins, and `maskTypedDate` draws exactly
 * those slashes as the driver types. So what is on screen IS how it will be read, and nobody has to
 * learn that a single-digit month needs a leading zero:
 *
 * - **Month.** It is one digit when the first digit is 2–9 ("315" → 3/15). When the first digit is 1, it
 *   is two digits only if the next digit is 0–2 ("1001" → 10/01, but "15" → 1/5). A leading 0 always
 *   makes two digits.
 * - **Day.** It is one digit when its first digit is 4–9; otherwise it is two.
 * - **Year.** Whatever is left: none, 2 digits or 4 digits.
 *
 * Typed separators (`/ - . space`) override all of this, so "10/1/85" means exactly what it says.
 *
 * ── THE YEAR, BY WHAT THE FIELD ASKS ──────────────────────────────────────────────────────────
 * With no year, the year is this year. On a `past` field (an accident, a conviction) a date that would
 * then land in the future is last year's, because it cannot be next week. A date of birth refuses to
 * guess and asks for the year.
 *
 * A 2-digit year goes to the century that makes sense for the field:
 * - a date of birth takes the age that is 18–99;
 * - `past` takes the most recent year that is not in the future;
 * - `future` takes 20YY;
 * - `any` takes 20YY up to ten years ahead, and 19YY otherwise.
 *
 * The answer is always spelled out to the driver (`spellTypedDate`), so a guess they did not mean is one
 * they can see before Continue.
 *
 * Pure: no clock. `today` is the caller's calendar day as `YYYY-MM-DD`. A calendar day is not an
 * instant (`displayDate.ts`).
 */

export type TypedDateKind = "dob" | "past" | "future" | "any" | "month";

export type TypedDateProblem =
  /** Nothing typed. */
  | "empty"
  /** Still being typed: a one-digit year, a month with no day. Not an error yet. */
  | "incomplete"
  /** A date of birth with no year — the one field that never assumes this year. */
  | "needsYear"
  | "badMonth"
  | "badDay"
  /** A 2-digit date of birth no century makes 18–99. */
  | "badAge"
  /** Letters, or more digits than a date has. */
  | "unreadable";

export type TypedDate =
  | { ok: true; iso: string; year: number; month: number; day: number | null }
  | { ok: false; problem: TypedDateProblem };

interface Segments {
  month: string;
  day: string;
  year: string;
}

const SEPARATORS = /[\s/.\-]+/;
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Where the digits break into month, day and year, with no separators typed (see the header). */
export function segmentDigits(digits: string, monthOnly = false): Segments {
  let rest = digits;
  const first = rest[0];
  let monthLength = 2;
  if (first === undefined) monthLength = 0;
  else if (first >= "2" && first <= "9") monthLength = 1;
  else if (first === "1" && rest.length >= 2 && rest[1]! > "2") monthLength = 1;
  const month = rest.slice(0, monthLength);
  rest = rest.slice(monthLength);
  if (monthOnly) return { month, day: "", year: rest };
  const dayFirst = rest[0];
  const dayLength = dayFirst === undefined ? 0 : dayFirst >= "4" ? 1 : 2;
  const day = rest.slice(0, dayLength);
  return { month, day, year: rest.slice(dayLength) };
}

/**
 * The box's text as the driver types it, with the slashes in. Only a run of digits (plus slashes this
 * function drew itself) is re-masked. Anything typed with separators of its own is left exactly as
 * typed, so "1/5/85" stays "1/5/85" and backspacing over a slash removes it.
 */
export function maskTypedDate(text: string, kind: TypedDateKind): string {
  const digits = text.replace(/\//g, "");
  if (!/^\d*$/.test(digits) || !isOurMask(text, kind)) return text;
  const monthOnly = kind === "month";
  const s = segmentDigits(digits.slice(0, monthOnly ? 6 : 8), monthOnly);
  const parts = monthOnly ? [s.month, s.year] : [s.month, s.day, s.year];
  // A slash appears only once the part after it has begun, so the box never ends in one the driver did
  // not type — which is what lets backspace delete a digit instead of fighting the mask.
  return parts.filter((p, i) => p !== "" || i === 0).join("/");
}

/** Is this text the mask's own drawing (or bare digits), rather than separators the driver typed? */
function isOurMask(text: string, kind: TypedDateKind): boolean {
  if (!text.includes("/")) return true;
  const digits = text.replace(/\//g, "");
  return maskTypedDate(digits, kind) === text;
}

/** Read what was typed (see the header). `today` is `YYYY-MM-DD`. */
export function parseTypedDate(text: string, kind: TypedDateKind, today: string): TypedDate {
  const raw = text.trim();
  if (raw === "") return { ok: false, problem: "empty" };
  if (!/^[\d\s/.\-]+$/.test(raw)) return { ok: false, problem: "unreadable" };
  const monthOnly = kind === "month";

  let seg: Segments;
  const digitsOnly = raw.replace(/\//g, "");
  if (/^\d+$/.test(digitsOnly) && isOurMask(raw, kind)) {
    if (digitsOnly.length > (monthOnly ? 6 : 8)) return { ok: false, problem: "unreadable" };
    seg = segmentDigits(digitsOnly, monthOnly);
    // A day begun with 0–3 is a two-digit day still being typed ("10/0" is on its way to 10/05).
    if (!monthOnly && seg.day.length === 1 && seg.day < "4" && seg.year === "") return { ok: false, problem: "incomplete" };
  } else {
    const parts = raw.split(SEPARATORS).filter((p) => p !== "");
    if (parts.some((p) => !/^\d+$/.test(p))) return { ok: false, problem: "unreadable" };
    if (monthOnly) {
      if (parts.length > 2) return { ok: false, problem: "unreadable" };
      seg = { month: parts[0] ?? "", day: "", year: parts[1] ?? "" };
    } else {
      if (parts.length > 3) return { ok: false, problem: "unreadable" };
      seg = { month: parts[0] ?? "", day: parts[1] ?? "", year: parts[2] ?? "" };
    }
    if (seg.month.length > 2 || seg.day.length > 2) return { ok: false, problem: "unreadable" };
  }

  if (seg.month === "" || (!monthOnly && seg.day === "")) return { ok: false, problem: "incomplete" };
  const month = Number(seg.month);
  if (month < 1 || month > 12) return { ok: false, problem: "badMonth" };
  const day = monthOnly ? null : Number(seg.day);

  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const todayKey = ty * 10_000 + tm * 100 + td;
  const keyOf = (y: number): number => y * 10_000 + month * 100 + (day ?? 1);

  let year: number;
  if (seg.year === "") {
    if (kind === "dob") return { ok: false, problem: "needsYear" };
    year = ty;
    if (kind === "past" && keyOf(year) > todayKey) year -= 1;
  } else if (seg.year.length === 2) {
    const yy = Number(seg.year);
    const candidates = [2000 + yy, 1900 + yy];
    if (kind === "dob") {
      const fit = candidates.find((y) => {
        const age = ageOn(y, month, day ?? 1, ty, tm, td);
        return age >= 18 && age <= 99;
      });
      if (fit === undefined) return { ok: false, problem: "badAge" };
      year = fit;
    } else if (kind === "past") {
      year = candidates.find((y) => keyOf(y) <= todayKey) ?? candidates[1]!;
    } else if (kind === "month") {
      // A period someone lived or worked through: this century up to this year, the last one after it.
      year = 2000 + yy <= ty ? 2000 + yy : 1900 + yy;
    } else if (kind === "future") {
      year = 2000 + yy;
    } else {
      year = 2000 + yy <= ty + 10 ? 2000 + yy : 1900 + yy;
    }
  } else if (seg.year.length === 4) {
    year = Number(seg.year);
  } else {
    return { ok: false, problem: seg.year.length < 4 ? "incomplete" : "unreadable" };
  }

  if (day !== null && (day < 1 || day > daysIn(year, month))) return { ok: false, problem: "badDay" };
  const iso = day === null ? `${year}-${pad2(month)}` : `${year}-${pad2(month)}-${pad2(day)}`;
  return { ok: true, iso, year, month, day };
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ageOn(y: number, m: number, d: number, ty: number, tm: number, td: number): number {
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
} as const;

/**
 * The date in words, shown under the box ("October 1, 1985" or "1 de octubre de 1985"). It is the
 * driver's check on the guess. `iso` is `YYYY-MM-DD` or `YYYY-MM`.
 */
export function spellTypedDate(iso: string, language: "en" | "es" = "en"): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[language][Number(m) - 1] ?? "";
  if (d === undefined) return language === "es" ? `${month} de ${y}` : `${month} ${y}`;
  const day = Number(d);
  return language === "es" ? `${day} de ${month} de ${y}` : `${month} ${day}, ${y}`;
}

/** What the box holds for a stored value: `1985-10-01` → `10/01/1985`, `2019-03` → `03/2019`. */
export function typedDateText(iso: string | null | undefined): string {
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (full) return `${full[2]}/${full[3]}/${full[1]}`;
  const month = /^(\d{4})-(\d{2})$/.exec(iso ?? "");
  return month ? `${month[2]}/${month[1]}` : "";
}
