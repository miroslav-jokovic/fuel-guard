import { expect, test, type Page } from "@playwright/test";
import { PART_ONE_SCREENS } from "@silvicom/shared";
import { openHandbook, packetStops, partOneLink, partTwoV2Link, stubApi, TOKEN, type Stub } from "./stubApi";

/**
 * §6.8's tap-target bar, measured: "100% ≥ 44×44 CSS px, none < 24 (WCAG 2.5.8), Playwright, 320 and
 * 390 px" (C3d3b2; Q-AW20: `/apply` only). Every screen of the walk, at both widths.
 *
 * ── WHAT COUNTS AS A TARGET ───────────────────────────────────────────────────────────────────
 * Everything a thumb presses: buttons, links, text boxes, selects, disclosures, and anything carrying
 * an interactive role — a combobox's options and a calendar's days included. A radio or a checkbox is
 * measured by its LABEL, because the label is what is pressed (the 16 px box inside it never is).
 *
 * Not measured, and each said here rather than skipped quietly:
 *  · **A link or a button inside a sentence.** WCAG 2.5.8 exempts a target "in a sentence or its size
 *    is otherwise constrained by the line-height of non-target text", and a 44 px box would break the
 *    line. "Inside a sentence" is decided from the page, not listed: the target's paragraph (or list
 *    item, or cell) holds words that are not themselves a target. Two links sharing a line with only
 *    a " · " between them are NOT in a sentence — the SMS card's were 16 px tall until this spec.
 *  · **A file input.** It is never shown; the button that opens the picker is, and is measured.
 *
 * ── AND A TARGET THE SCREEN CUTS OFF ──────────────────────────────────────────────────────────
 * A 44 px control that hangs off the side of a 320 px phone is not pressable either, so a target
 * crossing the viewport's edge fails too — except inside something that scrolls sideways (the packet's
 * strip of places), where the rest is a swipe away by design.
 *
 * ⚠ One test per stretch of the walk, and each collects EVERY miss before asserting, so a failing run
 * names all of them at once rather than the first.
 */

const MIN = 44;
const url = `/apply/${TOKEN}`;

/** What one screen measured short, keyed by screen. Empty when it passes. */
type Misses = Record<string, string[]>;

/** Every visible target on the page, measured; the ones under 44 px or cut off, described. */
function measure(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const TARGETS = [
      "button", "a[href]", "input:not([type=hidden]):not([type=file])", "select", "textarea", "summary",
      ...["button", "link", "radio", "checkbox", "switch", "tab", "combobox", "option", "gridcell"].map((r) => `[role=${r}]`),
    ].join(", ");
    const all = Array.from(document.querySelectorAll(TARGETS));
    const isTarget = (el: Element) => all.includes(el);

    /** The label that is pressed for a radio or a checkbox; the element itself for anything else. */
    const pressed = (el: Element): Element => {
      if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
        return el.closest("label") ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null) ?? el;
      }
      return el;
    };

    /** WCAG 2.5.8's inline exception: the block around it has words that are not a target's. */
    const inSentence = (el: Element): boolean => {
      if (!(el.tagName === "A" || el.tagName === "BUTTON")) return false;
      const block = el.parentElement?.closest("p, li, dd, dt, td, th");
      if (!block) return false;
      let text = block.textContent ?? "";
      for (const t of Array.from(block.querySelectorAll("*")).filter(isTarget)) text = text.replace(t.textContent ?? "", "");
      return /[\p{L}\p{N}]/u.test(text);
    };

    const scrollsSideways = (el: Element): boolean => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };

    const name = (el: Element): string => {
      const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} "${text}"`;
    };

    const seen = new Set<Element>();
    const misses: string[] = [];
    for (const el of all) {
      const target = pressed(el);
      if (seen.has(target)) continue;
      seen.add(target);
      if (!target.checkVisibility({ visibilityProperty: true })) continue;
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || inSentence(target)) continue;
      if (r.width < min || r.height < min) misses.push(`${name(target)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      else if ((r.left < -0.5 || r.right > window.innerWidth + 0.5) && !scrollsSideways(target)) {
        misses.push(`${name(target)} cut off at ${Math.round(r.left)}–${Math.round(r.right)} of ${window.innerWidth}`);
      }
    }
    // The page itself wider than the phone: everything past the edge is a sideways scroll away.
    const page = document.documentElement;
    if (page.scrollWidth > page.clientWidth) misses.push(`the page scrolls sideways: ${page.scrollWidth} wide on ${page.clientWidth}`);
    return misses;
  }, MIN);
}

