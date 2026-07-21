import "dotenv/config";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = createApp(env);

app.listen(env.PORT, () => {
  console.log(`[FuelGuard Admin API] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
