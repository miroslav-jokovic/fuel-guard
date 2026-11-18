import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";

const touched = ref(true);
vi.mock("@/composables/usePhoneFirst", () => ({ useTouchedWindow: () => touched }));

import PhoneContact from "./PhoneContact.vue";

describe("PhoneContact", () => {
  beforeEach(() => {
    touched.value = true;
  });

  it("on a touched window offers Call and Text links to the driver's number", () => {
    const w = mount(PhoneContact, { props: { phone: "512-555-0134", name: "Ana Diaz" } });
    expect(w.text()).toContain("(512) 555-0134");
    expect(w.get('a[aria-label="Call Ana Diaz"]').attributes("href")).toBe("tel:+15125550134");
    expect(w.get('a[aria-label="Text Ana Diaz"]').attributes("href")).toBe("sms:+15125550134");
  });

  it("at a desk with a mouse shows the number as plain text, no links", () => {
    touched.value = false;
    const w = mount(PhoneContact, { props: { phone: "5125550134", name: "Ana Diaz" } });
    expect(w.text()).toBe("(512) 555-0134");
    expect(w.findAll("a")).toHaveLength(0);
  });

  it("shows the number but no links when the caller says the person is not to be contacted", () => {
    const w = mount(PhoneContact, { props: { phone: "5125550134", name: "Ana Diaz", contactable: false } });
    expect(w.text()).toBe("(512) 555-0134");
    expect(w.findAll("a")).toHaveLength(0);
  });

  it("gives no links for a missing number or one no phone could dial", () => {
    expect(mount(PhoneContact, { props: { phone: null } }).findAll("a")).toHaveLength(0);
    const junk = mount(PhoneContact, { props: { phone: "n/a" } });
    expect(junk.findAll("a")).toHaveLength(0);
    expect(junk.text()).toBe("n/a");
  });
});
