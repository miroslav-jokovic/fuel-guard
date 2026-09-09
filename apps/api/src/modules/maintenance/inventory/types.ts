/**
 * The failure shape every inventory service returns, matching `inspections/serviceError.ts`'s
 * `TracedError` so the two halves of the maintenance module answer a route the same way.
 */
export type ServiceError = { error: string; code: string };

export const isServiceError = (v: unknown): v is ServiceError =>
  typeof v === "object" && v !== null && "error" in v && "code" in v;
