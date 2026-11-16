import { FEED_FORMATS, type AdFormat } from "./renderGeometry.js";

/**
 * The words and the image Meta is handed for one ad in one language (ADS-AGENT-BUILD-WORKFLOW B2c), in one place
 * so the publisher that sends them and the review screen that previews them cannot disagree (ADS-PLATFORM-V2-PLAN
 * V3 "preview as shown"). The image already carries the overlay's headline; the two texts here are the OTHER two
 * copy slots, the ones the preset names in `platform_slots`: Meta draws the primary text above the image and the
 * headline under it, beside the button.
 *
 * ── META'S OWN RECOMMENDATIONS (read 2026-11-16) ─────────────────────────────────────────────────────
 * Facebook Feed, image ad — https://www.facebook.com/business/ads-guide/update/image/facebook-feed:
 *   "Ratio: 4:5" · "Primary Text: 50-150 characters" · "Headline: 27 characters".
 * Instagram Stories, image ad — https://www.facebook.com/business/ads-guide/update/image/instagram-story:
 *   "Primary Text: 125 characters" · keep "roughly 14% of the top, 35% of the bottom, and 6% on each side" clear
 *   (`renderGeometry.ts` keeps 15 / 36 / 8 for 9:16, a little more).
 * They are recommendations, not limits: Meta accepts longer text and cuts what it shows. Neither page says where it
 * cuts, so nothing here pretends to know — the screen shows the whole text and says when it runs past the figure.
 */
export const META_FEED_TEXT = { headline_chars: 27, primary_min_chars: 50, primary_max_chars: 150 } as const;

export interface PlatformText { primary_text: string; headline: string }
export type PlatformSlots = { primary_text: string; headline: string };

/** The two texts beside the image, or null when the preset names no slots for them or the copy lacks one. */
export function platformText(copy: Record<string, string> | null | undefined, slots: PlatformSlots | null | undefined): PlatformText | null {
  if (!copy || !slots) return null;
  const primary_text = copy[slots.primary_text], headline = copy[slots.headline];
  return primary_text && headline ? { primary_text, headline } : null;
}

/** The image a feed ad shows in one language: the first published format the creative has — 4:5, else 1:1. */
export function feedImageOf<A extends { format: AdFormat | (string & {}); language: string }>(assets: readonly A[], language: string): A | null {
  for (const format of FEED_FORMATS) {
    const hit = assets.find((a) => a.format === format && a.language === language);
    if (hit) return hit;
  }
  return null;
}

/**
 * What a reviewer should know about these texts against Meta's recommendations for the feed, in sentences; empty
 * when both are inside them. Counted as Meta counts: characters, of the text as sent.
 */
export function feedTextNotes(t: PlatformText): string[] {
  const out: string[] = [];
  const p = [...t.primary_text].length, h = [...t.headline].length;
  if (p > META_FEED_TEXT.primary_max_chars) out.push(`The text above the picture is ${p} characters. Meta recommends ${META_FEED_TEXT.primary_min_chars} to ${META_FEED_TEXT.primary_max_chars}, and shows only the start of a longer one until a person taps "See more".`);
  else if (p < META_FEED_TEXT.primary_min_chars) out.push(`The text above the picture is ${p} characters. Meta recommends ${META_FEED_TEXT.primary_min_chars} to ${META_FEED_TEXT.primary_max_chars}.`);
  if (h > META_FEED_TEXT.headline_chars) out.push(`The headline under the picture is ${h} characters. Meta recommends ${META_FEED_TEXT.headline_chars}; a longer one may be cut.`);
  return out;
}
