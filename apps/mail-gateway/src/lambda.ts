import { GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";
import { GetWebIdentityTokenCommand, STSClient } from "@aws-sdk/client-sts";
import postgres from "postgres";
import { pgDoor, type Sql, type SqlJson } from "./door.js";
import { graphGet } from "./graphClient.js";
import { graphWrite } from "./graphWrite.js";
import { consoleLogger, errorClass } from "./log.js";
import { runCycle } from "./runCycle.js";
import { federatedTokens } from "./token.js";

/**
 * The Lambda host (D-BMR1): builds the deps and calls `runCycle`. Nothing here decides anything.
 *
 * Settings come from Parameter Store under MAILGW_PARAM_PATH (setup.sh): DATABASE_URL (db-login.sh),
 * TENANT_ID, CLIENT_ID, CANARY_MAILBOX. There is no Microsoft secret to read — badge 2 has none.
 * They are read once per cold start; a rotated database password reaches the next cold start.
 *
 * The invoke payload is ignored: the schedule sends `{}`, and P4's wake-up invoke sends nothing
 * either (D-BMR11). No caller can steer a run.
 *
 * The commit is built into the bundle (build.mjs, `__MAILGW_COMMIT__`) and lands on the heartbeat row
 * (§6 Verify) — one value, the same in both environments, so no setting has to carry it.
 */

declare const __MAILGW_COMMIT__: string | undefined;
const COMMIT = typeof __MAILGW_COMMIT__ === "string" ? __MAILGW_COMMIT__ : "";

type Settings = { DATABASE_URL: string; TENANT_ID: string; CLIENT_ID: string; CANARY_MAILBOX: string };
let ready: Promise<{ settings: Settings; sql: ReturnType<typeof postgres> }> | null = null;

async function load(): Promise<{ settings: Settings; sql: ReturnType<typeof postgres> }> {
  const path = process.env.MAILGW_PARAM_PATH;
  if (!path) throw new Error("MAILGW_PARAM_PATH is not set");
  const ssm = new SSMClient({});
  const got: Record<string, string> = {};
  let NextToken: string | undefined;
  do {
    const r = await ssm.send(new GetParametersByPathCommand({ Path: path, WithDecryption: true, NextToken }));
    for (const p of r.Parameters ?? []) if (p.Name && p.Value) got[p.Name.slice(path.length + 1)] = p.Value;
    NextToken = r.NextToken;
  } while (NextToken);
  for (const k of ["DATABASE_URL", "TENANT_ID", "CLIENT_ID", "CANARY_MAILBOX"] as const) {
    if (!got[k]) throw new Error(`parameter ${k} is missing`);
  }
  const settings = got as Settings;
  // Transaction pooler: no prepared statements (D-BMR2); one connection, closed when idle.
  const sql = postgres(settings.DATABASE_URL, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
  return { settings, sql };
}

export async function handler(): Promise<{ outcome: string }> {
  try {
    ready ??= load().catch((e) => { ready = null; throw e; });
    const { settings, sql } = await ready;
    // GetWebIdentityToken is served only by regional STS endpoints (V7), so the endpoint is pinned.
    const sts = new STSClient({ endpoint: `https://sts.${process.env.AWS_REGION}.amazonaws.com` });
    const tokens = federatedTokens({
      tenantId: settings.TENANT_ID,
      clientId: settings.CLIENT_ID,
      now: () => new Date(),
      awsToken: async (req) => {
        const r = await sts.send(new GetWebIdentityTokenCommand({ Audience: [req.audience], SigningAlgorithm: req.signingAlgorithm, DurationSeconds: req.durationSeconds }));
        if (!r.WebIdentityToken) throw new Error("no token");
        return r.WebIdentityToken;
      },
      post: (url, body) => fetch(url, { method: "POST", body }),
    });
    const outcome = await runCycle({
      door: pgDoor(sql as unknown as Sql, ((v: unknown) => sql.json(v as never)) as SqlJson),
      graph: graphGet((url, init) => fetch(url, init), tokens),
      write: graphWrite((url, init) => fetch(url, init), tokens),
      log: consoleLogger,
      now: () => new Date(),
      commit: COMMIT,
      canaryMailbox: settings.CANARY_MAILBOX,
    });
    return { outcome };
  } catch (e) {
    consoleLogger({ event: "cycle_error", class: errorClass(e) });
    // Rethrown so Lambda counts an Error and the alarm (≥3 in 15 min) can fire. Deliberately WITHOUT
    // `cause`: Lambda writes a thrown error to the log group, and the original's message can hold a
    // mailbox address or Graph's error text — only the class name may leave this function (§6 Logs).
    // eslint-disable-next-line preserve-caught-error -- the cause is withheld on purpose, see above
    throw new Error(`mail gateway cycle failed: ${errorClass(e)}`);
  }
}
