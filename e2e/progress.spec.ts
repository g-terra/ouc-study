// Ticking off what's been watched and read (#105): tick boxes on a week, counts on the week, course and Today,
// saved on the app server; a video ticks itself when it plays to the end.
import { expect, test } from "@playwright/test";

const SEM = "/2026-Demo";
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("ouc-tour-seen", "1"); } catch {} });
  // inside the demo's week 1, so it's "this week"
  await page.clock.setFixedTime(new Date("2026-09-15T10:00:00"));
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

test("tick an item on Today, see it counted on the course and the week, untick it on the week", async ({ page }) => {
  await page.goto(`/v2${SEM}`);
  const thisWeek = page.getByTestId("this-week");
  await expect(thisWeek.getByTestId("done-count")).toHaveText("0 of 3 done");
  await thisWeek.getByRole("checkbox", { name: /Demo lecture/ }).click();
  await expect(thisWeek.getByTestId("done-count")).toHaveText("1 of 3 done");

  await page.goto(`/v2${SEM}/courses`);
  await expect(page.getByTestId("done-count")).toHaveText("1 of 3 done");
  await expect(page.getByText("1 of 3 watched or read")).toBeVisible();

  // saved on the server: still ticked after a reload
  await page.goto(`/v2${SEM}/courses/DEMO101`);
  await page.reload();
  const week = page.locator("#w1");
  await expect(week.getByTestId("done-count")).toHaveText("1/3");
  const box = week.getByRole("checkbox", { name: /Demo lecture/ });
  await expect(box).toHaveAttribute("aria-checked", "true");
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "false");
  await expect(week.getByTestId("done-count")).toHaveText("0/3");
});

test("a video played to the end ticks itself", async ({ page }) => {
  await page.goto(`/v2${SEM}/courses/DEMO101`);
  const box = page.locator("#w1").getByRole("checkbox", { name: /Welcome/ });
  await expect(box).toHaveAttribute("aria-checked", "false");
  await page.locator("#w1").getByRole("link", { name: /Welcome/ }).first().click();
  await page.getByTestId("class-video").dispatchEvent("ended");
  await page.goBack();
  await expect(box).toHaveAttribute("aria-checked", "true");
  await box.click();   // leave the demo as it was
  await expect(box).toHaveAttribute("aria-checked", "false");
});
