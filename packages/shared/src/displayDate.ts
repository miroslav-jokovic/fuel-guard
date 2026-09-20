/**
 * The one definition of how a date is SHOWN to a person, in any of the four apps.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
 * `docs/DESIGN-SYSTEM-CONTRACT.md` §the-component-table has pinned date display to `MM/dd/yyyy` since
 * D-DS17 (2026-08-31), but only the two pickers ever honoured it, because the contract stated the rule
 * for a COMPONENT rather than for the product. Everything that was not a picker wrote its own. An
 * audit on 2026-09-20 counted the result:
 *
 *   - 13 near-duplicate `fmtDate` / `formatDate` definitions across `apps/web` and `apps/admin`
 *   - ~30 inline `toLocaleDateString` calls, most of them passing `undefined` as the locale, which
 *     hands the ordering to whatever the VIEWER's browser is set to — `2026/09/20` on a `ja`, `zh`
 *     or `en-CA` browser, `20/09/2026` on `en-GB`, and nothing in the repo pinning any of it
 *   - raw ISO reaching the screen unformatted in a dozen places, including `packetDraw.ts`'s `date()`,
 *     which printed `2026-09-20` into every date box of the 22-page federal DOT application packet
 *
 * Four shapes for one fact, none of them reviewed as a duplicate, each one a reasonable local decision.
 * That is precisely the failure CLAUDE.md's no-workarounds rule describes — "a value copied instead of
 * derived" — and a ruling alone does not survive it. `lint:date-format` is the half that does.
 *
 * ── THE BUG THE COPIES CARRIED ────────────────────────────────────────────────────────────────────
 * `apps/web/src/lib/format.ts` read a calendar-day string in a UTC frame and was right to. The copies
 * did `new Date("2026-09-20").toLocaleDateString(...)`, which parses to UTC midnight and then renders
 * it in LOCAL time — so every US timezone printed **Sep 19** for a day the database calls the 20th.
 * `MaintenanceSpendPage.vue`, `BillingPage.vue`, `RecallAuditPage.vue` and `OdometerPage.vue` all shipped
 * with it. The off-by-one is why this module distinguishes the two kinds of value rather than taking
 * "a date" and hoping:
 *
 *   - a CALENDAR DAY (`2026-09-20` — a `date` column: `next_due_on`, `date_of_birth`, `expires_at`)
 *     names a square on a wall calendar. It has no instant and therefore no timezone. We read the
 *     Y-M-D characters and never construct a `Date` at all, so there is nothing for an offset to shift.
 *   - an INSTANT (`2026-09-20T14:03:00Z` — a `timestamptz` column) is a moment, and the person reading
 *     it wants it in THEIR time, so it is rendered from local parts.
 *
 * The distinction is made from the value's own shape, so a caller cannot get it wrong by choosing the
 * wrong helper.
 *
 * ── WHY NOT `toLocaleDateString("en-US")` ─────────────────────────────────────────────────────────
 * Pinning the locale argument would fix the ordering and leave two smaller traps open: `en-US` yields
 * `9/20/2026`, not `09/20/2026` (a ragged left edge in a table column), and any future caller that
 * omits the argument silently reverts to the viewer's browser with no gate able to see the difference
 * between the two calls. Assembling the string from parts removes the class of fault rather than the
 * instance, and makes the gate a simple ban on `toLocale*Date*` outside this file.
 */

/** What every formatter here returns for a value that isn't there. Overridable — the PDF packet wants "". */
const EM_DASH = "—";

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Split any accepted input into the Y/M/D (and optional H:M) a formatter draws, or null when the value
 * is not a date at all.
 *
 * A bare `Date` is read in local time — it is an instant by construction, there is no other reading.
 */
type Parts = { y: number; m: number; d: number; h: number; min: number };

const fromDate = (at: Date): Parts | null =>
  Number.isNaN(at.getTime())
    ? null
    : { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate(), h: at.getHours(), min: at.getMinutes() };

