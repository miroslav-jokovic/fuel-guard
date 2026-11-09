/** The two answer shapes FakeMeta and its parts share (`fakeMeta.ts` header cites the pages). */

export function graphError(status: number, code: number, type: string, message: string, fbtrace_id: string, error_subcode?: number) {
  return { status, body: { error: { message, type, code, ...(error_subcode === undefined ? {} : { error_subcode }), fbtrace_id } } };
}

/** `fields=` as Graph answers it: the named fields plus the defaults; no `fields` = defaults only. */
export function pick(row: Record<string, unknown>, fields: string | undefined, defaults: string[]): Record<string, unknown> {
  const want = new Set([...defaults, ...fieldNames(fields)]);
  return Object.fromEntries(Object.entries(row).filter(([k]) => want.has(k)));
}

/**
 * The top-level names of a `fields=` list, with Graph's field expansion (`context_card{title,content}`)
 * read as its name. The fake answers an expanded field with the whole object it holds: every sub-field
 * it stores is one our callers ask for, so the subset is the object (LQ1).
 */
export function fieldNames(fields: string | undefined): string[] {
  const out: string[] = [];
  let depth = 0;
  let name = "";
  for (const ch of fields ?? "") {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) { if (name.trim()) out.push(name.trim()); name = ""; }
    else if (depth === 0) name += ch;
  }
  if (name.trim()) out.push(name.trim());
  return out;
}
