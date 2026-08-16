import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/node";
import {
  signalCardMutationSettled,
  signalEchoUnfaithful,
  signalEfsBreakerOpened,
  signalMirrorSweepCompleted,
  signalPromotionStateChanged,
} from "./cardControlSignals.js";

/**
 * Step 5.1. The step's Verify is "trigger each signal deliberately in QA and confirm it fires", and
 * that drill needs a live QA org — the recipe is in `docs/29-EFS-INCIDENT-RUNBOOK.md` §6. What is
 * asserted here is everything that does NOT need one: that each signal fires at all, at the severity
 * that was decided for it, carrying the tags an alert rule groups by.
 *
 * Severity is the part worth testing. It is the difference between a page and a line in a dashboard,
 * it is invisible at the call site, and it is exactly the sort of thing that gets quietly downgraded
 * to make an alert channel quieter.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

// `vi.mock`, not `vi.spyOn`: an ESM module namespace is not configurable, so the export cannot be
// redefined in place. Only `captureMessage` is replaced — the rest of the SDK is left alone so
// nothing else in the import graph changes behaviour under test.
vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof Sentry>()),
  captureMessage: vi.fn(() => "id"),
}));

const captured = vi.mocked(Sentry.captureMessage);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  captured.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The options object of the most recent Sentry capture. */
function lastCapture(): { level?: string; tags?: Record<string, string>; extra?: Record<string, unknown> } {
  const call = captured.mock.calls.at(-1);
  return (call?.[1] ?? {}) as { level?: string; tags?: Record<string, string>; extra?: Record<string, unknown> };
}

describe("mutation outcomes carry the severity an operator has to act on", () => {
  it.each([
    ["succeeded", "info"],
    ["failed", "warning"],
    ["drift_detected", "warning"],
    ["partial", "error"],
    ["sent", "error"],
  ] as const)("reports %s at %s", (outcome, level) => {
    signalCardMutationSettled({ orgId: ORG, intent: "lock", capability: "card_lock", outcome });

    expect(lastCapture().level).toBe(level);
    expect(lastCapture().tags).toMatchObject({ signal: "card_mutation_settled", outcome, intent: "lock" });
  });

  it("does not treat `sent` as the mildest outcome just because nothing errored", () => {
    // The trap this guards. `sent` means the re-read failed: we do not know what the card looks
    // like. It is the only outcome where the honest answer is "go and look", and the request that
    // produced it returned 200.
    signalCardMutationSettled({ orgId: ORG, intent: "lock", capability: "card_lock", outcome: "sent" });
    const unverified = lastCapture().level;

    signalCardMutationSettled({ orgId: ORG, intent: "lock", capability: "card_lock", outcome: "failed" });
    const failed = lastCapture().level;

    expect(unverified).toBe("error");
    expect(failed).toBe("warning");
  });
});

describe("the signals that must never fire at all", () => {
  it("pages on echo_unfaithful — the count that must be identically zero", () => {
    signalEchoUnfaithful({ orgId: ORG, capability: "card_lock", detail: "could not re-parse setCard" });

    // `fatal`, unconditionally. One occurrence means the round-trip fidelity the whole write path is
    // built on has stopped holding; there is no acceptable rate to tune this down to.
    expect(lastCapture().level).toBe("fatal");
    expect(lastCapture().tags).toMatchObject({ signal: "echo_unfaithful" });
  });
});

describe("the operational signals", () => {
  it("reports a breaker opening as an error, with the window it will stay open for", () => {
    signalEfsBreakerOpened({ orgId: ORG, reason: "auth: bad credentials", openUntilIso: "2026-08-16T04:00:00.000Z" });

    expect(lastCapture().level).toBe("error");
    expect(lastCapture().extra).toMatchObject({ openUntilIso: "2026-08-16T04:00:00.000Z" });
  });

  it("reports BOTH promotion directions at warning, not just the enable", () => {
    signalPromotionStateChanged({
      orgId: ORG, capability: "card_lock", state: "enabled",
      actorId: "u1", environment: "production", reason: "proof 1",
    });
    expect(lastCapture().level).toBe("warning");
    expect(lastCapture().tags).toMatchObject({ state: "enabled", capability: "card_lock" });

    // A suspension means someone believed a capability was doing harm. Downgrading it to info is how
    // the one that mattered gets missed.
    signalPromotionStateChanged({
      orgId: ORG, capability: "card_lock", state: "suspended",
      actorId: "u1", environment: "production", reason: "incident",
    });
    expect(lastCapture().level).toBe("warning");
  });

  it("reports a clean sweep at info and a sweep with undetailed cards at warning", () => {
    const sweep = { orgId: ORG, cardsSeen: 197, detailed: 197, linked: 157, tombstoned: 0 };

    signalMirrorSweepCompleted({ ...sweep, failed: 0, cardsWithoutDetail: 0 });
    expect(lastCapture().level).toBe("info");

    // A card with no detail is one the product cannot answer questions about — the badge renders the
    // mirror, and a mirror row only says what EFS said at `detail_synced_at`.
    signalMirrorSweepCompleted({ ...sweep, failed: 0, cardsWithoutDetail: 3 });
    expect(lastCapture().level).toBe("warning");

    signalMirrorSweepCompleted({ ...sweep, failed: 2, cardsWithoutDetail: 0 });
    expect(lastCapture().level).toBe("warning");
  });
});

describe("what a signal is not allowed to carry", () => {
  it("emits a greppable console line even with no Sentry DSN configured", () => {
    // Sentry is a no-op unless SENTRY_DSN is set, which is true locally, in CI and on any host where
    // it was forgotten. A signal that exists only when a DSN happens to be configured is one nobody
    // can verify — and the QA drills in the runbook grep for exactly this prefix.
    const errors = vi.mocked(console.error);
    signalEchoUnfaithful({ orgId: ORG, capability: "card_lock", detail: "x" });

    expect(errors.mock.calls.at(-1)?.[0]).toMatch(/^\[card-control-signal\] echo_unfaithful /);
  });

  it("never carries a card number", () => {
    // These payloads leave the process. Cards are referenced by efs_cards.id everywhere they are
    // referenced at all, and none of these signals takes one — this fails if a field is ever added
    // that does.
    const PAN = "70830000000000000";
    signalCardMutationSettled({ orgId: ORG, intent: "lock", capability: "card_lock", outcome: "succeeded" });
    signalMirrorSweepCompleted({
      orgId: ORG, cardsSeen: 1, detailed: 1, linked: 1, tombstoned: 0, failed: 0, cardsWithoutDetail: 0,
    });

    for (const call of captured.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(PAN);
      expect(serialized).not.toMatch(/\d{12,}/);
    }
  });
});
