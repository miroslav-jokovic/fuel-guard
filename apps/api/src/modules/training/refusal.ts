/** A refusal the routes turn into a status and a sentence the office (or the driver) can act on. */
export type TrainingRefusal = { refused: true; status: 400 | 403 | 404 | 409 | 410 | 422; code: string; message: string };

export const refuse = (status: TrainingRefusal["status"], code: string, message: string): TrainingRefusal => ({ refused: true, status, code, message });

export const isRefusal = (x: unknown): x is TrainingRefusal => typeof x === "object" && x != null && (x as TrainingRefusal).refused === true;

/** Postgres' own refusal of a frozen row (0648's TR0xx codes), in words. */
export function refusalFromDb(error: { code?: string; message?: string } | null): TrainingRefusal | null {
  if (!error?.code) return null;
  if (error.code === "TR004" || error.code === "TR010") return refuse(409, "published", "This video is published, so it cannot change. Upload a new version instead.");
  if (error.code === "TR005") return refuse(409, "too_few_questions", error.message ?? "This video needs more questions before it is published.");
  if (error.code === "TR041") return refuse(409, "not_ready", "The video is still being prepared for phones, or it failed. Wait for it to be ready.");
  if (error.code === "TR040") return refuse(404, "not_found", "No such video.");
  return null;
}
