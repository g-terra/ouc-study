// "Start class": a week's materials one step at a time (video, then slides, then links), each ticked
// off as you go to the next. Ticks are kept in the test (a mocked /api/progress), so other tests' counts stay as they are.
import { expect, test, type Page } from "@playwright/test";

const SEM = "/v2/2026-Demo";
let errors: string[] = [];
let posted: { key: string; done: boolean; how?: string }[] = [];

async function mockProgress(page: Page) {
  const done: Record<string, unknown> = {};
  posted = [];
  await page.route("**/api/progress**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const b = req.postDataJSON();
      posted.push({ key: b.key, done: b.done, how: b.how });
      if (b.done) done[b.key] = { course: b.course, week: b.week, title: b.title, kind: b.kind, at: new Date().toISOString(), how: b.how };
      else delete done[b.key];
    }
    await route.fulfill({ json: { done } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("ouc-tour-seen", "1"); } catch {} });
  await page.clock.setFixedTime(new Date("2026-09-15T10:00:00"));
  await mockProgress(page);
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

test("start a class on a week, go through its steps ticking each off, and finish", async ({ page }) => {
  await page.goto(`${SEM}/courses/DEMO101`);
  const week = page.locator("#w1");
  await week.getByRole("link", { name: "Start class" }).click();

  // step 1: the video, in the app
  const steps = page.getByRole("navigation", { name: "Class steps" });
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /Welcome/ })).toBeVisible();
  await expect(page.getByTestId("class-video")).toBeVisible();
  await expect(steps.getByRole("link")).toHaveCount(4);

  // done → ticked, and the slides are next
  await page.getByRole("button", { name: "Done, next" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /Demo lecture/ })).toBeVisible();
  expect(posted).toContainEqual(expect.objectContaining({ key: expect.stringMatching(/Welcome\.mp4$/), done: true }));
  await expect(steps.getByRole("link", { name: /Welcome.*done/ })).toBeVisible();
  // the slide viewer (getting them ready, the slides, or how to get them shown)
  await expect(page.getByText("Getting the slides ready").or(page.getByTestId("slide-counter")).or(page.getByText("can't be shown here yet")).first()).toBeVisible();

  // skip leaves it unticked; back again with Previous
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Step 3 of 4")).toBeVisible();
  await page.getByRole("link", { name: "Previous" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await page.getByRole("button", { name: "Done, next" }).click();

  // step 3: a PDF, in the app's PDF viewer
  await expect(page.getByRole("heading", { level: 1, name: "Demo reading" })).toBeVisible();
  await expect(page.getByTestId("slide-counter")).toHaveText("Page 1 / 3", { timeout: 30_000 });
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Done, next" }).click();

  // step 3: a link that opens outside the app
  await expect(page.getByRole("heading", { level: 1, name: "Course website" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open it/ })).toHaveAttribute("href", "https://example.org/demo");
  await page.getByRole("button", { name: "Done, finish class" }).click();

  await expect(page.getByRole("heading", { name: "Class done" })).toBeVisible();
  expect(posted.filter((p) => p.done).length).toBe(4);
  await page.getByRole("link", { name: /^Back to [^,]+$/ }).click();
  await expect(page.locator("#w1").getByTestId("done-count")).toHaveText("4/4");
  await expect(page.locator("#w1").getByRole("link", { name: "Go through again" })).toBeVisible();
});

test("a class picks up at the first step not done yet, and works on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SEM}/courses/DEMO101`);
  await page.locator("#w1").getByRole("checkbox", { name: /Welcome/ }).click();
  await page.locator("#w1").getByRole("link", { name: "Continue class" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /Demo lecture/ })).toBeVisible();
  expect(await page.locator("html").evaluate((el) => el.scrollWidth), "nothing scrolls sideways").toBeLessThanOrEqual(390);
});
