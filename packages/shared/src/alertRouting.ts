import { z } from "zod";
import { rolesThatCanView, type AppSection } from "./auth.js";
import type { UserRole } from "./constants.js";
import type { NotificationCategory } from "./notificationsContract.js";

/**
 * Alert routing — which alert goes to whom, by bell, email or text
 * (`docs/plans/notifications/NOTIFICATION-ROUTING-PLAN.md` D-NR1..D-NR3, built first for home time:
 * `docs/plans/dispatch-loads/HOME-TIME-PLAN.md` §3.6, D-HT14, D-HT15).
 *
 * ── ONE CATALOGUE, AND THE DEFAULTS LIVE IN IT ──────────────────────────────────────────────────
 * `ALERT_CATALOGUE` is the list of alerts an office can route. Each entry carries its DEFAULT routes,
 * and an alert with no saved row in `notification_routes` (0598) uses them — so a default is written
 * once, here, and an org that never opened the page is not frozen on the defaults of the day it was
 * created. The Settings page, the resolver and the senders all read this list.
 *
 * It starts with home time's three. The alerts that existed before (fuel, DQ, finance …) keep their
 * own audiences until the routing plan moves each one here (its NR3); adding one is an entry, not a
 * migration — `notification_routes.alert` is checked against this list by the API, not by a CHECK.
 *
 * ── WHO A ROUTE CAN NAME ────────────────────────────────────────────────────────────────────────
 * A role, a person, or a RELATION the sender works out per event: whoever marked the home time, or the
 * dispatcher who runs the truck's fleet. A relation resolves to one person or to nobody.
 *
 * Only people who can VIEW the alert's section receive it (Q-NR2, ruled 2026-11-13 for these alerts):
 * an alert is a request to act, and the link in it opens a page of that section.
 */

