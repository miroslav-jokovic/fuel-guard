/**
 * A figure against its neighbour (D-FRUI3): the change from the previous period, as a signed
 * percentage, and the tone it should wear.
 *
 * Pure and tiny on purpose. The page never recomputes a figure — both inputs come from the harness
 * — but the ratio between two of them is presentation, the same way a percentage share of revenue
 * is, and it lives here so every headline says "−47.7% vs June" the same way. The minus sign is
 * U+2212, the typographic one, because a hyphen beside a number reads as a range.
 *
 * `percentChange` returns null when there is nothing honest to say: no previous figure, or a
 * previous figure of zero, where any percentage would be a division by nothing wearing a number's
 * clothes. The caller prints the reason ("no previous month") rather than a blank.
 */
export function percentChange(previous: number | null | undefined, current: number | null | undefined): number | null {
  if (previous == null || current == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** "+11.7%", "−47.7%", "0.0%". */
export function formatPercentChange(pc: number): string {
  const sign = pc > 0 ? "+" : pc < 0 ? "−" : "";
  return `${sign}${Math.abs(pc).toFixed(1)}%`;
}

/**
 * The colour a change wears: green when it moved the way the reader wants, red when it did not,
 * neutral when it did not move or cannot be compared. Direction is the caller's to declare —
 * up is good for earned and kept, bad for spent — because the arithmetic cannot know.
 */
export function changeTone(pc: number | null, upIsGood: boolean): string {
  if (pc == null || pc === 0) return "text-ink-tertiary";
  const up = pc > 0;
  return up === upIsGood ? "text-success-700" : "text-danger-700";
}
