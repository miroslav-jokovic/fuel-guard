import { describe, expect, it, vi } from "vitest";
import { notifyForTransaction } from "./notifications.js";
import { createSupabaseRecorder, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

/**
 * The fill email asks for high/critical cases only. CF5 (2026-10-08) relies on that: after it the only
 * fill case is a Review, which is medium, so no fill email is sent — with no change to this code.
 * The fixture applies the `.in()` filters the service sends, because the recorder itself does not
 * filter: a fixture that returned the row regardless would pass whatever the gate said.
 */
const org = { name: "Fleet Co", notification_emails: ["office@example.com"], notifications_enabled: true };
const caseRow = (severity: string) => ({ rule_id: "theft_case", severity, status: "open", message: "m", vehicles: { unit_number: "887" } });

const applyIn = (q: RecordedQuery, rows: Record<string, unknown>[]) =>
  rows.filter((r) =>
    q.ops.every((o) => o.method !== "in" || (o.args[1] as unknown[]).includes(r[o.args[0] as string])),
  );

const send = async (severity: string) => {
  const rec = createSupabaseRecorder({
    tables: {
      organizations: [org],
      anomalies: (q) => applyIn(q, [caseRow(severity)]),
    },
  });
  const sender = vi.fn(async () => true);
  const sent = await notifyForTransaction(rec.client, testEnv(), "org1", "t1", sender);
  return { sent, sender };
};

describe("notifyForTransaction — the fill email's severity gate", () => {
  it("emails an alert (critical)", async () => {
    const { sent, sender } = await send("critical");
    expect(sent).toBe(true);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a Review (medium) — after CF5 the only fill case", async () => {
    const { sent, sender } = await send("medium");
    expect(sent).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });
});
