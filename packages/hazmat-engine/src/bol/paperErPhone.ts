/**
 * paper_er_phone — 49 CFR 172.604, against eCFR's text of 2026-10-09 (Title 49 current to 2026-10-07).
 *
 * (a): "A person who offers a hazardous material for transportation must provide a numeric emergency
 * response telephone number, including the area code, for use in an emergency involving the hazardous
 * material. For telephone numbers outside the United States, the international access code or the "+"
 * (plus) sign, country code, and city code, as appropriate, that are needed to complete the call must be
 * included." The rule checks exactly that shape — never a bare digit count (the first cut passed any ten
 * digits, letters and all; "CALL SHIPPER 800 555 1212" read as well formed because the letter check ran
 * after it).
 *
 * What a transcribed number cannot show — (a)(1) "Monitored at all times the hazardous material is in
 * transportation", (a)(2)'s knowledgeable person and its ban on call-back services, (b)'s registrant name
 * beside a provider's number — is not claimed either way.
 *
 * (d): "The requirements of this section do not apply to—" (1) limited or excepted quantities, (2) the
 * named shipping names below, (3) a fumigated unit with no other hazmat. The number is owed only when at
 * least one line is outside (d); a paper whose every line is inside passes `excepted_172_604_d`, and a
 * paper where some line MIGHT be inside (unresolved, unconfirmed) never fails — it cannot tell.
 */
import type { PaperFieldStates, PaperRuleResult, PrintedPaper } from "./paperTypes.js";
import { blank, declaresLimitedQuantity, lineLabel, make, unconfirmed, type LineCtx } from "./paperSupport.js";

/** §172.604(d)(2), "Materials properly described under the following shipping names:" — (i) to (xxvi), verbatim. */
export const ER_PHONE_EXCEPTED_SHIPPING_NAMES = [
  "Battery powered equipment",
  "Battery powered vehicle",
  "Carbon dioxide, solid",
  "Castor bean",
  "Castor flake",
  "Castor meal",
  "Castor pomace",
  "Consumer commodity",
  "Dry ice",
  "Engine, fuel cell, flammable gas powered",
  "Engine, fuel cell, flammable liquid powered",
  "Engine, internal combustion",
  "Engine, internal combustion, flammable gas powered",
  "Engine, internal combustion, flammable liquid powered",
  "Fish meal, stabilized",
  "Fish scrap, stabilized",
  "Krill Meal, PG III",
  "Machinery, internal combustion",
  "Machinery, fuel cell, flammable gas powered",
  "Machinery, fuel cell, flammable liquid powered",
  "Machinery, internal combustion, flammable gas powered",
  "Machinery, internal combustion, flammable liquid powered",
  "Refrigerating machine",
  "Vehicle, flammable gas powered",
  "Vehicle, flammable liquid powered",
  "Wheelchair, electric",
] as const;

/**
 * The list is compared with the TABLE name the resolver matched the printed name to (`matchedName`), so
 * the resolver's §172.101(c)(1) variations already apply. The fold here only bridges the list's own
 * spelling to the table's: case, a hyphen the table prints and the list does not ("Battery-powered"),
 * and the final plural the table uses ("Castor beans", "Refrigerating machines").
 */
