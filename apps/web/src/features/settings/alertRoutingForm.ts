import { alertsForMember, type AlertChannel, type AlertKey, type AlertRoute, type AlertRoutingView, type UserRole } from "@silvicom/shared";

/**
 * The routing section's form, as plain data (HOME-TIME-PLAN HT5): one row per recipient with a switch
 * per channel, built from the server's routes and turned back into the set a save sends.
 *
 * ── THE PAGE EDITS TWO CHANNELS ─────────────────────────────────────────────────────────────────
 * Dashboard and Email. A text route the carrier already holds is carried through a save untouched
 * (`toRoutes`), so this page cannot delete what the text step (HT6) writes.
 *
 * ── A PERSON WHO LEFT IS DROPPED ────────────────────────────────────────────────────────────────
 * A saved row naming somebody who is no longer an active member reaches nobody and the API refuses to
 * save it again; the form leaves it out, and the save removes it.
 */
export type RoutingAlert = AlertRoutingView["alerts"][number];
export type RoutingMember = AlertRoutingView["members"][number];
export const EDITED_CHANNELS = ["bell", "email"] as const satisfies readonly AlertChannel[];
export type EditedChannel = (typeof EDITED_CHANNELS)[number];

export interface RecipientRow {
  /** `kind:key`, the row's identity in the table. */
  id: string;
  kind: AlertRoute["recipientKind"];
  key: string;
  label: string;
  /** Who the row reaches, said under the label. */
  hint: string;
  bell: boolean;
  email: boolean;
}

const isOn = (routes: readonly AlertRoute[], kind: AlertRoute["recipientKind"], key: string, channel: AlertChannel): boolean =>
  routes.some((r) => r.recipientKind === kind && r.recipientKey === key && r.channel === channel && r.enabled);

const RELATION_HINTS: Record<string, string> = {
  marked_by: "The person who marked this driver's home time.",
  truck_dispatcher: "The dispatcher linked to the truck's McLeod fleet in Settings, McLeod fleets. Nobody, when the fleet is not linked.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function recipientRows(alert: RoutingAlert, members: readonly RoutingMember[]): RecipientRow[] {
  const row = (kind: AlertRoute["recipientKind"], key: string, label: string, hint: string): RecipientRow => ({
    id: `${kind}:${key}`,
    kind,
    key,
    label,
    hint,
    bell: isOn(alert.routes, kind, key, "bell"),
    email: isOn(alert.routes, kind, key, "email"),
  });
  const people = [...new Set(alert.routes.filter((r) => r.recipientKind === "user").map((r) => r.recipientKey))]
    .map((id) => members.find((m) => m.userId === id))
    .filter((m): m is RoutingMember => !!m);
  return [
    ...alert.relations.map((r) => row("relation", r.key, r.label, RELATION_HINTS[r.key] ?? "")),
    ...alert.roles.map((r) => row("role", r.key, `Everyone with the role ${r.label}`, plural(members.filter((m) => m.role === r.key).length, "person today", "people today"))),
    ...people.map((m) => row("user", m.userId, m.name, PERSON_HINT)),
  ];
}

export const PERSON_HINT = "This person's own switches. They win over the role's, on and off.";

/**
 * A row for a person being added, starting on what they receive TODAY by their role — so adding
 * somebody never silently takes away a channel their role gives them.
 */
export function personRow(alertKey: AlertKey, rows: readonly RecipientRow[], member: RoutingMember): RecipientRow {
  const always = alertsForMember(alertKey, toRoutes(rows, []), { userId: member.userId, role: member.role as UserRole }).always;
  return { id: `user:${member.userId}`, kind: "user", key: member.userId, label: member.name, hint: PERSON_HINT, bell: always.includes("bell") || !always.includes("email"), email: always.includes("email") };
}

/** The members who can still be added as a person: not already a row. */
export const addablePeople = (rows: readonly RecipientRow[], members: readonly RoutingMember[]): RoutingMember[] => {
  const listed = new Set(rows.filter((r) => r.kind === "user").map((r) => r.key));
  return members.filter((m) => !listed.has(m.userId));
};

/** The set a save sends: both edited channels of every row, plus the untouched text routes of rows still listed. */
export function toRoutes(rows: readonly RecipientRow[], original: readonly AlertRoute[]): AlertRoute[] {
  const listed = new Set(rows.map((r) => r.id));
  const edited = rows.flatMap((r) => EDITED_CHANNELS.map((channel): AlertRoute => ({ recipientKind: r.kind, recipientKey: r.key, channel, enabled: r[channel] })));
  const carried = original.filter((r) => !(EDITED_CHANNELS as readonly string[]).includes(r.channel) && listed.has(`${r.recipientKind}:${r.recipientKey}`));
  return [...edited, ...carried];
}

/** Has the form moved from what the server holds? Compared as what would be ON, so row order does not count. */
export function routesChanged(rows: readonly RecipientRow[], alert: RoutingAlert, members: readonly RoutingMember[]): boolean {
  const sig = (list: readonly RecipientRow[]) => list.map((r) => `${r.id}:${r.bell ? 1 : 0}${r.email ? 1 : 0}`).sort().join("|");
  return sig(rows) !== sig(recipientRows(alert, members));
}
