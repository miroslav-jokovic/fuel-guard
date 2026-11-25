import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { TrainingAssignmentRow, TrainingCourseSummary, TrainingSendOutcome, TrainingVersionSummary } from "@silvicom/shared";
import TrainingPage from "./TrainingPage.vue";

/**
 * Safety › Training (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8–§9), mounted with its data stubbed:
 *   · Videos lists each course's films with the state of the version being worked on.
 *   · A film's drawer says what still blocks publishing, and publishes only when nothing does.
 *   · Send shows the office a link to copy ONLY for the driver it must reach itself (D-TR11).
 *   · Progress reads a past due date as late, and a viewer without `safety: manage` gets no act.
 * `useMediaQuery` is stubbed so DataTable renders a table, not cards.
 */
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

const v = (o: Partial<TrainingVersionSummary>): TrainingVersionSummary => ({
  id: "v1", versionNo: 1, language: "en", state: "ready", durationMs: 204_000, chapters: [{ title: "The rule", startMs: 0 }, { title: "Turns", startMs: 69_000 }],
  serveCount: 5, passCount: 4, questionCount: 5, processError: null, posterUrl: null, publishedAt: null, ...o,
});
const COURSES: TrainingCourseSummary[] = [{
  id: "c1", title: "Defensive driving, Act I", description: null, position: 0, retiredAt: null,
  lessons: [
    { id: "l1", title: "Following distance", position: 0, retiredAt: null, versions: [v({ id: "v1", state: "published" })] },
    { id: "l2", title: "Eyes up", position: 1, retiredAt: null, versions: [v({ id: "v2", state: "ready", questionCount: 3 })] },
  ],
}];

const state = vi.hoisted(() => ({
  manage: true,
  courses: [] as unknown[],
  assignments: [] as unknown[],
  published: [] as string[],
  sendReturns: [] as unknown[],
  sentBodies: [] as unknown[],
}));
vi.mock("@/features/training/useTraining", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const q = (data: unknown) => ({ data: ref(data), isLoading: ref(false), isFetching: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn() });
  const m = (fn: (a: unknown) => unknown = () => undefined) => ({ isPending: ref(false), mutateAsync: async (a: unknown) => fn(a) });
  return {
    ...actual,
    useTrainingCatalogue: () => q(state.courses),
    useTrainingAssignments: () => q(state.assignments),
    useTrainingReach: () => q({ d1: { sms: false, smsReason: "Texting hired drivers is not set up yet.", email: null }, d2: { sms: false, smsReason: null, email: "ana@example.test" } }),
    useTrainingQuestions: () => q([]),
    useTrainingPreview: () => q(null),
    useCreateCourse: () => m(),
    useCreateLesson: () => m(() => ({ id: "new" })),
    useUpdateVersion: () => m(),
    usePublishVersion: () => m((id) => void state.published.push(id as string)),
    useWithdrawVersion: () => m(),
    useDeleteQuestion: () => m(),
    useSaveQuestion: () => m(),
    useUploadFilm: () => m(),
    useSendTraining: () => m((b) => (state.sentBodies.push(b), state.sendReturns)),
    useResendTraining: () => m(),
    useCancelTraining: () => m(),
  };
});
vi.mock("@/composables/useDrivers", () => ({
  useDriversQuery: () => ({
    data: ref([
      { id: "d1", full_name: "Marko Petrovic", phone: "+13125550141", employee_id: "811", archived_at: null },
      { id: "d2", full_name: "Ana Morales", phone: null, employee_id: "812", archived_at: null },
      { id: "d3", full_name: "Old Driver", phone: null, employee_id: "1", archived_at: "2026-01-01" },
    ]),
    isLoading: ref(false), isFetching: ref(false), isError: ref(false), refetch: vi.fn(),
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: (s: string) => s === "safety" && state.manage, canView: () => true }) }));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago") }) }));
vi.mock("@silvicom/ui", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useConfirm: () => async () => true };
});

