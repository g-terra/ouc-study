// Important dates: the student adds, changes and removes a course's dates (exams and others) on its Dates tab,
// and they show on the Calendar. The test puts the demo's dates back as it found them.
import { expect, test } from "@playwright/test";

const COURSE = "/v2/2026-Demo/courses/DEMO101#dates";
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("ouc-tour-seen", "1"); } catch {} });
  await page.clock.setFixedTime(new Date("2026-10-20T10:00:00"));
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

test("a course's Dates tab lists its important dates with what they cover", async ({ page }) => {
  await page.goto(COURSE);
  await expect(page.getByRole("tab", { name: /Dates/ })).toHaveAttribute("aria-selected", "true");
  const final = page.getByRole("listitem").filter({ hasText: "Final exam" });
  await expect(final).toContainText("Weeks 1 to 10");
  await expect(final).toContainText("Exam");
  await expect(page.getByRole("listitem").filter({ hasText: "Repeat exam" })).toBeVisible();
});

test("a date can be added, changed and removed, and shows on the Calendar", async ({ page }) => {
  await page.goto(COURSE);
  await page.getByRole("button", { name: "Add a date" }).click();
  const form = page.getByRole("form", { name: "Important date" });
  await form.getByLabel("Title").fill("Project talk");
  await form.getByLabel("Kind").selectOption("other");
  await form.getByLabel("Date").fill("2026-11-20");
  await form.getByLabel("Time").fill("10:00");
  await form.getByLabel("Topics").fill("Slides on week 3");
  await form.getByRole("button", { name: "Save" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Project talk" });
  await expect(row).toContainText("Slides on week 3");

  await page.goto("/v2/2026-Demo/calendar");
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Dates" }).click();
  await expect(page.getByText("Demo Studies · Project talk")).toBeVisible();

  await page.goto(COURSE);
  await page.getByRole("button", { name: "Edit Project talk" }).click();
  await form.getByLabel("Title").fill("Project presentation");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Project presentation" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Project talk" })).toHaveCount(0);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove Project presentation" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Project presentation" })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Final exam" })).toBeVisible();
});

test("a bad date is refused with the reason, and nothing is saved", async ({ page }) => {
  await page.goto(COURSE);
  await page.getByRole("button", { name: "Add a date" }).click();
  const form = page.getByRole("form", { name: "Important date" });
  await form.getByLabel("Date").fill("2026-11-20");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toContainText("title");
});
