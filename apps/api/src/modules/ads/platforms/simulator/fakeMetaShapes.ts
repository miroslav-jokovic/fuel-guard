/** The two answer shapes FakeMeta and its parts share (`fakeMeta.ts` header cites the pages). */

export function graphError(status: number, code: number, type: string, message: string, fbtrace_id: string, error_subcode?: number) {
  return { status, body: { error: { message, type, code, ...(error_subcode === undefined ? {} : { error_subcode }), fbtrace_id } } };
}

/** `fields=` as Graph answers it: the named fields plus the defaults; no `fields` = defaults only. */
export function pick(row: Record<string, unknown>, fields: string | undefined, defaults: string[]): Record<string, unknown> {
  const want = new Set([...defaults, ...(fields ? fields.split(",").map((f) => f.trim()).filter(Boolean) : [])]);
  return Object.fromEntries(Object.entries(row).filter(([k]) => want.has(k)));
}
