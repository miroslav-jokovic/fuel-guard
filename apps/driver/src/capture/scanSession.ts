/**
 * The hand-off between a capture provider and the scanner SCREEN (`app/scan.tsx`).
 *
 * The OS scanners are modal view controllers the native side presents and resolves; our own camera
 * (D-LED6) is a React screen, because its words, buttons and page count are the design system's. So the
 * provider opens the route and awaits this promise, and the screen settles it: with the pages, or with
 * `null` when the driver closed it. One session at a time — a second open settles the first as closed,
 * so a promise can never be left hanging by a screen that was replaced.
 *
 * Pure state, no React or router import, so `scanSession.test.ts` can reach every rule.
 */

export interface ScanSessionRequest {
  maxPages: number;
}

let pending: { request: ScanSessionRequest; settle: (pages: string[] | null) => void } | null = null;

/** Start a session. `open` navigates to the screen; the promise settles when the screen finishes. */
export function startScanSession(request: ScanSessionRequest, open: () => void): Promise<string[] | null> {
  pending?.settle(null);
  return new Promise((resolve) => {
    const session = {
      request,
      settle: (pages: string[] | null) => {
        if (pending === session) pending = null;
        resolve(pages);
      },
    };
    pending = session;
    open();
  });
}

/** What the screen should allow, or null when no session is open (a deep link, a stale screen). */
export function currentScanRequest(): ScanSessionRequest | null {
  return pending?.request ?? null;
}

/** The screen is done: hand back the pages in the order they were taken. An empty list is a close. */
export function finishScanSession(pages: readonly string[]): void {
  pending?.settle(pages.length > 0 ? [...pages] : null);
}

/** The driver closed the screen, or it unmounted without finishing. Idempotent. */
export function cancelScanSession(): void {
  pending?.settle(null);
}
