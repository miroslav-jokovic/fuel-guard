/**
 * Person identity colour (D-CHATUI22, CHAT-REDESIGN-PLAN, 2026-11-01).
 *
 * Every initials avatar in the office chat was the same grey circle, so in a busy channel nobody
 * could be told apart before reading the name — the owner's "outdated and boring", measured in the
 * built page. Slack, Teams and Linear all answer it the same way: a steady colour per person.
 *
 * The tone is DERIVED from a stable key (the user id), never stored and never chosen, so one person
 * is one colour in the rail, the log, the picker and the header without any of them agreeing on
 * anything. FNV-1a over the key's UTF-16 units, then a final mix: cheap and deterministic.
 *
 * ⚠ The final mix is not decoration. FNV's multiply carries low bits upward only, so `h % 8` alone
 * depends on nothing but the lowest three bits of each character — `a` and `A`, `1` and `9` hash
 * to the same tone, and a hex id has fewer distinct inputs than it looks. Found 2026-11-01 when a
 * mutation (dropping the lower-casing) survived its test; the xor-shift-multiply below folds the
 * high bits down before the tone is taken.
 *
 * The eight grounds and their initials are tokens (`--identity-N`, `--identity-N-ink`), gated for
 * 4.5:1 in both schemes by `lint:ui-contrast` and for sRGB by `lint:token-gamut`. The class strings
 * below are written out in full because Tailwind finds classes by reading source text — a class
 * assembled from `identity-${n}` would emit nothing.
 */
export const IDENTITY_TONES = 8;

export type IdentityTone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export function identityTone(key: string): IdentityTone {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (((h >>> 0) % IDENTITY_TONES) + 1) as IdentityTone;
}

export const IDENTITY_CLASSES: Record<IdentityTone, string> = {
  1: "bg-identity-1 text-identity-1-ink",
  2: "bg-identity-2 text-identity-2-ink",
  3: "bg-identity-3 text-identity-3-ink",
  4: "bg-identity-4 text-identity-4-ink",
  5: "bg-identity-5 text-identity-5-ink",
  6: "bg-identity-6 text-identity-6-ink",
  7: "bg-identity-7 text-identity-7-ink",
  8: "bg-identity-8 text-identity-8-ink",
};

/** The ground and initials for a person, or `null` when there is no key to derive one from. */
export const identityClass = (key: string | null | undefined): string | null =>
  key ? IDENTITY_CLASSES[identityTone(key.toLowerCase())] : null;
