2026-11-24 · Q-DV8 (g) · Every failed request reaches a driver as a sentence (D-DV26).
- `apps/driver/src/lib/errorWords.ts` chooses the words by status; a 403, 409 or 422 with its own code keeps the route's words. The status, code and server text move to `detail`. Tests: `apps/driver/tests/error-words.test.ts` ("never shows a status number to a driver, whatever the status").
- `lint:design` refuses `HTTP ${…}` outside `errorWords.ts`, `api.ts` and the build card (checked with a probe file: it failed, then passed once removed).
