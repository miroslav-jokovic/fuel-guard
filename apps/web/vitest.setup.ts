/**
 * What jsdom does not have and every drawer needs.
 *
 * ── WHY THIS FILE EXISTS RATHER THAN A FOURTH COPY OF THE STUB ──────────────────────────────────
 * Headless UI's `Dialog` observes its panel, and jsdom has no `ResizeObserver` at all. A suite that
 * OPENS a `SlideOver` or a `BaseModal` therefore throws inside a watcher — and the failure mode is
 * the worst kind: the assertions still pass, and the RUN fails on an unhandled rejection somewhere
 * that names none of them. `BaseModal.test.ts` carried the stub first and said exactly that in its
 * own comment.
 *
 * FUEL-C4 hit it a second time (`importRetired.test.ts`, mounting the three pages whose drawers it
 * relocated) and FUEL-C5 a third (`FuelReconciliationPage.test.ts`, opening the reconcile drawer).
 * Three copies of six lines is the point at which "promote the shared thing, do not copy it" applies
 * to test scaffolding as much as to code, so it is promoted here and the copies are deleted.
 *
 * ⚠ `??=`, not `=`: this runs before EVERY suite, including the ones that touch no dialog and the
 * ones that run in an environment which may one day provide the real thing. A stub that overwrote a
 * working implementation would be a test harness quietly disagreeing with the browser.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
