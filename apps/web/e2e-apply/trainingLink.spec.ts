import { expect, test, type Page } from "@playwright/test";
import { ORIGIN, STORAGE_ORIGIN } from "./stubApi";

/**
 * The driver's training link (`/t/<token>`, SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8–§9), BUILT and served
 * by the API's own `mountWebSpa` under production's headers, against a stubbed
 * `/api/public/training/:token`.
 *
 * What only a browser shows:
 *   · `/t/<token>` opens the small page (`t.html`), not the office app.
 *   · The film is ASKED FOR from storage. With no `media-src` the CSP fell back to `'self'` and the
 *     browser refused every film before any request left (found 2026-11-25); this spec's film lives on a
 *     Supabase-shaped host for exactly that reason. Chromium here has no H.264, so the film never plays —
 *     what is asserted is that the request was allowed out.
 *   · An answer given with no signal is kept on the phone and sent with the rest (§8.2 rule 5).
 *   · A failed quiz names the chapters to watch again (D-TR8).
 *
 * Raw JSON, as the surface answers: no `{ ok, data }` envelope, errors as `{ error: { code, message } }`.
 */

const TOKEN = "e2eTrainingLink_0123-abc"; // 24 characters of the base64url alphabet
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const Q = ["44444444-4444-4444-8444-444444444441", "44444444-4444-4444-8444-444444444442", "44444444-4444-4444-8444-444444444443"];
const RIGHT: Record<string, string> = { [Q[0]!]: "a", [Q[1]!]: "b", [Q[2]!]: "c" };
const CHAPTER: Record<string, number> = { [Q[0]!]: 0, [Q[1]!]: 1, [Q[2]!]: 2 };
const FILM_PATH = `/storage/v1/object/sign/training-media/${V1}/360.mp4`;

interface Stub {
  answers: Array<{ questionId: string; choiceId: string }>;
  filmRequests: string[];
  cutAnswers: boolean;
}

async function stubTraining(page: Page): Promise<Stub> {
  const stub: Stub = { answers: [], filmRequests: [], cutAnswers: false };
  const base = `/api/public/training/${TOKEN}`;
  const lesson = (versionId: string, title: string, status: string) => ({
    lessonId: versionId, versionId, title, durationMs: 300_000, posterUrl: `${STORAGE_ORIGIN}/storage/v1/object/sign/training-media/${versionId}/poster.jpg`, status,
  });

  await page.route((url) => url.origin !== ORIGIN && url.origin !== STORAGE_ORIGIN, (route) => route.abort("blockedbyclient"));
  await page.route(`${STORAGE_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(".mp4")) stub.filmRequests.push(path);
    await route.fulfill({ status: 200, contentType: path.endsWith(".mp4") ? "video/mp4" : "image/jpeg", body: "" });
  });
  await page.route(`${ORIGIN}/api/public/training/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === base) {
      return json({ carrier: "Silvicom Inc", firstName: "Dana", courseTitle: "Safety basics", dueOn: "2026-12-09", complete: false, lessons: [lesson(V1, "Backing up", "quiz"), lesson(V2, "Winter driving", "locked")] });
    }
    if (path === `${base}/films/${V1}`) {
      return json({
        versionId: V1, title: "Backing up", durationMs: 300_000, posterUrl: lesson(V1, "", "").posterUrl, captionsUrl: null, positionMs: 0, watched: [[0, 300_000]], status: stub.answers.length ? "rewatch" : "quiz",
        chapters: [{ title: "Get out and look", startMs: 0 }, { title: "Use a spotter", startMs: 100_000 }, { title: "Go slow", startMs: 200_000 }],
        renditions: [360, 540, 720].map((height) => ({ height, url: `${STORAGE_ORIGIN}/storage/v1/object/sign/training-media/${V1}/${height}.mp4?token=t`, bytes: 3_000_000 })),
        rewatch: stub.answers.length ? [1] : [],
      });
    }
    if (path === `${base}/films/${V1}/quiz`) {
      return json({
        attemptId: ATTEMPT, passCount: 3, answered: {},
        questions: Q.map((id, n) => ({ id, prompt: `Question ${n + 1} about backing up?`, choices: ["a", "b", "c"].map((c) => ({ id: c, text: `Choice ${c.toUpperCase()} of ${n + 1}` })) })),
      });
    }
    if (path === `${base}/answers`) {
      if (stub.cutAnswers) return route.abort("internetdisconnected");
      const a = req.postDataJSON() as { questionId: string; choiceId: string };
      stub.answers.push(a);
      const done = Q.every((q) => stub.answers.some((x) => x.questionId === q));
      const missed = Q.filter((q) => stub.answers.find((x) => x.questionId === q)?.choiceId !== RIGHT[q]);
      return json({
        feedback: { right: a.choiceId === RIGHT[a.questionId], answer: RIGHT[a.questionId], why: "Because the film says so.", chapter: CHAPTER[a.questionId] },
        result: done ? { correct: Q.length - missed.length, total: Q.length, passed: missed.length === 0, missedChapters: missed.map((q) => CHAPTER[q]) } : null,
      });
    }
    if (path === `${base}/progress`) return json({ status: "quiz" });
    return json({ error: { code: "e2e_unstubbed", message: path } }, 503);
  });
  return stub;
}