/**
 * A sweep over one stretch of the walk: `check` measures the screen as it stands, `expectNone` asserts.
 * `misses` is passed in where one test walks several links, so they report together.
 */
function sweep(page: Page, stub: Stub, misses: Misses = {}) {
  return {
    async check(screen: string): Promise<void> {
      // Nothing the page asked for went unanswered: a walk must never pass on a 501 from the fake.
      expect(stub.state.unstubbed, `unstubbed request before "${screen}"`).toEqual([]);
      // A drawer sliding in is measured where it lands, not where it was when the click returned.
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
      const found = await measure(page);
      if (found.length) misses[screen] = found;
    },
    expectNone(): void {
      expect(misses).toEqual({});
    },
  };
}

const press = (page: Page, name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" }).click();

/** Pick an option in one of the page's state comboboxes, measuring the open list on the way. */
async function chooseState(page: Page, id: string, check?: () => Promise<void>): Promise<void> {
  await page.locator(id).click();
  await page.locator(id).fill("Illin");
  await check?.();
  await page.getByRole("option", { name: /Illinois/ }).first().click();
}

/** A photograph of a card, textured enough to pass the browser's gate (`offline.spec.ts`'s). */
async function cardPhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1000;
    const g = c.getContext("2d")!;
    for (let y = 0; y < 1000; y += 20) {
      for (let x = 0; x < 1600; x += 20) {
        g.fillStyle = `rgb(${(x * 7) % 255},${(y * 3) % 255},${(x + y) % 255})`;
        g.fillRect(x, y, 20, 20);
      }
    }
    return c.toDataURL("image/jpeg", 0.9).split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

async function photograph(page: Page): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await press(page, "Take photo");
  await (await chooser).setFiles({ name: "card.jpg", mimeType: "image/jpeg", buffer: await cardPhoto(page) });
  await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible();
}

const step = (page: Page, n: number) => expect(page.getByText(`Step ${n} of ${PART_ONE_SCREENS.length}`)).toBeVisible();

