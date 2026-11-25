import type { SupabaseClient } from "@supabase/supabase-js";
import { BROKER_MAIL_ROSTER_REASONS, type BrokerMailAdmin, type BrokerMailMailbox, type BrokerMailSettings } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { listOfficeMembers } from "../org/index.js";
import { getGatewayHealth } from "./gatewayHealth.js";
import { readRoster, readSettingsRow } from "./brokerMailList.js";
import { readBackups, readTextStates } from "./brokerMailBackups.js";

/**
 * Settings › Broker mail (BROKER-MAIL-READER-PLAN P2; Q-BM9: the admin alone). Three things:
 *  · the gateway's state — shown, never switched here: `enabled` and `body_reading` stay owner-run
 *    (`infra/mail-gateway/db-login.sh`), because turning mail reading on is an act on Microsoft's side too;
 *  · the company's answer-by time (`broker_mail_settings`, 0649);
 *  · the mailbox list (D-BMR14): the roster (0649) — every McLeod dispatcher and why their mailbox is or
 *    is not read — with what Graph last said about each, plus mailboxes that left the roster but still
 *    open, which IT has to take out of the mail group.
 * Every read is org-filtered; the roster function takes the org itself. Asserted in `routes.test.ts` by
 * "gives the admin the gateway's state and the roster with Graph's word on each mailbox, org-scoped".
 */

interface ConfigRow {
  org_id: string;
  enabled: boolean;
  body_reading: boolean;
  mail_domains: string[];
  canary_result: BrokerMailAdmin["gateway"]["canaryResult"];
  canary_checked_at: string | null;
  disabled_reason: string | null;
}
interface MailboxRow {
  mailbox: string;
  owner_user_id: string | null;
  state: NonNullable<BrokerMailMailbox["state"]>;
  last_read_at: string | null;
  unlinked_at: string | null;
  last_probe_at: string | null;
}

export async function readBrokerMailAdmin(admin: SupabaseClient, env: Env, orgId: string): Promise<BrokerMailAdmin> {
  const [cfgRes, boxesRes, settings, roster, members, health, backups] = await Promise.all([
    admin.from("mail_gateway_config")
      .select("org_id, enabled, body_reading, mail_domains, canary_result, canary_checked_at, disabled_reason")
      .eq("org_id", orgId).limit(1),
    admin.from("mail_gateway_mailboxes").select("mailbox, owner_user_id, state, last_read_at, unlinked_at, last_probe_at").eq("org_id", orgId),
    readSettingsRow(admin, orgId),
    readRoster(admin, orgId),
    listOfficeMembers(admin, orgId),
    getGatewayHealth(env),
    readBackups(admin, orgId),
  ]);
  if (cfgRes.error) throw new Error(cfgRes.error.message);
  if (boxesRes.error) throw new Error(boxesRes.error.message);
  const cfg = ((cfgRes.data ?? []) as ConfigRow[])[0] ?? null;
  const boxes = (boxesRes.data ?? []) as MailboxRow[];
  const byMailbox = new Map(boxes.map((b) => [b.mailbox, b]));
  const names = new Map(members.map((m) => [m.userId, m.fullName ?? m.email]));
  const texts = await readTextStates(admin, orgId, roster.map((r) => r.user_id).filter((u): u is string => Boolean(u)));

  const mailboxes: BrokerMailMailbox[] = roster.map((r) => {
    const box = r.email ? byMailbox.get(r.email) : undefined;
    return {
      userId: r.user_id,
      name: r.user_id ? names.get(r.user_id) ?? null : null,
      email: r.email,
      mcleodLogins: r.mcleod_logins,
      reason: r.reason,
      textState: r.user_id ? texts.get(r.user_id) ?? "none" : null,
      backups: (r.user_id ? backups.get(r.user_id) ?? [] : []).map((u) => ({ userId: u, name: names.get(u) ?? "A former member" })),
      state: box && !box.unlinked_at ? box.state : null,
      lastReadAt: box?.last_read_at ?? null,
    };
  });
  // Read first, then the reasons in the contract's order, which is the order an admin fixes them in.
  const rank = (m: BrokerMailMailbox) => (m.reason === null ? 0 : 1 + BROKER_MAIL_ROSTER_REASONS.indexOf(m.reason));
  mailboxes.sort((a, b) => rank(a) - rank(b) || (a.name ?? a.mcleodLogins[0] ?? "").localeCompare(b.name ?? b.mcleodLogins[0] ?? ""));

  return {
    settings: { answerWithinMinutes: settings.answerWithinMinutes, textsOn: settings.textsOnSince !== null, backupAfterMinutes: settings.backupAfterMinutes },
    gateway: {
      // The published state is the database's one gateway (D-BMR12); it is this org's only if the row is.
      state: cfg ? health.state : "off",
      configured: cfg !== null,
      enabled: cfg?.enabled ?? false,
      bodyReading: cfg?.body_reading ?? false,
      mailDomains: cfg?.mail_domains ?? [],
      lastCycleAt: cfg ? health.lastCycleAt : null,
      canaryResult: cfg?.canary_result ?? null,
      canaryCheckedAt: cfg?.canary_checked_at ?? null,
      disabledReason: cfg?.disabled_reason ?? null,
    },
    mailboxes,
    members: members.map((m) => ({ userId: m.userId, name: m.fullName ?? m.email ?? "Unnamed" })).sort((a, b) => a.name.localeCompare(b.name)),
    stillConnected: boxes
      .filter((b) => b.unlinked_at && b.state === "still_connected_after_unlink")
      .map((b) => ({ mailbox: b.mailbox, unlinkedAt: b.unlinked_at, lastProbeAt: b.last_probe_at })),
  };
}

/**
 * The company row, written whole: an UPDATE when it exists, else an INSERT of every column — never a
 * partial upsert (`lint:upserts`: Postgres checks NOT NULL before conflict arbitration).
 */
export async function saveBrokerMailSettings(admin: SupabaseClient, orgId: string, userId: string, next: BrokerMailSettings, now: Date = new Date()): Promise<void> {
  // The switch is a MOMENT (0651): keep it while texts stay on, stamp it when they go on, clear it when off.
  const { textsOnSince } = await readSettingsRow(admin, orgId);
  const row = {
    answer_within_minutes: next.answerWithinMinutes,
    backup_after_minutes: next.backupAfterMinutes,
    texts_on_since: next.textsOn ? (textsOnSince ?? now.toISOString()) : null,
    updated_at: now.toISOString(),
    updated_by: userId,
  };
  const upd = await admin.from("broker_mail_settings").update(row).eq("org_id", orgId).select("org_id");
  if (upd.error) throw new Error(upd.error.message);
  if ((upd.data ?? []).length > 0) return;
  const ins = await admin.from("broker_mail_settings").insert({ org_id: orgId, ...row });
  if (ins.error) throw new Error(ins.error.message);
}

export type LeftOutResult = { ok: true; excluded: string[] } | { ok: false; code: "not_member" | "not_configured" };

/** Q-BMR11 through 0649's function, which refuses a non-member (22023) and an org with no config row (P0002). */
export async function setLeftOut(admin: SupabaseClient, orgId: string, userId: string, leftOut: boolean): Promise<LeftOutResult> {
  const { data, error } = await admin.rpc("broker_mail_set_left_out", { p_org: orgId, p_user: userId, p_left_out: leftOut });
  if (error) {
    if (error.code === "22023") return { ok: false, code: "not_member" };
    if (error.code === "P0002") return { ok: false, code: "not_configured" };
    throw new Error(error.message);
  }
  return { ok: true, excluded: (data ?? []) as string[] };
}
