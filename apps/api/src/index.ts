import "dotenv/config";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { startSamsaraScheduler } from "./services/samsaraScheduler.js";
import { startRebuildOnBoot } from "./services/rebuildScheduler.js";
import { startDigestScheduler } from "./services/digestScheduler.js";

const env = loadEnv();
const app = createApp(env);

app.listen(env.PORT, () => {
  console.log(`[FuelGuard API] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  startSamsaraScheduler(env); // background auto-refresh of Samsara data
  startRebuildOnBoot(env); // one-time anomaly rebuild with the current rules (rules-only, idempotent)
  startDigestScheduler(env); // weekly AI theft digest email
});
