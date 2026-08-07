import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertOrgFeature, upsertOverride } from "./driverAppSettings.js";

const admin = (upsertError: { message: string } | null = null): SupabaseClient => {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError });
  return { from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient;
};

describe("driver-app settings invariants", () => {
  it("rejects disabling core.app before touching the database", async () => {
    const client = admin();
    const result = await upsertOrgFeature(client, "org-1", "actor-1", "core.app", { enabled: false });
    expect(result).toEqual({
      code: "invalid_feature",
      error: "App policy cannot be disabled; configure its minimum version instead.",
    });
    expect((client.from as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("validates released feature configuration before persistence", async () => {
    const client = admin();
    const result = await upsertOrgFeature(client, "org-1", "actor-1", "duty.odometer", {
      enabled: true,
      config: { mode: "required" },
    });
    expect(result).toMatchObject({ featureKey: "duty.odometer", enabled: true, config: { mode: "required" } });
    expect((client.from as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("rejects invalid configuration and unreleased features without persistence", async () => {
    const client = admin();
    const invalidConfig = await upsertOrgFeature(client, "org-1", "actor-1", "duty.odometer", {
      enabled: true,
      config: { mode: "invalid" },
    });
    const unreleased = await upsertOrgFeature(client, "org-1", "actor-1", "training", { enabled: true });
    expect(invalidConfig).toMatchObject({ code: "invalid_config" });
    expect(unreleased).toMatchObject({ code: "feature_unreleased" });
    expect((client.from as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("never permits a per-driver core.app override", async () => {
    const client = admin();
    const result = await upsertOverride(client, "org-1", "actor-1", "driver-1", "core.app", { enabled: true });
    expect(result).toEqual({ code: "invalid_feature", error: "App policy has no per-driver form." });
    expect((client.from as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
