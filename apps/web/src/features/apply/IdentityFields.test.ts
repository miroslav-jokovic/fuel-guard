import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { AppCombobox, AppDateField, AppInput } from "@silvicom/ui";
import IdentityFields from "@/features/apply/IdentityFields.vue";

/**
 * The identity step (AF3, D-AF1). What it must do: validate with the server's schema before asking,
 * send exactly the three values to this link, say so when the carrier already held some, and ask
 * for the licence's two sides and nothing else.
 */

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const TOKEN = "t".repeat(43);

const mountIt = () =>
  mount(IdentityFields, { props: { token: TOKEN, carrier: "Silvicom Inc", captures: [] } });

async function fill(w: ReturnType<typeof mountIt>, number = " PA334554 "): Promise<void> {
  w.findComponent(AppDateField).vm.$emit("update:modelValue", "1980-04-02");
  await w.findComponent(AppInput).find("input").setValue(number);
  w.findComponent(AppCombobox).vm.$emit("update:modelValue", "PA");
  await flushPromises();
}

const pressContinue = async (w: ReturnType<typeof mountIt>) => {
  const button = w.findAll("button").find((b) => b.text() === "Continue");
  await button!.trigger("click");
  await flushPromises();
};

beforeEach(() => fetchMock.mockReset());

describe("the identity step", () => {
  it("refuses to send a blank licence number, and says so beside the field", async () => {
    const w = mountIt();
    await fill(w, "   ");
    await pressContinue(w);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.emitted("done")).toBeUndefined();
    expect(w.find("#identity-number-description").text()).toBe("Enter the number on your licence.");
  });

  it("sends the three values, trimmed, to this link, and moves on", async () => {
    fetchMock.mockResolvedValue(ok({ ok: true, keptExisting: [] }));
    const w = mountIt();
    await fill(w);
    await pressContinue(w);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/public/application/${TOKEN}/identity`);
    expect(JSON.parse(String(init.body))).toEqual({ date_of_birth: "1980-04-02", cdl_number: "PA334554", cdl_state: "PA" });
    expect(w.emitted("done")).toHaveLength(1);
  });

  /**
   * Fill-only on the server (D-AF8): a value the carrier already held was kept. The applicant is
   * told once, before moving on — never what the value is — rather than left believing what they
   * typed is on file.
   */
  it("says when the carrier already had some of it, and moves on at the next press", async () => {
    fetchMock.mockResolvedValue(ok({ ok: true, keptExisting: ["date_of_birth"] }));
    const w = mountIt();
    await fill(w);
    await pressContinue(w);
    expect(w.text()).toContain("already had some of these on file");
    expect(w.emitted("done")).toBeUndefined();
    await pressContinue(w);
    expect(w.emitted("done")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for both sides of the licence and no other document", () => {
    const text = mountIt().text();
    expect(text).toContain("Front of your licence");
    expect(text).toContain("Back of your licence");
    expect(text).not.toMatch(/medical/i);
    expect(text).not.toMatch(/social security/i);
  });
});
