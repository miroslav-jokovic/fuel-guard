import { describe, expect, it } from "vitest";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { runEfsSoapIngest } from "./efsSoapIngest.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * `runEfsSoapIngest` promises, in its own doc comment, that it never throws — every failure lands on
 * the returned result AND on `efs_soap_credentials`. It did throw, on one line.
 *
 * The unseal of the SOAP password sat outside every try/catch. A rotated or missing
 * `SECRETS_ENCRYPTION_KEY`, or a row sealed under a key this deploy no longer holds, escaped into the
 * scheduler: the tick died, `posted_last_error` was never written, and the admin screen went on
 * showing the feed exactly as it looked when it last worked. **A feed that has stopped looked
 * identical to a feed that is idle** — which is the failure shape a poller must never have.
 *
 * The seal below is real and really unopenable; nothing here mocks the function under test.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const env = testEnv({
  EFS_SOAP_ENABLED: true,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
});

/** Well-formed enough to be attempted, and cryptographically impossible to open. */
const UNOPENABLE_SEAL = "v1.deadbeef.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB.CCCCCCCCCCCCCCCCCCCCCC";

const recorder = () =>
  createSupabaseRecorder({
    tables: {
      efs_soap_credentials: {
        data: {
          org_id: ORG,
          environment: "sandbox",
          endpoint_url: "https://ws.partner.efsllc.com/axis2/services/CardManagementWS/",
          soap_username: "user",
          soap_password: null,
          soap_password_sealed: UNOPENABLE_SEAL,
          account_id: null,
          posted_last_cursor: null,
          rejected_last_cursor: null,
          posted_last_polled_at: null,
          rejected_last_polled_at: null,
          posted_last_success_at: null,
          rejected_last_success_at: null,
          posted_last_error: null,
          rejected_last_error: null,
          enabled: true,
        },
        error: null,
      },
    },
  });

describe("an EFS credential that cannot be unsealed", () => {
  it("returns a failed result instead of throwing into the scheduler", async () => {
    const rec = recorder();

    // Before the fix this rejected, and the poller's tick died with it.
    const result = await runEfsSoapIngest(rec.client, env, ORG, "posted");

    expect(result.status).toBe("failed");
    expect(result.feed).toBe("posted");
    // The vendor's own diagnosis, not merely "something went wrong": a poller failure the operator
    // cannot act on is barely better than the silent one this replaced.
    expect(result.error).toMatch(/SECRETS_ENCRYPTION_KEY/);
  });

  it("writes the fault where an operator already looks", async () => {
    const rec = recorder();
    await runEfsSoapIngest(rec.client, env, ORG, "posted");

    // `posted_last_error` is the field the admin screen renders. A credential fault that does not
    // reach it is a stopped feed presented as a healthy one.
    const written = rec.writtenRows("efs_soap_credentials").at(-1);
    expect(written?.posted_last_error).toMatch(/credentials unavailable/i);
    // A real timestamp, not merely a non-empty value — the admin screen renders "last polled" from
    // this, and an unparseable string there reads as a healthy poll that happened at the epoch.
    expect(Number.isFinite(Date.parse(String(written?.posted_last_polled_at)))).toBe(true);
    // The failure must not masquerade as a success on the neighbouring column.
    expect(written?.posted_last_success_at).toBeUndefined();
  });

  it("does not report the fault as an absence of configuration", async () => {
    const rec = recorder();
    const result = await runEfsSoapIngest(rec.client, env, ORG, "rejected");

    // `skipped_no_config` means "this org has no EFS". A credential that EXISTS and cannot be opened
    // is a fault, and reporting it as absence is how it would stay invisible a second time.
    expect(result.status).not.toBe("skipped_no_config");
    expect(rec.writtenRows("efs_soap_credentials").at(-1)?.rejected_last_error)
      .toMatch(/credentials unavailable/i);
  });
});
