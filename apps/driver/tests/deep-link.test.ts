import { describe, expect, it } from 'vitest';
import { resolveDeepLink } from '@/features/notifications/deepLink';

/**
 * Server deep links → app routes (Phase 6). The property that matters: the resolver is TOTAL and
 * CLOSED over routes that exist in this app — any link it can't render lands on Home, never a
 * dead screen. The hazmat web-path translation is the case that motivated the resolver.
 */
describe('resolveDeepLink', () => {
  const uuid = '6e9c8a1e-1b2d-4c3e-9f4a-5b6c7d8e9f0a';

  it('translates the hazmat web reviewer path to the driver verdict route', () => {
    expect(resolveDeepLink(`/hazmat/loads/${uuid}`)).toBe(`/hazmat/${uuid}`);
    expect(resolveDeepLink('/hazmat/loads')).toBe('/hazmat');
    expect(resolveDeepLink('/hazmat/review')).toBe('/hazmat');
  });

  it('passes load links through unchanged (same shape in both products)', () => {
    expect(resolveDeepLink(`/loads/${uuid}`)).toBe(`/loads/${uuid}`);
    expect(resolveDeepLink('/loads')).toBe('/loads');
  });

  it('keeps tab links that exist here', () => {
    expect(resolveDeepLink('/score')).toBe('/score');
    expect(resolveDeepLink('/home')).toBe('/home');
    expect(resolveDeepLink('/more')).toBe('/more');
  });

  it('routes messages links to the thread and inbox (Phase 7)', () => {
    expect(resolveDeepLink(`/messages/${uuid}`)).toBe(`/messages/${uuid}`);
    expect(resolveDeepLink('/messages')).toBe('/messages');
    expect(resolveDeepLink('/messages/not-a-uuid')).toBe('/home');
  });

  it('is total: null, empty, junk and traversal-looking input all land on Home', () => {
    expect(resolveDeepLink(null)).toBe('/home');
    expect(resolveDeepLink(undefined)).toBe('/home');
    expect(resolveDeepLink('')).toBe('/home');
    expect(resolveDeepLink('not-a-path')).toBe('/home');
    expect(resolveDeepLink('/hazmat/loads/../../settings')).toBe('/home');
    expect(resolveDeepLink('https://evil.example/loads/x')).toBe('/home');
  });
});
