import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALERT_CATALOGUE,
  ALERT_RELATION_LABELS,
  USER_ROLE_LABELS,
  alertDefinition,
  alertRouteId,
  alertMemberCanView,
  alertRolesFor,
  alertRoutesProblem,
  alertsForMember,
  receivableRoutes,
  routesInForce,
  type AlertChannel,
  type AlertKey,
  type AlertMember,
  type AlertRoute,
  type AlertRoutingView,
  type MyAlerts,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { smsConfigured } from "../../lib/sms.js";
import { readDirectory } from "./alertRouting.js";
import { readAlertTextQuiet } from "./alertTexts.js";

/**
 * What the office sets and sees about alert routing (HOME-TIME-PLAN HT5; NOTIFICATION-ROUTING-PLAN
 * NR4): the Settings page's read and its two writes, and "My alerts".
 *
 * ── THE PAGE SHOWS WHAT THE SENDER WILL DO ──────────────────────────────────────────────────────
 * The read returns the routes IN FORCE (`routesInForce`): the carrier's saved set, or the catalogue's
 * defaults when it has saved none. "My alerts" asks the sender's own resolver (`alertsForMember`). Neither
 * holds a second copy of who is told.
 *
 * ── A SAVE REPLACES THE ALERT'S WHOLE SET ───────────────────────────────────────────────────────
 * The page sends every switch of one alert. Each is written as a COMPLETE row on the table's own
 * identity (alert × recipient × channel), then rows the page no longer lists — a person taken off — are
 * deleted. In that order: if the second step fails, the alert still has every switch the office just
 * set, plus a stale one the next save removes; the other order could leave an alert with no rows at
 * all, which reads as "use the defaults". Reset deletes the alert's rows, which IS "use the defaults".
 *
 * Every query filters on `org_id`: the service role bypasses RLS.
 */

interface RouteRow {
  id: string;
  alert: string;
  recipient_kind: AlertRoute["recipientKind"];
  recipient_key: string;
  channel: AlertChannel;
  enabled: boolean;
}

const toRoute = (r: RouteRow): AlertRoute => ({ recipientKind: r.recipient_kind, recipientKey: r.recipient_key, channel: r.channel, enabled: r.enabled });

/** Every saved route of the carrier, one read. A carrier's routes are tens of rows, far under PostgREST's cap. */
async function readRouteRows(admin: SupabaseClient, orgId: string): Promise<RouteRow[]> {
  const { data, error } = await admin.from("notification_routes").select("id, alert, recipient_kind, recipient_key, channel, enabled").eq("org_id", orgId);
  if (error) throw new Error(`notification_routes: ${error.message}`);
  return (data ?? []) as RouteRow[];
}

const savedFor = (rows: readonly RouteRow[], alert: AlertKey): AlertRoute[] => rows.filter((r) => r.alert === alert).map(toRoute);

/** The active members who can view the alert's section: the people a route can reach. */
const reachable = (members: readonly AlertMember[], alert: AlertKey): AlertMember[] => {
  const section = alertDefinition(alert).section;
  return members.filter((m) => alertMemberCanView(m, section));
};

/** Who has a confirmed number they have not stopped: the people a Text switch actually reaches. */
async function readTextReady(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const { data, error } = await admin.from("notification_contacts").select("user_id").eq("org_id", orgId).not("verified_at", "is", null).is("stopped_at", null);
  if (error) throw new Error(`notification_contacts: ${error.message}`);
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
}

