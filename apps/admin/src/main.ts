import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { QUERY_DEFAULTS } from "@silvicom/ui";
import App from "@/App.vue";
import { router } from "@/router";
import "@/style.css";

// The same read vocabulary as the web app (US7, D-US11): TanStack Query, with a missing record asked
// about once rather than retried (`QUERY_DEFAULTS`, F21).
createApp(App)
  .use(createPinia())
  .use(router)
  .use(VueQueryPlugin, { queryClientConfig: { defaultOptions: QUERY_DEFAULTS } })
  .mount("#app");
