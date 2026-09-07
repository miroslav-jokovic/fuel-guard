import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/**
 * Category → glyph. Lives here rather than inside `app/notifications.tsx` because Today's attention
 * queue shows the same events: two copies of this map is two vocabularies for one set of facts, and
 * the drift only shows up when a driver sees a truck on one screen and an info dot on the other.
 */
export const CATEGORY_ICON: Record<string, MaterialSymbolName> = {
  load_offered: 'local_shipping',
  load_changed: 'local_shipping',
  load_canceled: 'warning',
  message_received: 'mail',
  duty_auto_closed: 'schedule',
  performance_week: 'speed',
  training_due: 'school',
  hazmat_review: 'local_fire_department',
  hazmat_cleared: 'local_fire_department',
  hazmat_rejected: 'local_fire_department',
  system: 'info',
};
