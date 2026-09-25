import { describe, it, expect } from "vitest";
import { mount, RouterLinkStub } from "@vue/test-utils";
import { SMS_STOP_KEYWORDS, smsHelpReply } from "@silvicom/shared";
import SmsTermsPage from "@/pages/legal/SmsTermsPage.vue";
import PrivacyPolicyPage from "@/pages/legal/PrivacyPolicyPage.vue";
import { SMS_PRIVACY_ANCHOR, SMS_PRIVACY_PATH } from "@/lib/legalPaths";

/**
 * The two pages a toll-free verification reviewer opens from the opt-in screenshot (SMS-OPT-IN-PLAN
 * SMS3, D-SMS4).
 *
 * ⚠ The keyword list and the HELP answer are read from the constants the webhook itself uses. These
 * tests are what make that a property rather than a habit: a keyword the webhook honours but the page
 * does not print, or a HELP reply the page misquotes, turns one of them red.
 */
const mountPage = (page: unknown) =>
  mount(page as never, { global: { stubs: { RouterLink: RouterLinkStub } } });

describe("the text message terms", () => {
  it("prints every stop word the webhook honours, and the exact HELP answer", () => {
    const text = mountPage(SmsTermsPage).text();
    for (const k of SMS_STOP_KEYWORDS) expect(text).toContain(k.toUpperCase());
    expect(text).toContain(smsHelpReply(window.location.host));
  });

  it("says agreeing is optional, and names rates and frequency", () => {
    const text = mountPage(SmsTermsPage).text();
    expect(text).toContain("not a condition of applying");
    expect(text).toContain("Message and data rates may apply");
    expect(text).toContain("Message frequency varies");
  });

  it("names the programme, says it is not marketing, and carries the no-sharing sentence", () => {
    const text = mountPage(SmsTermsPage).text();
    expect(text).toContain("Silvicom 360 driver application texts");
    expect(text).toContain("We do not send marketing or promotional messages");
    expect(text).toContain("opt-in and consent are not shared with any third party");
    expect(text).toContain("Mobile carriers are not liable");
  });

  it("links to the privacy section the opt-in card links to", () => {
    const links = mountPage(SmsTermsPage).findAllComponents(RouterLinkStub).map((l) => l.props("to"));
    expect(links).toContain(SMS_PRIVACY_PATH);
  });
});

describe("the privacy policy's text-message section", () => {
  it("exists at the anchor the card links to, and promises no sale or marketing share", () => {
    const w = mountPage(PrivacyPolicyPage);
    const heading = w.find(`#${SMS_PRIVACY_ANCHOR}`);
    expect(heading.exists()).toBe(true);
    // The two sentences a verification reviewer reads for, in the form carriers expect.
    expect(w.text()).toContain("No mobile information will be shared with third parties or affiliates for marketing");
    expect(w.text()).toContain("opt-in data and consent will not be shared with any third parties");
  });
});
