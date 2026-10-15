import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h, type Component } from "vue";
import { ConfirmHost, QUERY_DEFAULTS } from "@silvicom/ui";
import { routes } from "@/router";

/**
 * Mount one console page as the app would: a memory router over the console's OWN route table (the
 * lists keep their state in the URL through `useQueryState`, which awaits `router.replace`, and
 * `NotFoundState` reads `meta.parent`), Pinia, and a query client with the app's defaults but no
 * retries, so a failed read fails at once. The page is mounted directly, so no route's lazy page loads.
 *
 * `AppShell` is replaced by its slot: it reads the session and the support grants, which are not what
 * a page test is about.
 */
export async function mountPage(page: Component, url: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(url);
  await router.isReady();
  const client = new QueryClient({ defaultOptions: { queries: { ...QUERY_DEFAULTS.queries, retry: false } } });
  const Host = defineComponent({ render: () => [h(page), h(ConfirmHost)] });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [router, pinia, [VueQueryPlugin, { queryClient: client }]],
      stubs: { AppShell: defineComponent({ render() { return h("div", this.$slots.default?.()); } }) },
    },
  });
  await settle();
  return { wrapper, router, pinia };
}

export async function settle() {
  for (let i = 0; i < 6; i++) {
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
  }
}
