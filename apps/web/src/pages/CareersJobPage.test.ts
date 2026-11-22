import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { APPLY_HONEYPOT_FIELD, SMS_APPLY_PAGE_CONSENT, type ApplyJobView } from "@silvicom/shared";
import CareersJobPage from "@/pages/CareersJobPage.vue";
import { CAREERS_COPY } from "@/features/careers";

/**
 * One job's page and its form (APPLY-PAGE-PLAN AP3), against a stubbed `fetch` that answers as the API does (raw
 * JSON, `fieldError` on a 400). What is asserted is what the page SENDS and what a person reads: the contract's own
 * sentences under the field, the box unticked and its words whole, the checks travelling with the form, and links that
 * never route inside the office app (D-AP9).
 */
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ params: { handle: "silvicom", openingId: OPENING } }),
}));

const OPENING = "60000000-0000-4000-8000-000000000001";
const BODY = SMS_APPLY_PAGE_CONSENT.body.replace("{{carrier}}", "Silvicom Inc");
const JOB: ApplyJobView = {
  carrier: "Silvicom Inc",
  handle: "silvicom",
  opening: {
    id: OPENING,
    title: "Regional dry van",
    areaLabel: "Chicago, IL",
    facts: {
      pay: { per: "mile", min_cents: 60, max_cents: 75 }, home_time: "Home weekly", equipment: ["dry_van", "reefer"], lanes: "Midwest",
      start_date: null, benefits: ["health insurance"], bonus: { kind: "sign-on bonus", cents: 200_000 }, schedule: "regional", in_our_words: null,
    },
  },
  requirements: { minAge: 23, minClassAYears: 2, hazmat: "required" },
  questions: [
    { key: "class_a_held", label: "Do you hold a valid Class A CDL?", options: [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] },
    { key: "hazmat_endorsement", label: "Do you have a hazmat endorsement?", options: [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] },
  ],
  consent: { version: SMS_APPLY_PAGE_CONSENT.version, title: SMS_APPLY_PAGE_CONSENT.title, body: BODY },
  accommodation: { email: "recruiting@silvicominc.com", phone: "+17082365732" },
  formToken: "sealed-token",
  turnstileSiteKey: null,
  pageUrl: `https://careers.example.test/careers/silvicom/jobs/${OPENING}`,
  legalOrigin: "https://360.example.test",
};

const state = vi.hoisted(() => ({
  job: null as unknown,
  jobStatus: 200,
  posts: [] as Array<{ url: string; body: Record<string, unknown> }>,
  answer: { status: 201, body: { ok: true } as unknown },
  offline: false,
}));

beforeEach(() => {
  Object.assign(state, { job: JOB, jobStatus: 200, posts: [], answer: { status: 201, body: { ok: true } }, offline: false });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") {
      if (state.offline) throw new TypeError("Failed to fetch");
      state.posts.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(state.answer.body), { status: state.answer.status });
    }
    return new Response(JSON.stringify(state.jobStatus === 200 ? state.job : { error: { code: "not_found", message: "x" } }), { status: state.jobStatus });
  }));
});
afterEach(() => vi.unstubAllGlobals());
// A test that fails before its own unmount must not leave its page's head behind for the next one.
enableAutoUnmount(afterEach);

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 12; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountPage = async () => {
  const w = mount(CareersJobPage, { attachTo: document.body, global: { plugins: [VueQueryPlugin], stubs: { RouterLink: { props: ["to"], template: "<a data-router-link><slot /></a>" } } } });
  await settle(w);
  return w;
};
const fill = async (w: ReturnType<typeof mount>, values: { name?: string; phone?: string; email?: string } = {}) => {
  await w.find("#careers-fullName").setValue(values.name ?? "Pat Driver");
  await w.find("#careers-phone").setValue(values.phone ?? "(708) 555-0142");
  if (values.email !== undefined) await w.find("#careers-email").setValue(values.email);
};
const choose = async (w: ReturnType<typeof mount>, key: string, option: string) => {
  await w.find(`[data-question="${key}"] input[value="${option}"]`).setValue(true);
};
const send = async (w: ReturnType<typeof mount>) => {
  await w.find("[data-careers-form]").trigger("submit");
  await settle(w);
};

describe("the job", () => {
  it("states the pay range first, then the job's facts in the editor's words, the benefits and what it asks", async () => {
    const w = await mountPage();
    expect(w.find("h1").text()).toBe("Regional dry van");
    const dts = w.findAll("[data-job-facts] dt").map((dt) => dt.text());
    const facts = Object.fromEntries(w.findAll("[data-job-facts] dd").map((dd, i) => [dts[i], dd.text()]));
    expect(facts).toEqual({
      Pay: "$0.60–$0.75 per mile", "Home time": "Home weekly", Equipment: "Dry van, Reefer", "Kind of run": "Regional",
      Lanes: "Midwest", "Hiring area": "Chicago, IL", Bonus: "Sign-on bonus: $2,000",
    });
    expect(w.find("[data-job-facts] dt").text(), "pay comes first").toBe("Pay");
    expect(w.find("[data-benefits]").text()).toBe("Health insurance");
    expect(w.findAll("[data-requirements] li").map((l) => l.text())).toEqual([
      "A valid Class A CDL", "At least 2 years of Class A driving", "At least 23 years old", "A hazmat (H or X) endorsement",
    ]);
    w.unmount();
  });

  it("sets the title, the description and the canonical link to the careers host's address, and takes them away on leaving", async () => {
    const w = await mountPage();
    expect(document.title).toBe("Regional dry van · Silvicom Inc");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(JOB.pageUrl);
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toContain("$0.60–$0.75 per mile");
    w.unmount();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.title).not.toContain("Regional dry van");
  });

  it("an opening that is not published reads as not available, never as an error", async () => {
    state.jobStatus = 404;
    const w = await mountPage();
    expect(w.find("[data-careers-not-found]").text()).toContain(CAREERS_COPY.notFound.heading);
    expect(w.find("[data-careers-form]").exists()).toBe(false);
    w.unmount();
  });
});

