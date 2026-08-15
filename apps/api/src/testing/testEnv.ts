import { loadEnv, type Env } from "../env.js";

/**
 * A real, fully-defaulted `Env` for tests, with typed overrides.
 *
 * WHY THIS EXISTS (Step 5.9). Test fixtures used to build an environment as
 * `{ EFS_SOAP_MAX_RPS: 100 } as unknown as Env` — 88 of them across 42 files. That cast produces an
 * object missing every key it does not mention, which is a shape `loadEnv` can never return: the zod
 * schema applies `.default()` to those keys, so in a running process they are always present.
 *
 * That gap is what made `env.X ?? <literal>` look load-bearing. The literal was unreachable in
 * production and reachable only in tests, so deleting the duplicated defaults turned 62 tests red at
 * once — tests that had been exercising an `undefined` no deployment can produce. The `??` was not
 * protecting the product; it was propping up the fixtures.
 *
 * So the fixture is the thing that had to change. `testEnv()` parses the schema exactly as the
 * process does and then applies overrides, which means a test sees the same defaults production
 * sees, and `Partial<Env>` makes a mistyped or renamed key a compile error rather than a silent
 * `undefined`.
 *
 * Use this instead of casting. `envCasts.test.ts` fails the build on a new `as unknown as Env`.
 */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv), ...overrides };
}
