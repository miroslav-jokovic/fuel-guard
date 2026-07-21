/** Structured error envelope for the platform API. Never leak upstream errors verbatim. */
export function apiError(code: string, message: string) {
  return { error: { code, message } };
}
