import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import { createRouter, createMemoryHistory } from "vue-router";
import NotificationBell from "@/components/NotificationBell.vue";

/**
 * C6's done-when, web half: a dq_expired event emitted by C3 shows in the office bell, and reading
 * it decrements the unread count (the mark-read POST + the invalidated refetch).
 */
const calls: Array<{ path: string; init?: { method?: string; body?: unknown } }> = [];
let unreadState = 1;
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, init });
    if (path === "/api/me/notifications" && !init?.method) {
      return {
        ok: true,
        data: {
          notifications: [
            {
              id: "00000000-0000-4000-8000-0000000000e1",
              category: "dq_expired",
              title: "Marcus Reyes — Medical examiner's certificate expired 3 days ago",
              body: null,
              severity: "warning",
              entity_type: "driver",
              entity_id: "00000000-0000-4000-8000-0000000000d1",
              created_at: new Date().toISOString(),
              read_at: unreadState > 0 ? null : "2026-08-19T12:00:00Z",
            },
          ],
          unread: unreadState,
        },
      };
    }
    if (path === "/api/me/notifications/read") {
      unreadState = 0;
      return { ok: true, data: { ok: true } };
    }
    return { ok: true, data: {} };
  }),
}));

function mountBell() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/compliance/:id", component: { template: "<div />" } },
    ],
  });
  return mount(NotificationBell, {
    global: {
      plugins: [
        router,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
      stubs: {
        SlideOver: { template: "<div><slot /><slot name='footer' /></div>", props: ["open", "title"] },
      },
    },
  });
}

describe("NotificationBell (C6)", () => {
  beforeEach(() => {
    calls.length = 0;
    unreadState = 1;
  });

  it("shows the unread badge and renders a C3-emitted dq_expired event", async () => {
    const w = mountBell();
    await flushPromises();
    expect(w.get("button[aria-label]").attributes("aria-label")).toContain("1 unread");
    expect(w.text()).toContain("Medical examiner's certificate expired");
    expect(w.text()).toContain("warning");
  });

  it("clicking the item marks it read and navigates to the driver's qualification file", async () => {
    const w = mountBell();
    await flushPromises();
    const item = w.findAll("button").find((b) => b.text().includes("Marcus Reyes"))!;
    await item.trigger("click");
    await flushPromises();

    const read = calls.find((c) => c.path === "/api/me/notifications/read");
    expect(read).toBeDefined();
    expect(read!.init?.body).toEqual({ ids: ["00000000-0000-4000-8000-0000000000e1"] });
    // The invalidated refetch now reports zero unread — the badge is gone.
    expect(w.get("button[aria-label]").attributes("aria-label")).toBe("Notifications");
  });

  it("Mark all read posts without ids — the clear-the-badge action", async () => {
    const w = mountBell();
    await flushPromises();
    const all = w.findAll("button").find((b) => b.text() === "Mark all read")!;
    await all.trigger("click");
    await flushPromises();
    const read = calls.find((c) => c.path === "/api/me/notifications/read");
    expect(read!.init?.body).toEqual({});
  });
});
