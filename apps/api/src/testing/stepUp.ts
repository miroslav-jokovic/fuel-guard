import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../lib/stepUpToken.js";
import { testEnv } from "./testEnv.js";

/**
 * A real step-up token for a route test, and the key the route must verify it against.
 *
 * WHY THIS EXISTS (SP9, Q-SET8 (a), 2026-09-30). Every write on the Permissions and Users pages and on
 * invites now sits behind `requireFreshAuth()`, which is five route files whose tests stub
 * `getAppLocals` with a hand-built env. Each of them has to (1) put a signing key into that stub and
 * (2) mint a token under the SAME key, and a test that got either half wrong would refuse every
 * request — which reads as "the gate works" in a refusal test and as a wall of 403s everywhere else.
 * One key and one minting function, here, is the only way the two halves cannot drift apart.
 *
 * The token is minted with the production function, not faked: a test that forged the format would
 * go on passing after the format changed, and would prove nothing about the gate the route really has.
 *
 * `vi.mock` factories are hoisted above imports, so a stub reads the key through
 * `await import("../../../testing/stepUp.js")` inside the factory rather than from a top-level binding.
 */
export const STEP_UP_TEST_KEY = Buffer.alloc(32, 9).toString("base64");

const env = testEnv({ SECRETS_ENCRYPTION_KEY: STEP_UP_TEST_KEY });

/** The header a web client sends after the password prompt, for this user in this org. */
export function stepUpHeaders(userId: string, orgId: string): Record<string, string> {
  const minted = mintStepUpToken(env, userId, orgId);
  if (!minted) throw new Error("stepUpHeaders: the test key did not decode — fix STEP_UP_TEST_KEY");
  return { [STEP_UP_TOKEN_HEADER]: minted.token };
}
