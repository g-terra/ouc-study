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
