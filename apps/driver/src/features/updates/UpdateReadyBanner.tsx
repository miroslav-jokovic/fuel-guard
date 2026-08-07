import { Banner } from '@/components';
import { useAppUpdate } from './useAppUpdate';

/**
 * "An update is ready — Restart now" (ship-pipeline plan D2.5).
 *
 * Deliberately an offer, not an event. The bundle is already downloaded by the time this appears, so
 * the restart is instant and offline-safe; what it is waiting for is a moment when the driver is not
 * mid-task. Queued offline work survives a reload — it lives in the encrypted outbox, not in memory —
 * but a half-filled form does not, and that is the thing worth protecting.
 *
 * Renders nothing at all when there is no update, which is almost always.
 */
export function UpdateReadyBanner() {
  const { ready, apply } = useAppUpdate();
  if (!ready) return null;
  return (
    <Banner
      tone="info"
      icon="download"
      message="An update is ready. Restart when you have a moment."
      actionLabel="Restart"
      onAction={() => {
        void apply();
      }}
    />
  );
}
