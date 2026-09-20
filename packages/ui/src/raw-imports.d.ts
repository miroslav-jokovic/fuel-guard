/**
 * Vite's `?raw` suffix, declared so `vue-tsc` knows what it yields.
 *
 * Used by `AppIconChip.test.ts`'s "shares its tone names with AppBadge, exactly" to read
 * `AppBadge.vue`'s `tone` union out of its SOURCE. There is no runtime route to that list: Vue
 * compiles `defineProps<{ tone?: "danger" | … }>()` down to `{ tone: { type: String } }`, so the
 * union is erased before anything can inspect it — the text of the file is the only place the names
 * survive. The alternative, retyping the seven names into the test, is a copy that agrees with
 * itself and cannot go red when the badge gains an eighth.
 *
 * ⚠ Not `node:fs` + `import.meta.url`, which is the obvious way and throws: under vitest's
 * transform `import.meta.url` is not a `file:` URL (`ERR_INVALID_URL_SCHEME`), and a cwd-relative
 * path would depend on whether the runner started in `packages/ui` or at the repo root — CI does
 * the latter.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
