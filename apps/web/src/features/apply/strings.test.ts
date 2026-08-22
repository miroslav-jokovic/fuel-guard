import { describe, it, expect } from "vitest";
import { APPLY_COPY } from "./strings";

/**
 * The apply wizard says nothing to a driver in CFR (2026-08-22, owner).
 *
 * ── WHY THIS IS A TEST AND NOT A CONVENTION ───────────────────────────────────────────────────
 * Ten strings in `strings.ts` named the paragraph they discharged, and the wizard printed the
 * section's citation under every heading besides, so a driver on a phone read "§391.21(b)(3)" above
 * the boxes asking where they had lived. The owner's judgement is that this is "useless and
 * confusing for a regular user", and the audience argument settles it: a citation is an instrument
 * for arguing with an auditor, and the reader of this file is not one.
 *
 * A copy rule with no gate lasts until the next person writes the next hint. This file is the gate.
 * It walks every string the applicant can be shown — including the ones behind functions, which is
 * where two of the ten were hiding — and fails on a section mark or a "CFR".
 *
 * ⚠ **It deliberately does NOT reach the disclosure and consent instruments.** `DISCLOSURES` and
 * `ESIGN_CONSENT` bodies still say "§40.25(g)" and "49 CFR Part 40" because those sentences ARE the
 * legal instrument the driver signs; editing them is counsel's act, not a copy pass. What left those
 * screens is the separate `citation` metadata line above the title, which was ours to write.
 */
const FORBIDDEN = /§|\bCFR\b|\b49\s*C\.?F\.?R\b/;

/** Every leaf string in APPLY_COPY, with functions invoked so their output is covered too. */
function leaves(node: unknown, path: string): Array<{ path: string; text: string }> {
  if (typeof node === "string") return [{ path, text: node }];
  if (typeof node === "function") {
    // The copy functions take (carrier), (n, total), (n, noun) or (carrier, count). Feeding a string
    // and a number covers all four shapes; the assertion is about the literal parts either way.
    const fn = node as (...args: unknown[]) => unknown;
    const out = fn.length >= 2 ? fn("Silvicom", 2) : fn("Silvicom");
    return typeof out === "string" ? [{ path: `${path}()`, text: out }] : [];
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  }
  return [];
}

describe("apply copy", () => {
  const all = leaves(APPLY_COPY, "APPLY_COPY");

  it("covers the whole object, functions included", () => {
    // A walker that silently returned nothing would make every assertion below vacuously true.
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((l) => l.path.endsWith("()"))).toBe(true);
  });

  it("names no regulation anywhere a driver can read it", () => {
    const offenders = all.filter((l) => FORBIDDEN.test(l.text));
    expect(offenders.map((o) => `${o.path}: ${o.text}`)).toEqual([]);
  });

  /**
   * The rule is "no citation", not "no reason". The voice rule in `strings.ts` still stands: where the
   * form asks something a driver would reasonably resent being asked, it says why in the same breath.
   * These three were the sensitive ones, and each kept its sentence when it lost its number.
   */
  it("keeps the reason where the reason was the point", () => {
    expect(APPLY_COPY.identity.ssnHint).toMatch(/driving-record checks match on it/);
    expect(APPLY_COPY.employment.addressHint).toMatch(/record where we wrote to/);
    expect(APPLY_COPY.identity.otherNamesHint).toMatch(/cannot find you under a name/);
  });
});
