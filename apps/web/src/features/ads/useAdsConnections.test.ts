import { describe, expect, it } from "vitest";
import type { AdsConnectionReport } from "@silvicom/shared";
import { connectionRefusal, connectionRequest } from "./useAdsConnections";

/** The ad accounts' wire (E1b): each act reaches its own door, and a refusal keeps what the page acts on. */
const ID = "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a";
const ASK = { token: "EAAB".padEnd(40, "x"), account_id: "1234567", page_id: "7654321", sandbox: true };

describe("connectionRequest", () => {
  it.each([
    [{ kind: "meta", ask: ASK } as const, "/api/ads/connections/meta", ASK],
    [{ kind: "simulator" } as const, "/api/ads/connections/simulator", {}],
    [{ kind: "test", id: ID } as const, `/api/ads/connections/${ID}/test`, {}],
    [{ kind: "disconnect", id: ID } as const, `/api/ads/connections/${ID}/disconnect`, {}],
  ])("%j goes to its own door, with only a connect carrying the token", (act, path, body) => {
    expect(connectionRequest(act)).toEqual({ path, body });
  });
});

describe("connectionRefusal", () => {
  it("keeps a step-up refusal's code, so the page can ask for the password and run the act again", () => {
    const r = connectionRefusal({ error: { code: "step_up_required", message: "Confirm your password." }, detail: {} }, "disconnect");
    expect([r.code, r.message, r.report]).toEqual(["step_up_required", "Confirm your password.", undefined]);
  });

  it("carries a refused connect's report, which exists nowhere else — nothing was stored", () => {
    const report = { ok: false, checks: [{ key: "token", ok: false, detail: "Invalid OAuth access token." }] } as unknown as AdsConnectionReport;
    const r = connectionRefusal({ error: { code: "token_refused", message: "Meta does not accept this token. Nothing was saved." }, detail: { report } }, "meta");
    expect(r.report).toBe(report);
  });

  it("says which act failed when the API gave no sentence", () => {
    expect(connectionRefusal({ error: undefined, detail: undefined }, "test").message).toBe("Could not test the connection");
  });
});
