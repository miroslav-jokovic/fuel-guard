import { describe, expect, it } from "vitest";
import {
  maskEmail,
  maskPhone,
  renderUnlockCodeEmail,
  renderUnlockCodeText,
  unlockCodeRequestSchema,
  unlockCodeVerifySchema,
} from "./applicationUnlockCodeContract.js";

describe("the unlock code's contract (F0b)", () => {
  it("takes a channel and a language, and refuses an address — the code goes where the link went", () => {
    expect(unlockCodeRequestSchema.parse({ channel: "email" })).toEqual({ channel: "email", language: "en" });
    expect(unlockCodeRequestSchema.safeParse({ channel: "email", to: "someone@else.test" }).success).toBe(false);
    expect(unlockCodeRequestSchema.safeParse({ channel: "fax" }).success).toBe(false);
  });

  it("forgives spaces and dashes in the six digits, and refuses anything else", () => {
    expect(unlockCodeVerifySchema.parse({ code: "042 917" }).code).toBe("042917");
    expect(unlockCodeVerifySchema.parse({ code: "042-917" }).code).toBe("042917");
    for (const code of ["04291", "0429170", "abcdef", ""]) expect(unlockCodeVerifySchema.safeParse({ code }).success, code).toBe(false);
  });

  it("masks an address down to what tells the driver which inbox to open", () => {
    expect(maskEmail("susan.godfrey@example.test")).toBe("s•••@example.test");
    expect(maskEmail("broken")).toBe("•••");
    expect(maskPhone("+13125550142")).toBe("•••-•••-0142");
    expect(maskPhone("0142")).toBe("•••-•••-0142");
    expect(maskPhone("")).toBe("•••");
  });

  it("writes the code into the email and the text in the page's language, with what to do if unasked", () => {
    const en = renderUnlockCodeEmail("Silvicom", "042917", "en");
    expect(en.subject).toBe("Your code for your Silvicom application");
    expect(en.html).toContain("042917");
    expect(en.text).toContain("If you did not ask for a code");
    const es = renderUnlockCodeEmail("Silvicom", "042917", "es");
    expect(es.subject).toBe("Su código para su solicitud con Silvicom");
    expect(es.text).toContain("Si usted no pidió un código");
    expect(renderUnlockCodeText("Silvicom", "042917", "en")).toMatch(/^042917 is your code.*Reply STOP to opt out\.$/);
  });

  it("escapes the carrier's name in the email's HTML", () => {
    expect(renderUnlockCodeEmail("<b>Acme</b>", "042917", "en").html).not.toContain("<b>Acme</b>");
  });
});
