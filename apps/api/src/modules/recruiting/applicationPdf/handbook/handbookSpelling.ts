/**
 * Every typing error corrected in the carrier's driver handbook (D-HB6, owner 2026-09-25: *"yes
 * handbook was retyped too, fix it"*) — the whole difference between `DRIVER HANDBOOK.docx` and what
 * prints.
 *
 * D-HB4 printed the handbook's typos as written, under D-PKT11's reading that the carrier's text was
 * counsel's. The owner has since said both documents were retyped by the office (D-PKT20 for the
 * application), so a typing error is the typist's and is corrected. `handbookText.json` stays the
 * faithful extraction — `handbookText.test.ts` still checks it word for word against the Word file —
 * and this register is applied on top of it in `handbookText.ts`.
 *
 * ⚠ **Spelling only, and the same guard as the packet's register** (`packetSpelling.ts`): a
 * `spelling` entry keeps its word count, a `join` only removes a space, a `character` fix says why.
 * A garbled phrase or a missing word is NOT corrected — that is drafting — and is listed in
 * `HANDBOOK-SIGNING-PLAN.md`.
 *
 * ⚠ Each entry is matched inside ONE text run of the extraction (Word splits runs at formatting
 * changes) and must land exactly `times` times, or `handbookText.ts` throws at import — so an entry
 * that stops matching can never quietly print the typo again.
 */
export interface HandbookSpelling {
  wrong: string;
  right: string;
  kind: "spelling" | "join" | "character";
  /** How often it occurs across the whole handbook (default 1). */
  times?: number;
  why?: string;
}

const s = (wrong: string, right: string, times?: number): HandbookSpelling => ({ wrong, right, kind: "spelling", times });
const join = (wrong: string, right: string, times?: number): HandbookSpelling => ({ wrong, right, kind: "join", times });

export const HANDBOOK_SPELLING: readonly HandbookSpelling[] = [
  // ── Passenger policy
  s("INSURANCE COMPNAY", "INSURANCE COMPANY"),
  s("OPERATORS THA DO NOT", "OPERATORS THAT DO NOT"),
  s("SUBJECT DO DISCIPLINARY", "SUBJECT TO DISCIPLINARY"),
  s("TEMINATION", "TERMINATION"),
  // ── Supplemental: driver policy and rules
  s("are in additional to rules", "are in addition to rules"),
  join("With in 14 days", "Within 14 days"),
  s("seek payment form broker", "seek payment from broker"),
  s("at he rate of", "at the rate of"),
  { wrong: "for it’s own vehicles", right: "for its own vehicles", kind: "character", why: "The possessive `its`, written with an apostrophe as if it were `it is`." },
  { wrong: "Silvicom 's equipment", right: "Silvicom's equipment", kind: "join", why: "A stray space before the possessive." },
  { wrong: "Silvicom’ s", right: "Silvicom’s", kind: "join", times: 5, why: "A stray space inside the possessive, five times in rules 12 and 17." },
  s("governed by the laws to  the State", "governed by the laws of  the State"),
  // ── Hours of service policy
  s("The Rules are as follow:", "The Rules are as follows:"),
  s("since you last 10 hour break", "since your last 10 hour break"),
  s("FLASIFICATION", "FALSIFICATION"),
  // ── Amendment clause
  s("of the forgoing provisions", "of the foregoing provisions"),
];
