import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { ApplyInvitation, useApplyInvitationQuery } from "@/features/apply/useApplication";
import { usePartOneStep } from "./usePartOneStep";

/**
 * The bundle → Part 1's inputs (C3a), for what C3d1a added: the device copy's key and lifetime come from
 * the bundle's `localKey` and the LINK's expiry, and a bundle without a key (cached from before C3d1a)
 * keeps no copy at all rather than one under a guessed key.
 */
const bundle = (over: Partial<ApplyInvitation> = {}): ApplyInvitation =>
  ({
    expiresAt: "2026-10-05T00:00:00Z",
    captures: [],
    identityComplete: false,
    fcraSummary: null,
    partOne: {
      completedAt: null, contact: false, address: false, licences: false, screening: false,
      medicalCardPending: false, rights: false,
    },
    ...over,
  }) as unknown as ApplyInvitation;

const query = (data: ApplyInvitation) =>
  ({ data: ref(data), refetch: vi.fn(async () => ({ data })) }) as unknown as ReturnType<typeof useApplyInvitationQuery>;

describe("the device copy's inputs", () => {
  it("keys the copy by the bundle's localKey and bounds it by the link's expiry", () => {
    const step = usePartOneStep(query(bundle({ localKey: "f".repeat(64) })), ref(false));
    expect(step.partOneInputs.value?.local).toEqual({ key: "f".repeat(64), linkExpiresAt: "2026-10-05T00:00:00Z" });
  });

  it("keeps no copy for a bundle served without a key", () => {
    const step = usePartOneStep(query(bundle()), ref(false));
    expect(step.partOneInputs.value?.local).toBeNull();
  });
});
