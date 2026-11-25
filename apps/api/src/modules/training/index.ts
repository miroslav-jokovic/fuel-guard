/**
 * Training — the driver safety films, their quizzes, and who was sent them
 * (docs/plans/training/SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS-2026-11-24.md; tables 0646).
 *
 * The office adds films and questions and sends links on Safety → Training (`trainingRouter`); a driver
 * opens their link with no login (`publicTrainingRouter`). An upload becomes phone-sized videos in the
 * `training_transcode` job. Texting an applicant is recruiting's, handed in by app.ts (D-TR11).
 */
export { trainingRouter } from "./routes/office.js";
export { publicTrainingRouter } from "./routes/portal.js";
export { transcodeVersion } from "./transcode.js";
export type { TrainingTexter } from "./assignments.js";
