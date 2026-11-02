import { afterAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../../env.js";
import { seal, secretAad } from "../../../lib/secretBox.js";
import { metaPageTokenPurpose, metaTokenPurpose, pageGraphForConnection, stopSimulatorForTests } from "./registry.js";

/** B2b: the Page client a form is made with — its own seal, and the simulator only off production. */
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const ORG = "00000000-0000-4000-8000-0000000000a1";
const conn = (patch: Record<string, unknown> = {}) => ({ id: "c1", org_id: ORG, provider: "meta", is_sandbox: false, token_sealed: null, page_token_sealed: null, ...patch });
afterAll(() => stopSimulatorForTests());

describe("pageGraphForConnection", () => {
  it("opens the Page token under its own purpose; the system user's sealed token does not open as a Page token", async () => {
    const page = seal(env, "EAAB-page", secretAad(ORG, metaPageTokenPurpose(false)));
    expect(await pageGraphForConnection({ env }, conn({ page_token_sealed: page }))).toMatchObject({ ok: true, simulated: false });
    const user = seal(env, "EAAB-user", secretAad(ORG, metaTokenPurpose(false)));
    expect(await pageGraphForConnection({ env }, conn({ page_token_sealed: user }))).toMatchObject({ ok: false, error_code: "token_unreadable" });
    // A sandbox Page token does not open as the live one either.
    const sandbox = seal(env, "EAAB-page", secretAad(ORG, metaPageTokenPurpose(true)));
    expect(await pageGraphForConnection({ env }, conn({ page_token_sealed: sandbox }))).toMatchObject({ ok: false, error_code: "token_unreadable" });
    expect(await pageGraphForConnection({ env }, conn())).toMatchObject({ ok: false, error_code: "no_token" });
  });

  it("hands out the simulator's Page client only on a positively non-production host", async () => {
    const sim = conn({ provider: "simulator" });
    expect(await pageGraphForConnection({ env, processEnv: { NODE_ENV: "production" } }, sim)).toMatchObject({ ok: false, error_code: "simulator_not_allowed" });
    expect(await pageGraphForConnection({ env, processEnv: { NODE_ENV: "test" } }, sim)).toMatchObject({ ok: true, simulated: true });
  });
});
