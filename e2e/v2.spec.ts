// The v2 preview (/v2/…): its four places render, links stay inside v2, and the look can be switched both ways.
import { expect, test } from "@playwright/test";

const SEM = "/2026-Demo";
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

for (const [path, name, heading] of [["", "Today", /Good (morning|afternoon|evening)/], ["/courses", "Courses", "Courses"], ["/calendar", "Calendar", "Calendar"], ["/inbox", "Inbox", "Daily updates"]] as const) {
  test(`v2 ${name} renders`, async ({ page }) => {
    await page.goto(`/v2${SEM}${path}`);
    await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  });
}

test("v2 calendar lists the overdue assignment; a course keeps its notes and quizzes in tabs", async ({ page }) => {
  await page.goto(`/v2${SEM}/calendar`);
  await expect(page.getByRole("heading", { name: "Overdue" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Course" }).getByRole("button", { name: "All courses" })).toBeVisible();
  await expect(page.getByText("Assignment 1").first()).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Courses", exact: true }).click();
  // the ring says what it counts
  await expect(page.getByTitle("0 of 1 assignments handed in")).toContainText("assignments");
  await expect(page.getByText("Exam: no date yet")).toBeVisible();
  await page.getByText("Demo Studies").click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/courses\/DEMO101$/);
  await page.getByRole("tab", { name: /Notes/ }).click();
  await page.getByText("Week 1 · Getting started").click();
  // the shared note page opens inside v2
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/notes\/DEMO101\/week-01-getting-started$/);
  await expect(page.getByText("Smoke tests open every page")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Courses", exact: true })).toHaveAttribute("aria-current", "page");
});

test("the new look is the default; the classic look can be chosen and is remembered", async ({ page }) => {
  // a first visit, and classic addresses, open the new look
  await page.goto("/");
  await expect(page).toHaveURL(/\/v2\/2026-Demo$/);
  await page.goto(`${SEM}/updates`);
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/inbox$/);
  // choosing the classic look sticks
  await page.getByRole("button", { name: /^Settings/ }).click();
  await page.getByRole("button", { name: "Back to the classic look" }).click();
  await expect(page).toHaveURL(/\/2026-Demo\/updates$/);
  await expect(page.getByRole("link", { name: "Dashboard", exact: true }).first()).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/2026-Demo$/);
  await page.goto(`${SEM}/timeline`);
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/2026-Demo\/timeline$/);
  // and back to the new look
  await page.getByRole("button", { name: /new look/ }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/calendar$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/v2\/2026-Demo$/);
});

test("v2: Ask AI expands to a full page inside v2, and the page opens on its own", async ({ page }) => {
  await page.goto(`/v2${SEM}/calendar`);
  await page.getByRole("button", { name: "Ask AI" }).click();
  await page.getByRole("dialog", { name: "Ask AI" }).getByRole("button", { name: "Open as a full page" }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/chat$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ask AI" })).toBeVisible();
  await page.getByRole("button", { name: "Back to the pop-up" }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/calendar$/);
  await expect(page.getByRole("dialog", { name: "Ask AI" })).toBeVisible();
  // a bookmarked chat page: Back to the pop-up lands on the semester's home
  await page.goto(`/v2${SEM}/chat`);
  await expect(page.getByRole("dialog", { name: "Ask AI" })).toBeHidden();
  await page.getByRole("button", { name: "Back to the pop-up" }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo$/);
});
