import { describe, expect, it } from 'vitest';
import { relativeTime, syncSubtitle, type SyncWordsInput } from '@/components/syncStatusModel';

/**
 * Settings › Sync's words. The case that started this file: on the first device pass (2026-11-25)
 * the row said "All synced" beside "1 failed".
 */

const NOW = Date.parse('2026-11-25T18:00:00Z');
const base: SyncWordsInput = { running: false, online: true, pending: 0, needsAttention: 0, lastSyncAt: NOW - 5_000, now: NOW };

describe('syncSubtitle', () => {
  it('never says "All synced" while work is stuck waiting for Retry', () => {
    const words = syncSubtitle({ ...base, needsAttention: 1 });
    expect(words).not.toMatch(/All synced/);
    expect(words).toBe('Not everything is sent · checked just now');
  });

  it('says "All synced" only when nothing is waiting and nothing is stuck', () => {
    expect(syncSubtitle(base)).toBe('All synced · just now');
  });

  it('counts waiting work first, because it is still trying on its own', () => {
    expect(syncSubtitle({ ...base, pending: 2, needsAttention: 1 })).toBe('2 waiting · last checked just now');
  });

  it('calls the last run "checked", since it ends whether or not anything was delivered', () => {
    expect(syncSubtitle({ ...base, online: false, lastSyncAt: NOW - 3 * 60_000 })).toBe('Offline · last checked 3m ago');
  });

  it('says a run is under way, and that a fresh install has had nothing to send', () => {
    expect(syncSubtitle({ ...base, running: true, needsAttention: 1 })).toBe('Syncing now…');
    expect(syncSubtitle({ ...base, lastSyncAt: null })).toBe('Nothing to sync yet');
  });
});

describe('relativeTime', () => {
  it('reads in the phone’s short words', () => {
    expect(relativeTime(null, NOW)).toBe('not yet');
    expect(relativeTime(NOW - 30_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe('2h ago');
    expect(relativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3d ago');
  });
});
