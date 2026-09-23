import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { EfsSoapError } from "../lib/efsSoapSession.js";
import { controlErrorResponse } from "./controlPrepare.js";
import { efsErrorResponse } from "./read.js";

/**
 * A vendor fault reaching the browser is PAN-redacted (2026-09-22 security audit).
 *
 * EFS faults can quote the request back, and a getCardv2 request carries the card number. Both
 * routers put `error.message` in the response; `probe.ts` already redacted its copy, these two did not.
 */

const PAN = "7083050012345678901";

function capture(): { res: Response; sent: () => { error: { message: string } } } {
  let body: unknown;
  const res = {
    status() { return res; },
    json(payload: unknown) { body = payload; return res; },
  } as unknown as Response;
  return { res, sent: () => body as { error: { message: string } } };
}

const fault = () => new EfsSoapError(`EFS rejected getCardV2: card ${PAN} is not on this account`, "soap_fault");

describe.each([
  ["card control (controlErrorResponse)", controlErrorResponse],
  ["card reads (efsErrorResponse)", efsErrorResponse],
])("%s", (_name, respond) => {
  it("does not hand the card number back to the browser", () => {
    const { res, sent } = capture();
    respond(res, fault());
    expect(sent().error.message).not.toContain(PAN);
    // Still useful: the last four survive, so an operator can tell which card the vendor meant.
    expect(sent().error.message).toContain("8901");
  });
});
