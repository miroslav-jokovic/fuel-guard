// The warning desk's bell (WARNING-DESK-PLAN WD6, D-WD14). Only an URGENT follow-up rings it — a crash, a
// red STOP lamp, a panic button; everything else waits on the list, because a desk is a list, not an alarm.
//
// WHO hears it is everyone who can open Maintenance › Follow-ups today: `surfaceHolders`, the same resolver
// the Permissions page's "Who has access" tab reads, so the people the bell reaches and the people the page
// opens for are one list rather than a role list written beside the matrix. Each follow-up rings once per
// person (`follow_up:<id>` dedupe), so a retried tick or a queued and in-process run racing cannot ring twice.
// The web bell opens `/shop/follow-ups?open=<id>` (notificationRoute.ts).
//
// It lives here, not in followups, because it composes three owners — followups' row, org's access tables,
// messaging's one sender — through their indexes; no table is named in this file.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FollowUpRule } from "@silvicom/shared";
import { readFollowUpsByIds } from "../modules/followups/index.js";
import { surfaceHolders } from "../modules/org/index.js";
import { notify } from "../modules/messaging/index.js";

export const DESK_SURFACE = "maintenance.follow-ups";

export interface BellDeps {
  holders: (admin: SupabaseClient, orgId: string, surfaceKey: string) => Promise<string[]>;
  send: typeof notify;
  read: typeof readFollowUpsByIds;
}

const DEFAULT_DEPS: BellDeps = { holders: surfaceHolders, send: notify, read: readFollowUpsByIds };

/** Rings the bell for each follow-up opened urgent this pass. Returns how many notifications were written. */
export async function ringUrgentFollowUps(
  admin: SupabaseClient,
  orgId: string,
  followUpIds: readonly string[],
  rules: readonly FollowUpRule[],
  deps: BellDeps = DEFAULT_DEPS,
): Promise<number> {
  if (followUpIds.length === 0) return 0;
  const [rows, people] = await Promise.all([deps.read(admin, orgId, followUpIds), deps.holders(admin, orgId, DESK_SURFACE)]);
  if (people.length === 0) return 0;
  const labels = new Map(rules.map((r) => [r.key, r.label]));
  let sent = 0;
  for (const f of rows) {
    const label = labels.get(f.rule_key) ?? "Samsara warning";
    const what = f.subject_name ? `${f.subject_kind === "driver" ? "" : f.subject_kind === "trailer" ? "Trailer " : "Truck "}${f.subject_name}` : null;
    for (const userId of people) {
      const id = await deps.send(admin, {
        orgId,
        userId,
        category: "follow_up_urgent",
        title: `Urgent: ${label}`,
        body: what ? `${what}. Call the driver from Maintenance › Follow-ups.` : "Call the driver from Maintenance › Follow-ups.",
        severity: "critical",
        entityType: "follow_up",
        entityId: f.id,
        dedupeKey: `follow_up:${f.id}`,
      });
      if (id) sent += 1;
    }
  }
  return sent;
}
