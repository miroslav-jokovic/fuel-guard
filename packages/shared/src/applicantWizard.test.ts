import { describe, expect, it } from "vitest";
import { APPLICANT_FACTS } from "./applicantFacts.js";
import { DONOR_GENDERS, LICENCE_KINDS } from "./applicantScreeningContract.js";
import { CDL_CLASSES, ENDORSEMENT_CODES } from "./rosterContract.js";
import { PART_ONE_SCREENS } from "./applicationScreens.js";
import { APPLICATION_FILLING_SECTIONS, APPLICATION_SECTION_KEYS } from "./applicationSections.js";
import { WIZARD_SCREEN_IDS } from "./applicantWizardScreens.js";
import { questionnaireForApplicant } from "./questionnaireContract.js";
import {
  ASKED_BY_HAND,
  askedByDefinition,
  GENERATED_TASKS,
  TASK_FACTS_ASKED_ELSEWHERE,
  WIZARD_SCREENS,
  rowListOf,
  wizardTaskScreens,
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
const STAGE_ONE = WIZARD_SCREENS.filter((s) => s.stage === 1);
const STAGE_TWO = WIZARD_SCREENS.filter((s) => s.stage === 2);

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
    for (const s of STAGE_ONE) expect(isWizardPage(s.page), s.id).toBe(true);
    // A page's screens are adjacent, and pages come in PART_ONE_SCREENS' order — or "Back" would
    // leave a page half-answered and come back to it later.
    const pages = STAGE_ONE.map((s) => s.page).filter((p, i, all) => all[i - 1] !== p);
    expect(new Set(pages).size).toBe(pages.length);
    expect(pages).toEqual(PART_ONE_SCREENS.filter((p) => pages.includes(p as never)));
  });

  it("cuts each Stage 2 screen from a generated task, after every Stage 1 screen, tasks in the list's order", () => {
    const ids = WIZARD_SCREENS.map((s) => s.id);
    expect(Math.max(...STAGE_ONE.map((s) => ids.indexOf(s.id)))).toBeLessThan(Math.min(...STAGE_TWO.map((s) => ids.indexOf(s.id))));
    for (const s of STAGE_TWO) expect(GENERATED_TASKS as readonly string[], s.id).toContain(s.page);
    const tasks = STAGE_TWO.map((s) => s.page).filter((p, i, all) => all[i - 1] !== p);
    expect(new Set(tasks).size).toBe(tasks.length);
    expect(tasks).toEqual(APPLICATION_FILLING_SECTIONS.filter((t) => tasks.includes(t as never)));
    expect(wizardTaskScreens("safety").length).toBeGreaterThan(10);
    expect(wizardTaskScreens("identity").map((s) => s.id)).toEqual(["identity.name", "identity.other_names", "identity.email", "identity.ssn"]);
    // The carrier's questions are the served definition's screens, not the catalogue's (`askedByDefinition`).
    expect(wizardTaskScreens("questions")).toEqual([]);
    expect(wizardTaskScreens("employment")).toEqual([]);
  });

  it("asks every fact a generated task owns, or names where it is asked instead", () => {
    const owned = (task: string) =>
      APPLICANT_FACTS.filter((f) => {
        const key = /^application\.([a-z_]+)/.exec(f.path)?.[1];
        return key !== undefined && (APPLICATION_SECTION_KEYS[task as keyof typeof APPLICATION_SECTION_KEYS] as readonly string[]).includes(key);
      });
    for (const task of GENERATED_TASKS) {
      // Not vacuous: every task owns facts — the driving record fifteen, the carrier's questions twelve.
      expect(owned(task).length, task).toBeGreaterThan(5);
      const homeless = owned(task)
        .filter((f) => !f.ask?.length && !(f.path in TASK_FACTS_ASKED_ELSEWHERE) && !askedByDefinition(f.path))
        .map((f) => f.path);
      expect(homeless, task).toEqual([]);
    }
    // The definition asks the carrier's questions and nothing the catalogue asks.
    const byDefinition = APPLICANT_FACTS.filter((f) => askedByDefinition(f.path));
    expect(byDefinition.map((f) => f.path)).toContain("application.carrier_answers");
    for (const f of byDefinition) expect(f.ask, f.path).toBeUndefined();
    for (const p of Object.keys(TASK_FACTS_ASKED_ELSEWHERE)) expect(APPLICANT_FACTS.map((f) => f.path), p).toContain(p);
  });

  it("makes a loop of exactly the screens that ask one list's columns, each list behind its gate", () => {
    for (const s of STAGE_TWO) {
      const lists = new Set(s.fields.map((f) => rowListOf(f.fact.path)));
      expect(s.list, s.id).toBe(lists.size === 1 ? [...lists][0] : undefined);
    }
    const order = WIZARD_SCREENS.map((s) => s.id);
    for (const list of ["accidents", "violations"]) {
      const gate = STAGE_TWO.find((s) => s.gate === list);
      const rows = STAGE_TWO.filter((s) => s.list === list);
      expect(gate, list).toBeDefined();
      expect(rows.length, list).toBeGreaterThan(2);
      // The gate opens the list, and the list's screens follow it together.
      expect(order.indexOf(gate!.id), list).toBe(order.indexOf(rows[0]!.id) - 1);
      const at = rows.map((r) => order.indexOf(r.id));
      expect(at, list).toEqual(at.map((_, i) => at[0]! + i));
    }
  });

  it("offers quick picks only for an answer typed as text", () => {
    const withPicks = STAGE_TWO.flatMap((s) => s.fields).filter((f) => f.ask.quickPicks);
    expect(withPicks.map((f) => f.fact.path)).toEqual(["application.violations[].offence", "application.violations[].penalty"]);
    for (const f of withPicks) expect(f.fact.input, f.fact.path).toBe("text");
    // And on the served definition, only on a question answered in a text box.
    const questionPicks = questionnaireForApplicant().questions.filter((q) => q.quickPicks);
    expect(questionPicks.map((q) => q.id)).toEqual(["heard_from"]);
    for (const q of questionPicks) expect(q.kind, q.id).toBe("text");
  });

  it("groups only what is one fact typed together (D-AM3)", () => {
    const groups = WIZARD_SCREENS.filter((s) => s.kind === "group").map((s) => s.id);
    // The address, the licence card, and an accident's dead and hurt (SCREEN-MAP 2.18c); everything
    // else is one question to a screen (D-AM2).
    expect(groups).toEqual(["address.home", "licence.card", "identity.name", "safety.accident_casualties"]);
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
    const conditional = STAGE_ONE.filter((s) => s.when).map((s) => [s.id, s.when]);
    const inProgram = { fact: "intake.dot_program_30d", is: true };
    expect(conditional).toEqual([["screening.tested_6m", inProgram], ["screening.random_12m", inProgram]]);
  });

  it("asks a denial's or suspension's story only after a yes (SCREEN-MAP 2.20a, 2.21a)", () => {
    const conditional = STAGE_TWO.filter((s) => s.when).map((s) => [s.id, s.when]);
    expect(conditional).toEqual([
      ["safety.denied_detail", { fact: "application.licence_ever_denied", is: true }],
      ["safety.suspended_detail", { fact: "application.licence_suspended", is: true }],
    ]);
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
