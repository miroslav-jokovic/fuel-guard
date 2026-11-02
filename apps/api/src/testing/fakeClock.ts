/**
 * A clock a test moves by hand (ADS-AGENT-BUILD-WORKFLOW.md §4R, the harness): the ads code takes its
 * time as `now: () => Date` (the guard, the runner, the AI rail), so handing it `clock.now` lets a
 * scenario walk a campaign through simulated days in milliseconds — a month boundary in Central time,
 * an approval aging, an hourly spend pull — without `vi.useFakeTimers`, which would also freeze the
 * fake vendors' own sockets.
 *
 * It never moves on its own and never goes backwards: `advance` refuses a negative step and `set`
 * refuses an earlier instant, because a clock that can run backwards makes "this happened after that"
 * — the property every ledger here is ordered by — untestable.
 */
export class FakeClock {
  private ms: number;

  constructor(start: string | Date = "2026-11-02T12:00:00.000Z") {
    this.ms = typeof start === "string" ? Date.parse(start) : start.getTime();
    if (!Number.isFinite(this.ms)) throw new Error(`FakeClock: not an instant: ${String(start)}`);
  }

  /** Bound, so it can be handed as `now` directly. */
  readonly now = (): Date => new Date(this.ms);

  iso(): string {
    return new Date(this.ms).toISOString();
  }

  advance(by: { ms?: number; seconds?: number; minutes?: number; hours?: number; days?: number }): Date {
    const step = (by.ms ?? 0) + 1000 * ((by.seconds ?? 0) + 60 * ((by.minutes ?? 0) + 60 * ((by.hours ?? 0) + 24 * (by.days ?? 0))));
    if (!(step >= 0)) throw new Error(`FakeClock: cannot move backwards (${step} ms)`);
    this.ms += step;
    return this.now();
  }

  set(to: string | Date): Date {
    const next = typeof to === "string" ? Date.parse(to) : to.getTime();
    if (!Number.isFinite(next) || next < this.ms) throw new Error(`FakeClock: ${String(to)} is not at or after ${this.iso()}`);
    this.ms = next;
    return this.now();
  }
}
