import { initColorScheme } from "@/composables/useColorScheme";
import { createApp } from "vue";
import * as Sentry from "@sentry/vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "@/App.vue";
import { router } from "@/router";
import "@vuepic/vue-datepicker/dist/main.css";
import "@/style.css"; // after the datepicker CSS so token overrides win

// Replay the stored colour-scheme override before first paint (D-DS2b).
initColorScheme();

const app = createApp(App);

// Sentry error monitoring — no-op unless VITE_SENTRY_DSN is set, so dev/preview builds are unaffected.
// Errors-only by default (tracesSampleRate 0); no PII collected. Mirrors the API's @sentry/node setup.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    app,
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0),
    sendDefaultPii: false,
  });
}

app.use(createPinia()).use(router).use(VueQueryPlugin).mount("#app");
