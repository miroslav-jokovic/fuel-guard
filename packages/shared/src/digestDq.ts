import type { DriverOverviewRow } from "./dqFile.js";

/**
 * The weekly digest's driver-qualification block (DQF execution plan C4) — pure, its own module
 * because digest.ts sits at 360 lines against the 450 warn band and email.ts renders, never
 * computes.
 *
 * The digest answers a different question than the C3 alerts: alerts fire when ONE item crosses a
 * threshold; this is the Monday-morning rollup — how many items are close, how many have lapsed,
 * how many files were never started, and the five pairs most worth a phone call. "Not started"
 * belongs HERE and not in alerts (see dqAlerts.ts's header for why).
 */
export interface DqDigestSection {
  expiringSoon: number;
  expired: number;
  notStarted: number;
  /** The five most urgent driver+item pairs, worst first — the same ranking every DQ surface uses. */
  topPairs: Array<{ driver: string; label: string; due: string }>;
}

export function buildDqDigestSection(rows: readonly DriverOverviewRow[]): DqDigestSection {
  let expiringSoon = 0;
  let expired = 0;
  let notStarted = 0;
  const dated: Array<{ driver: string; label: string; days: number; goodUntil: string | null }> = [];

  for (const d of rows) {
    if (d.state === "not_started") {
      notStarted++;
      continue;
    }
    expired += d.counts.expired;
    expiringSoon += d.counts.expiring;
    for (const a of d.attention) {
      if (a.daysRemaining == null) continue;
      dated.push({ driver: d.driver_name, label: a.label, days: a.daysRemaining, goodUntil: a.goodUntil });
    }
  }

  const due = (days: number): string =>
    days < 0
      ? `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`
      : days === 0
        ? "due today"
        : `due in ${days} ${days === 1 ? "day" : "days"}`;

  return {
    expiringSoon,
    expired,
    notStarted,
    topPairs: dated
      .sort((x, y) => x.days - y.days)
      .slice(0, 5)
      .map((p) => ({ driver: p.driver, label: p.label, due: due(p.days) })),
  };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The HTML block for renderDigestEmail. Empty string when there is nothing to say — a digest
 *  section that renders "0 · 0 · 0" every week trains readers to skip the whole email. */
export function renderDqDigestHtml(s: DqDigestSection): string {
  if (s.expired === 0 && s.expiringSoon === 0 && s.notStarted === 0) return "";
  const bits: string[] = [];
  if (s.expired > 0) bits.push(`${s.expired} expired`);
  if (s.expiringSoon > 0) bits.push(`${s.expiringSoon} due in 30 days`);
  if (s.notStarted > 0) bits.push(`${s.notStarted} file${s.notStarted === 1 ? "" : "s"} not started`);
  const pairs = s.topPairs.length
    ? `<ul style="margin:6px 0 0;padding-left:18px;color:#555;font-size:13px">` +
      s.topPairs.map((p) => `<li>${esc(p.driver)} — ${esc(p.label)}, ${esc(p.due)}</li>`).join("") +
      `</ul>`
    : "";
  return (
    `<div style="margin:16px 0 0;padding-top:12px;border-top:1px solid #eee">` +
    `<p style="margin:0;color:#111;font-size:14px;font-weight:600">Driver qualification</p>` +
    `<p style="margin:4px 0 0;color:${s.expired > 0 ? "#dc2626" : "#555"};font-size:13px">${esc(bits.join(" · "))}</p>` +
    pairs +
    `</div>`
  );
}
