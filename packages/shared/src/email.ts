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

export interface DigestStats {
  alertCount: number;
  siphonCount: number;
  declineAlertCount: number;
  topVehicles: { unit: string; count: number }[];
  appUrl: string;
}

/** Weekly theft digest email: the AI narrative + a compact stats strip. Pure — no I/O. */
export function renderDigestEmail(orgName: string, summary: string, stats: DigestStats): RenderedEmail {
  const subject = `${orgName} — weekly fuel-theft digest`;
  const summaryHtml = summary
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;color:#333;line-height:1.5">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const chip = (label: string, n: number, tone: string) =>
    `<td style="padding:10px 14px;border:1px solid #eee;border-radius:8px;text-align:center">` +
    `<div style="font-size:22px;font-weight:700;color:${tone}">${n}</div>` +
    `<div style="font-size:12px;color:#777">${esc(label)}</div></td>`;
  const topVeh = stats.topVehicles.length
    ? `<p style="margin:14px 0 0;color:#555;font-size:14px">Repeat-flagged: ` +
      stats.topVehicles.map((v) => `${esc(v.unit)} (${v.count})`).join(", ") +
      `</p>`
    : "";
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:640px">` +
    `<h2 style="margin:0 0 4px;color:#111">${esc(orgName)} — weekly fuel-theft digest</h2>` +
    `<p style="margin:0 0 16px;color:#888;font-size:13px">Past 7 days</p>` +
    `<table style="border-collapse:separate;border-spacing:8px 0;margin:0 0 16px"><tr>` +
    chip("High/critical alerts", stats.alertCount, stats.alertCount ? "#dc2626" : "#16a34a") +
    chip("Siphoning events", stats.siphonCount, stats.siphonCount ? "#ea580c" : "#16a34a") +
    chip("Suspicious declines", stats.declineAlertCount, stats.declineAlertCount ? "#d97706" : "#16a34a") +
    `</tr></table>` +
    summaryHtml +
    topVeh +
    `<p style="margin:20px 0 0"><a href="${esc(stats.appUrl)}/anomalies" style="color:#4f46e5">Open FuelGuard →</a></p>` +
    `</div>`;
  const text =
    `${orgName} — weekly fuel-theft digest (past 7 days)\n\n` +
    `High/critical alerts: ${stats.alertCount} | Siphoning: ${stats.siphonCount} | Suspicious declines: ${stats.declineAlertCount}\n\n` +
    `${summary}\n\n${stats.appUrl}/anomalies`;
  return { subject, html, text };
}

/** Branded invite email (sent via our own mailer, e.g. Resend). Pure — no I/O. */
export function renderInviteEmail(orgName: string, acceptUrl: string): RenderedEmail {
  const subject = `You're invited to ${orgName} on FuelGuard`;
  const html =
    `<div style="font-family:system-ui,sans-serif;color:#111">` +
    `<h2 style="margin:0 0 8px">Join ${esc(orgName)} on FuelGuard</h2>` +
    `<p style="color:#555">You've been invited to help manage fuel and prevent theft for ${esc(orgName)}. ` +
    `Click below to set your password and get started.</p>` +
    `<p style="margin:20px 0"><a href="${esc(acceptUrl)}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Accept invitation →</a></p>` +
    `<p style="color:#888;font-size:12px">If the button doesn't work, paste this link into your browser:<br>${esc(acceptUrl)}</p>` +
    `<p style="color:#aaa;font-size:12px">This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.</p>` +
    `</div>`;
  const text =
    `Join ${orgName} on FuelGuard\n\nYou've been invited to manage fuel for ${orgName}.\n` +
    `Accept your invitation: ${acceptUrl}\n\nThis link expires in 7 days.`;
  return { subject, html, text };
}

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
  const subject = `FuelGuard alert: ${count} ${critical ? "critical/" : ""}high-severity fuel anomal${count === 1 ? "y" : "ies"}`;

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
    `<p style="margin-top:16px"><a href="${esc(appUrl)}/anomalies" style="color:#4f46e5">Review in FuelGuard →</a></p>` +
    `</div>`;

  const text =
    `${orgName} — fuel anomaly alert\n${count} transaction(s) flagged high/critical.\n\n` +
    items.map((i) => `- ${i.unit} [${i.severity}] ${i.message}`).join("\n") +
    `\n\nReview: ${appUrl}/anomalies`;

  return { subject, html, text };
}
