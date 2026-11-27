import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ORIGIN, STORAGE_ORIGIN } from "./stubApi";

/**
 * The driver's training link (`/t/<token>`, SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8–§9; SEGMENT-QUIZ
 * D-TR13–D-TR15), BUILT and served by the API's own `mountWebSpa` under production's headers, against a
 * stubbed `/api/public/training/:token` that keeps the server's segment rules.
 *
 * What only a browser shows:
 *   · `/t/<token>` opens the small page (`t.html`), not the office app.
 *   · The film is let out to storage (`media-src`; with none, every film was refused, 2026-11-25).
 *   · The film PAUSES at the end of a segment, reports what played, and the questions open.
 *   · What counts as watching (§3.1): a muted film and a hidden page pause it; skipping ahead is undone.
 *   · A wrong answer is not told the right one (D-TR15); a miss sends the driver back to the segment.
 *   · An answer given with no signal waits on the phone.
 *
 * ⚠ The film is a committed 8-second, 10 KB WebM (`fixtures/training-film.webm`, ffmpeg's lavfi colour
 * and sine), not one of the films: Chromium here has no H.264, so an MP4 never plays, and a page that
 * never plays cannot be shown pausing at a stop. Served under the `.mp4` name the API signs.
 *
 * Raw JSON, as the surface answers: no `{ ok, data }` envelope, errors as `{ error: { code, message } }`.
 */

const TOKEN = "e2eTrainingLink_0123-abc"; // 24 characters of the base64url alphabet
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const Q = ["44444444-4444-4444-8444-444444444441", "44444444-4444-4444-8444-444444444442", "44444444-4444-4444-8444-444444444443"];
const RIGHT = "b";
const FILM = readFileSync(new URL("./fixtures/training-film.webm", import.meta.url));
const FILM_PATH = `/storage/v1/object/sign/training-media/${V1}/360.mp4`;
/** The test film's segment: 0:00–0:03, then the closing to 0:08. */
const STOP = { chapter: 0, title: "Get out and look", startMs: 0, endMs: 3000 };

interface Stub {
  status: "watch" | "quiz" | "rewatch" | "passed";
  answers: Array<{ questionId: string; choiceId: string }>;
  progress: Array<{ fromMs: number; toMs: number }>;
  filmRequests: string[];
  cutAnswers: boolean;
}

async function stubTraining(page: Page, status: Stub["status"] = "watch"): Promise<Stub> {
  const stub: Stub = { status, answers: [], progress: [], filmRequests: [], cutAnswers: false };
  const base = `/api/public/training/${TOKEN}`;
  const poster = (v: string) => `${STORAGE_ORIGIN}/storage/v1/object/sign/training-media/${v}/poster.jpg`;

  await page.route((url) => url.origin !== ORIGIN && url.origin !== STORAGE_ORIGIN, (route) => route.abort("blockedbyclient"));
  await page.route(`${STORAGE_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(".mp4")) {
      stub.filmRequests.push(path);
      return route.fulfill({ status: 200, contentType: "video/webm", body: FILM });
    }
    await route.fulfill({ status: 200, contentType: "image/jpeg", body: "" });
  });
  await page.route(`${ORIGIN}/api/public/training/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (path === base) {
      return json({
        carrier: "Silvicom Inc", firstName: "Dana", courseTitle: "Safety basics", dueOn: "2026-12-09", complete: false,
        lessons: [
          { lessonId: V1, versionId: V1, title: "Backing up", durationMs: 8000, posterUrl: poster(V1), status: stub.status },
          { lessonId: V2, versionId: V2, title: "Winter driving", durationMs: 8000, posterUrl: poster(V2), status: "locked" },
        ],
      });
    }
    if (path === `${base}/films/${V1}`) {
      return json({
        versionId: V1, title: "Backing up", durationMs: 8000, posterUrl: poster(V1), captionsUrl: null, positionMs: 0,
        watched: stub.status === "watch" ? [] : [[0, 3000]], status: stub.status,
        chapters: [{ title: STOP.title, startMs: 0 }, { title: "Closing", startMs: 3000 }],
        renditions: [360, 540, 720].map((height) => ({ height, url: `${STORAGE_ORIGIN}/storage/v1/object/sign/training-media/${V1}/${height}.mp4?token=t`, bytes: 10_000 })),
        rewatch: stub.status === "rewatch" ? [0] : [],
        stop: stub.status === "passed" ? null : STOP,
      });
    }
    if (path === `${base}/progress`) {
      const p = req.postDataJSON() as { fromMs: number; toMs: number };
      stub.progress.push(p);
      // The server's rule: the segment's questions open once 90 % of it has played.
      if (stub.status === "watch" && p.toMs >= STOP.endMs * 0.9) stub.status = "quiz";
      return json({ status: stub.status });
    }
    if (path === `${base}/films/${V1}/quiz`) {
      if (stub.status !== "quiz") return json({ error: { code: "watch_first", message: "Watch this part of the video first." } }, 409);
      return json({
        attemptId: ATTEMPT, chapter: 0, chapterTitle: STOP.title, answered: {},
        questions: Q.map((id, n) => ({ id, prompt: `Question ${n + 1} about backing up?`, choices: ["a", "b", "c", "d"].map((c) => ({ id: c, text: `Choice ${c.toUpperCase()} of ${n + 1}` })) })),
      });
    }
    if (path === `${base}/answers`) {
      if (stub.cutAnswers) return route.abort("internetdisconnected");
      const a = req.postDataJSON() as { questionId: string; choiceId: string };
      stub.answers.push(a);
      const right = a.choiceId === RIGHT;
      const done = Q.every((q) => stub.answers.some((x) => x.questionId === q));
      const correct = Q.filter((q) => stub.answers.find((x) => x.questionId === q)?.choiceId === RIGHT).length;
      if (done) stub.status = correct === Q.length ? "passed" : "rewatch";
      return json({
        // D-TR15: a wrong answer is told nothing more.
        feedback: right ? { right, answer: RIGHT, why: "Because the film says so.", chapter: 0 } : { right, answer: null, why: null, chapter: 0 },
        result: done ? { correct, total: Q.length, passed: correct === Q.length, missedChapters: correct === Q.length ? [] : [0] } : null,
      });
    }
    return json({ error: { code: "e2e_unstubbed", message: path } }, 503);
  });
  return stub;
}

