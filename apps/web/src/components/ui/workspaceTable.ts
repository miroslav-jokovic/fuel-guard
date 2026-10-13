import { inject, onBeforeUnmount, provide, reactive, watchEffect, type InjectionKey } from "vue";

/**
 * What a list's toolbar needs to know about the table beneath it (F15, US6b —
 * docs/plans/design-system/UI-STANDARDIZATION.md).
 *
 * The browser pass found every toolbar list printing "0 vehicles" while its read was still loading
 * and again after it had failed — the count was `rows.length`, and a list that has not answered has
 * no rows. A count is an answer, so it may only be printed when the table has one. The 46 callers
 * each knew their own query's state, but asking each of them to restate it beside `:count` is the
 * per-site copy the gate cannot check; the table they already hand `:loading` and `:error` to is the
 * one place that state is stated. So the workspace holds one record, the table writes it, and the
 * toolbar reads it.
 *
 * ⚠ One table per workspace (D-US1). A table nested inside the workspace's table (a cell, an
 * expanded row) re-provides `null`, so only the list's own table speaks for it.
 */
export interface WorkspaceTableState {
  loading: boolean;
  failed: boolean;
}

const KEY: InjectionKey<WorkspaceTableState | null> = Symbol("workspace-table");

/** `DataWorkspace` — opens the record its table and toolbar share. */
export function provideWorkspaceTable(): WorkspaceTableState {
  const state = reactive<WorkspaceTableState>({ loading: false, failed: false });
  provide(KEY, state);
  return state;
}

/** `DataTable` — reports its own state to the workspace it sits in, if any. */
export function reportToWorkspace(read: () => WorkspaceTableState): void {
  const state = inject(KEY, null);
  provide(KEY, null);
  if (!state) return;
  watchEffect(() => Object.assign(state, read()));
  onBeforeUnmount(() => Object.assign(state, { loading: false, failed: false }));
}

/** `FilterBar` — the workspace's table state, or null outside a workspace (a report's bar). */
export function useWorkspaceTable(): WorkspaceTableState | null {
  return inject(KEY, null);
}
