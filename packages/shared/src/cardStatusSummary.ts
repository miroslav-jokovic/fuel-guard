import { canonicalEfsStatus, EFS_CARD_STATUS_LABELS, efsStatusEquals, type EfsCardStatus } from "./efsCardCatalog.js";

/**
 * The daily card status summary (Q-F3, owner's ruling 2026-10-06; F02-F04 PLAN.md chunk 3b): one
 * message per fuel manager per day, for the changes made at EFS the day before. Chunk 3a stopped
 * sending most of them one by one; this is where they are read instead.
 *
 * Pure: the API reads the audit rows and the cards, and this decides the words. `null` means there
 * is nothing to say, and nothing is sent — a quiet day is not a message.
 *
 * Plain words for a busy office whose first language is not English: counts first, then one line per
 * card, sorted by truck.
 */
export interface SummaryCardChange {
  cardId: string;
  from: string;
  to: string;
  /** The truck as EFS knows the card (`efs_cards.unit_prompt`); null on about half the fleet. */
  unit: string | null;
  driver: string | null;
  last4: string | null;
}

/** How many card lines the message lists before "and N more". The bell is not a report. */
export const SUMMARY_MAX_LINES = 25;

/**
 * Name a card for a person: truck, then driver, then the last four. The last four come last because
 * they are the weakest name — AUDIT N7 measured 246 of 309 cards sharing their last four with another.
 */
export function cardLabel(c: Pick<SummaryCardChange, "unit" | "driver" | "last4">): string {
  const parts = [c.unit ? `Truck ${c.unit}` : null, c.driver?.trim() || null, `••••${c.last4 ?? "????"}`];
  return parts.filter(Boolean).join(" · ");
}

const statusWord = (s: string): string => {
  const known = canonicalEfsStatus(s);
  return known && known in EFS_CARD_STATUS_LABELS ? EFS_CARD_STATUS_LABELS[known as EfsCardStatus] : s;
};

/**
 * The words of the message sent AT ONCE for one urgent change (Q-F3 3a; titles from chunk 3c). The
 * card is named as the summary names it — truck, driver, last four — because "Fuel card ••••7977 is
 * now HOLD" came from two different cards on 10-05 (AUDIT N7).
 */
export function cardStatusChangeMessage(
  c: Pick<SummaryCardChange, "unit" | "driver" | "last4" | "from" | "to">,
): { title: string; body: string } {
  return {
    title: `${cardLabel(c)} is now ${statusWord(c.to)}`,
    body: `It was ${statusWord(c.from)}. The change was made at EFS, in the WEX portal or by EFS itself, not in Silvicom 360.`,
  };
}

const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

export function summarizeCardStatusChanges(changes: readonly SummaryCardChange[]): { title: string; body: string } | null {
  if (changes.length === 0) return null;
  const distinct = (pick: (c: SummaryCardChange) => boolean) => new Set(changes.filter(pick).map((c) => c.cardId)).size;
  const onHold = distinct((c) => efsStatusEquals(c.to, "Hold"));
  const back = distinct((c) => efsStatusEquals(c.to, "Active"));
  const other = distinct((c) => !efsStatusEquals(c.to, "Hold") && !efsStatusEquals(c.to, "Active"));

  const said = [
    onHold ? `${cards(onHold)} went on hold` : null,
    // "23 cards went on hold and 19 came back" — the noun is said once when both are there.
    back ? `${onHold ? back : cards(back)} came back` : null,
    other ? `${cards(other)} changed in another way` : null,
  ].filter(Boolean) as string[];
  const title = `Yesterday ${said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : said[0]}`;

  // One line per card, its changes in the order they happened, cards sorted by truck then label.
  const byCard = new Map<string, { label: string; unit: string | null; steps: string[] }>();
  for (const c of changes) {
    const entry = byCard.get(c.cardId) ?? { label: cardLabel(c), unit: c.unit, steps: [statusWord(c.from)] };
    entry.steps.push(statusWord(c.to));
    byCard.set(c.cardId, entry);
  }
  // A card EFS knows no truck for sorts after every truck.
  const lines = [...byCard.values()]
    .sort((a, b) => Number(a.unit === null) - Number(b.unit === null) || (a.unit ?? "").localeCompare(b.unit ?? "", "en", { numeric: true }) || a.label.localeCompare(b.label))
    .map((e) => `${e.label}: ${e.steps.join(" → ")}`);
  const shown = lines.slice(0, SUMMARY_MAX_LINES);
  const rest = lines.length - shown.length;
  if (rest > 0) shown.push(`and ${rest} more card${rest === 1 ? "" : "s"}`);
  return { title, body: shown.join("\n") };
}