for (const width of [390, 320]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("Part 1: expectations, consent, the nine screens, the permissions and the wait", async ({ page }) => {
      const link = partOneLink({ captures: [] });
      link.phases = { ...(link.phases as object), consentedAt: null };
      const stub = await stubApi(page, link);
      const s = sweep(page, stub);
      await page.goto(url);

      await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
      await s.check("expectations");
      await press(page, "Start");
      await s.check("consent");
      await press(page, /I agree/);

      await step(page, 1);
      await s.check("part1.cdl_front");
      await photograph(page);
      await s.check("part1.cdl_front, photo to review");
      await press(page, "Use this photo");
      await expect(page.getByText("Received.")).toBeVisible();
      await s.check("part1.cdl_front, received");
      await press(page, "Continue");

      await step(page, 2);
      await photograph(page);
      await press(page, "Use this photo");
      await expect(page.getByText("Received.")).toBeVisible();
      await s.check("part1.cdl_back");
      await press(page, "Continue");

      await step(page, 3);
      await s.check("part1.about");
      await page.getByLabel("Mobile phone number").fill("3125550142");
      await page.locator("#p1-dob").fill("03");
      await page.locator("#p1-dob-day").fill("07");
      await page.locator("#p1-dob-year").fill("1985");
      await press(page, "Continue");

      await step(page, 4);
      await s.check("part1.address");
      await page.locator("#p1-line1").fill("12 Depot Rd");
      await page.locator("#p1-city").fill("Joliet");
      await chooseState(page, "#p1-state", () => s.check("part1.address, state list open"));
      await page.locator("#p1-zip").fill("60432");
      await press(page, "Continue");

      await step(page, 5);
      await s.check("part1.licence");
      await chooseState(page, "#p1-cdl-state");
      await page.locator("#p1-cdl-number").fill("D12345678901");
      await page.getByLabel("A", { exact: true }).check();
      await page.locator("#p1-cdl-expires").fill("05");
      await page.locator("#p1-cdl-expires-day").fill("01");
      await page.locator("#p1-cdl-expires-year").fill("2029");
      await press(page, "Continue");

      await step(page, 6);
      await s.check("part1.other_licences");
      await page.getByLabel("Yes", { exact: true }).check();
      await press(page, "Add a licence");
      await s.check("part1.other_licences, one added");
      await page.getByLabel("No", { exact: true }).check();
      await press(page, "Continue");

      await step(page, 7);
      await s.check("part1.screening");
      const noes = page.getByLabel("No", { exact: true });
      for (let i = 0; i < 2; i += 1) await noes.nth(i).check();
      await press(page, "Continue");

      await step(page, 8);
      await s.check("part1.medical_card");
      await page.getByLabel(/medical card yet/).check();
      await press(page, "Continue");

      // AW6: the selfie — its oval, its notice, "I can't take one" ticked, then a photo taken and sent.
      await step(page, 9);
      await s.check("part1.selfie");
      const cannot = page.getByLabel(/can't take a photo of myself/);
      await cannot.check();
      await s.check("part1.selfie, cannot take one");
      await cannot.uncheck();
      await photograph(page);
      await s.check("part1.selfie, photo to review");
      await press(page, "Use this photo");
      await expect(page.getByText("Received.")).toBeVisible();
      await press(page, "Continue");

      await step(page, 10);
      await s.check("part1.rights");
      await press(page, "I have read this");

      // The ceremony: its adoption in each of its three ways, the confirm, then each permission.
      await expect(page.getByRole("radio", { name: "Choose a style" })).toBeVisible();
      await s.check("ceremony, adoption: a style");
      await page.getByRole("radio", { name: "Draw it" }).click();
      await s.check("ceremony, adoption: draw");
      await page.getByRole("radio", { name: "Upload" }).click();
      await s.check("ceremony, adoption: upload");
      await page.getByRole("radio", { name: "Choose a style" }).click();
      await page.getByRole("textbox").first().fill("Susan Godfrey");
      await page.getByRole("textbox").nth(1).fill("SG");
      await press(page, /^Use this/);
      await s.check("ceremony, confirm");
      // Screen 13 registered both marks as the link's adoptions, each a PNG the browser drew (C3s1).
      const adopted = stub.callsTo("POST", /\/adoption$/).map((c) => c.body as { kind: string; typed_text: string; png_base64: string });
      expect(adopted.map((a) => [a.kind, a.typed_text])).toEqual([["signature", "Susan Godfrey"], ["initials", "SG"]]);
      for (const a of adopted) expect(Buffer.from(a.png_base64, "base64").subarray(1, 4).toString()).toBe("PNG");
      await press(page, /start signing/);
      for (const title of ["Disclosure regarding background reports", "PSP disclosure and authorization"]) {
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
        await expect(page.getByRole("button", { name: "Sign here" })).toBeVisible();
        await page.locator("summary").click();
        await s.check(`ceremony, ${title}`);
        // A tag taller than the box grows DOWN over it, never up over the sentence the driver signs to:
        // at 320 px a bottom-aligned 44 px tag covered the intent sentence (C3d3b2). Its top is the box's.
        const tag = await page.getByRole("button", { name: "Sign here" }).boundingBox();
        const box = await page.locator(".sign-here-tag").locator("..").boundingBox();
        expect(tag!.y).toBeGreaterThanOrEqual(box!.y);
        await press(page, "Sign here");
      }

      await expect(page.getByRole("heading", { name: "We have your permissions" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Turn on texts" })).toBeVisible();
      await s.check("wait.permissions");
      s.expectNone();
    });

    test("the unlock, and its calendar open", async ({ page }) => {
      const stub = await stubApi(page, partTwoV2Link({
        draft: { locked: true, payload: null, furthestSection: "identity", updatedAt: "2026-09-28T15:00:00.000Z", revision: 1 },
      }));
      const s = sweep(page, stub);
      await page.goto(url);
      await expect(page.getByRole("button", { name: "Choose a date" })).toBeVisible();
      await s.check("unlock");
      await press(page, "Choose a date");
      await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
      await s.check("unlock, calendar open");
      s.expectNone();
    });

    test("Part 2: the task list, every task, and what each one adds", async ({ page }) => {
      const stub = await stubApi(page, partTwoV2Link());
      const s = sweep(page, stub);
      await page.goto(url);
      const tasks = page.locator("main li button");
      await expect(tasks.first()).toBeVisible();
      await s.check("part2.hub");

      const count = await tasks.count();
      expect(count).toBeGreaterThan(5);
      for (let i = 0; i < count; i += 1) {
        const task = tasks.nth(i);
        if (await task.isDisabled()) continue;
        const label = ((await task.textContent()) ?? "").trim().split(/\s{2,}|(?=Not started|In progress|Optional|Done)/)[0]!;
        await task.click();
        await expect(page.getByRole("button", { name: "Back to your application" })).toBeVisible();
        await s.check(`part2: ${label}`);
        // Each "Add…" once: an inline row or a drawer, whichever the task opens.
        const adds = page.getByRole("button", { name: /^Add/ });
        for (let a = 0; a < (await adds.count()); a += 1) {
          const add = adds.nth(a);
          const what = ((await add.textContent()) ?? "").trim();
          await add.click();
          await s.check(`part2: ${label}, ${what}`);
          await page.keyboard.press("Escape");
        }
        await press(page, "Back to your application");
        await expect(tasks.first()).toBeVisible();
      }
      s.expectNone();
    });

    test("the office's two waits, the sign-off with the packet, and the filed page with the handbook", async ({ page }) => {
      const T = "2026-09-28T15:00:00.000Z";
      const states: [string, Record<string, unknown>, string][] = [
        ["wait.review", { phases: { reviewRequestedAt: T } }, "Turn on texts"],
        ["wait.office", { phases: { reviewRequestedAt: T, approvedAt: T, signingOpenedAt: null } }, "Turn on texts"],
        ["signoff", { phases: { reviewRequestedAt: T, approvedAt: T, signingOpenedAt: T }, packet: packetStops() }, "Sign and send it"],
        // D-AW15 (C3s2a): screen 13's adoption, offered at the packet — "This is your signature — use it".
        ["signoff.adopted", {
          phases: { reviewRequestedAt: T, approvedAt: T, signingOpenedAt: T }, packet: packetStops(),
          adoptions: { signature: "Susan Godfrey", initials: "SG" },
        }, "Use it"],
        // D-AW16 (C3s4b): a filed link with handbook places left opens on the walk, not on the downloads.
        ["filed", {
          phases: { reviewRequestedAt: T, approvedAt: T, signingOpenedAt: T, submittedAt: T },
          packet: packetStops().map((p) => ({ ...p, signedAt: T })), handbook: openHandbook(),
        }, "Sign here"],
      ];
      const misses: Misses = {};
      for (const [screen, over, ready] of states) {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        const stub = await stubApi(page, partTwoV2Link(over));
        const s = sweep(page, stub, misses);
        await page.goto(url);
        await expect(page.getByRole("button", { name: ready })).toBeVisible();
        await s.check(screen);
        if (screen === "signoff") {
          // The packet's own adoption — signature AND initials — its confirm, and the first place.
          await page.getByLabel("Type your full name").fill("Susan Godfrey");
          await page.getByLabel("Type your initials").fill("SG");
          await s.check("signoff, packet adoption");
          await press(page, /^Use this/);
          await s.check("signoff, packet confirm");
          await press(page, /start signing/);
          await expect(page.getByText("Page 3", { exact: false }).first()).toBeVisible();
          // D-AW16 (C3s4b): the count spans the packet and the handbook's five places after it.
          await expect(page.getByText(`Place 1 of ${packetStops().length + 5}`)).toBeVisible();
          await s.check("signoff, packet: first place");
        }
        if (screen === "signoff.adopted") {
          await expect(page.getByRole("heading", { name: "This is your signature" })).toBeVisible();
          await expect(page.getByRole("button", { name: "Make a new one" })).toBeVisible();
          await press(page, "Use it");
          await expect(page.getByText("Page 3", { exact: false }).first()).toBeVisible();
          await s.check("signoff.adopted, packet: first place");
          // Used as it is: nothing new is registered.
          expect(stub.callsTo("POST", /\/adoption$/)).toHaveLength(0);
        }
        if (screen === "filed") {
          // The envelope's count carries on from the packet: its places, then the handbook's first.
          const packet = packetStops().length;
          await expect(page.getByText(`Place ${packet + 1} of ${packet + 5}`)).toBeVisible();
          await s.check("filed, handbook open");
        }
      }
      expect(misses).toEqual({});
    });
  });
}
