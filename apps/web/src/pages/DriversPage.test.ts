import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";
import type { Driver, Vehicle } from "@silvicom/shared";
import DriversPage from "@/pages/DriversPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ColumnPicker from "@/components/ui/ColumnPicker.vue";
import SavedViewMenu from "@/components/ui/SavedViewMenu.vue";
import FileGallery from "@/components/files/FileGallery.vue";

/**
 * R2's safety net (DRIVER-ROSTER-PLAN.md §5): the roster table moves out of `DriversPage.vue` into
 * `features/roster/DriverRosterTable.vue` so R4 has room for four more columns. The extraction is
 * meant to be invisible, and "invisible" is only a claim unless the rendered markup is compared —
 * so this snapshot was taken BEFORE the move and must survive it byte for byte.
 *
 * The fixture is deliberately awkward: one driver with everything set, one with almost nothing, one
 * archived. That covers each cell's null branch, the "Due 12d" rollup override, and the app-access
 * badge with and without a username.
 *
 * The row menu is teleported to `document.body`, so it is outside the table snapshot and pinned
 * separately — it is where the Archive/Restore branch lives, and that branch only appears in the
 * archived view.
 */

const drivers = ref<Driver[]>([]);
const vehicles = ref<Vehicle[]>([]);
const overview = ref<unknown>(null);

const driversQuery = {
  data: drivers,
  isLoading: ref(false),
  isError: ref(false),
  error: ref(null),
  refetch: vi.fn(),
  isFetching: ref(false),
};
const idleMutation = () => ({ isPending: ref(false), mutateAsync: vi.fn() });

/**
 * The AUDITED edit path (R6a). Its resolved answer is what the page turns into a sentence, so the
 * mock returns the whole response rather than just the row — returning only the row is exactly how
 * the two flags stayed invisible in the real composable.
 */
/** Create goes through `POST /api/roster/drivers` since R6a, so the row is born `manual`. */
const createDriver = { isPending: ref(false), mutateAsync: vi.fn(async () => ({})) };

const updateProfile = {
  isPending: ref(false),
  mutateAsync: vi.fn(async () => ({
    driver: {},
    claimedFromTelematics: false,
    stampedTerminationDate: false,
  })),
};

vi.mock("@/composables/useDrivers", () => ({
  useDriversQuery: () => driversQuery,
  useCreateDriver: () => createDriver,
  useUpdateDriverProfile: () => updateProfile,
  useArchiveDriver: () => idleMutation(),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: vehicles }) }));
