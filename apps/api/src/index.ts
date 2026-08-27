import "dotenv/config";
import "./instrument.js"; // Sentry init — must load before the app + its instrumented libs
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { runSchemaCheck } from "./services/schemaCheck.js";
import { startAllSchedulers } from "./schedulers.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { sealPlaintextSamsaraTokens } from "./lib/samsaraToken.js";

const env = loadEnv();
const app = createApp(env);

app.listen(env.PORT, () => {
  console.log(`[Silvicom 360 API] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  void runSchemaCheck(env); // warn loudly if a migration hasn't been applied
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    // Seal any legacy plaintext Samsara tokens at rest (no-op once sealed; warns if the key is unset).
    void sealPlaintextSamsaraTokens(getSupabaseAdmin(env), env).catch((e) =>
      console.error("[boot] token seal sweep failed:", e instanceof Error ? e.message : e),
    );
  }
  if (env.RUN_SCHEDULERS_IN_PROCESS) {
    // Single-service deploy (default): this process also runs the background schedulers.
    startAllSchedulers(env);
  } else {
    console.log("[api] in-process schedulers disabled (RUN_SCHEDULERS_IN_PROCESS=false) — a dedicated worker service runs them");
  }
});
