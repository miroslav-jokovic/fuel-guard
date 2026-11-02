import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import OrientationVideosPanel from "@/features/recruitment/OrientationVideosPanel.vue";

/**
 * The orientation videos step's drawer (HW8a, 0539): what the applicant did with each video in honest
 * words ("Opened", "Said they watched it" — never "watched" as a measured fact), the empty state that
 * points at Settings → Recruiting, and "Send the videos" asserted by the request it makes.
 */
const state = vi.hoisted(() => ({
  view: null as unknown,
  requests: [] as Array<{ url: string; method: string }>,
  canManage: true,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method });
      return { ok: true, data: { sentAt: "2026-10-31T15:00:00Z", email: { sent: true, email: "ana@x.test", reason: null }, text: { state: "held", reason: "no_consent" } } };
    }
    return { ok: true, data: state.view };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.canManage }) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPanel = () => mount(OrientationVideosPanel, { props: { driverId: "d1" }, global: { plugins: [VueQueryPlugin], stubs: { RouterLink: true } } });

const VIEW = {
  videos: [
    { id: "v1", title: "Pre-trip", url: "https://v.example/1", minutes: 10, required: true, openedAt: "2026-10-20T11:00:00Z", attestedAt: "2026-10-21T10:00:00Z" },
    { id: "v2", title: "Using the ELD", url: "https://v.example/2", minutes: null, required: false, openedAt: "2026-10-20T12:00:00Z", attestedAt: null },
    { id: "v3", title: "Coupling", url: "https://v.example/3", minutes: 5, required: true, openedAt: null, attestedAt: null },
  ],
  sentAt: "2026-10-20T10:00:00Z",
  lastAttestation: { signerName: "Ana Plicant", attestedAt: "2026-10-21T10:00:00Z" },
  canSend: true,
};

beforeEach(() => {
  setActivePinia(createPinia());
  state.view = VIEW;
  state.requests = [];
  state.canManage = true;
});

describe("OrientationVideosPanel", () => {
  it("says what the applicant did with each video, in words a link list can stand behind", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.get('[data-testid="video-status-v1"]').text()).toBe("Said they watched it · 10/21/2026");
    expect(w.get('[data-testid="video-status-v2"]').text()).toBe("Opened 10/20/2026 · not ticked yet");
    expect(w.get('[data-testid="video-status-v3"]').text()).toBe("Not opened");
    expect(w.text()).not.toMatch(/\bWatched\b/);
    expect(w.get('[data-testid="last-attestation"]').text()).toContain("Ana Plicant ticked “I watched these”");
    expect(w.get('[data-testid="sent-at"]').text()).toContain("Last sent");
  });

  it("sends the videos with one press, to the applicant's own route", async () => {
    const w = mountPanel();
    await settle(w);
    expect(w.get('[data-testid="send-videos"]').text()).toBe("Send the videos again");
    await w.get('[data-testid="send-videos"]').trigger("click");
    await settle(w);
    expect(state.requests).toEqual([{ url: "/api/recruitment/applicants/d1/orientation-videos/send", method: "POST" }]);
  });

  it("says to send the invitation first when there is no live link, and offers no send", async () => {
    state.view = { ...VIEW, canSend: false };
    const w = mountPanel();
    await settle(w);
    expect(w.get('[data-testid="cannot-send"]').text()).toContain("Send the invitation first");
    expect(w.find('[data-testid="send-videos"]').exists()).toBe(false);
  });

  it("offers a viewer no send", async () => {
    state.canManage = false;
    const w = mountPanel();
    await settle(w);
    expect(w.find('[data-testid="send-videos"]').exists()).toBe(false);
  });

  it("with no videos on the list, says to add them in Settings → Recruiting", async () => {
    state.view = { ...VIEW, videos: [], sentAt: null, lastAttestation: null };
    const w = mountPanel();
    await settle(w);
    expect(w.get('[data-testid="no-videos"]').text()).toContain("Add your videos in Settings → Recruiting");
    expect(w.find('[data-testid="send-videos"]').exists()).toBe(false);
  });
});
