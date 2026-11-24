/**
 * A duration in the words the phone itself uses: "45 min", "2 hr", "2 hr, 10 min".
 *
 * WHY THIS FORMAT (Visual 2026 V9 critique, D-DV25). The Lock Screen's countdown is iOS's own relative
 * date, which says "7 hr, 59 min" and cannot be restyled. Today said "7 h 59 min", so the same
 * countdown read two ways on one phone. The app follows the system, through this one function, for
 * every countdown and early/late figure it shows.
 */
export function durationWords(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} hr` : `${h} hr, ${m} min`;
}
