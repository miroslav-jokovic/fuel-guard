import { describe, it, expect } from "vitest";
import { mount, RouterLinkStub } from "@vue/test-utils";
import { SMS_STOP_KEYWORDS, alertTextHelpReply, smsHelpReply } from "@silvicom/shared";
import SmsTermsPage from "@/pages/legal/SmsTermsPage.vue";
import PrivacyPolicyPage from "@/pages/legal/PrivacyPolicyPage.vue";
import { SMS_PRIVACY_ANCHOR, SMS_PRIVACY_PATH, SMS_STAFF_ALERTS_ANCHOR } from "@/lib/legalPaths";

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

  // The second number's verification reviewer reads this section and nothing else (HOME-TIME HT6).
  it("gives office work alerts a section of their own: who gets them, the code, the hours, STOP and the exact HELP answer", () => {
    const page = mountPage(SmsTermsPage);
    expect(page.find(`#${SMS_STAFF_ALERTS_ANCHOR}`).text()).toBe("Work alert texts for office staff");
    const text = page.text().replace(/\s+/g, " ");
    expect(text).toContain("Silvicom 360 work alerts");
    expect(text).toContain("Applicants and drivers do not receive them");
    expect(text).toContain("6-digit code");
    expect(text).toContain("9:00 PM to 7:00 AM");
    expect(text).toContain("Reply STOP to any work alert");
    expect(text).toContain(alertTextHelpReply(window.location.host));
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

  /**
   * APPLY-PAGE-PLAN (2026-11-22): every way the code lets a person agree is named — the careers page's box
   * (`SMS_APPLY_PAGE_CONSENT`), the application page's box (`SMS_CONSENT`), a recruiter's attestation
   * (`SMS_OFFICE_INVITE_ATTESTATION`) — and every kind of message either box names is a kind the programme names, so
   * no box promises what the terms do not. What only a private application page has is said only of it.
   */
  it("names all three ways to agree, and never promises a careers-page lead an application page or an email", () => {
    const text = mountPage(SmsTermsPage).text().replace(/\s+/g, " ");
    expect(text).toContain("careers page when you apply for a job");
    expect(text).toContain("private driver application page");
    expect(text).toContain("ask the trucking company's recruiter to text you your application link");
    expect(text).toContain("A box is never ticked for you.");
    expect(text).not.toContain("tick the text-message box on your application page. The box is never ticked");
    expect(text).toContain("If you have a private application page, every message about it is also sent by email");
    expect(text).not.toMatch(/saying no changes nothing about your application: every message is also sent by email/);
  });

  it("names every kind of message the careers page's box and the application page's box say they send", () => {
    const text = mountPage(SmsTermsPage).text().replace(/\s+/g, " ").toLowerCase();
    // The careers page box: "application links, interview and orientation scheduling, and hiring updates".
    for (const kind of ["application links", "interview and orientation scheduling", "status"]) expect(text, kind).toContain(kind);
    // The application page box: "a link to your application form, reminders about steps you have not finished,
    // and updates on its status".
    for (const kind of ["a link to fill in your driver application", "a reminder if you have not finished a step"]) expect(text, kind).toContain(kind);
    expect(text).toContain("not a condition of applying, of being considered for a job, or of employment");
  });

  it("prints the company as its registration reads", () => {
    expect(mountPage(SmsTermsPage).text()).toContain("Silvicom Inc, 1301 Armitage Ave");
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
