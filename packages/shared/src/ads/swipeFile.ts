import { z } from "zod";
import { AD_HOOK_FAMILIES, AD_HOOK_FAMILY_LABELS, AD_SCENE_FAMILIES, AD_SCENE_FAMILY_LABELS } from "./brandKitContract.js";
import type { EvidenceItem } from "./campaignPlan.js";
import { recordId } from "../recordId.js";

/**
 * The swipe file (ADS-PLATFORM-V2-PLAN V2r, D-AD36): what a recruiter saved of other carriers' recruiting — a
 * competitor's job page, or a picture of a competitor's ad — and what the Researcher read from it, as evidence a
 * campaign's plan may cite. Pure: no clock, no I/O.
 *
 * ── A PERSON CHOOSES EVERY SOURCE ───────────────────────────────────────────────────────────────────────
 * The Researcher never searches and never follows a link. V2's "web search held to an allow-list of sites"
 * became this: the allow-list IS the swipe file, each entry a page or a picture a person put there. A page found
 * by a model's search is a source nobody approved, and its ranking is not ours to cite.
 *
 * ── A PAGE'S ITEMS ARE HELD TO THE PAGE, BY CODE ───────────────────────────────────────────────────────
 * Each item the Researcher writes from a page carries a verbatim `quote`, and `checkPageReading` keeps it only
 * when (1) the quote is found in the text that was fetched, and (2) every figure in the item's sentence appears
 * in its quote. So a model that invents a fact, or turns "competitive pay" into "$0.70 a mile", loses the item;
 * and an instruction planted in a page can at most produce a true quote OF that page, attributed to it.
 *
 * Both texts are compared after one normalisation (`normaliseForQuote`): Unicode NFKC, the typographic quotes,
 * apostrophes and dashes written as their plain ASCII forms, and every run of whitespace as one space. That is
 * all — no case folding and no stemming — because a model writes curly quotes as straight ones and HTML breaks
 * lines where a sentence does not, and neither changes what the page says. Anything more lenient would let a
 * paraphrase pass as a quote.
 *
 * ── A PICTURE IS DESCRIBED, AND SAID TO BE ─────────────────────────────────────────────────────────────
 * Code cannot check a description against a picture. So a picture's item names what it leads with and what it
 * shows from the two closed lists the plan uses (a comparison of values, not of sentences), carries the words the
 * Researcher read off it marked "as read", and the Researcher's reading of pictures is measured on fixtures
 * before it is trusted (§4R: it enters at L0).
 */

export const SWIPE_KINDS = ["page", "picture"] as const;
export type SwipeKind = (typeof SWIPE_KINDS)[number];

/** Read, waiting to be read, or read with nothing that could be kept (`last_error` says why). */
export const SWIPE_STATES = ["waiting", "read", "unreadable"] as const;
export type SwipeState = (typeof SWIPE_STATES)[number];

/** How long a reading stays evidence. A competitor's page changes; a reading older than this is left out of a pack. */
export const SWIPE_EVIDENCE_DAYS = 180;

export const SWIPE_NOTE_MAX = 300;
const note = z.string().trim().min(1).max(SWIPE_NOTE_MAX).nullable();

export const adsSwipePageSaveSchema = z.object({ url: z.url({ protocol: /^https$/ }).max(2000), note });
export type AdsSwipePageSave = z.infer<typeof adsSwipePageSaveSchema>;

export const adsSwipePictureSaveSchema = z.object({ upload_id: recordId(), note });
export type AdsSwipePictureSave = z.infer<typeof adsSwipePictureSaveSchema>;

// ── what the Researcher answers ──────────────────────────────────────────────────────────────────────
export const RESEARCH_TOPICS = ["pay", "home_time", "equipment", "lanes", "benefits", "sign_on", "requirements", "other"] as const;
export type ResearchTopic = (typeof RESEARCH_TOPICS)[number];
export const RESEARCH_TOPIC_LABELS: Record<ResearchTopic, string> = {
  pay: "pay", home_time: "home time", equipment: "equipment", lanes: "lanes", benefits: "benefits",
  sign_on: "sign-on bonus", requirements: "requirements", other: "other",
};

export const PAGE_ITEMS_MAX = 12;
export const pageReadingSchema = z.object({
  items: z.array(z.object({
    topic: z.enum(RESEARCH_TOPICS),
    /** The fact, in one plain sentence about the page's carrier. */
    sentence: z.string().trim().min(10).max(220),
    /** Words copied from the page that hold the fact, exactly as written there. */
    quote: z.string().trim().min(5).max(300),
  })).max(PAGE_ITEMS_MAX),
});
export type PageReading = z.infer<typeof pageReadingSchema>;
export type PageItem = PageReading["items"][number];

