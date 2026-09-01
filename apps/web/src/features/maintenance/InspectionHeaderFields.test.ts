import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import InspectionHeaderFields from "@/features/maintenance/InspectionHeaderFields.vue";

/**
 * The two header values the printed form carries and nothing could capture.
 *
 * ── WHY THE AGENCY SPLIT IS THE PART WORTH PINNING ─────────────────────────────────────────────
 * The column is ONE line, because the form is one cell — but the office asked for a company and a
 * location separately, so this component presents one stored string as two boxes. That is a
 * presentation, not a second representation, and the way a presentation like this goes wrong is
 * silently: a value that does not survive being loaded, edited and loaded again. So the round trip
 * is the test.
 */

const fields = (props: Record<string, unknown> = {}) =>
  mount(InspectionHeaderFields, {
    props: { decalSerial: null, agency: null, carrierName: "Silvicom Inc", ...props },
  });

const labelled = (w: ReturnType<typeof fields>, label: string) => {
  const field = w.findAll("label").find((l) => l.text().startsWith(label));
  expect(field, `no field labelled "${label}"`).toBeTruthy();
  return w.find(`#${field!.attributes("for")}`);
};

describe("the decal serial", () => {
  it("is offered as its own field, because it is the form's report number box", () => {
    // Measured from the office's own filed reports: 610685784 on trailer 535968, 610641628 on
    // tractor 654. Every real report carries one; the product could not record it at all.
    const w = fields({ decalSerial: "610685784" });
    expect((labelled(w, "Sticker number").element as HTMLInputElement).value).toBe("610685784");
  });

  it("emits null rather than an empty string when it is cleared", async () => {
    // The column is nullable on purpose — a failed inspection gets no decal — and `''` is not null.
    const w = fields({ decalSerial: "610685784" });
    await labelled(w, "Sticker number").setValue("  ");
    expect(w.emitted("update:decalSerial")?.at(-1)).toEqual([null]);
  });
});

describe("who performed the inspection", () => {
  it("defaults to the carrier's own technician and prints nothing", () => {
    // Both filed samples leave INSPECTION AGENCY/LOCATION blank, correctly: the MOTOR CARRIER
    // OPERATOR block directly above it already names the company.
    const w = fields();
    // Read off the control rather than the rendered text: a combobox shows its selection as the
    // value of an input, which `w.text()` cannot see.
    const options = w.findComponent({ name: "AppCombobox" }).props("options") as Array<{ label: string }>;
    expect(options[0]!.label).toBe("Silvicom Inc — our own technician");
    expect(w.findAll("label").some((l) => l.text().startsWith("Company"))).toBe(false);
  });

  it("asks for a company and a location once an outside shop is chosen", async () => {
    const w = fields();
    w.findComponent({ name: "AppCombobox" }).vm.$emit("update:modelValue", "outside");
    await w.vm.$nextTick();

    await labelled(w, "Company").setValue("Peterbilt of Chicago");
    await labelled(w, "Company").trigger("blur");
    await labelled(w, "Location").setValue("Melrose Park IL");
    await labelled(w, "Location").trigger("blur");

    expect(w.emitted("update:agency")?.at(-1)).toEqual(["Peterbilt of Chicago, Melrose Park IL"]);
  });

  it("loads a stored line back into the two boxes it was written from", () => {
    // The round trip. A split that cannot rebuild what it wrote loses an office's typing on reload.
    const w = fields({ agency: "Peterbilt of Chicago, Melrose Park IL" });
    expect((labelled(w, "Company").element as HTMLInputElement).value).toBe("Peterbilt of Chicago");
    expect((labelled(w, "Location").element as HTMLInputElement).value).toBe("Melrose Park IL");
  });

  it("puts a line with no comma entirely in the company box, losing nothing", () => {
    const w = fields({ agency: "PETERBILT OF CHICAGO" });
    expect((labelled(w, "Company").element as HTMLInputElement).value).toBe("PETERBILT OF CHICAGO");
    expect((labelled(w, "Location").element as HTMLInputElement).value).toBe("");
  });

  it("clears the stored line when the work goes back to being in-house", async () => {
    const w = fields({ agency: "Peterbilt of Chicago, Melrose Park IL" });
    w.findComponent({ name: "AppCombobox" }).vm.$emit("update:modelValue", "in_house");
    await w.vm.$nextTick();
    expect(w.emitted("update:agency")?.at(-1)).toEqual([null]);
  });

  it("warns when the line is longer than the cell holds, without refusing it", async () => {
    // 158 pt at a 5.5 pt floor is about 47 characters — measured against pdf-lib's Helvetica and
    // pinned in the renderer's `layout.test.ts`. A warning and not a block: the office may know
    // something the measurement does not, and the renderer shrinks before it overflows.
    const w = fields({ agency: "Peterbilt of Chicago, 1301 Armitage Ave Melrose Park IL 60160" });
    await w.vm.$nextTick();
    expect(w.text()).toContain("About 47 characters fit on the line and this is 61");
    expect(w.text()).toContain("it will print smaller");
  });
});
