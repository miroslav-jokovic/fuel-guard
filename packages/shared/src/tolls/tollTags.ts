/**
 * A toll tag's identity (TOLLS-PER-TRUCK-PLAN.md TL1, D-TL2). Pure.
 *
 * ── THE VOCABULARY LIVES HERE ONCE ───────────────────────────────────────────────────────────
 * `TOLL_PROVIDERS` mirrors 0622's CHECK constraint exactly. It is rendered as a label in web, decides
 * which statement reader runs in the API, and is enforced by the database — three copies of a list
 * is how the fourth value arrives in only two of them. PrePass is absent on purpose: owner 2026-11-16,
 * it is weigh-station bypass, not tolls, and McLeod already carries it.
 *
 * ── WHY TWO FORMS OF ONE NUMBER ──────────────────────────────────────────────────────────────
 * `normaliseTagNumber` is what we STORE: what is printed on the tag, upper-cased, with the spaces,
 * dashes and dots people type removed. `tollTagKey` is what we MATCH on, and it also drops leading
 * zeros, because a statement opened in Excel turns the number column into numbers: E-ZPass tag
 * `00812345678` arrives as `812345678`. Two different tags of one provider that differ only by
 * leading zeros do not exist in any numbering scheme the three providers use, so dropping them merges
 * nothing real and recovers every Excel-mangled row. The key keeps the provider, so the same digits
 * under K-TAG and E-ZPass stay two tags.
 */

export const TOLL_PROVIDERS = ["ezpass", "ktag", "expresstoll"] as const;
export type TollProvider = (typeof TOLL_PROVIDERS)[number];

/** How each provider is written for a reader: brand spelling, not our enum. */
export const TOLL_PROVIDER_LABEL: Record<TollProvider, string> = {
  ezpass: "E-ZPass",
  ktag: "K-TAG",
  expresstoll: "ExpressToll",
};

export function isTollProvider(value: unknown): value is TollProvider {
  return typeof value === "string" && (TOLL_PROVIDERS as readonly string[]).includes(value);
}

/** 0622's `tag_number` CHECK, restated for the API's 400 so the database never has to refuse it. */
export const TAG_NUMBER_PATTERN = /^[0-9A-Z]{4,24}$/;

/**
 * The stored form, or null when what was typed cannot be a tag number. Removes whitespace and the
 * separators people copy from a statement (`008-1234 5678`, `KT.0000.777`); anything else that is not
 * a letter or digit makes the input invalid rather than silently dropped, because a stray `/` or `*`
 * means a masked or mistyped number, not decoration.
 */
export function normaliseTagNumber(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[\s\-.]/g, "");
  return TAG_NUMBER_PATTERN.test(s) ? s : null;
}

/**
 * The matching key: provider plus the normalised number with leading zeros dropped. Null when the
 * number is not a tag number. An all-zero number keeps a single `0` rather than becoming empty.
 */
export function tollTagKey(provider: TollProvider, raw: string | number | null | undefined): string | null {
  const n = normaliseTagNumber(raw);
  if (n == null) return null;
  const stripped = n.replace(/^0+/, "");
  return `${provider}:${stripped === "" ? "0" : stripped}`;
}
