/**
 * Server deep-link → app route translation (Phase 6). `deepLinkFor` in shared emits ONE link
 * vocabulary consumed by two products with different route tables — the web dashboard
 * (`/hazmat/loads/:id` is a reviewer page there) and this app (`/hazmat/:id` is the driver
 * verdict). This is the app-side resolver: pure, total, and CLOSED over routes that actually
 * exist here — a link the app can't render resolves to Home rather than a crash or a blank
 * screen (a notification that strands the driver has wasted the one moment it had their
 * attention). Extend this when a new surface ships (messages → Phase 7).
 */

export function resolveDeepLink(link: string | null | undefined): string {
  if (!link) return '/home';

  // Hazmat: web reviewer path → driver verdict screen.
  const hazmatLoad = /^\/hazmat\/loads\/([0-9a-f-]{36})$/i.exec(link);
  if (hazmatLoad) return `/hazmat/${hazmatLoad[1]}`;
  if (link === '/hazmat/loads' || link === '/hazmat/review') return '/hazmat';

  // Loads: same shape in both products.
  if (/^\/loads\/[0-9a-f-]{36}$/i.test(link)) return link;
  if (link === '/loads') return '/loads';

  // Score + home are tabs here.
  if (link === '/score') return '/score';
  if (link === '/home') return '/home';
  if (link === '/more') return '/more';

  // Messages (Phase 7): thread route + inbox.
  const messageThread = /^\/messages\/([0-9a-f-]{36})$/i.exec(link);
  if (messageThread) return `/messages/${messageThread[1]}`;
  if (link === '/messages') return '/messages';

  // Anything else the app can't render lands on Home instead of a dead screen.
  return '/home';
}
