import type { SupabaseClient } from "@supabase/supabase-js";
import {
  USER_ROLES,
  formatDisplayDate,
  formatDisplayDateTime,
  isAdmin,
  medstopKeyThreshold,
  medstopSweepTrouble,
  organizationTimezone,
  todayInZone,
  type CalendarDay,
} from "@silvicom/shared";
import { notify } from "../messaging/index.js";
import { usersInRoles } from "../org/index.js";
import { getCredential, type MedstopCredential } from "./credentials.js";

/**
 * Telling an admin that the Med-Stop connection is about to stop, or has (MEDSTOP-PLAN §7A.20;
 * category `medstop_connection`, 0477).
 *
 * ── WHY AN ALERT AND NOT ONLY THE LINES ON THE PAGES ────────────────────────────────────────────
 * Settings › Med-Stop warns 30 days before the key expires and the Drug & Alcohol page cautions after
 * two hours without a read. Nobody opens either while things work, and when the sweep stops, the DER's
 * result alert and the dispatch stop stop with it. So the people who can fix it are told: a key nears
 * expiry (D-MSUX21), a sweep failed or stopped running (D-MSUX22).
 *
 * ── WHO, AND HOW OFTEN ──────────────────────────────────────────────────────────────────────────
 * The admins — Settings › Med-Stop is `requireAdminOnly("medstop.connection")`, so they are the
 * people who can paste a new key; derived from `isAdmin`, never typed. The key: once per threshold
 * per key (the dedupe key carries the expiry and the threshold, so a new key starts over). The sweep:
 * once a day per state while it lasts, `roadside_feed_stale`'s daily reminder.
 *
 * The scheduler calls this every tick for every connected org, due or not. Never throws into it: an
 * alert that cannot be sent is logged.
 */

const ADMIN_ROLES = USER_ROLES.filter((r) => isAdmin(r));

export interface ConnectionNotice {
  title: string;
  body: string;
  severity: "warning" | "critical";
  dedupeKey: string;
}

/** The notices a connection's state calls for today. Pure. */
export function medstopConnectionNotices(
  credential: Pick<MedstopCredential, "keyExpiresOn" | "lastSyncedAt" | "lastError">,
  today: CalendarDay,
  nowMs: number,
  timeZone: string,
): ConnectionNotice[] {
  const out: ConnectionNotice[] = [];
  const expiresOn = credential.keyExpiresOn?.slice(0, 10) ?? null;
  const threshold = medstopKeyThreshold(expiresOn, today);
  const stops = "Until a new key is saved, Med-Stop results, random selections and the Med-Stop dispatch stop will not update.";
  if (threshold === "expired") {
    out.push({
      title: "Med-Stop API key has expired",
      body: `The key Silvicom 360 uses to read Med-Stop expired ${formatDisplayDate(expiresOn!)}. ${stops} Create a new key in Med-Stop's API Admin and paste it in Settings › Med-Stop.`,
      severity: "critical",
      dedupeKey: `medstop-key:${expiresOn}:expired`,
    });
  } else if (threshold !== null) {
    const when = threshold === 0 ? "today" : `on ${formatDisplayDate(expiresOn!)}`;
    out.push({
      title: threshold === 0 ? "Med-Stop API key expires today" : "Med-Stop API key expires soon",
      body: `The key Silvicom 360 uses to read Med-Stop expires ${when}. Create a new key in Med-Stop's API Admin and paste it in Settings › Med-Stop before then. ${stops}`,
      severity: threshold <= 3 ? "critical" : "warning",
      dedupeKey: `medstop-key:${expiresOn}:${threshold}`,
    });
  }

  const trouble = medstopSweepTrouble(credential.lastSyncedAt, credential.lastError, nowMs);
  if (trouble) {
    const since = formatDisplayDateTime(credential.lastSyncedAt, "—", timeZone);
    out.push({
      title: trouble === "failed" ? "Med-Stop could not be read" : "Med-Stop has not been read",
      body:
        trouble === "failed"
          ? `The last read from Med-Stop, at ${since}, failed: ${credential.lastError}. New results do not reach the safety manager and do not stop dispatch until it works again. Settings › Med-Stop shows the error.`
          : `Nothing has been read from Med-Stop since ${since}; it is read every hour. New results do not reach the safety manager and do not stop dispatch until it works again.`,
      severity: "critical",
      dedupeKey: `medstop-sweep:${trouble}:${new Date(nowMs).toISOString().slice(0, 10)}`,
    });
  }
  return out;
}

export async function alertMedstopConnection(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<number> {
  try {
    const credential = await getCredential(admin, orgId);
    if (!credential) return 0;
    const { data } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
    const timeZone = organizationTimezone((data as { operating_hours?: object | null } | null)?.operating_hours);
    const notices = medstopConnectionNotices(credential, todayInZone(now, timeZone), now.getTime(), timeZone);
    if (notices.length === 0) return 0;
    let sent = 0;
    for (const userId of await usersInRoles(admin, orgId, ADMIN_ROLES)) {
      for (const n of notices) {
        const id = await notify(admin, { orgId, userId, category: "medstop_connection", ...n });
        if (id) sent++;
      }
    }
    return sent;
  } catch (e) {
    console.error(`[medstop] org ${orgId}: connection alert failed —`, e instanceof Error ? e.message : e);
    return 0;
  }
}