export const ALERT_CHANNELS = ["bell", "email", "sms"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export const ALERT_CHANNEL_LABELS: Record<AlertChannel, string> = { bell: "Dashboard", email: "Email", sms: "Text" };

export const ALERT_RELATIONS = ["marked_by", "truck_dispatcher"] as const;
export type AlertRelation = (typeof ALERT_RELATIONS)[number];
export const ALERT_RELATION_LABELS: Record<AlertRelation, string> = {
  marked_by: "Whoever marked the home time",
  truck_dispatcher: "The truck's dispatcher",
};

/** The three ways `notification_routes.recipient_kind` names a recipient (0598's CHECK). */
export const ALERT_RECIPIENT_KINDS = ["role", "user", "relation"] as const;
export type AlertRecipientKind = (typeof ALERT_RECIPIENT_KINDS)[number];

/** One switch: this recipient, this channel, on or off. A `user` row that is off removes a person their role would include. */
export const alertRouteSchema = z.object({
  recipientKind: z.enum(ALERT_RECIPIENT_KINDS),
  recipientKey: z.string().min(1).max(80),
  channel: z.enum(ALERT_CHANNELS),
  enabled: z.boolean(),
});
export type AlertRoute = z.infer<typeof alertRouteSchema>;

export interface AlertDefinition {
  /** The alert's key — its bell category too, so a person's own mute and the route name one thing. */
  key: NotificationCategory;
  label: string;
  /** One sentence for the Settings page: when it fires. */
  description: string;
  /** Where to go, as the last line of the email and the text. */
  action: string;
  /** Whose pages the alert is about: only people who can view this section receive it. */
  section: AppSection;
  /** The relations this alert can resolve; a route naming another relation reaches nobody. */
  relations: readonly AlertRelation[];
  defaults: readonly AlertRoute[];
}

const on = (recipientKind: AlertRecipientKind, recipientKey: string, channel: AlertChannel): AlertRoute => ({ recipientKind, recipientKey, channel, enabled: true });
/** Whoever marked it, and the truck's dispatcher, on the dashboard (D-HT15's first two columns). */
const HOME_TIME_BASE: readonly AlertRoute[] = [on("relation", "marked_by", "bell"), on("relation", "truck_dispatcher", "bell")];
/**
 * …and the fleet manager role by dashboard and email, for the two that mean something went wrong
 * (owner's ruling Q-HT3, 2026-11-13). A default audience, the carrier's to change on the page — not a
 * permission, which is why it is a role named here and not a set derived from the matrix.
 */
const HOME_TIME_ESCALATED: readonly AlertRoute[] = [...HOME_TIME_BASE, on("role", "fleet_manager", "bell"), on("role", "fleet_manager", "email")];

const HOME_TIME_ACTION = "Open the Dispatch board in Silvicom 360, Home time tab.";

export const ALERT_CATALOGUE = [
  {
    key: "home_time_return_due",
    label: "Home time ending",
    description: "A driver on home time is due back within the warning window.",
    action: HOME_TIME_ACTION,
    section: "dispatch",
    relations: ALERT_RELATIONS,
    defaults: HOME_TIME_BASE,
  },
  {
    key: "home_time_overdue",
    label: "Home time overstayed",
    description: "A driver is past the return time and nobody has marked him back. Repeats daily, up to seven times.",
    action: HOME_TIME_ACTION,
    section: "dispatch",
    relations: ALERT_RELATIONS,
    defaults: HOME_TIME_ESCALATED,
  },
  {
    key: "home_time_truck_limit",
    label: "Truck at home too long",
    description: "A truck has been at its driver's home longer than the limit.",
    action: HOME_TIME_ACTION,
    section: "dispatch",
    relations: ALERT_RELATIONS,
    defaults: HOME_TIME_ESCALATED,
  },
] as const satisfies readonly AlertDefinition[];

export type AlertKey = (typeof ALERT_CATALOGUE)[number]["key"];
export const ALERT_KEYS = ALERT_CATALOGUE.map((a) => a.key) as AlertKey[];
export const isAlertKey = (v: unknown): v is AlertKey => typeof v === "string" && (ALERT_KEYS as string[]).includes(v);
export const alertDefinition = (key: AlertKey): AlertDefinition => ALERT_CATALOGUE.find((a) => a.key === key)!;

/** The routes in force for an alert: the carrier's saved rows, or the catalogue's defaults when it has saved none. */
export function routesInForce(key: AlertKey, saved: readonly AlertRoute[]): readonly AlertRoute[] {
  return saved.length > 0 ? saved : alertDefinition(key).defaults;
}

export interface AlertMember {
  userId: string;
  role: UserRole;
}

/**
 * Who receives an alert, and on which channels — the ONE resolver (D-NR3).
 *
 * - A **role** row reaches every member with that role.
 * - A **relation** row reaches the person the sender resolved for this event, if anybody.
 * - A **user** row beats both (D-NR2): on adds the person, off removes them — so somebody can opt a
 *   colleague out of an alert their role gets without changing the role's switch.
 * - Nobody outside the alert's section is ever reached, whatever a row says: a member whose role cannot
 *   view it is dropped, and so is an id that is not a current member (a person who left, a relation
 *   that points at a suspended account).
 *
 * `members` are the carrier's ACTIVE members. The result holds only people with at least one channel.
 * It may be empty: the sender then falls back, loudly — an alert addressed to nobody is a failure.
 */
export function resolveAlertRecipients(
  key: AlertKey,
  saved: readonly AlertRoute[],
  members: readonly AlertMember[],
  relations: Partial<Record<AlertRelation, string | null>>,
): Map<string, Set<AlertChannel>> {
  const def = alertDefinition(key);
  const viewers = new Set<string>(rolesThatCanView(def.section));
  const eligible = new Map(members.filter((m) => viewers.has(m.role)).map((m) => [m.userId, m.role]));
  const out = new Map<string, Set<AlertChannel>>();
  const add = (userId: string | null | undefined, channel: AlertChannel) => {
    if (!userId || !eligible.has(userId)) return;
    out.set(userId, (out.get(userId) ?? new Set<AlertChannel>()).add(channel));
  };
  const routes = routesInForce(key, saved);
  for (const r of routes) {
    if (!r.enabled) continue;
    if (r.recipientKind === "role") {
      for (const [userId, role] of eligible) if (role === r.recipientKey) add(userId, r.channel);
    } else if (r.recipientKind === "relation") {
      if ((def.relations as readonly string[]).includes(r.recipientKey)) add(relations[r.recipientKey as AlertRelation], r.channel);
    }
  }
  // The person's own rows last, so they win in both directions.
  for (const r of routes) {
    if (r.recipientKind !== "user") continue;
    if (r.enabled) add(r.recipientKey, r.channel);
    else out.get(r.recipientKey)?.delete(r.channel);
  }
  for (const [userId, channels] of out) if (channels.size === 0) out.delete(userId);
  return out;
}
