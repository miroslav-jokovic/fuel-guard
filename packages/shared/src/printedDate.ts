/**
 * A date as a US paper prints it → `YYYY-MM-DD`, or null (DRIVER-PAPER-INTAKE-PLAN PI3).
 *
 * The reader transcribes dates exactly as printed (D-DR2: "03/01/2019", "3-1-19", "March 1, 2019"); turning
 * them into a date the file can judge is the consumer's job, in code. Pure, no clock:
 * - Month first. These are US carrier papers — a state MVR, a DOT medical card, a carrier's own forms —
 *   and every one of them prints MM/DD. A day-first paper would be misread; the person filing sees the
 *   proposed date beside the scan and corrects it (D-UF8), which is why a proposal is never filed unseen.
 * - A two-digit year pivots at 50: `19` is 2019, `68` is 1968 — a driver file spans hire dates from the
 *   1970s to expiries in the 2030s, and a fixed pivot keeps the answer the same on every day it is asked.
 * - Anything that is not a real calendar day (02/30/2026) is null, not rolled into March.
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2199) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const fullYear = (y: number, digits: number): number => (digits === 2 ? (y < 50 ? 2000 + y : 1900 + y) : y);

export function parsePrintedDate(text: string | null | undefined): string | null {
  const s = (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  // 2019-03-01
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  // 03/01/2019, 3-1-19, 03.01.2019
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return iso(fullYear(Number(m[3]), m[3]!.length), Number(m[1]), Number(m[2]));
  // March 1, 2019 · Mar. 1 2019
  m = s.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3)) + 1;
    return month ? iso(Number(m[3]), month, Number(m[2])) : null;
  }
  // 1 March 2019 · 01-Mar-2019
  m = s.match(/^(\d{1,2})[ -]([a-z]+)\.?[ ,-]+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3)) + 1;
    return month ? iso(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}