test("a driver opens the link, sees their videos, and the film is let through to storage", async ({ page }) => {
  const stub = await stubTraining(page);
  const res = await page.goto(`/t/${TOKEN}`);
  expect(res!.headers()["cache-control"]).toBe("no-cache");
  await expect(page.getByRole("heading", { name: "Hi Dana" })).toBeVisible();
  await expect(page.getByText("Finish by 2026-12-09.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Winter driving/ })).toBeDisabled();

  // The driver's own switch, so the pick does not hang on this machine's network estimate (Chromium
  // reports one; a fast one picks 720p). Low data is the smallest whatever the network says.
  await page.getByLabel("Low data: smaller videos for weak signal").check();
  await expect(page.getByRole("status")).toHaveText("Low data");
  await page.getByRole("button", { name: /Backing up/ }).click();
  await expect(page.getByRole("heading", { name: "Backing up" })).toBeVisible();
  await expect(page.getByText("360p · 2.9 MB for the whole video")).toBeVisible();
  await expect(page.getByRole("button", { name: /Use a spotter/ })).toBeVisible();
  await expect.poll(() => stub.filmRequests).toContain(FILM_PATH);
});

test("an answer given with no signal waits on the phone, and a failed quiz names the chapter to watch again", async ({ page }) => {
  const stub = await stubTraining(page);
  await page.goto(`/t/${TOKEN}`);
  await page.getByRole("button", { name: /Backing up/ }).click();
  await page.getByRole("button", { name: "Take the quiz" }).click();

  await page.getByRole("button", { name: "Choice A of 1" }).click();
  await expect(page.getByText("✓ Right.")).toBeVisible();
  await expect(page.getByText('From chapter 1, "Get out and look"')).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  stub.cutAnswers = true;
  await page.getByRole("button", { name: "Choice A of 2" }).click(); // wrong, and it cannot be sent
  await expect(page.getByText("Your answer is saved on this phone")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  stub.cutAnswers = false;
  await page.getByRole("button", { name: "Choice C of 3" }).click();
  await expect(page.getByText("✓ Right.")).toBeVisible();
  expect(stub.answers.map((a) => a.questionId)).toEqual([Q[0], Q[2]]); // the second still on the phone
  await page.getByRole("button", { name: "Send my answers" }).click();

  await expect(page.getByText("2 / 3")).toBeVisible();
  await expect(page.getByText("Not yet. You need 3 of 3.")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveText(["Use a spotter"]);
  expect(stub.answers).toContainEqual({ attemptId: ATTEMPT, questionId: Q[1], choiceId: "a" });

  await page.getByRole("button", { name: "Watch again" }).click();
  await expect(page.getByText("Watch the chapters marked ↺ again")).toBeVisible();
});
