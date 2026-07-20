import "dotenv/config";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { runSchemaCheck } from "./services/schemaCheck.js";
import { startAllSchedulers } from "./schedulers.js";

const env = loadEnv();
const app = createApp(env);

app.listen(env.PORT, () => {
  console.log(`[FuelGuard API] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  void runSchemaCheck(env); // warn loudly if a migration hasn't been applied
  if (env.RUN_SCHEDULERS_IN_PROCESS) {
    // Single-service deploy (default): this process also runs the background schedulers.
    startAllSchedulers(env);
  } else {
    console.log("[api] in-process schedulers disabled (RUN_SCHEDULERS_IN_PROCESS=false) — a dedicated worker service runs them");
  }
});