const fold = (s: string): string =>
  s.toLowerCase().replace(/-/g, " ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, "");
const EXCEPTED = ER_PHONE_EXCEPTED_SHIPPING_NAMES.map((name) => {
  const m = /^(.*), PG (I{1,3})$/.exec(name);
  return m ? { name: fold(m[1]!), pg: m[2] as "I" | "II" | "III" } : { name: fold(name), pg: null };
});

type Exception = "d1_limited_quantity" | "d1_excepted_quantity" | "d2_named_material" | "d3_fumigated_unit";
type LineStatus = Exception | "not_excepted" | "unknown";

function lineStatus(ctx: LineCtx): LineStatus {
  if (ctx.paper.fumigatedUnitNoOtherHazmat === true) return "d3_fumigated_unit";
  if (ctx.resolved.claimedExceptedQuantity === true) return "d1_excepted_quantity";
  if (ctx.resolved.claimedLimitedQuantity === true) return "d1_limited_quantity";
  if (unconfirmed(ctx.states, (["marks", "psn", "packaging", "pg"] as const).map(ctx.path)).length) return "unknown";
  if (declaresLimitedQuantity(ctx.printed)) return "d1_limited_quantity";
  const res = ctx.resolved.resolution;
  if (!res || !res.ok) return "unknown";
  if (blank(ctx.printed.psn)) return "not_excepted";
  const name = fold(res.matchedName);
  const hit = EXCEPTED.some((e) => e.name === name && (e.pg == null || e.pg === res.pg));
  return hit ? "d2_named_material" : "not_excepted";
}

// ── the number's shape ────────────────────────────────────────────────────────────────────────────
type Shape =
  | { ok: true; reason: "well_formed" | "international"; digits: string; extension: string | null }
  | { ok: false; outcome: "fail" | "cannot_tell"; reason: string; digits: string; extension: string | null };

const NANP = /^[2-9]\d{2}[2-9]\d{6}$/; // NPA and exchange both start 2–9 (the NANP numbering plan).

export function phoneShape(printed: string): Shape {
  const extMatch = /\s*(?:ext\.?|extension|x|#)\s*(\d{1,6})\s*$/i.exec(printed);
  const extension = extMatch ? extMatch[1]! : null;
  const rest = extMatch ? printed.slice(0, extMatch.index) : printed;
  const runs = rest.match(/\+?\(?\d[\d\s().\-/]*\d|\+?\d/g) ?? [];
  const number = runs.reduce((a, b) => (b.replace(/\D/g, "").length > a.replace(/\D/g, "").length ? b : a), "");
  let digits = number.replace(/\D/g, "");
  const no = (outcome: "fail" | "cannot_tell", reason: string): Shape => ({ ok: false, outcome, reason, digits, extension });
  if (!digits) return no("fail", "not_a_number");
  // "numeric": letters joined to the digits are a vanity number ("1-800-CHEMTREC"), not a number.
  if (/\d[-.]?[a-z]{3,}/i.test(rest)) return no("fail", "not_numeric");
  const international = number.trim().startsWith("+") || digits.startsWith("011");
  if (international) {
    const national = digits.startsWith("011") ? digits.slice(3) : digits;
    if (national.length >= 8 && national.length <= 15) {
      digits = national;
      return /[a-z]/i.test(rest) ? no("cannot_tell", "words_beside_number") : { ok: true, reason: "international", digits, extension };
    }
    return no("cannot_tell", "number_shape_unrecognised");
  }
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length <= 7) return no("fail", "too_short");
  if (digits.length !== 10 || !NANP.test(digits)) return no("cannot_tell", "number_shape_unrecognised");
  // Words beside a well-formed number may be the registrant's name (§172.604(b)) or a condition on the call
  // (a call-back, which (a)(2) forbids); code cannot tell which, so neither pass nor fail.
  if (/[a-z]/i.test(rest)) return no("cannot_tell", "words_beside_number");
  return { ok: true, reason: "well_formed", digits, extension };
}

export function paperErPhone(printed: PrintedPaper, lines: readonly LineCtx[], states: PaperFieldStates): PaperRuleResult {
  const r = make("paper_er_phone", null);
  const open = unconfirmed(states, ["hazmat.emergencyPhone"]);
  if (open.length) return r("cannot_tell", "field_unconfirmed", { unconfirmed: open });

  const statuses = lines.map(lineStatus);
  if (statuses.length > 0 && statuses.every((s) => s !== "not_excepted" && s !== "unknown")) {
    return r("pass", "excepted_172_604_d", { exceptions: [...new Set(statuses)].sort() });
  }
  // The number is owed only when some line is certainly outside §172.604(d).
  const owed = statuses.includes("not_excepted");
  const unknownLines = lines.filter((_, i) => statuses[i] === "unknown").map(lineLabel);
  const mayBeExcepted = () => r("cannot_tell", "exception_may_apply", { unknownLines });

  const text = printed.hazmat.emergencyPhone;
  if (blank(text)) return owed ? r("fail", "missing") : mayBeExcepted();
  const shown = text!.trim();
  const shape = phoneShape(shown);
  const facts = { printed: shown, digits: shape.digits, extension: shape.extension };
  if (shape.ok) return r("pass", shape.reason, facts);
  if (!owed) return mayBeExcepted();
  return r(shape.outcome, shape.reason, facts);
}