export async function readAlertRoutingView(admin: SupabaseClient, env: Env, orgId: string): Promise<AlertRoutingView> {
  const [rows, directory, quiet, ready] = await Promise.all([readRouteRows(admin, orgId), readDirectory(admin, orgId), readAlertTextQuiet(admin, orgId), readTextReady(admin, orgId)]);
  const listed = new Set<string>();
  const alerts = ALERT_CATALOGUE.map((def) => {
    const saved = savedFor(rows, def.key);
    const people = reachable(directory.members, def.key);
    for (const m of people) listed.add(m.userId);
    const roles = alertRolesFor(def.section, directory.roleChanges);
    // What can still receive it: a role or a person the carrier has since taken the section from is not
    // shown as a switch — and the sender already skips them.
    const inForce = receivableRoutes(routesInForce(def.key, saved), new Set(people.map((m) => m.userId)), new Set<string>(roles));
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      relations: def.relations.map((key) => ({ key, label: ALERT_RELATION_LABELS[key] })),
      roles: roles.map((key) => ({ key, label: USER_ROLE_LABELS[key] ?? key })),
      routes: inForce,
      usesDefaults: saved.length === 0,
    };
  });
  const members = directory.members
    .filter((m) => listed.has(m.userId))
    .map((m) => ({ userId: m.userId, name: directory.nameOf.get(m.userId) ?? "Unnamed member", role: m.role, textReady: ready.has(m.userId) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { alerts, members, texts: { available: smsConfigured(env), quiet } };
}

export type AlertRoutesSaved = { ok: true; routes: AlertRoute[] } | { ok: false; problem: string };

/** Replace one alert's set. Refused, in words for the page, when the set breaks `alertRoutesProblem`. */
export async function saveAlertRoutes(admin: SupabaseClient, orgId: string, actorId: string, alert: AlertKey, routes: readonly AlertRoute[], now: Date): Promise<AlertRoutesSaved> {
  const directory = await readDirectory(admin, orgId);
  const roleKeys = new Set<string>(alertRolesFor(alertDefinition(alert).section, directory.roleChanges));
  const problem = alertRoutesProblem(alert, routes, new Set(reachable(directory.members, alert).map((m) => m.userId)), roleKeys);
  if (problem) return { ok: false, problem };

  const { error } = await admin.from("notification_routes").upsert(
    routes.map((r) => ({
      org_id: orgId,
      alert,
      recipient_kind: r.recipientKind,
      recipient_key: r.recipientKey,
      channel: r.channel,
      enabled: r.enabled,
      updated_by: actorId,
      updated_at: now.toISOString(),
    })),
    { onConflict: "org_id,alert,recipient_kind,recipient_key,channel" },
  );
  if (error) throw new Error(`notification_routes: ${error.message}`);

  const keep = new Set(routes.map(alertRouteId));
  const stale = (await readRouteRows(admin, orgId)).filter((r) => r.alert === alert && !keep.has(alertRouteId(toRoute(r)))).map((r) => r.id);
  // 50 ids a request: the Node 22 header limit's bound on an `.in()` list.
  for (let i = 0; i < stale.length; i += 50) {
    const { error: removeError } = await admin.from("notification_routes").delete().eq("org_id", orgId).eq("alert", alert).in("id", stale.slice(i, i + 50));
    if (removeError) throw new Error(`notification_routes: ${removeError.message}`);
  }
  return { ok: true, routes: [...routes] };
}

/** Back to the catalogue's defaults: the alert has no saved rows. Returns how many were removed. */
export async function resetAlertRoutes(admin: SupabaseClient, orgId: string, alert: AlertKey): Promise<number> {
  const { data, error } = await admin.from("notification_routes").delete().eq("org_id", orgId).eq("alert", alert).select("id");
  if (error) throw new Error(`notification_routes: ${error.message}`);
  return (data ?? []).length;
}

/** What this member receives, alert by alert; an alert about a section they cannot view is not listed. */
export async function readMyAlerts(admin: SupabaseClient, orgId: string, userId: string): Promise<MyAlerts> {
  // The caller as the SENDER sees them — from the directory, with the carrier's permission changes —
  // not from the token: a token is up to a lifetime old, and this must say what the next run will do.
  const [rows, directory] = await Promise.all([readRouteRows(admin, orgId), readDirectory(admin, orgId)]);
  const me = directory.members.find((m) => m.userId === userId);
  const alerts = ALERT_CATALOGUE.flatMap((def) => {
    if (!me || !alertMemberCanView(me, def.section)) return [];
    const mine = alertsForMember(def.key, savedFor(rows, def.key), me);
    return [
      {
        key: def.key,
        label: def.label,
        description: def.description,
        always: mine.always,
        whenMine: mine.whenMine.map((w) => ({ relation: w.relation, label: ALERT_RELATION_LABELS[w.relation], channels: w.channels })),
      },
    ];
  });
  return { alerts };
}
