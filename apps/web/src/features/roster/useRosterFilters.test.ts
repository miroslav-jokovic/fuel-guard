import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { useRosterFilters, type RosterFilters } from "./useRosterFilters";

/**
 * The roster's filters, in the URL (R3c, D-ROS14).
 *
 * Two groups of rules here, and they fail in opposite directions.
 *
 * The first is about LINKS: a URL only states what somebody chose, so a default never appears in it.
 * Without that, `/drivers?show=live&page=1&dir=asc` is the same view as `/drivers` while looking
 * like a narrowed one.
 *
 * The second is about a URL being something a person can type into. `?page=-4`, `?dir=sideways` and
 * `?show=banana` all reach this module from a forwarded link, a truncated copy-paste or a hand edit,
 * and each has to mean something sensible rather than produce an empty roster — which reads exactly
 * like a carrier with no drivers.
 */
async function mountFilters(initial = "/drivers"): Promise<{ f: RosterFilters; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/drivers", component: { template: "<div/>" } }],
  });
  let f!: RosterFilters;
  const C = defineComponent({
    setup() {
      f = useRosterFilters();
      return () => h("div");
    },
  });
  await router.push(initial);
  await router.isReady();
  mount(C, { global: { plugins: [router] } });
  return { f, router };
}

const settle = () => flushPromises();