async function mountPage(url = "/training") {
  state.courses = COURSES;
  state.published.length = 0;
  state.sentBodies.length = 0;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/training", component: TrainingPage }] });
  await router.push(url);
  await router.isReady();
  setActivePinia(createPinia());
  const w = mount(TrainingPage, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { w, router };
}
const body = () => document.body;

describe("TrainingPage › Videos", () => {
  it("lists each course's films, numbered, with where the version being worked on stands", async () => {
    const { w } = await mountPage();
    const rows = w.findAll("tbody tr").map((r) => r.text());
    expect(rows[0]).toContain("1. Following distance");
    expect(rows[0]).toContain("3:24");
    expect(rows[0]).toContain("Published");
    expect(rows[1]).toContain("2. Eyes up");
    expect(rows[1]).toContain("Ready to publish");
    w.unmount();
  });

  it("names what blocks publishing a film, and keeps the button off until nothing does", async () => {
    const { w } = await mountPage("/training?film=l2");
    const blockers = body().querySelector('[data-test="publish-blockers"]');
    expect(blockers?.textContent).toContain("Write at least 5 questions: 3 so far.");
    expect((body().querySelector('[data-test="film-publish"]') as HTMLButtonElement).disabled).toBe(true);
    w.unmount();

    state.courses = [{ ...COURSES[0]!, lessons: [{ ...COURSES[0]!.lessons[1]!, versions: [v({ id: "v2", state: "ready", questionCount: 6 })] }] }];
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/training", component: TrainingPage }] });
    await router.push("/training?film=l2");
    const w2 = mount(TrainingPage, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    (body().querySelector('[data-test="film-publish"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(state.published).toEqual(["v2"]);
    w2.unmount();
  });
});

describe("TrainingPage › Send to drivers", () => {
  it("leaves archived drivers off, and hands the office a link only for the driver it must reach itself", async () => {
    const out: TrainingSendOutcome[] = [
      { driverId: "d1", assignmentId: "a1", via: "copy", ok: true, detail: null, link: "https://360.example.test/t/aaaaaaaaaaaaaaaaaaaaaaaa" },
      { driverId: "d2", assignmentId: "a2", via: "email", ok: true, detail: null, link: null },
    ];
    state.sendReturns = out;
    const { w } = await mountPage("/training?view=send");
    expect(w.text()).not.toContain("Old Driver");
    expect(w.find('[data-test="send-texting-note"]').text()).toContain("Texting company drivers is not switched on yet");

    for (const box of w.findAll('tbody input[type="checkbox"]')) await box.setValue(true);
    await flushPromises();
    expect(w.find('[data-test="send-summary"]').text()).toBe("2 drivers picked.");
    const cells = w.findAll("tbody tr").map((r) => r.text());
    expect(cells[0]).toContain("You send the link");
    expect(cells[1]).toContain("Email");

    await w.find('[data-test="send-go"]').trigger("click");
    await flushPromises();
    expect(state.sentBodies[0]).toMatchObject({ driverIds: ["d1", "d2"], courseId: "c1", lessonIds: null });
    expect(w.find('[data-test="send-copy-d1"]').exists()).toBe(true);
    expect(w.find('[data-test="send-copy-d2"]').exists()).toBe(false);
    w.unmount();
  });
});

describe("TrainingPage › Progress", () => {
  const a = (o: Partial<TrainingAssignmentRow>): TrainingAssignmentRow => ({
    id: "a1", driverId: "d1", driverName: "Marko Petrovic", courseId: "c1", courseTitle: "Act I", sentAt: "2026-11-20T15:00:00Z", lastSentVia: "copy",
    dueOn: null, firstOpenedAt: null, completedAt: null, revokedAt: null,
    lessons: [{ lessonId: "l1", title: "Following distance", status: "rewatch", watchedMs: 0, durationMs: 1, best: { correct: 3, total: 5 }, attempts: 1 }], ...o,
  });

  it("marks a past due date late, shows each film's best score, and gives a viewer no acts", async () => {
    state.assignments = [a({ dueOn: "2000-01-01" })];
    state.manage = false;
    const { w } = await mountPage("/training?view=progress");
    const row = w.find("tbody tr").text();
    expect(row).toContain("Overdue");
    expect(row).toContain("Watching again · 3/5");
    expect(w.findComponent({ name: "KebabMenu" }).exists()).toBe(false);
    state.manage = true;
    w.unmount();
  });
});
