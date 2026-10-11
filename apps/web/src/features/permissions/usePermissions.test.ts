import { describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { useSetMemberSurface, useSetRoleSection } from "@/features/permissions/usePermissions";

/**
 * SP9 (Q-SET8 (a)): every permission write is behind the password step-up, and the page can only turn
 * the refusal into its prompt if the API's `code` survives the throw. The page tests mock this module
 * whole, so this is the one place that sees what `put` actually throws.
 */
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({
    ok: false,
    status: 403,
    error: { code: "step_up_required", message: "Confirm your password to continue." },
  })),
}));

function withMutations<T>(use: () => T): T {
  let out!: T;
  mount(defineComponent({ setup: () => ((out = use()), () => null) }), { global: { plugins: [VueQueryPlugin] } });
  return out;
}

describe("a refused permission write keeps the API's code", () => {
  it.each([
    ["the role layer", () => withMutations(useSetRoleSection).mutateAsync({ role: "dispatcher", section: "fuel", access: "view" })],
    ["the person layer", () => withMutations(useSetMemberSurface).mutateAsync({ userId: "u-1", surfaceKey: "fuel.log", allowed: null })],
  ])("on %s", async (_layer, write) => {
    const refusal = await write().catch((e: unknown) => e);
    await flushPromises();
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).toMatchObject({ code: "step_up_required", message: "Confirm your password to continue." });
  });
});