describe("useRosterFilters", () => {
  it("opens on the live roster, unsorted, page one, with a clean URL", async () => {
    const { f, router } = await mountFilters();
    expect(f.view.value).toBe("live");
    expect(f.showArchived.value).toBe(false);
    expect(f.sort.value).toEqual({ key: null, dir: "asc" });
    expect(f.page.value).toBe(1);
    expect(f.active.value).toBe(false);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("puts a search term in the URL, so the view can be sent to somebody", async () => {
    const { f, router } = await mountFilters();
    f.search.value = "reyes";
    await settle();
    expect(router.currentRoute.value.query.q).toBe("reyes");
  });

  it("writes nothing for a value that is back to its default", async () => {
    const { f, router } = await mountFilters("/drivers?q=reyes&status=active");
    f.search.value = "";
    await settle();
    expect(router.currentRoute.value.query.q).toBeUndefined();
    // …and it does not take the other filter with it.
    expect(router.currentRoute.value.query.status).toBe("active");
  });

  it("returns to page one when a filter changes, in the same navigation", async () => {
    // On page 4 of a 287-driver roster, filtering to eleven shows an empty table — which reads as
    // "no drivers match" rather than "you are past the end".
    const { f, router } = await mountFilters("/drivers?page=4");
    f.status.value = "inactive";
    await settle();
    expect(router.currentRoute.value.query.page).toBeUndefined();
    expect(f.page.value).toBe(1);
    expect(router.currentRoute.value.query.status).toBe("inactive");
  });

  /**
   * 2026-10-21: the roster opens on ACTIVE drivers — its count said 184 where McLeod said 178, the
   * difference being terminated drivers nobody had archived. Like every default, it stays out of the
   * URL; "All statuses" therefore has to be written, as `any`, or choosing it would snap back.
   */
  it("opens on active drivers without writing the default, and writes `any` for All statuses", async () => {
    const { f, router } = await mountFilters();
    expect(f.status.value).toBe("active");
    f.status.value = "";
    await settle();
    expect(router.currentRoute.value.query.status).toBe("any");
    expect(f.status.value).toBe("");
    expect(f.active.value).toBe(true);
    f.status.value = "active";
    await settle();
    expect(router.currentRoute.value.query.status).toBeUndefined();
    expect(f.active.value).toBe(false);
  });

  it("opens the archived view on every status, where active would leave it empty", async () => {
    const { f, router } = await mountFilters("/drivers?show=archived");
    expect(f.defaultStatus.value).toBe("");
    expect(f.status.value).toBe("");
    f.status.value = "terminated";
    await settle();
    expect(router.currentRoute.value.query.status).toBe("terminated");
    f.status.value = "";
    await settle();
    expect(router.currentRoute.value.query.status).toBeUndefined();
  });

  it("keeps the page when only the sort changes", async () => {
    // Unlike a filter, re-ordering leaves the row you were looking at on the roster.
    const { f, router } = await mountFilters("/drivers?page=3");
    f.onSort("full_name");
    await settle();
    expect(router.currentRoute.value.query.page).toBe("3");
    expect(router.currentRoute.value.query.sort).toBe("full_name");
  });

  it("cycles a column through ascending, descending and off", async () => {
    const { f, router } = await mountFilters();
    f.onSort("full_name");
    await settle();
    expect(f.sort.value).toEqual({ key: "full_name", dir: "asc" });
    expect(router.currentRoute.value.query.dir).toBeUndefined();

    f.onSort("full_name");
    await settle();
    expect(f.sort.value).toEqual({ key: "full_name", dir: "desc" });
    expect(router.currentRoute.value.query.dir).toBe("desc");
  });

  it("reads a link that narrows several things at once", async () => {
    const { f } = await mountFilters("/drivers?q=reyes&status=active&show=archived&sort=phone&dir=desc&page=2");
    expect(f.search.value).toBe("reyes");
    expect(f.status.value).toBe("active");
    expect(f.showArchived.value).toBe(true);
    expect(f.sort.value).toEqual({ key: "phone", dir: "desc" });
    expect(f.page.value).toBe(2);
    expect(f.active.value).toBe(true);
  });

  it("treats a nonsense page as page one rather than an empty roster", async () => {
    expect((await mountFilters("/drivers?page=-4")).f.page.value).toBe(1);
    expect((await mountFilters("/drivers?page=banana")).f.page.value).toBe(1);
    expect((await mountFilters("/drivers?page=0")).f.page.value).toBe(1);
  });

  it("treats an unknown direction as ascending, and a direction with no column as no sort", async () => {
    expect((await mountFilters("/drivers?sort=phone&dir=sideways")).f.sort.value).toEqual({
      key: "phone",
      dir: "asc",
    });
    expect((await mountFilters("/drivers?dir=desc")).f.sort.value).toEqual({ key: null, dir: "asc" });
  });

  it("treats any unknown view as the live roster, never as an empty one", async () => {
    const { f } = await mountFilters("/drivers?show=banana");
    expect(f.showArchived.value).toBe(false);
    expect(f.view.value).toBe("live");
  });

  it("clears every filter at once and keeps the sort, which orders the roster rather than narrowing it", async () => {
    const { f, router } = await mountFilters("/drivers?q=reyes&status=active&show=archived&sort=phone&dir=desc&page=2");
    f.reset();
    await settle();
    expect(router.currentRoute.value.query).toEqual({ sort: "phone", dir: "desc" });
    expect(f.active.value).toBe(false);
  });

  it("does not count a re-sort as a narrowed roster", async () => {
    const { f } = await mountFilters("/drivers?sort=phone&dir=desc");
    expect(f.active.value).toBe(false);
  });

  it("carries the qualification filters, using the shared vocabulary", async () => {
    const { f, router } = await mountFilters();
    f.file.value = "expired";
    await settle();
    f.dqDue.value = "30";
    await settle();
    expect(router.currentRoute.value.query).toMatchObject({ file: "expired", due: "30" });
    expect(f.active.value).toBe(true);
  });

  it("reads an old ?dq= link as the File filter, and the next choice drops it (Q-UF9)", async () => {
    // A saved view stored before Q-UF9 still says `dq=expired`; it must still narrow the roster.
    const { f, router } = await mountFilters("/drivers?dq=not_started");
    expect(f.file.value).toBe("not_started");
    expect(f.active.value).toBe(true);
    f.file.value = "attention";
    await settle();
    expect(router.currentRoute.value.query).toEqual({ file: "attention" });
  });

  it("lets ?file= win over an old ?dq= in the same link", async () => {
    const { f } = await mountFilters("/drivers?dq=expired&file=expiring");
    expect(f.file.value).toBe("expiring");
  });

  it("reads the per-requirement narrowing a built-in view sets", async () => {
    // No control sets `req` — a named view does, and a view IS a URL (D-ROS14).
    const { f } = await mountFilters("/drivers?req=medical_card&due=30");
    expect(f.dqRequirement.value).toBe("medical_card");
    expect(f.dqDue.value).toBe("30");
    expect(f.active.value).toBe(true);
  });

  it("clears the qualification filters along with everything else", async () => {
    const { f, router } = await mountFilters("/drivers?dq=expired&due=30&req=cdl");
    f.reset();
    await settle();
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("reads the Seats card's door, and clears it with everything else", async () => {
    // FLEET-MANAGER-HOME-PLAN D-FM9: no control sets `seat` — the Operations tab's Seats card does.
    const { f, router } = await mountFilters("/drivers?status=active&seat=none");
    expect(f.seat.value).toBe("none");
    expect(f.active.value).toBe(true);
    f.reset();
    await settle();
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("reads any other seat value as no filter, because it arrives from a URL", async () => {
    const { f } = await mountFilters("/drivers?seat=banana");
    expect(f.seat.value).toBe("");
  });

  it("reads the File cell's chip as a filter, in the chip's own vocabulary (UF4b)", async () => {
    const { f, router } = await mountFilters("/drivers?file=expiring");
    expect(f.file.value).toBe("expiring");
    expect(f.active.value).toBe(true);
    f.file.value = "";
    await settle();
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("reads a chip word it does not know as no filter, and clears a known one with everything else", async () => {
    // `?file=banana` reaches here from a hand-edited link; it must not empty the roster.
    expect((await mountFilters("/drivers?file=banana")).f.file.value).toBe("");
    const { f, router } = await mountFilters("/drivers?file=missing&page=3");
    expect(f.file.value).toBe("missing");
    f.reset();
    await settle();
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("does not count the column choice as a narrowed roster", async () => {
    // `hide` belongs to the reader's table, not to which drivers are on it (R3b).
    const { f } = await mountFilters("/drivers?hide=phone");
    expect(f.active.value).toBe(false);
  });
});
