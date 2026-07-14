import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "@/App.vue";
import { router } from "@/router";
import "@vuepic/vue-datepicker/dist/main.css";
import "@/style.css"; // after the datepicker CSS so token overrides win

createApp(App).use(createPinia()).use(router).use(VueQueryPlugin).mount("#app");
