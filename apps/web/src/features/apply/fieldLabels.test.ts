import { describe, expect, it } from "vitest";
import {
  applicationAccidentSchema,
  applicationAddressSchema,
  applicationEmployerSchema,
  applicationEquipmentSchema,
  applicationLicenceSchema,
  applicationViolationSchema,
  driverApplicationObject,
  driverApplicationSchema,
} from "@silvicom/shared";
import {
  FIELD_LABEL_KEYS,
  describeField,
  fieldId,
  messageFor,
  valueAt,
} from "./fieldLabels";
import {
  emptyAccident,
  emptyAddress,
  emptyDraft,
  emptyEmployer,
  emptyEquipment,
  emptyLicence,
  emptyViolation,
  toApplication,
} from "./draft";
import { issuesFromParse } from "./useApplicationWizard";

/**
 * The rule this file enforces: **nothing the machine calls a field ever reaches a driver** (D-AX3).
 *
 * Two halves, and the second is the one worth having. The first walks the contract and fails on a
 * key with no label — that is the `equipment_experience` defect, caught structurally. The second
 * runs real broken drafts through the real schema and fails if ANY sentence a driver would be shown
 * still reads like a validator talking to a programmer. A conventional list of "check this message"
 * assertions would pass forever while a new `.min()` three schemas down leaks "Too small: expected
 * string to have >=1 characters" onto a phone.
 */

/** The keys of a Zod object, through whatever wrappers the contract put around it. */
function shapeKeys(schema: unknown): string[] {
  const direct = (schema as { shape?: Record<string, unknown> }).shape;
  if (direct) return Object.keys(direct);
  const def = (schema as { _def?: { schema?: unknown; innerType?: unknown } })._def;
  if (def?.schema) return shapeKeys(def.schema);
  if (def?.innerType) return shapeKeys(def.innerType);
  throw new Error("not an object schema");
}