vi.mock("@/composables/useCompliance", () => ({
  useComplianceOverviewQuery: () => ({ data: overview }),
  // UF4b: the gallery fetches a driver's papers only when it opens, so the roster's own load is
  // unchanged. Stubbed empty — what this file pins is the cell and which driver's gallery opens, not
  // the papers inside it.
  useDocumentsQuery: () => ({ data: ref([]), isLoading: ref(false), isError: ref(false) }),
}));
vi.mock("@/features/roster/useDriverReconcile", () => ({
  useDriverReconcile: () => ({
    preview: vi.fn(),
    apply: vi.fn(),
    linkOne: vi.fn(),
    report: ref(null),
    loading: ref(false),
    applying: ref(false),
    error: ref(null),
  }),
}));
// The real shape (SP5): the roster's qualification links ask the guard's function, which reads the
// role and the screen answers, so an answer-everything stub can no longer say whether one shows.
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
// PageHeader builds a breadcrumb from the live route; it is page chrome, not the table under test.
vi.mock("@/components/ui/PageHeader.vue", () => ({
  default: {
    props: ["description"],
    template: `<header><slot name="actions" /></header>`,
  },
}));
const savedViews = vi.hoisted(() => ({
  views: [] as { table_id: string; name: string; query: string; updated_at: string }[],
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/composables/useSavedViews", () => ({
  useSavedViews: () => ({
    views: { value: savedViews.views },
    loading: { value: false },
    saving: { value: false },
    save: savedViews.save,
    remove: savedViews.remove,
  }),
}));
vi.mock("@/stores/toast", () => ({
  useToastStore: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const base = (over: Partial<Driver>): Driver => ({
  id: "d-0",
  org_id: "org-1",
  user_id: null,
  full_name: "Unnamed",
  employee_id: null,
  phone: null,
  status: "active",
  samsara_driver_id: null,
  samsara_username: null,
  current_hos_status: null,
  current_hos_vehicle: null,
  current_hos_at: null,
  current_location: null,
  app_username: null,
  app_access_enabled: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  archived_at: null,
  ...over,
});

const RouterLinkStub = {
  props: ["to"],
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
};

beforeEach(() => {
  // hosAgo() renders "as of Nh ago" from Date.now(); a real clock would make the snapshot rot daily.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
  // jsdom's matchMedia always answers false, which would snapshot DataTable's narrow card layout
  // instead of the table this step is about.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));

  drivers.value = [
    base({
      id: "d-1",
      full_name: "Marcus Reyes",
      employee_id: "D-104",
      phone: "5558675309",
      samsara_username: "marcus",
      samsara_driver_id: "sam-1",
      current_hos_status: "driving",
      current_hos_vehicle: "T-118",
      current_hos_at: "2026-08-30T09:30:00Z",
      current_location: "Joliet, IL",
      app_username: "mreyes",
      app_access_enabled: true,
      user_id: "u-1",
    }),
    base({ id: "d-2", full_name: "Ana Whitfield", status: "inactive" }),
    base({
      id: "d-3",
      full_name: "Gone Away",
      status: "terminated",
      archived_at: "2026-07-01T00:00:00Z",
    }),
  ];
  vehicles.value = [
    { id: "v-1", unit_number: "T-118", assigned_driver_id: "d-1" } as unknown as Vehicle,
    { id: "v-2", unit_number: "T-902", assigned_driver_id: "d-1" } as unknown as Vehicle,
  ];
  /**
   * `requirements` covers every branch the three R4 expiry columns have, because a column that only
   * ever renders one state is a column nobody has really looked at:
   *   current  → plain text, because a tint on every row of three columns means nothing
   *   expiring → tinted
   *   missing  → "Missing", tinted: it blocks dispatch today
   *   ABSENT   → "—", the requirement is not asked of this driver (hazmat without the module)
   */
  overview.value = {
    drivers: [
      // Inside 30 days with nothing expired → the "Due 12d" override, not the plain state word.
      {
        driver_id: "d-1",
        state: "incomplete",
        counts: { expired: 0, expiring: 1, missing: 1, current: 3 },
        attention: [{ daysRemaining: 12 }],
        documents: { onFile: 8, of: 17 },
        requirements: [
          { key: "cdl", state: "current", goodUntil: "2030-01-01", daysRemaining: 1220, expiryUnknown: false, documentId: "cdl-1" },
          { key: "medical_card", state: "expiring", goodUntil: "2026-09-11", daysRemaining: 12, expiryUnknown: false, documentId: null },
          { key: "endorsement_hazmat", state: "missing", goodUntil: null, daysRemaining: null, expiryUnknown: false, documentId: null },
        ],
        // UF4b: two of five papers drawn (one thumbnail derived, one not yet), "+3" for the rest.
        papers: [
          { documentId: "cdl-1", kind: "cdl", contentType: "application/pdf", thumbUrl: "https://signed.test/cdl-1.webp", filedAt: "2026-03-01T00:00:00Z" },
          { documentId: "mvr-1", kind: "mvr", contentType: "image/jpeg", thumbUrl: null, filedAt: "2026-02-01T00:00:00Z" },
        ],
        paper_count: 5,
      },
      {
        driver_id: "d-2",
        state: "complete",
        counts: { expired: 1, expiring: 0, missing: 0, current: 4 },
        attention: [{ daysRemaining: -241 }],
        documents: { onFile: 0, of: 14 },
        // No hazmat entry at all: this carrier does not ask it of this driver, so the cell reads "—".
        requirements: [
          { key: "cdl", state: "expired", goodUntil: "2026-01-01", daysRemaining: -241, expiryUnknown: false, documentId: null },
          { key: "medical_card", state: "current", goodUntil: "2027-06-30", daysRemaining: 304, expiryUnknown: false, documentId: null },
        ],
        papers: [],
        paper_count: 0,
      },
      // d-3 is absent on purpose: rows the rollup does not return read as "—".
    ],
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * A real router, because the column picker holds its choice in the URL (R3b) — but `RouterLink` stays
 * STUBBED, so the rendered markup the snapshots pin is the same anchor it always was. The page needs
 * `useRoute`/`useRouter` to work; it does not need real navigation to render a table.
 */
const mountPage = async (at = "/drivers") => {
  const router = createRouter({
    history: createMemoryHistory(),
    // The two pages the roster's cells link to are here because every link asks the router whether
    // its page opens (SP5) — a route this harness did not declare would read as "nowhere to go".
    routes: ["/drivers", "/drivers/:id", "/compliance/:id"].map((path) => ({ path, component: { template: "<div/>" } })),
  });
  // Awaited: an unresolved route has no match, and the column picker's first `replace` throws on one.
  await router.push(at);
  await router.isReady();
  return mount(DriversPage, {
    global: {
      plugins: [VueQueryPlugin, router],
      stubs: {
        RouterLink: RouterLinkStub,
        // HeadlessUI's `Dialog` throws under this repo's jsdom, as `DocumentPreview.test.ts`
        // records. Stubbed with `v-if` on `open`, which is the only part of it this file asserts
        // on; the modals' own behaviour is tested where they live.
        BaseModal: {
          props: ["open", "title", "description", "size", "printable"],
          template: `<div v-if="open" role="dialog"><slot /><slot name="footer" /></div>`,
        },
      },
    },
  });
};

/**
 * The "Show" filter is the second FilterSelect on the bar. Driven through its model rather than by
 * clicking the popover open: this file is pinning the TABLE, and a filter's internals changing
 * should not be able to fail an extraction test that has nothing to do with them.
 */
const showArchived = async (w: Awaited<ReturnType<typeof mountPage>>) => {
  const filters = w.findAllComponents(FilterSelect);
  await filters[1]!.vm.$emit("update:modelValue", "archived");
  await w.vm.$nextTick();
};

describe("DriversPage roster table", () => {
  it("renders the roster table unchanged by the R2 extraction", async () => {
    const table = (await mountPage()).find("table");
    expect(table.exists()).toBe(true);
    expect(table.html()).toMatchSnapshot();
  });

  /**
   * SP5 (plan §4b): the qualification file (`/compliance/:id`) is a screen the admin can switch off
   * for one person apart from the roster. Since UF4b the row's only door to it is the menu's "Open
   * qualification file…", and that is what the guard gates; the cell has no link to lose.
   */
  it("drops the row menu's door to the qualification file where it does not open (SP5)", async () => {
    const { __session: session } = (await import("@/stores/session")) as unknown as {
      __session: import("@/testing/fakeSession").FakeSession;
    };
    const open = async () => {
      const w = await mountPage();
      await w.find("td[class*=pl-2] button").trigger("click");
      const text = document.body.textContent ?? "";
      // The menu is teleported to `document.body`; unmounting takes it with it, so the second
      // mount's menu is read on its own.
      w.unmount();
      return text;
    };
    expect(await open()).toContain("Open qualification file…");
    session.surfaces = { "safety.driver-qualification": false };
    try {
      expect(await open()).not.toContain("Open qualification file…");
    } finally {
      session.surfaces = null;
    }
  });

  it("renders the archived view unchanged by the R2 extraction", async () => {
    const w = await mountPage();
    await showArchived(w);
    expect(w.find("table").html()).toMatchSnapshot();
  });

  /**
   * R3b end to end: the picker lives in the toolbar and the table is a different component, so the
   * two only agree through `useTableColumns`. Hiding a column has to reach the header, the cells,
   * and the URL — a picker that ticks a box and changes nothing is the failure mode worth pinning.
   */
  /**
   * R4, D-ROS9. The dates and the qualification badge beside them come from ONE rollup, so they
   * cannot disagree. What is pinned here is the rendering rule the vocabulary decided: a date that
   * is simply fine is plain text, because tinting all three columns on every row would make the tint
   * mean nothing — and only the dates that need a phone call carry a tone.
   */
  it("renders a fine expiry as plain text and an urgent one as a tinted badge", async () => {
    const w = await mountPage();
    const cells = w.findAll("tbody tr")[0]!.findAll("td");
    // Exact text, not `includes`: the File cell's hover cards carry the same dates ("Good until
    // 01/01/2030"), and that cell comes first in the row.
    const cdl = cells.find((c) => c.text().trim() === "01/01/2030")!;
    const medical = cells.find((c) => c.text().trim() === "09/11/2026")!;

    // `rounded-detail` is BADGE_BASE — its presence is what "this is a pill" means. Asserting on the
    // TONE instead would pass for a neutral pill too, which is the version of this test that did not
    // discriminate.
    expect(cdl.html()).not.toContain("rounded-detail");
    expect(cdl.html()).toContain("tabular-nums");
    expect(medical.html()).toContain("rounded-detail");
    expect(medical.html()).toContain("bg-warning-50");
  });

  it("says Missing where a requirement is absent, and — where it is not asked at all", async () => {
    const w = await mountPage();
    const rows = w.findAll("tbody tr");
    // d-1 has no hazmat endorsement on file: that blocks dispatch, so it is stated.
    expect(rows[0]!.text()).toContain("Missing");
    // d-2's carrier does not ask hazmat of them at all — an accusation would be wrong.
    expect(rows[1]!.text()).not.toContain("Missing");
  });

  it("links an expiry to the driver's qualification section rather than editing in place", async () => {
    // D-ROS1: the grid reads and navigates. D-ROS5: `?section=` is the public surface. A requirement
    // is recorded inside its file, never from a grid cell, so the link is the sanctioned path.
    const w = await mountPage();
    const link = w.findAll("tbody tr")[0]!.findAll("a").find((a) => a.text().includes("09/11/2026"))!;
    expect(link.attributes("href")).toBe("/drivers/d-1?section=qualification");
  });

  /**
   * R4b. The roster filters on the SAME rollup its expiry columns read, using the SAME predicate the
   * compliance fleet table uses — so "has expired items" here and there cannot mean two things.
   */
  it("filters the roster by qualification state from the URL", async () => {
    // d-2's CDL is expired; d-1's worst item is a medical expiring in 12 days.
    const w = await mountPage("/drivers?file=expired");
    const table = w.find("table").text();
    expect(table).toContain("Ana Whitfield");
    expect(table).not.toContain("Marcus Reyes");
  });

  it("still narrows by an old ?dq= link, and shows ONE file control beside Due (Q-UF9)", async () => {
    const w = await mountPage("/drivers?dq=expired");
    expect(w.find("table").text()).not.toContain("Marcus Reyes");
    const labels = w.findAllComponents({ name: "FilterSelect" }).map((c) => c.props("label"));
    expect(labels).not.toContain("File status");
    expect(labels).toEqual(expect.arrayContaining(["File", "Due"]));
  });

  it("narrows to ONE requirement when a built-in view asks for it", async () => {
    // "Medical expiring in 30 days" must not list a driver whose CDL is the thing expiring.
    const medical = await mountPage("/drivers?req=medical_card&due=30");
    expect(medical.find("table").text()).toContain("Marcus Reyes");
    expect(medical.find("table").text()).not.toContain("Ana Whitfield");
  });

  it("offers the standard views before the reader has saved anything", async () => {
    savedViews.views = [];
    const w = await mountPage();
    const menu = w.findComponent(SavedViewMenu);
    const builtIns = menu.props("builtIns") as readonly { name: string; query: string }[];
    expect(builtIns.length).toBeGreaterThan(0);
    expect(builtIns.map((v) => v.name)).toContain("Medical expiring in 30 days");
  });

  it("names the built-in view it is currently showing", async () => {
    const w = await mountPage("/drivers?req=medical_card&due=30&sort=full_name");
    expect(w.findComponent(SavedViewMenu).props("activeName")).toBe("Medical expiring in 30 days");
  });

  /**
   * UNIT-FILES-PLAN UF4b, D-UF7: ONE File cell summarises the file — the chip, the newest scans, "+N"
   * — where the roster carried a qualification badge AND a scans-filed count until 2026-10-20. Off
   * the same rollup, no per-row fetch; the thumbs open ONE gallery owned by the page, never a dialog
   * per row.
   */
  it("has exactly one file column, and it says the worst state first (D-UF7)", async () => {
    const w = await mountPage();
    const headers = w.findAll("thead th").map((th) => th.text().trim());
    expect(headers.filter((h) => h === "File")).toHaveLength(1);
    expect(headers).not.toContain("Qualification");
    const rows = w.findAll("tbody tr");
    // d-1: one missing, one expiring — "missing" outranks "expiring"; d-2: one expired outranks all.
    expect(rows[0]!.find("[data-test=file-chip]").text()).toBe("1 missing");
    expect(rows[1]!.find("[data-test=file-chip]").text()).toBe("1 expired");
    // Two thumbs drawn, three more counted — and nothing of the old "8/17" count.
    expect(rows[0]!.findAll("[data-test=file-thumb]")).toHaveLength(2);
    expect(rows[0]!.find("[data-test=file-more]").text()).toBe("+3");
    expect(rows[0]!.text()).not.toContain("8/17");
    expect(rows[1]!.findAll("[data-test=file-thumb]")).toHaveLength(0);
  });

  it("narrows the roster to the chip's state when the chip is clicked, and the rows match it", async () => {
    const w = await mountPage();
    await w.findAll("tbody tr")[1]!.find("[data-test=file-chip]").trigger("click");
    await flushPromises();
    expect(w.vm.$route.query.file).toBe("expired");
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text()).toContain("Ana Whitfield");
    // The File control shows the same choice, so the reader can see what narrowed the list and undo it.
    expect(w.findAllComponents(FilterSelect).find((f) => f.props("label") === "File")!.props("modelValue")).toBe("expired");
  });

  it("opens the gallery on the paper that was clicked, for that driver, and only one", async () => {
    const w = await mountPage();
    // The thumb itself, not the hover card's Download button beside it.
    const thumbs = w.findAll("tbody tr")[0]!.findAll("[data-test=file-thumb] > button");
    await thumbs[1]!.trigger("click");
    await flushPromises();

    const gallery = w.findComponent(FileGallery);
    expect(gallery.props("subject")).toEqual({ type: "driver", id: "d-1" });
    expect(gallery.props("subjectLabel")).toBe("Marcus Reyes");
    expect(gallery.props("startId")).toBe("mvr-1");
    expect(w.findAllComponents(FileGallery)).toHaveLength(1);
  });

  it("hides a column from the table when the picker turns it off", async () => {
    const w = await mountPage();
    expect(w.find("table").text()).toContain("Phone");

    const picker = w.findComponent(ColumnPicker);
    picker.vm.columns.toggle("phone");
    await flushPromises();

    expect(w.find("table").text()).not.toContain("Phone");
    expect(w.find("table").text()).not.toContain("(555) 867-5309");
    // …and it is in the URL, which is what lets a saved view carry it in R3c (D-ROS14).
    expect(w.vm.$route.query.hide).toBe("phone");
  });

  it("keeps the name column whatever the picker is asked to do", async () => {
    const w = await mountPage();
    const picker = w.findComponent(ColumnPicker);
    picker.vm.columns.toggle("full_name");
    await flushPromises();
    expect(w.find("table").text()).toContain("Marcus Reyes");
  });

  /**
   * R3c: the filters live in the URL, so the page has to be arrivable in a narrowed state — that is
   * the whole mechanism a saved view is built on, and the only way to check it is to arrive.
   */
  it("opens already filtered when the link says so", async () => {
    const w = await mountPage("/drivers?status=inactive");
    const table = w.find("table").text();
    expect(table).toContain("Ana Whitfield");
    expect(table).not.toContain("Marcus Reyes");
  });

  it("opens on the drivers holding no truck when the Seats card's door says so", async () => {
    // FLEET-MANAGER-HOME-PLAN D-FM7: the same `seatedDriverIds` the card counts with. d-1 holds two
    // trucks; d-2 holds none.
    const w = await mountPage("/drivers?seat=none");
    const table = w.find("table").text();
    expect(table).toContain("Ana Whitfield");
    expect(table).not.toContain("Marcus Reyes");
  });

  it("opens on the archived roster when the link says so", async () => {
    const w = await mountPage("/drivers?show=archived");
    expect(w.find("table").text()).toContain("Gone Away");
  });

  it("shows Clear filters only on a narrowed roster, and it puts everyone back", async () => {
    const plain = await mountPage();
    expect(plain.text()).not.toContain("Clear filters");

    const w = await mountPage("/drivers?status=inactive");
    expect(w.text()).toContain("Clear filters");
    const clear = w.findAll("button").find((b) => b.text() === "Clear filters")!;
    await clear.trigger("click");
    await flushPromises();

    expect(w.find("table").text()).toContain("Marcus Reyes");
    expect(w.vm.$route.query).toEqual({});
  });

  /**
   * R3c-2, and the whole point of D-ROS14: applying a view is a NAVIGATION. If this ever became "set
   * the filters from the view", a saved view and the link that produced it would be two mechanisms
   * that agree until they do not.
   */
  it("applies a saved view by navigating to its query", async () => {
    savedViews.views = [
      { table_id: "roster.drivers", name: "Terminated", query: "status=terminated", updated_at: "2026-08-30T00:00:00Z" },
    ];
    const w = await mountPage();
    const menu = w.findComponent(SavedViewMenu);
    menu.vm.$emit("apply", "status=terminated");
    await flushPromises();

    // The URL afterwards IS the view — identical to the link a colleague would have been sent.
    expect(w.vm.$route.query).toEqual({ status: "terminated" });
  });

  it("saves the whole current URL, not just the filters it knows about", async () => {
    savedViews.views = [];
    // `hide` belongs to the column picker, `status` to the filters. A view carries both, because a
    // view is the URL rather than a list of things somebody remembered to include.
    const w = await mountPage("/drivers?status=inactive&hide=phone");
    w.findComponent(SavedViewMenu).vm.$emit("save", "My view");
    await flushPromises();

    expect(savedViews.save).toHaveBeenCalledWith("My view", "status=inactive&hide=phone");
  });

  it("names the view it is currently showing, so saving again updates it", async () => {
    savedViews.views = [
      { table_id: "roster.drivers", name: "Terminated", query: "status=terminated", updated_at: "2026-08-30T00:00:00Z" },
    ];
    const w = await mountPage("/drivers?status=terminated");
    expect(w.findComponent(SavedViewMenu).props("activeName")).toBe("Terminated");

    const plain = await mountPage();
    expect(plain.findComponent(SavedViewMenu).props("activeName")).toBeNull();
  });

  it("offers Archive on a live row and Restore on an archived one", async () => {
    const w = await mountPage();
    await w.find("td[class*=pl-2] button").trigger("click");
    expect(document.body.textContent).toContain("Archive…");
    expect(document.body.textContent).not.toContain("Restore to the roster");

    const archived = await mountPage();
    await showArchived(archived);
    await archived.find("td[class*=pl-2] button").trigger("click");
    expect(document.body.textContent).toContain("Restore to the roster");
  });
});
