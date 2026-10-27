import type { NotificationCategory } from "@silvicom/shared";

/**
 * Where a notification takes an OFFICE user on click (DQF plan C6).
 *
 * The `deep_link` column on notification_events carries DRIVER-APP paths (expo-router), which mean
 * nothing to the web router — so the web derives its own destination from category + entity, and
 * only for pairs it is certain about. Returning null is the honest default: a notification with no
 * destination still informs; a notification that navigates somewhere wrong teaches people not to
 * click any of them.
 *
 * `opens` is the reader's own answer (SP5, plan §4b): a destination the guard would refuse them is no
 * destination, for the same reason — pressing a hazmat alert as a dispatcher without `hazmat` used to
 * land on the dashboard, which reads as a broken link. The bell passes `useOpens()`; the default
 * answers "yes" so the map itself stays testable on its own.
 */
export function notificationRoute(
  category: NotificationCategory | string,
  entityType: string | null,
  entityId: string | null,
  opens: (to: string) => boolean = () => true,
): string | null {
  // A category may name more than one door, most fitting first; the reader takes the first they can open.
  return candidates(category, entityType, entityId).find(opens) ?? null;
}

/**
 * Where a category can lead, best first. Only `roadside_repair_due` has two: its recipients are maintenance
 * managers, whose door is the Shop's repairs page; a reader who holds safety but not maintenance (it can be
 * re-routed by an admin's settings) still lands on the inspection (Q-IC16 (a), owner 2026-10-19).
 */
function candidates(category: string, entityType: string | null, entityId: string | null): string[] {
  if (category === "roadside_repair_due" && entityType === "roadside_inspection" && entityId) {
    return [`/shop/roadside-repairs?inspection=${encodeURIComponent(entityId)}`, `/roadside-inspections/${entityId}`];
  }
  const to = destination(category, entityType, entityId);
  return to ? [to] : [];
}

function destination(category: string, entityType: string | null, entityId: string | null): string | null {
  if (category.startsWith("dq_") && entityType === "driver" && entityId) {
    return `/compliance/${entityId}`;
  }
  // UF6: a truck's or trailer's paper, on the unit's own page opened at its File section, where the
  // drop card files the renewal (UF5). The entity is the unit itself, so the subject type picks the page.
  if (category.startsWith("unit_file_") && entityId) {
    if (entityType === "tractor") return `/vehicles/${entityId}?section=file`;
    if (entityType === "trailer") return `/trailers/${entityId}?section=file`;
  }
  if (category === "message_received") return "/messages";
  // D-CHAT23: a mention or a reply is one item per conversation, so it opens the conversation — a channel
  // at `?ch=`, a direct or group conversation at `?c=` (the /chat page's own addresses).
  if ((category === "chat_mention" || category === "chat_reply") && entityId) {
    if (entityType === "chat_channel") return `/chat?ch=${encodeURIComponent(entityId)}`;
    if (entityType === "chat_conversation") return `/chat?c=${encodeURIComponent(entityId)}`;
  }
  // A10. The applicant board IS the queue for a stalled application — there is no per-applicant page
  // to land on, and "an alert that cannot deep-link to its queue is half an alert".
  if (category === "application_stalled") return "/recruitment";
  // Q-AW56. The board, opened on its "Ready to screen" view: the filter lives in the URL (D-US2), so
  // the notice lands on exactly the rows it is about, with the count on the trigger.
  if (category === "application_ready_to_screen") return "/recruitment?waiting=screen";
  // The card itself — the entity is the `efs_cards` row the status poll saw change.
  if (category === "card_status_changed" && entityType === "efs_card" && entityId) return `/fuel-cards/${entityId}`;
  // The daily summary names many cards and no single one, so it opens the card list (chunk 3b).
  if (category === "card_status_changed" && entityType === null && entityId === null) return "/fuel-cards";
  // Safety › Drug & Alcohol — the result itself is a testing record, so the page decides what the
  // reader may see; the notification only says there is something to look at (MEDSTOP-PLAN F-5).
  if (category === "drug_alcohol_result") return "/drug-alcohol";
  // The FMCSA record has stopped refreshing (IC1c): the list says how old it is, above its rows.
  if (category === "roadside_feed_stale") return "/roadside-inspections";
  // A report to review (IC14): the inspection page's driver card holds it. A repair due has two doors (`candidates`).
  if (category === "roadside_report_needs_review" && entityType === "roadside_inspection" && entityId) {
    return `/roadside-inspections/${entityId}`;
  }
  // A key about to expire, or a sweep that stopped (§7A.20): the fix — a new key, the sweep's error — is on Settings › Med-Stop.
  if (category === "medstop_connection") return "/settings/medstop";
  if (category.startsWith("hazmat_") && entityType === "load" && entityId) {
    return `/hazmat/loads/${entityId}`;
  }
  if (category.startsWith("load_") && entityType === "load" && entityId) {
    return `/dispatch/loads/${entityId}`;
  }
  return null;
}
