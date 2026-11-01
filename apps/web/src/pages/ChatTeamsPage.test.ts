import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { isRecordId } from "@silvicom/shared";

/**
 * Settings → Chat teams (OFFICE-CHAT-PLAN CH5b, D-CHAT21) — the page's own decisions: every team is
 * listed, an archived one says so and offers no Archive; archiving asks first and archives nothing
 * when declined; and a new team carries its name, its people and two fresh ids — the team's and its
 * General channel's — so a retried create is the same team.
 */
const state = vi.hoisted(() => ({
  teams: [] as unknown[],
  create: vi.fn(),
  archive: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/features/chat/teams/useChatTeamsAdmin", async () => {
  const { ref } = await import("vue");
  return {
    useTeamDirectoryQuery: () => ({ data: ref(state.teams), isPending: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() }),
    useCreateTeam: () => ({ mutateAsync: state.create, isPending: ref(false) }),
    useArchiveTeam: () => ({ mutateAsync: state.archive, isPending: ref(false) }),
  };
});
vi.mock("@/features/chat/useChat", async () => {
  const { ref } = await import("vue");
  return {
    useChatPeopleQuery: () => ({
      data: ref([
        { user_id: "11111111-1111-4111-8111-111111111111", name: "Me", role: "admin", suspended: false },
        { user_id: "22222222-2222-4222-8222-222222222222", name: "Ben Dispatch", role: "dispatcher", suspended: false },
      ]),
    }),
  };
});
vi.mock("@silvicom/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@silvicom/ui")>()),
  useConfirm: () => state.confirm,
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ userId: "11111111-1111-4111-8111-111111111111" }) }));

import ChatTeamsPage from "./ChatTeamsPage.vue";

const LIVE = "55555555-5555-4555-8555-555555555555";
const OLD = "66666666-6666-4666-8666-666666666666";
const entry = (over: Record<string, unknown>) => ({
  space_id: LIVE, name: "Dispatch", description: "Loads and trucks", created_at: "2026-10-25T14:00:00Z", created_by_name: "Ana",
  archived_at: null, member_count: 4, channel_count: 2, owners: [{ user_id: "22222222-2222-4222-8222-222222222222", name: "Ben Dispatch" }],
  is_member: false, ...over,
});
const buttons = (w: VueWrapper, label: string) => w.findAll("button").filter((b) => b.text().trim() === label);

async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/settings/chat-teams", component: { template: "<div/>" }, meta: { title: "Chat teams" } }],
  });
  await router.push("/settings/chat-teams");
  await router.isReady();
  const w = mount(ChatTeamsPage, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  state.teams = [entry({}), entry({ space_id: OLD, name: "Old yard", archived_at: "2026-10-20T10:00:00Z" })];
  state.create.mockReset().mockResolvedValue({ space_id: LIVE });
  state.archive.mockReset().mockResolvedValue({ ok: true });
  state.confirm.mockReset().mockResolvedValue(true);
});

describe("the list", () => {
  it("lists every team with its owners and counts, and offers Archive only on a live one", async () => {
    const w = await render();
    expect(w.text()).toContain("Dispatch");
    expect(w.text()).toContain("Ben Dispatch");
    expect(w.text()).toContain("Old yard");
    expect(w.text()).toContain("Archived");
    expect(buttons(w, "Archive")).toHaveLength(1);
  });
});

describe("archiving", () => {
  it("asks first, then archives that team", async () => {
    const w = await render();
    await buttons(w, "Archive")[0]!.trigger("click");
    await flushPromises();
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Archive Dispatch?", confirmLabel: "Archive" }));
    expect(state.archive).toHaveBeenCalledWith(LIVE);
  });

  it("archives nothing when the question is declined", async () => {
    state.confirm.mockResolvedValue(false);
    const w = await render();
    await buttons(w, "Archive")[0]!.trigger("click");
    await flushPromises();
    expect(state.archive).not.toHaveBeenCalled();
  });
});

describe("making a team", () => {
  it("sends the name, the people picked and two fresh ids, and lists nobody twice", async () => {
    const w = await render();
    await buttons(w, "New team")[0]!.trigger("click");
    await flushPromises();
    const dialog = document.body;
    const name = dialog.querySelector<HTMLInputElement>('input[aria-label="Team name"]')!;
    name.value = "Night dispatch";
    name.dispatchEvent(new Event("input"));
    // The viewer is not offered: they are in the team already.
    expect(dialog.textContent).not.toContain("Me");
    const ben = [...dialog.querySelectorAll<HTMLButtonElement>("button[role=checkbox]")].find((b) => b.textContent?.includes("Ben Dispatch"))!;
    expect(ben.getAttribute("aria-checked")).toBe("false");
    ben.click();
    await flushPromises();
    // Picked: the row says so, and the person shows as a chip that removes them.
    expect(ben.getAttribute("aria-checked")).toBe("true");
    expect(dialog.querySelector('button[aria-label="Remove Ben Dispatch"]')).not.toBeNull();
    const make = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Make the team of 2")!;
    make.click();
    await flushPromises();
    expect(state.create).toHaveBeenCalledTimes(1);
    const req = state.create.mock.calls[0]![0] as { space_id: string; general_id: string; name: string; description: string | null; member_ids: string[] };
    expect(req).toMatchObject({ name: "Night dispatch", description: null, member_ids: ["22222222-2222-4222-8222-222222222222"] });
    expect(isRecordId(req.space_id) && isRecordId(req.general_id) && req.space_id !== req.general_id).toBe(true);
  });
});
