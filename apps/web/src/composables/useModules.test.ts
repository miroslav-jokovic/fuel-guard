import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * The module set is the CALLER'S ORG's, so the cache must never hold one that belonged to nobody
 * (2026-10-13). Measured on staging: a read made before sign-in went out with the anon key, RLS
 * answered `[]`, and the person who then signed in saw no dispatch surfaces for five minutes.
 */
const session = reactive({ orgId: null as string | null });
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));

const reads: string[] = [];
const answer = vi.fn<() => { module_key: string; enabled: boolean }[]>();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: async () => {
        reads.push(`${table} as ${session.orgId ?? "nobody"}`);
        return { data: answer(), error: null };
      },
    }),
  },
}));

const { useModulesQuery } = await import("./useModules");

let mounted: VueWrapper | null = null;
function probe() {
  let result!: ReturnType<typeof useModulesQuery>;
  const C = defineComponent({ setup: () => { result = useModulesQuery(); return () => h("div"); } });
  // One client per test, as the app has one per page load.
  mounted = mount(C, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
  return () => result;
}

beforeEach(() => {
  mounted?.unmount();
  mounted = null;
  session.orgId = null;
  reads.length = 0;
  answer.mockReturnValue([{ module_key: "dispatch", enabled: true }]);
});

describe("the module set", () => {
  it("is not asked for at all while nobody is signed in — RLS would answer an empty set, not an error", async () => {
    const q = probe();
    await flushPromises();
    expect(reads).toEqual([]);
    expect(q().data.value).toBeUndefined();
  });

  it("is read once an org is known, and holds that org's modules", async () => {
    const q = probe();
    await flushPromises();
    session.orgId = "org-a";
    await flushPromises();
    expect(reads).toEqual(["org_modules as org-a"]);
    expect(q().data.value?.has("dispatch")).toBe(true);
  });

  it("asks again for a different org instead of serving the first one's answer", async () => {
    session.orgId = "org-a";
    const q = probe();
    await flushPromises();
    answer.mockReturnValue([]);
    session.orgId = "org-b";
    await flushPromises();
    expect(reads).toEqual(["org_modules as org-a", "org_modules as org-b"]);
    expect(q().data.value?.has("dispatch")).toBe(false);
  });
});
