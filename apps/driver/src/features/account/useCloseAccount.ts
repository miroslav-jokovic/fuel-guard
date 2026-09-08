import { useMutation } from '@tanstack/react-query';
import { closureRequestResponseSchema } from '@silvicom/shared';
import { apiFetch } from '@/lib/api';
import { ApiQueryError } from '@/lib/queryClient';

/**
 * "Close my account" (DIRECTION-B-PLAN §6 P4.3, D-PR8).
 *
 * ── WHY THIS ONE WRITE DOES NOT RIDE THE OUTBOX ────────────────────────────────────────────────
 * Every other driver write in this app is queued: a check-in, a completed stop, a photograph, a
 * message. They are queued because a dock has no bars and losing the work would lose the job.
 *
 * This one is different in a way that matters. The outbox drains by authenticating as the driver —
 * and the whole point of this request is that the server stops accepting that authentication. A
 * queued closure would sit behind whatever else is pending, fire, ban the login, and then every
 * record still in the queue behind it would fail forever with no way to retry. Worse, the driver
 * would have been shown "your login is closed" while it demonstrably still worked.
 *
 * So it is a live call, and offline it simply fails with a message that says to try on a signal.
 * That is the honest behaviour: closing an account is not urgent the way recording a delivery is,
 * and a driver who is out of signal loses nothing by doing it ten minutes later.
 *
 * ⚠ The server is idempotent (0330's partial unique index), so a retry after a timeout that
 * actually succeeded is answered `already: true` rather than filing a second request.
 */
export function useCloseAccount() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/api/me/account/closure-request', {
        method: 'POST',
        schema: closureRequestResponseSchema,
      });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(
          res.error?.message ?? 'Could not send the request. Try again when you have a signal.',
          res.status,
          res.error?.code,
        );
      }
      return res.data;
    },
  });
}