describe("every field the contract has, named in words", () => {
  it("gives every top-level contract key a label", () => {
    // The structural half. A key added to `driverApplicationSchema` with no home here fails the
    // build rather than reaching a screen as its own column name.
    const missing = shapeKeys(driverApplicationObject).filter(
      (k) => !(k in FIELD_LABEL_KEYS.TOP),
    );
    expect(missing).toEqual([]);
  });

  it("gives every column of every repeated row a label", () => {
    const collections: Array<[string, unknown]> = [
      ["addresses", applicationAddressSchema],
      ["employers", applicationEmployerSchema],
      ["accidents", applicationAccidentSchema],
      ["violations", applicationViolationSchema],
      ["equipment_experience", applicationEquipmentSchema],
      ["additional_licences", applicationLicenceSchema],
    ];
    const missing: string[] = [];
    for (const [key, schema] of collections) {
      const columns = FIELD_LABEL_KEYS.ROWS[key]?.columns ?? {};
      for (const column of shapeKeys(schema)) {
        if (!(column in columns)) missing.push(`${key}.${column}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("numbers a row from one, because that is how a driver counts down a screen", () => {
    expect(describeField(["addresses", 1, "city"])).toBe("Address 2 · City");
    expect(describeField(["employers", 0, "reason_for_leaving"])).toBe("Employer 1 · Reason for leaving");
    expect(describeField(["other_names", 0])).toBe("Name 1");
    expect(describeField(["addresses", 2])).toBe("Address 3");
  });

  it("names a plain field the way the screen above it does", () => {
    expect(describeField(["cdl_number"])).toBe("Licence number");
    expect(describeField(["equipment_experience"])).toBe("Equipment you have driven");
  });

  it("builds one id per path, and the same id every time", () => {
    // The convention two places depend on: the field sets it, `focusFirstIssue` reads it back.
    expect(fieldId(["addresses", 1, "city"])).toBe("apply-addresses-1-city");
    expect(fieldId(["cdl_number"])).toBe("apply-cdl_number");
  });
});

describe("what a driver is told to do about it", () => {
  it("tells an empty box it is needed, and a short one that it is short", () => {
    // Same rule, two sentences, from the value rather than from a second copy of the rule.
    expect(messageFor({ code: "too_small", message: "x", path: ["phone"] }, "")).toBe("This is needed.");
    expect(messageFor({ code: "too_small", message: "x", path: ["phone"] }, "12")).toBe("This is too short.");
  });

  it("asks for at least one of an empty list", () => {
    expect(messageFor({ code: "too_small", message: "x", path: ["addresses"] }, [])).toBe("Add at least one.");
  });

  it("keeps a message that was written for this reader", () => {
    // `code: "custom"` is where APPLICATION_CROSS_FIELD_RULES and the date-of-birth refinement live.
    const rule = "List every accident in the last 3 years, or confirm there were none";
    expect(messageFor({ code: "custom", message: rule, path: ["accidents"] }, [])).toBe(rule);
  });

  it("says what a tick box needs, which no generated sentence does", () => {
    expect(messageFor({ code: "invalid_value", message: "Invalid input: expected true", path: ["certified"] }, false))
      .toBe("Tick the box to certify that your answers are true.");
  });

  it("reads a value out of the document by its path", () => {
    const doc = { addresses: [{ city: "Joliet" }] };
    expect(valueAt(doc, ["addresses", 0, "city"])).toBe("Joliet");
    expect(valueAt(doc, ["addresses", 9, "city"])).toBeUndefined();
    expect(valueAt(doc, ["nothing", "here"])).toBeUndefined();
  });
});

/**
 * ── THE ASSERTION THAT IS WORTH MORE THAN THE REST OF THIS FILE ───────────────────────────────
 *
 * Real drafts, the real schema, every issue it produces, and one question asked of every sentence:
 * could a driver have written this? It fails on the vocabulary of a validator rather than on a list
 * of known strings, so it keeps holding when somebody adds a rule nobody thought about here.
 */
const MACHINE_VOCABULARY =
  /expected|invalid input|invalid option|too small|too big|characters|>=|<=|zod|undefined|null|string|array|boolean/i;

describe("nothing a validator would say reaches a driver", () => {
  /** Broken in as many ways as the form can be broken, with every row anchored so it survives
   *  `toApplication`'s filtering and the NESTED rules actually fire. */
  function brokenDraft() {
    const d = emptyDraft();
    d.first_name = "x".repeat(200);
    d.email = "not-an-email";
    d.phone = "1";
    d.other_names = ["ok"];
    d.addresses = [{ ...emptyAddress(), line1: "1 Main St", from: "not-a-month" }];
    d.additional_licences = [{ ...emptyLicence(), number: "A1" }];
    d.equipment_experience = [{ ...emptyEquipment(), equipment_class: "bus", from: "nope" }];
    d.accidents = [{ ...emptyAccident(), nature: "Rear-end", fatalities: "x" }];
    d.violations = [{ ...emptyViolation(), offence: "Speeding" }];
    d.employers = [
      { ...emptyEmployer(), employer_name: "Acme", started_on: "2020-01-01", ended_on: "2019-01-01", email: "nope" },
    ];
    return d;
  }

  const shown = (draftLike: ReturnType<typeof emptyDraft>) => {
    const candidate = toApplication(draftLike);
    const parsed = driverApplicationSchema.safeParse(candidate);
    expect(parsed.success).toBe(false);
    return issuesFromParse(parsed.success ? [] : parsed.error.issues, candidate);
  };

  it("finds something to say about every broken field, in words", () => {
    const issues = [...shown(emptyDraft()), ...shown(brokenDraft())];
    // The guard against a vacuous pass: if the walker found nothing, everything below is trivially
    // true. Both drafts are broken in more than a dozen places.
    expect(issues.length).toBeGreaterThan(20);

    const offenders = issues
      .filter((i) => MACHINE_VOCABULARY.test(i.say))
      .map((i) => `${i.fieldId}: ${i.say}`);
    expect(offenders).toEqual([]);
  });

  it("never shows a contract key as a label", () => {
    const issues = [...shown(emptyDraft()), ...shown(brokenDraft())];
    const offenders = issues
      .filter((i) => /_/.test(i.label) || i.label === i.key)
      .map((i) => `${i.fieldId}: ${i.label}`);
    expect(offenders).toEqual([]);
  });

  it("gives every issue a control to go to, or a collection that has none", () => {
    // A path with an index always names one box. A bare collection key is a cross-field rule, and
    // `focusFirstIssue` falls back to the summary for those on purpose.
    for (const issue of shown(brokenDraft())) {
      expect(issue.fieldId.startsWith("apply-")).toBe(true);
      expect(issue.say.trim()).not.toBe("");
    }
  });
});