/**
 * Read a value as a CALENDAR DAY — a square on a wall calendar, which has no instant and therefore no
 * timezone.
 *
 * A string that LEADS with `YYYY-MM-DD` is read character-wise, and any time part after it is ignored
 * rather than allowed to move the date. No `Date` is constructed, so there is nothing for an offset to
 * shift.
 *
 * ⚠ Ignoring the time part is the load-bearing half, not an accident of the regex. The formatter this
 * replaced did `iso.slice(0, 10)` and then pinned `timeZone: "UTC"`, so a caller handing it a
 * `timestamptz` got the UTC calendar day — and dozens of callers do exactly that. Reading the same
 * string as an instant instead renders it in the viewer's zone, which moves every midnight-UTC stamp
 * to the previous day for everyone west of Greenwich. That regression was written on 2026-09-20 and
 * caught the same hour by `apps/web/src/lib/format.test.ts`'s "formats a calendar date without
 * timezone shifting", which is the test that exists for it. Making this local is a SEMANTIC change to
 * what a date means in this product, not a formatting one, and needs its own decision.
 *
 * A bare `Date` has no character form to read, so it falls back to local parts.
 */
function calendarParts(value: string | Date): Parts | null {
  if (value instanceof Date) return fromDate(value);
  const trimmed = value.trim();
  if (!trimmed) return null;
  const day = CALENDAR_DAY.exec(trimmed);
  if (day) return { y: Number(day[1]), m: Number(day[2]), d: Number(day[3]), h: 0, min: 0 };
  return fromDate(new Date(trimmed));
}

/**
 * Read a value as an INSTANT — a moment, which the reader wants on their own clock.
 *
 * The mirror of `calendarParts`, and the reason the two are separate functions rather than one with a
 * flag: `formatDisplayDateTime` is showing a moment and must never ignore the time part, while
 * `formatDisplayDate` is showing a day and must never be moved by one.
 */
function instantParts(value: string | Date): Parts | null {
  if (value instanceof Date) return fromDate(value);
  const trimmed = value.trim();
  if (!trimmed) return null;
  return fromDate(new Date(trimmed));
}

/**
 * `MM/DD/YYYY` — the product's date, everywhere a date is shown as a field, a cell or a sentence.
 *
 * Zero-padded on purpose: `09/20/2026` and `10/20/2026` are the same width, which is what lets a table
 * column of them read as a column. `en-US` would have given `9/20/2026` and a ragged edge.
 *
 * An unparseable string comes back trimmed rather than as a fallback, on the same reasoning as
 * `formatPhone` in `apps/web/src/lib/format.ts`: showing the raw value tells the reader something is
 * wrong with the DATA, while showing "—" tells them there is no data, which would be a lie.
 */
export function formatDisplayDate(value: string | Date | null | undefined, fallback = EM_DASH): string {
  if (value === null || value === undefined || value === "") return fallback;
  const p = calendarParts(value);
  if (!p) return typeof value === "string" ? value.trim() : fallback;
  return `${pad2(p.m)}/${pad2(p.d)}/${p.y}`;
}

/**
 * `MM/DD/YYYY h:mm AM/PM` — a date that also needs its moment: audit rows, sync stamps, message times.
 *
 * The clock is 12-hour and the hour is NOT zero-padded, because that is how the reader writes it; the
 * date half stays padded because it is the part that lines up in a column.
 */
export function formatDisplayDateTime(value: string | Date | null | undefined, fallback = EM_DASH): string {
  if (value === null || value === undefined || value === "") return fallback;
  const p = instantParts(value);
  if (!p) return typeof value === "string" ? value.trim() : fallback;
  const suffix = p.h < 12 ? "AM" : "PM";
  const hour12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${pad2(p.m)}/${pad2(p.d)}/${p.y} ${hour12}:${pad2(p.min)} ${suffix}`;
}

/**
 * `MM/DD` — the same date with the year dropped, for places where the year is already established by
 * the surrounding control and the space is genuinely scarce: chart axis ticks, dense timeline rails.
 *
 * This replaced `Sep 20`, which was consistent with itself and with nothing else on the page. It is in
 * the MM/DD/YYYY family rather than an exception to it, which is the whole point of naming it here
 * instead of letting each chart invent a short form again.
 */
export function formatDisplayDayShort(value: string | Date | null | undefined, fallback = EM_DASH): string {
  if (value === null || value === undefined || value === "") return fallback;
  const p = calendarParts(value);
  if (!p) return typeof value === "string" ? value.trim() : fallback;
  return `${pad2(p.m)}/${pad2(p.d)}`;
}
