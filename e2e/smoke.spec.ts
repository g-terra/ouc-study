// Every page of the app renders on the demo semester, with no errors in the browser console.
import { expect, test } from "@playwright/test";

const SEM = "/2026-Demo";
const PAGES: [path: string, name: string][] = [
  ["", "Dashboard"], ["/plan", "Plan"], ["/timeline", "Timeline"], ["/courses", "Courses"],
  ["/notes", "Notes"], ["/assignments", "Assignments"], ["/updates", "Updates"],
];

// what went wrong in the browser during the current test (tests in a worker run one at a time)
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

for (const [path, name] of PAGES) {
  test(`${name} page renders`, async ({ page }) => {
    await page.goto(`${SEM}${path}`);
    await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();
    await expect(page.locator("main")).not.toBeEmpty();
  });
}

test("the demo course, its note and assignment show up", async ({ page }) => {
  await page.goto(`${SEM}/courses`);
  await expect(page.getByText("Demo Studies").first()).toBeVisible();
  await page.goto(`${SEM}/notes`);
  await page.getByText("Week 1 · Getting started").first().click();
  await expect(page.getByText("Smoke tests open every page")).toBeVisible();
  await page.goto(`${SEM}/assignments`);
  await expect(page.getByText("Assignment 1").first()).toBeVisible();
});

test("the app's local APIs answer", async ({ request }) => {
  const u = await request.get("/api/update");
  expect(u.ok()).toBeTruthy();
  expect(await u.json()).toHaveProperty("current");
  expect((await request.get("/api/eclass/status")).status()).toBeLessThan(500);
});

test("a course's slides open in the slide viewer", async ({ page }) => {
  await page.goto(`${SEM}/courses/DEMO101`);
  const link = page.getByRole("link", { name: /Demo lecture/ });
  if (!(await link.isVisible())) await page.getByRole("button", { name: /Getting started/ }).click();
  await link.click();
  await expect(page).toHaveURL(/\/slides\//);
  // with LibreOffice the slides show (the first with its narration); without it, how to get it
  await expect(page.getByTestId("slide-counter").or(page.getByText("can't be shown here yet"))).toBeVisible({ timeout: 60_000 });
  if (await page.getByTestId("slide-counter").isVisible()) {
    await expect(page.getByTestId("slide-counter")).toHaveText("Slide 1 / 2");
    await expect(page.locator("audio")).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("slide-counter")).toHaveText("Slide 2 / 2");
    await expect(page.locator("audio")).toHaveCount(0);
  }
  await expect(page.getByRole("link", { name: /Download/ }).first()).toHaveAttribute("href", /Demo%20lecture\.pptx$/);
});
