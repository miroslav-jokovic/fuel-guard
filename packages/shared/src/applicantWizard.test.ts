import { describe, expect, it } from "vitest";
import { APPLICANT_FACTS } from "./applicantFacts.js";
import { DONOR_GENDERS, LICENCE_KINDS } from "./applicantScreeningContract.js";
import { CDL_CLASSES, ENDORSEMENT_CODES } from "./rosterContract.js";
import { PART_ONE_SCREENS } from "./applicationScreens.js";
import { WIZARD_SCREEN_IDS } from "./applicantWizardScreens.js";
import {
  ASKED_BY_HAND,
  WIZARD_SCREENS,
  factChoices,
  isWizardPage,
  wizardScreenShown,
  wizardScreensOf,
} from "./applicantWizard.js";

/**
 * The generated wizard's own parity (SCREEN-MAP §7, §10's gate, F4 PR 1): every Part 1 fact is asked
 * by a generated screen or says where it is asked instead, and every screen asks something.
 */
const PART_ONE_FACTS = APPLICANT_FACTS.filter((f) => f.path.startsWith("intake."));

describe("the wizard generated from the catalogue", () => {
  it("puts every Part 1 fact on a screen, or names where it is asked instead", () => {
    // Not vacuous: Part 1 has twenty facts, and fifteen of them are on generated screens.
    expect(PART_ONE_FACTS.length).toBeGreaterThan(15);
    const homeless = PART_ONE_FACTS.filter((f) => !f.ask?.length && !(f.path in ASKED_BY_HAND)).map((f) => f.path);
    expect(homeless).toEqual([]);
    const both = PART_ONE_FACTS.filter((f) => f.ask?.length && f.path in ASKED_BY_HAND).map((f) => f.path);
    expect(both).toEqual([]);
    for (const p of Object.keys(ASKED_BY_HAND)) expect(PART_ONE_FACTS.map((f) => f.path), p).toContain(p);
  });

  it("asks something on every screen it lists, and nothing on a screen it does not", () => {
    expect(WIZARD_SCREENS.filter((s) => s.fields.length === 0).map((s) => s.id)).toEqual([]);
    const named = APPLICANT_FACTS.flatMap((f) => (f.ask ?? []).map((a) => a.screen));
    for (const id of named) expect(WIZARD_SCREEN_IDS as readonly string[], id).toContain(id);
  });

  it("cuts each screen from one of Part 1's pages, walking the pages in their own order", () => {
    for (const s of WIZARD_SCREENS) expect(isWizardPage(s.page), s.id).toBe(true);
    // A page's screens are adjacent, and pages come in PART_ONE_SCREENS' order — or "Back" would
    // leave a page half-answered and come back to it later.
    const pages = WIZARD_SCREENS.map((s) => s.page).filter((p, i, all) => all[i - 1] !== p);
    expect(new Set(pages).size).toBe(pages.length);
    expect(pages).toEqual(PART_ONE_SCREENS.filter((p) => pages.includes(p)));
  });

  it("groups only what is one fact typed together (D-AM3)", () => {
    const groups = WIZARD_SCREENS.filter((s) => s.kind === "group").map((s) => s.id);
    // The address and the licence card; everything else is one question to a screen (D-AM2).
    expect(groups).toEqual(["address.home", "licence.card"]);
    expect(wizardScreensOf("about").map((s) => s.id)).toEqual(["about.phone", "about.date_of_birth"]);
    expect(wizardScreensOf("rights")).toEqual([]);
  });

  it("asks a conditional screen under one condition, on an answer given earlier", () => {
    const order = WIZARD_SCREENS.map((s) => s.id);
    for (const s of WIZARD_SCREENS) {
      for (const f of s.fields) expect(f.ask.when, `${s.id} ${f.fact.path}`).toEqual(s.when);
      if (!s.when) continue;
      const asker = WIZARD_SCREENS.find((x) => x.fields.some((f) => f.fact.path === s.when!.fact));
      expect(asker, s.id).toBeDefined();
      expect(order.indexOf(asker!.id), s.id).toBeLessThan(order.indexOf(s.id));
    }
  });

  it("asks under a condition exactly the screens SCREEN-MAP §2 marks IF — 1.12 and 1.13", () => {
    const conditional = WIZARD_SCREENS.filter((s) => s.when).map((s) => [s.id, s.when]);
    const inProgram = { fact: "intake.dot_program_30d", is: true };
    expect(conditional).toEqual([["screening.tested_6m", inProgram], ["screening.random_12m", inProgram]]);
  });

  it("shows the 6- and 12-month questions only to a driver in a testing program", () => {
    const [tested] = WIZARD_SCREENS.filter((s) => s.id === "screening.tested_6m");
    const answers = (inProgram: boolean | null) => (p: string) => (p === "intake.dot_program_30d" ? inProgram : undefined);
    expect(wizardScreenShown(tested!, answers(true))).toBe(true);
    expect(wizardScreenShown(tested!, answers(false))).toBe(false);
    expect(wizardScreenShown(tested!, answers(null))).toBe(false);
  });

  it("says which years every date box assumes, and only on dates", () => {
    for (const s of WIZARD_SCREENS) {
      for (const f of s.fields) {
        expect(Boolean(f.ask.dates), `${s.id} ${f.fact.path}`).toBe(f.fact.input === "date" || f.fact.input === "month");
      }
    }
  });
});

describe("a choice's answers, read from the contract", () => {
  it("gives the contract's own values, in its order", () => {
    expect(factChoices("intake.cdl_class")).toEqual(CDL_CLASSES);
    expect(factChoices("intake.endorsements[]")).toEqual(ENDORSEMENT_CODES);
    expect(factChoices("intake.donor_gender")).toEqual(DONOR_GENDERS);
    expect(factChoices("intake.licences[].kind")).toEqual(LICENCE_KINDS);
  });

  it("has answers for every choice a screen asks, and none for what is not a choice", () => {
    for (const s of WIZARD_SCREENS) {
      for (const f of s.fields) {
        const choice = f.fact.input === "choice" || f.fact.input === "multi_choice";
        expect(Boolean(factChoices(f.fact.path)?.length), f.fact.path).toBe(choice);
      }
    }
    expect(factChoices("intake.nope")).toBeUndefined();
    expect(factChoices("application.cdl_class")).toBeUndefined();
  });
});
