import { describe, it, expect } from "vitest";
import { resolveMedicalExpiry } from "./credentialSources.js";

/**
 * Q-MSUX7 (owner, 2026-10-13): a scanned card wins; without one, the earliest source date wins and the
 * driver is flagged when sources disagree. The property everything else rests on is the last block:
 * the answer does not depend on which sweep asks, so McLeod and Med-Stop cannot take turns filing.
 */
const mcleod = (d: string) => ({ source: "mcleod" as const, expiresOn: d });
const medstop = (d: string) => ({ source: "medstop" as const, expiresOn: d });

describe("resolveMedicalExpiry", () => {
  it("keeps a scanned card over a later vendor date, and flags the difference", () => {
    const r = resolveMedicalExpiry({ expiresOn: "2026-11-01", documented: true }, [mcleod("2027-11-01")]);
    expect(r).toEqual({ expiresOn: "2026-11-01", rule: "documented", disagree: true });
  });

  it("keeps a scanned card over an EARLIER vendor date too", () => {
    const r = resolveMedicalExpiry({ expiresOn: "2026-11-01", documented: true }, [medstop("2026-05-01")]);
    expect(r.expiresOn).toBe("2026-11-01");
    expect(r.disagree).toBe(true);
  });

  it("does not flag a scanned card every source agrees with", () => {
    const r = resolveMedicalExpiry({ expiresOn: "2026-11-01", documented: true }, [mcleod("2026-11-01"), medstop("2026-11-01")]);
    expect(r.disagree).toBe(false);
  });

  it("without a scan, files the EARLIEST source date and flags the disagreement", () => {
    const r = resolveMedicalExpiry({ expiresOn: "2027-03-01", documented: false }, [mcleod("2027-03-01"), medstop("2026-12-15")]);
    expect(r).toEqual({ expiresOn: "2026-12-15", rule: "earliest", disagree: true });
  });

  it("a scan with no expiry on it does not win — the sources decide", () => {
    const r = resolveMedicalExpiry({ expiresOn: null, documented: true }, [mcleod("2027-03-01")]);
    expect(r).toEqual({ expiresOn: "2027-03-01", rule: "earliest", disagree: false });
  });

  it("has no opinion when no source has a date", () => {
    expect(resolveMedicalExpiry({ expiresOn: "2027-03-01", documented: false }, [])).toEqual({ expiresOn: null, rule: "none", disagree: false });
    expect(resolveMedicalExpiry(null, [])).toEqual({ expiresOn: null, rule: "none", disagree: false });
  });

  it("reads timestamps as calendar days", () => {
    const r = resolveMedicalExpiry(null, [mcleod("2027-03-01T00:00:00Z"), medstop("2027-03-01")]);
    expect(r).toEqual({ expiresOn: "2027-03-01", rule: "earliest", disagree: false });
  });

  it("gives the same answer whichever order the sources arrive in (no ping-pong)", () => {
    const a = resolveMedicalExpiry({ expiresOn: "2027-03-01", documented: false }, [mcleod("2027-03-01"), medstop("2026-12-15")]);
    const b = resolveMedicalExpiry({ expiresOn: "2026-12-15", documented: false }, [medstop("2026-12-15"), mcleod("2027-03-01")]);
    expect(a.expiresOn).toBe(b.expiresOn);
  });
});
