import {
  AD_HOOK_FAMILY_LABELS, AD_SCENE_FAMILY_LABELS, RESEARCH_TOPIC_LABELS,
  type AdsSwipeEntryView, type PageItem, type PageItemDrop, type PictureReading, type SwipeState,
} from "@silvicom/shared";

/**
 * The swipe file's words (V2r, D-AD36), kept apart from the card so they can be tested without it. Nothing here
 * decides what a reading holds: the Researcher read it and `checkPageReading` kept what the page says. This file
 * only says it, including what the check did NOT keep, so a person sees why a page gave fewer facts than it holds.
 */
export const SWIPE_STATE_LABEL: Record<SwipeState, string> = { waiting: "Being read", read: "Read", unreadable: "Could not be read" };
export const SWIPE_STATE_TONE: Record<SwipeState, string> = { waiting: "info", read: "success", unreadable: "danger" };

/** "carrier.com/jobs" — a page's address without the scheme and the leading www, the way a person says it. */
export function swipeTitle(e: Pick<AdsSwipeEntryView, "kind" | "url" | "note">): string {
  if (e.kind === "picture") return e.note ?? "A competitor's ad";
  if (!e.url) return "A job page";
  return e.url.replace(/^https:\/\/(?:www\.)?/i, "").replace(/\/$/, "");
}

/** One fact for `FactList`: `key` names its slot, where the card adds a page fact's quote under it. */
export interface SwipeReadingLine { key: string; label: string; value: string; quote?: string }

/** What was read, as lines: a page's kept facts with their quotes; a picture's lead, scene, summary and words. */
export function swipeReadingLines(e: Pick<AdsSwipeEntryView, "kind" | "reading">): SwipeReadingLine[] {
  if (e.reading === null) return [];
  if (e.kind === "page") {
    return (e.reading as PageItem[]).map((i, n) => ({ key: `fact${n}`, label: capital(RESEARCH_TOPIC_LABELS[i.topic]), value: i.sentence, quote: i.quote }));
  }
  const r = e.reading as PictureReading;
  return [
    { key: "hook", label: "Leads with", value: AD_HOOK_FAMILY_LABELS[r.hook_family] },
    { key: "scene", label: "Shows", value: AD_SCENE_FAMILY_LABELS[r.scene_family] },
    { key: "summary", label: "Offers", value: r.summary },
    { key: "words", label: "Its words, as read", value: r.words.length > 0 ? r.words.join(" / ") : "None" },
  ];
}

const DROP_REASON: Record<PageItemDrop["reason"], string> = {
  quote_not_on_page: "its quote is not on the page",
  figure_not_in_quote: "it gave a figure its quote does not",
};

/** "2 facts not kept: 1 because its quote is not on the page, 1 because it gave a figure (0.70) its quote does not." */
export function swipeDroppedWords(dropped: readonly PageItemDrop[]): string | null {
  if (dropped.length === 0) return null;
  const parts = (Object.keys(DROP_REASON) as PageItemDrop["reason"][]).flatMap((reason) => {
    const of = dropped.filter((d) => d.reason === reason);
    if (of.length === 0) return [];
    const figures = of.map((d) => d.figure).filter((f): f is string => Boolean(f));
    const why = figures.length > 0 ? DROP_REASON[reason].replace("a figure", `a figure (${figures.join(", ")})`) : DROP_REASON[reason];
    return [`${of.length} because ${why}`];
  });
  return `${dropped.length} ${dropped.length === 1 ? "fact" : "facts"} not kept: ${parts.join(", ")}.`;
}

/** What a read entry with nothing in it says, so an empty reading is not mistaken for one still to come. */
export function swipeEmptyWords(e: Pick<AdsSwipeEntryView, "state" | "kind" | "reading" | "last_error">): string | null {
  if (e.state === "waiting") return "Being read. This list updates by itself.";
  if (e.state === "unreadable") return e.last_error ?? "Nothing could be read from it.";
  if (e.kind === "page" && Array.isArray(e.reading) && e.reading.length === 0) return "Read, but nothing on it could be kept as a fact.";
  return null;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