describe("the form", () => {
  it("sends exactly the contract's fields: the token, the answers, an unticked box, no robot token without keys, an empty honeypot", async () => {
    const w = await mountPage();
    await fill(w, { email: "pat@example.com" });
    await choose(w, "class_a_held", "yes");
    await choose(w, "hazmat_endorsement", "no");
    await send(w);
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0]!.url).toBe(`/api/public/careers/silvicom/jobs/${OPENING}/apply`);
    expect(state.posts[0]!.body).toEqual({
      formToken: "sealed-token", fullName: "Pat Driver", phone: "(708) 555-0142", email: "pat@example.com",
      answers: { class_a_held: "yes", hazmat_endorsement: "no" }, smsOptIn: false, turnstileToken: null, [APPLY_HONEYPOT_FIELD]: "",
    });
    expect(w.find("[data-careers-sent]").text()).toContain("Silvicom Inc has your application for Regional dry van.");
    expect(w.find("[data-careers-sent] h2").element).toBe(document.activeElement);
    w.unmount();
  });

  it("the texting box starts unticked, shows the served words whole, and links its terms on the office host in a new tab", async () => {
    const w = await mountPage();
    const box = w.find("[data-sms-box]");
    expect((box.find("input[type=checkbox]").element as HTMLInputElement).checked).toBe(false);
    expect(box.find("[data-sms-words]").text()).toBe(BODY);
    const links = box.findAll("a").map((a) => [a.attributes("href"), a.attributes("target")]);
    expect(links).toEqual([["https://360.example.test/sms-terms", "_blank"], ["https://360.example.test/privacy#careers-page", "_blank"]]);
    w.unmount();
  });

  it("a ticked box sends smsOptIn true; a field left blank is sent as null, never as an empty string", async () => {
    const w = await mountPage();
    await fill(w);
    await choose(w, "class_a_held", "yes");
    await choose(w, "hazmat_endorsement", "yes");
    await w.find("[data-sms-box] input[type=checkbox]").setValue(true);
    await send(w);
    expect(state.posts[0]!.body.smsOptIn).toBe(true);
    expect(state.posts[0]!.body.email).toBeNull();
    w.unmount();
  });

  it("the contract's own sentences under their fields, focus on the first, unanswered questions by name, and nothing sent", async () => {
    const w = await mountPage();
    await w.find("#careers-phone").setValue("12");
    await w.find("[data-sms-box] input[type=checkbox]").setValue(true);
    await send(w);
    expect(state.posts).toHaveLength(0);
    expect(w.text()).toContain("Enter your full name.");
    expect(w.text()).toContain("Enter a 10-digit mobile number.");
    expect(w.findAll("p").filter((p) => p.text() === CAREERS_COPY.form.chooseOne)).toHaveLength(2);
    expect(document.activeElement?.id).toBe("careers-fullName");
    // The question's error is tied to its group for a screen reader.
    expect(w.find('[data-question="class_a_held"]').attributes("aria-describedby")).toBe("careers-q-class_a_held-error");
    w.unmount();
  });

  it("neither a number nor an email: the contract's D-LS10 sentence, under the mobile number", async () => {
    const w = await mountPage();
    await w.find("#careers-fullName").setValue("Pat Driver");
    await choose(w, "class_a_held", "yes");
    await choose(w, "hazmat_endorsement", "yes");
    await send(w);
    expect(state.posts).toHaveLength(0);
    expect(w.text()).toContain("Enter a mobile number or an email so we can reach you.");
    w.unmount();
  });

  it("the server's 400 lands under the field it names; a send with no connection keeps every answer", async () => {
    state.answer = { status: 400, body: { error: { code: "bad_request", message: "Enter an email address like name@example.com.", field: "email" } } };
    const w = await mountPage();
    await fill(w, { email: "pat@example.com" });
    await choose(w, "class_a_held", "yes");
    await choose(w, "hazmat_endorsement", "yes");
    await send(w);
    expect(w.find("#careers-email-description").text()).toBe("Enter an email address like name@example.com.");
    state.offline = true;
    await send(w);
    expect(w.find("[data-send-failed]").text()).toBe(CAREERS_COPY.form.offline);
    expect((w.find("#careers-fullName").element as HTMLInputElement).value).toBe("Pat Driver");
    w.unmount();
  });

  it("an opening closed while the form was open says so instead of the form", async () => {
    state.answer = { status: 404, body: { error: { code: "not_found", message: "x" } } };
    const w = await mountPage();
    await fill(w);
    await choose(w, "class_a_held", "yes");
    await choose(w, "hazmat_endorsement", "yes");
    await send(w);
    expect(w.find("[data-careers-gone]").text()).toContain(CAREERS_COPY.form.gone);
    w.unmount();
  });

  it("the honeypot is out of sight, out of the tab order and out of the accessibility tree", async () => {
    const w = await mountPage();
    const hp = w.find(`input[name="${APPLY_HONEYPOT_FIELD}"]`);
    expect(hp.attributes("tabindex")).toBe("-1");
    expect(hp.element.closest("[aria-hidden=true]")).not.toBeNull();
    w.unmount();
  });

  it("every link on the page is either a /careers route or an absolute address (D-AP9)", async () => {
    const w = await mountPage();
    for (const a of w.findAll("a")) {
      if (a.attributes("data-router-link") !== undefined) continue;
      expect(a.attributes("href"), a.text()).toMatch(/^(https:\/\/|mailto:|tel:)/);
    }
    w.unmount();
  });
});
