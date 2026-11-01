import { describe, it, expect } from "vitest";
import { questionnaireForApplicant, translateQuestionnaire } from "@silvicom/shared";
import { APPLY_COPY, APPLY_COPY_EN } from "./strings";
import { APPLY_COPY_ES } from "./es/strings.es";

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
function leaves(node: unknown, path: string, carrier = "Silvicom"): Array<{ path: string; text: string }> {
  if (typeof node === "string") return [{ path, text: node }];
  if (typeof node === "function") {
    /**
     * The copy functions take (carrier), (n, total), (n, noun), (carrier, count) — and since A4 also
     * (pages[]) and (kind, count).
     *
     * ⚠ **Arity is not enough to tell them apart and this walk used to assume it was.** A4 added
     * `confirmInitialsWhere(pages: number[])`, which has arity 1 exactly like `adoptIntro(carrier)`;
     * feeding it a string threw `pages.slice(...).join is not a function` and the whole suite failed.
     * The failure was loud, which is the good case — the BAD case is a shape that happens not to throw
     * and returns something unlike the real sentence, leaving a gate that walks past its own blind
     * spot. So the candidates are TRIED, and a function that satisfies none of them is reported rather
     * than skipped: `leaves` returning `[]` for it would be this file failing silently, which is the
     * one thing its header says it exists to prevent.
     */
    const fn = node as (...args: unknown[]) => unknown;
    const candidates: unknown[][] = [
      [carrier, 2],
      [carrier],
      [[5, 6, 9]],
      [2],
      [[5]],
    ];
    for (const args of candidates) {
      try {
        const out = fn(...args);
        if (typeof out === "string") return [{ path: `${path}()`, text: out }];
      } catch {
        // Wrong shape for this one; try the next.
      }
    }
    throw new Error(
      `${path} is a copy function this walk cannot call — add its argument shape to \`candidates\` `
      + "rather than letting it go unchecked.",
    );
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, `${path}.${k}`, carrier));
  }
  return [];
}

/**
 * ⚠ **The carrier's questions are copy a driver reads, and this file did not know about them.**
 *
 * `proof_of_age`'s hint carried "§391.11(b)(1)" from the day A9 was written until 2026-09-11, when
 * D-AX7 moved that question onto a screen one page test happened to check for citations. Everything
 * below walked `APPLY_COPY` and the questionnaire is not in it — a gate with a blind spot exactly the
 * shape of the thing that got through. The definition is walked here now, for the same reason and by
 * the same rule.
 */
describe("apply copy", () => {
  // ⚠ The definition SERVED — v3 since §9 P8 — and the Spanish overlay of it: walking an older one alone
  // would leave a newer label, hint or skip outside the gate, the blind spot this block was written to close.
  // Both languages (C4): the Spanish object is walked by the same rule, not trusted to mirror the English.
  const all = [
    ...leaves(APPLY_COPY, "APPLY_COPY"),
    ...leaves(APPLY_COPY_ES, "APPLY_COPY_ES"),
    ...leaves(questionnaireForApplicant(), "SERVED"),
    ...leaves(translateQuestionnaire(questionnaireForApplicant(), "es"), "SERVED_ES"),
  ];

  it("reaches the carrier's own questions, which are copy too", () => {
    // The guard that the walk actually descends into the definition rather than stopping at its id.
    expect(all.some((l) => l.text === "Do you have proof of age?")).toBe(true);
    expect(all.some((l) => l.path.includes("columns"))).toBe(true);
  });

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

/**
 * F29 (US6b, 2026-10-14). A carrier with no name on file is "the carrier" — the API's word for it
 * (`publicApplicationBundle.ts`) — and sixteen sentences open with the carrier's name. Before
 * `sentenceCase` they opened in lower case ("the carrier has read your application."), and before the
 * API trimmed the name an empty one printed "This is 's driver application."
 */
describe("apply copy, for a carrier with no name on file", () => {
  it("opens every sentence that starts with the carrier in a capital, and never names nobody", () => {
    // Only the sentences whose first argument IS the carrier: the walk feeds every copy function the
    // same first argument, and a count printed as "the carrier minutes" is the walk's, not the copy's.
    const carrierFns = new Set<string>();
    const collect = (node: unknown, path: string): void => {
      if (typeof node === "function" && /^\(?\s*carrier\b/.test(node.toString())) carrierFns.add(`${path}()`);
      else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) collect(v, `${path}.${k}`);
    };
    collect(APPLY_COPY, "APPLY_COPY");
    const texts = leaves(APPLY_COPY, "APPLY_COPY", "the carrier").filter((t) => carrierFns.has(t.path));
    expect(texts.length).toBeGreaterThan(15);
    const lowerStarts = texts.filter((t) => /(^|[.?!]\s+)the carrier\b/.test(t.text)).map((t) => t.path);
    expect(lowerStarts).toEqual([]);
    expect(texts.find((t) => t.path === "APPLY_COPY.expectations.lead()")?.text).toBe("This is the carrier's driver application.");
    expect(texts.some((t) => /The carrier has read your application\./.test(t.text))).toBe(true);
  });
});

/**
 * AW13's key-parity test (C4): the Spanish object has exactly the English object's keys, with a phrase
 * function where English has one (and of the same arity) and a list where English has one. `satisfies`
 * already fails `vue-tsc` on a missing key; this is the same promise kept where a reviewer can read it,
 * and the one that catches a function swapped for a string, which the widened type would allow.
 */
describe("the Spanish copy, key for key", () => {
  type Shape = Record<string, string>;
  const shape = (node: unknown, path: string, into: Shape): Shape => {
    if (typeof node === "function") into[path] = `fn/${(node as (...a: unknown[]) => unknown).length}`;
    else if (Array.isArray(node)) into[path] = `list/${node.length}`;
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) shape(v, `${path}.${k}`, into);
    else into[path] = typeof node;
    return into;
  };

  it("has every key the English has, of the same kind, and no other", () => {
    expect(shape(APPLY_COPY_ES, "copy", {})).toEqual(shape(APPLY_COPY_EN, "copy", {}));
  });

  it("is actually Spanish, not the English copied over", () => {
    const en = leaves(APPLY_COPY_EN, "en").map((l) => l.text);
    const es = leaves(APPLY_COPY_ES, "es").map((l) => l.text);
    // A URL is the same in every language; everything else of any length must differ.
    const same = es.filter((t, i) => t === en[i] && t.length > 12 && !t.startsWith("http"));
    expect(same).toEqual([]);
  });
});
