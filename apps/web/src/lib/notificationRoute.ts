import type { NotificationCategory } from "@fuelguard/shared";

/**
 * Where a notification takes an OFFICE user on click (DQF plan C6).
 *
 * The `deep_link` column on notification_events carries DRIVER-APP paths (expo-router), which mean
 * nothing to the web router — so the web derives its own destination from category + entity, and
 * only for pairs it is certain about. Returning null is the honest default: a notification with no
 * destination still informs; a notification that navigates somewhere wrong teaches people not to
 * click any of them.
 */
export function notificationRoute(
  category: NotificationCategory | string,
  entityType: string | null,
  entityId: string | null,
): string | null {
  if (category.startsWith("dq_") && entityType === "driver" && entityId) {
    return `/compliance/${entityId}`;
  }
  if (category === "message_received") return "/messages";
  // A10. The applicant board IS the queue for a stalled application — there is no per-applicant page
  // to land on, and "an alert that cannot deep-link to its queue is half an alert".
  if (category === "application_stalled") return "/recruitment";
  if (category.startsWith("hazmat_") && entityType === "load" && entityId) {
    return `/hazmat/loads/${entityId}`;
  }
  if (category.startsWith("load_") && entityType === "load" && entityId) {
    return `/dispatch/loads/${entityId}`;
  }
  return null;
}
