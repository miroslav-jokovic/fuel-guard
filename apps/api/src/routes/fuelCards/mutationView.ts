/**
 * One ledger row, as a page may see it.
 *
 * Shared by the per-card history and the account-wide change log so the two cannot describe the same
 * row differently — and so the column list stays in one place. The ledger also carries
 * `before_document`, `after_document` and redacted vendor XML; none of it belongs in a page render,
 * which is why both callers select explicit columns rather than `*`.
 */
export interface MutationRow {
  id: string; intent: string; status: string;
  requested_by: string | null; step_up: boolean;
  created_at: string; completed_at: string | null;
  efs_fault_code: string | null; efs_fault_message: string | null;
  drift: { unexplained?: { path: string }[] } | null;
}

export const toMutationView = (row: unknown) => {
  const r = row as MutationRow;
  return {
    id: r.id,
    intent: r.intent,
    status: r.status,
    requestedBy: r.requested_by,
    stepUp: r.step_up,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    efsFaultCode: r.efs_fault_code,
    efsFaultMessage: r.efs_fault_message,
    driftFields: r.drift?.unexplained?.map((d) => d.path) ?? null,
  };
};
