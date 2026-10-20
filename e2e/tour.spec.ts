// The guided tour: it opens by itself on the first visit only, walks through the main places, and the profile menu replays it.
import { expect, test } from "@playwright/test";

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

test("the tour opens on the first visit, visits each place, and doesn't open again", async ({ page }) => {
  await page.goto("/");
  const tour = page.getByRole("dialog", { name: /Welcome to OUC Study/ });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Show me" }).click();
  await expect(page.getByRole("dialog", { name: "☀️ Today" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "📚 Courses" })).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/courses$/);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Inside a course" })).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/courses\/DEMO101$/);
  // the arrow keys move too
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "🗓️ Calendar" })).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/calendar$/);
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog", { name: "Inside a course" })).toBeVisible();
  for (const name of ["🗓️ Calendar", "🔔 Notifications", "🤖 Ask AI", "👤 Profile and Settings", "You're all set 🎉"]) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("dialog", { name })).toBeVisible();
  }
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/v2\/2026-Demo$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("skipping ends the tour for good; Take the tour in the profile menu opens it again", async ({ page }) => {
  await page.goto("/v2/2026-Demo/calendar");
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/calendar$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^Profile/ }).click();
  await page.getByRole("menuitem", { name: "Take the tour" }).click();
  await expect(page.getByRole("dialog", { name: /Welcome to OUC Study/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
