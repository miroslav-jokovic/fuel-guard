import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { recordCardRefusal, type CardRefusal } from "./refusalAudit.js";

/**
 * EFS audit 2026-09-30: a refused prompts edit left no trace anywhere in production. These pin the row
 * a refusal now writes, and that writing it can never change or break the refusal itself.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const REFUSAL: CardRefusal = {
  orgId: ORG,
  userId: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  efsCardId: CARD,
  capabilityKey: "prompts_set",
  scope: "prompts",
  code: "card_control_not_promoted",
  blockedBy: "not_promoted",
};

describe("recordCardRefusal", () => {
  it("writes one card.action_refused row naming the actor, the card, the capability and the gate", async () => {
    const rec = createSupabaseRecorder({ tables: { audit_logs: [] } });
    await recordCardRefusal(() => rec.client, REFUSAL);
    expect(rec.writtenRows("audit_logs")).toEqual([
      {
        org_id: ORG,
        actor_id: REFUSAL.userId,
        action: "card.action_refused",
        entity: "efs_cards",
        entity_id: CARD,
        meta: { capability: "prompts_set", scope: "prompts", code: "card_control_not_promoted", blockedBy: "not_promoted" },
      },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("swallows a client that cannot even be built — the kill switch answers with no Supabase configured", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      recordCardRefusal(() => {
        throw new Error("Supabase admin not configured");
      }, REFUSAL),
    ).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("could not record a refusal (card_control_not_promoted)"));
    errors.mockRestore();
  });

  it("swallows a failed insert", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = {
      from: () => ({ insert: async () => ({ error: { message: "db down" } }) }),
    } as unknown as SupabaseClient;
    await expect(recordCardRefusal(() => broken, REFUSAL)).resolves.toBeUndefined();
    errors.mockRestore();
  });
});
