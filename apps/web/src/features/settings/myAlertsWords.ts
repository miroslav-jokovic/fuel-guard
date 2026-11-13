import { ALERT_CHANNEL_LABELS, type AlertChannel, type MyAlerts } from "@silvicom/shared";

/**
 * "My alerts" in sentences (HOME-TIME-PLAN D-HT17's read-only half): for each alert, how the signed-in
 * person hears of it, always and when the event is theirs. The channels and relations are the API's —
 * the sender's own resolver — so this only words them.
 */
const WHEN_MINE: Record<string, string> = {
  marked_by: "when you marked the home time",
  truck_dispatcher: "when the truck is in your fleet",
};

const HOW: Record<AlertChannel, string> = { bell: "on the dashboard", email: "by email", sms: "by text" };

/** "on the dashboard and by email" */
export function channelWords(channels: readonly AlertChannel[]): string {
  const words = channels.map((c) => HOW[c] ?? ALERT_CHANNEL_LABELS[c]);
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** One line per way the alert reaches this person; empty when it never does. */
export function myAlertLines(alert: MyAlerts["alerts"][number]): string[] {
  return [
    ...(alert.always.length > 0 ? [`Always, ${channelWords(alert.always)}.`] : []),
    ...alert.whenMine.map((w) => {
      const when = WHEN_MINE[w.relation] ?? w.label;
      return `${alert.always.length > 0 ? "Also " : "Only "}${when}, ${channelWords(w.channels)}.`;
    }),
  ];
}
