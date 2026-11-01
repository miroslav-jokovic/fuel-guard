import { describe, expect, it } from "vitest";
import {
  SILVICOM_DRIVER_V2,
  questionnaireForApplicant,
} from "./questionnaireContract.js";
const SERVED = questionnaireForApplicant();
import { SILVICOM_DRIVER_V3_ES, translateQuestionnaire } from "./questionnaireTranslation.js";

/**
 * The carrier's questions in Spanish (Q-AW11, C4): every question, every structured choice and every
 * table column the served definition has is translated; nothing but words changes; a free select's
 * options are left as the answer they store; English and an unknown language get the definition back.
 */
describe("the Spanish questionnaire", () => {
  const es = translateQuestionnaire(questionnaireForApplicant(), "es");

  it("translates every question, choice and column the served definition has", () => {
    const missing: string[] = [];
    for (const q of SERVED.questions) {
      const words = SILVICOM_DRIVER_V3_ES.questions[q.id];
      if (!words) {
        missing.push(q.id);
        continue;
      }
      if (q.hint && !words.hint) missing.push(`${q.id}.hint`);
      for (const c of q.choices ?? []) if (!words.choices?.[c.value]) missing.push(`${q.id}.choices.${c.value}`);
      for (const col of q.columns ?? []) if (!words.columns?.[col.id]) missing.push(`${q.id}.columns.${col.id}`);
      if (q.skip && !words.skip) missing.push(`${q.id}.skip`);
    }
    expect(missing).toEqual([]);
    const stray = Object.keys(SILVICOM_DRIVER_V3_ES.questions).filter((id) => !SERVED.questions.some((q) => q.id === id));
    expect(stray).toEqual([]);
  });

  it("changes words and nothing else", () => {
    expect(es.id).toBe(SERVED.id);
    expect(es.version).toBe(SERVED.version);
    expect(es.questions.map((q) => [q.id, q.kind, q.screen, q.maxRows, q.required, q.skip?.value, q.askedWhen])).toEqual(
      SERVED.questions.map((q) => [q.id, q.kind, q.screen, q.maxRows, q.required, q.skip?.value, q.askedWhen]),
    );
    // §9 P8: the skip's LABEL is translated; the stored value stays the carrier's English words.
    const references = es.questions.find((q) => q.id === "references")!;
    expect(references.skip).toEqual({ value: "I'd rather not say", label: "Prefiero no decirlo" });
    const applyingAs = es.questions.find((q) => q.id === "applying_as")!;
    expect(applyingAs.choices?.map((c) => c.value)).toEqual(["company_driver", "owner_operator"]);
    expect(applyingAs.choices?.map((c) => c.label)).toEqual(["Conductor de la empresa", "Operador propietario"]);
    expect(applyingAs.label).toMatch(/operador propietario/);
    const education = es.questions.find((q) => q.id === "education")!;
    expect(education.columns?.map((c) => c.id)).toEqual(SERVED.questions.find((q) => q.id === "education")!.columns!.map((c) => c.id));
    expect(education.columns?.[0]?.label).toBe("Escuela o universidad");
    expect(es.title).toBe("Unas preguntas de la empresa");
  });

  it("hands the definition back for English and for a language it has no words in", () => {
    expect(translateQuestionnaire(SILVICOM_DRIVER_V2, "en")).toBe(SILVICOM_DRIVER_V2);
    expect(translateQuestionnaire(SILVICOM_DRIVER_V2, "fr")).toBe(SILVICOM_DRIVER_V2);
  });

  it("names no regulation in any word a driver reads", () => {
    const forbidden = /§|\bCFR\b/;
    const texts = [es.title, es.intro, ...es.questions.flatMap((q) => [q.label, q.hint ?? "", q.skip?.label ?? "", ...(q.choices ?? []).map((c) => c.label), ...(q.columns ?? []).map((c) => c.label)])];
    expect(texts.filter((t) => forbidden.test(t))).toEqual([]);
  });
});
