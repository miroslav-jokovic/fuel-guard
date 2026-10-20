import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { notifyEnqueued, onEnqueued } from './outboxSignal';

/**
 * The trigger that wakes the sync engine when something is queued (D-RLY7). Without it a load
 * accepted while ONLINE waited for the next app switch or lost signal (outboxSignal.ts's header).
 */
describe('the enqueue signal', () => {
  it('wakes every subscriber, and stops waking one that unsubscribed', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onEnqueued(a);
    const offB = onEnqueued(b);
    notifyEnqueued();
    offA();
    notifyEnqueued();
    offB();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("never lets a subscriber's failure fail the enqueue that signalled it", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const after = vi.fn();
    const offBad = onEnqueued(() => {
      throw new Error('engine not ready');
    });
    const offAfter = onEnqueued(after);
    expect(() => notifyEnqueued()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    offBad();
    offAfter();
    warn.mockRestore();
  });

  // The two halves live in React Native modules this runner cannot load (expo-sqlite, AppState), so
  // the wiring is held by reading the source: a refactor that drops either line fails here.
  it('is raised by enqueue once the record is durable, and subscribed to by the sync engine', () => {
    const read = (f: string) => readFileSync(path.join(__dirname, f), 'utf8');
    const enqueue = read('outbox.ts').split('export async function enqueue')[1]!.split('\nexport ')[0]!;
    expect(enqueue.indexOf('notifyEnqueued()')).toBeGreaterThan(enqueue.indexOf("select * from outbox where id = ?"));
    expect(read('sync.ts')).toMatch(/onEnqueued\(\(\) => void runSync\(\)\)/);
    expect(read('sync.ts')).toMatch(/unsubscribeEnqueued\(\);/);
  });
});