const video = (page: Page) => page.locator("video");
const byTest = (page: Page, t: string) => page.locator(`[data-test="${t}"]`);
const play = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.play());

test("a driver opens the link and the film is let through to storage", async ({ page }) => {
  const stub = await stubTraining(page);
  const res = await page.goto(`/t/${TOKEN}`);
  expect(res!.headers()["cache-control"]).toBe("no-cache");
  await expect(page.getByRole("heading", { name: "Hi Dana" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Winter driving/ })).toBeDisabled();
  // The driver's own switch, so the pick does not hang on this machine's network estimate.
  await page.getByLabel("Low data: smaller videos for weak signal").check();
  await page.getByRole("button", { name: /Backing up/ }).click();
  await expect(page.getByText("The video stops after “Get out and look” for 3 short questions.")).toBeVisible();
  await expect(page.getByText("360p · 0.0 MB for the whole video")).toBeVisible();
  await expect.poll(() => stub.filmRequests).toContain(FILM_PATH);
});

test("the film pauses at the end of the segment, reports what played, and the questions open", async ({ page }) => {
  const stub = await stubTraining(page);
  await page.goto(`/t/${TOKEN}`);
  await page.getByRole("button", { name: /Backing up/ }).click();
  await expect(video(page)).toHaveJSProperty("readyState", 4, { timeout: 10_000 });
  await play(page);
  await expect(page.getByText("Questions about “Get out and look” · all 3 right to go on")).toBeVisible({ timeout: 10_000 });
  expect(stub.progress.at(-1)!.toMs).toBeGreaterThanOrEqual(2700);
  expect(stub.progress.at(-1)!.toMs).toBeLessThanOrEqual(3300); // stopped at the segment's end, not played on
});

test("a muted film and a hidden page pause it, and skipping ahead is undone (§3.1)", async ({ page }) => {
  await stubTraining(page);
  await page.goto(`/t/${TOKEN}`);
  await page.getByRole("button", { name: /Backing up/ }).click();
  await expect(video(page)).toHaveJSProperty("readyState", 4, { timeout: 10_000 });

  await video(page).evaluate((v: HTMLVideoElement) => (v.muted = true));
  await play(page).catch(() => undefined);
  await expect(byTest(page, "sound-note")).toBeVisible();
  await expect(video(page)).toHaveJSProperty("paused", true);

  await video(page).evaluate((v: HTMLVideoElement) => (v.muted = false));
  await expect(byTest(page, "sound-note")).toBeHidden();
  await play(page);
  await expect(video(page)).toHaveJSProperty("paused", false);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(video(page)).toHaveJSProperty("paused", true);

  await video(page).evaluate((v: HTMLVideoElement) => (v.currentTime = 6));
  await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(3);
});

test("a wrong answer is not told the right one, an offline answer waits, and a miss sends the driver back", async ({ page }) => {
  const stub = await stubTraining(page, "quiz");
  await page.goto(`/t/${TOKEN}`);
  await page.getByRole("button", { name: /Backing up/ }).click();

  await page.getByRole("button", { name: "Choice B of 1" }).click();
  await expect(byTest(page, "why")).toHaveText("✓ Right. Because the film says so.");
  await page.getByRole("button", { name: "Next question" }).click();

  await page.getByRole("button", { name: "Choice A of 2" }).click();
  await expect(byTest(page, "why")).toHaveText("✗ Not quite. This is in the part you're about to watch again.");
  await expect(page.locator(".ans.right")).toHaveCount(0); // the right choice is not marked
  await expect(page.getByText("Because the film says so.")).toHaveCount(0);
  await page.getByRole("button", { name: "Next question" }).click();

  stub.cutAnswers = true;
  await page.getByRole("button", { name: "Choice B of 3" }).click();
  await expect(page.getByText("Your answer is saved on this phone")).toBeVisible();
  stub.cutAnswers = false;
  await page.getByRole("button", { name: "Send my answers" }).click();

  await expect(byTest(page, "score")).toHaveText("2 / 3");
  await expect(byTest(page, "rewatch-plan")).toHaveText("Watch “Get out and look” again. Then you get a new question on what you missed.");
  await byTest(page, "continue").click();
  await expect(byTest(page, "rewatch-note")).toBeVisible();
});

test("“Watch this part again” goes back to the segment before answering", async ({ page }) => {
  await stubTraining(page, "quiz");
  await page.goto(`/t/${TOKEN}`);
  await page.getByRole("button", { name: /Backing up/ }).click();
  await byTest(page, "watch-again").click();
  await expect(video(page)).toBeVisible();
  await expect(page.getByText("Question 1 of 3")).toHaveCount(0);
});
