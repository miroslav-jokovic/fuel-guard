import type { AnomalySeverity } from "./constants.js";

export interface AnomalyEmailItem {
  unit: string;
  rule_id: string;
  severity: AnomalySeverity;
  message: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Pure renderer for a high/critical-anomaly alert email (no I/O — fully testable).
 * Kept deliberately plain so any provider (Resend/Brevo/SMTP) can send it.
 */
export function renderAnomalyAlertEmail(
  orgName: string,
  items: AnomalyEmailItem[],
  appUrl: string,
): RenderedEmail {
  const count = items.length;
  const critical = items.filter((i) => i.severity === "critical").length;
  const subject = `FleetGuard alert: ${count} ${critical ? "critical/" : ""}high-severity fuel anomal${count === 1 ? "y" : "ies"}`;

  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(i.unit)}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-transform:capitalize">${esc(i.severity)}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(i.message)}</td></tr>`,
    )
    .join("");

  const html =
    `<div style="font-family:system-ui,sans-serif;color:#111">` +
    `<h2 style="margin:0 0 8px">${esc(orgName)} — fuel anomaly alert</h2>` +
    `<p style="color:#555">${count} transaction(s) were flagged at high or critical severity.</p>` +
    `<table style="border-collapse:collapse;font-size:14px"><thead><tr>` +
    `<th align="left" style="padding:6px 10px">Vehicle</th><th align="left" style="padding:6px 10px">Severity</th><th align="left" style="padding:6px 10px">Detail</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>` +
    `<p style="margin-top:16px"><a href="${esc(appUrl)}/anomalies" style="color:#4f46e5">Review in FleetGuard →</a></p>` +
    `</div>`;

  const text =
    `${orgName} — fuel anomaly alert\n${count} transaction(s) flagged high/critical.\n\n` +
    items.map((i) => `- ${i.unit} [${i.severity}] ${i.message}`).join("\n") +
    `\n\nReview: ${appUrl}/anomalies`;

  return { subject, html, text };
}