export const pictureReadingSchema = z.object({
  /** What the ad leads with, from the plan's own list. */
  hook_family: z.enum(AD_HOOK_FAMILIES),
  /** What the picture shows, from the plan's own list. */
  scene_family: z.enum(AD_SCENE_FAMILIES),
  /** The words printed on the ad, each line as it reads; none when it carries none. */
  words: z.array(z.string().trim().min(1).max(120)).max(12),
  /** What the ad offers a driver, in one plain sentence. */
  summary: z.string().trim().min(10).max(200),
});
export type PictureReading = z.infer<typeof pictureReadingSchema>;

// ── the check of a page's items ──────────────────────────────────────────────────────────────────────
export function normaliseForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The figures in a text, as digit strings without separators: "$1,250.00 a week, 3 days" → ["1250.00", "3"]. */
export function figuresIn(text: string): string[] {
  return [...normaliseForQuote(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "").replace(/\.$/, ""));
}

export type PageItemDrop = { index: number; reason: "quote_not_on_page" | "figure_not_in_quote"; figure?: string };

export function checkPageReading(reading: PageReading, pageText: string): { kept: PageItem[]; dropped: PageItemDrop[] } {
  const page = normaliseForQuote(pageText);
  const kept: PageItem[] = [];
  const dropped: PageItemDrop[] = [];
  reading.items.forEach((item, index) => {
    if (!page.includes(normaliseForQuote(item.quote))) return void dropped.push({ index, reason: "quote_not_on_page" });
    const inQuote = new Set(figuresIn(item.quote).map(canonicalFigure));
    const stray = figuresIn(item.sentence).find((f) => !inQuote.has(canonicalFigure(f)));
    if (stray !== undefined) return void dropped.push({ index, reason: "figure_not_in_quote", figure: stray });
    kept.push(item);
  });
  return { kept, dropped };
}

/** "0.70" and "0.7" are one figure, "070" and "70" another; "7" is a third. */
const canonicalFigure = (f: string): string => String(Number(f));

// ── the evidence a reading becomes ───────────────────────────────────────────────────────────────────
/** An entry as the pack reads it: what was saved and what was read from it. */
export interface SwipeEvidenceEntry {
  id: string;
  kind: SwipeKind;
  url: string | null;
  note: string | null;
  reading: PageItem[] | PictureReading | null;
}

const slug = (id: string) => id.replace(/-/g, "").slice(0, 12).toLowerCase();

/** A page's kept items as `market` items (what the market offers), each naming the site it was read on. */
export function pageEvidence(entry: SwipeEvidenceEntry & { kind: "page"; url: string; reading: PageItem[] }): EvidenceItem[] {
  // No `URL` here: this package is also built for React Native without DOM types. The schema holds `url` to https.
  const host = (/^https:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(entry.url)?.[1] ?? entry.url).toLowerCase().replace(/^www\./, "");
  return entry.reading.map((item, i) => ({
    id: `market:page_${slug(entry.id)}_${i + 1}`, kind: "market" as const, source: entry.url,
    text: clip(`A job page on ${host}, saved by our recruiters, says (${RESEARCH_TOPIC_LABELS[item.topic]}): ${item.sentence}`),
  }));
}

/** A picture's reading as one `swipe` item: what it leads with and shows, and its words as the Researcher read them. */
export function pictureEvidence(entry: SwipeEvidenceEntry & { kind: "picture"; reading: PictureReading }): EvidenceItem {
  const r = entry.reading;
  const words = r.words.length > 0 ? ` Its words, as read: "${r.words.join(" / ")}".` : " It carries no words.";
  const saved = entry.note ? `A competitor's ad saved by our recruiters ("${entry.note}")` : "A competitor's ad saved by our recruiters";
  return {
    id: `swipe:${slug(entry.id)}`, kind: "swipe", source: null,
    text: clip(`${saved}. What it leads with: ${AD_HOOK_FAMILY_LABELS[r.hook_family]}. What its picture shows: ${AD_SCENE_FAMILY_LABELS[r.scene_family]}. ${r.summary}${words}`),
  };
}

/** The pack's item limit is 400 characters (`evidenceItemSchema`); a longer sentence is cut at a word with an ellipsis. */
function clip(text: string): string {
  if (text.length <= 400) return text;
  const cut = text.slice(0, 399);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 300))}…`;
}

// ── the doors a person uses ─────────────────────────────────────────────────────────────────────────
/** One entry as the screen reads it. */
export interface AdsSwipeEntryView {
  id: string;
  kind: SwipeKind;
  url: string | null;
  note: string | null;
  state: SwipeState;
  /** For a page: the items kept. For a picture: its reading. Null until read. */
  reading: PageItem[] | PictureReading | null;
  /** How many of the Researcher's items the check dropped, and why — so a person sees what was not kept. */
  dropped: PageItemDrop[];
  last_error: string | null;
  read_at: string | null;
  created_at: string;
  created_by_name: string | null;
}
