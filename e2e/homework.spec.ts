// Interactive homework: a demo assignment with a tasks file is answered in the app, task by task,
// with a timeline and a done/left counter; answers are saved on the app server.
import { expect, test } from "@playwright/test";

const SEM = "/v2/2026-Demo";
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("ouc-tour-seen", "1"); } catch {} });
  await page.clock.setFixedTime(new Date("2026-09-15T10:00:00"));
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

test("answer a homework task by task, see the counter move, and find the answers again after a reload", async ({ page }) => {
  await page.goto(`${SEM}/courses/DEMO101#work`);
  await expect(page.getByTestId("homework-count")).toHaveText("0 of 3 done");
  await page.getByRole("link", { name: "Answer Assignment 1 in the app" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Assignment 1" })).toBeVisible();
  const timeline = page.getByRole("navigation", { name: "Tasks" });
  await expect(timeline.getByRole("button")).toHaveCount(3);
  await expect(page.getByTestId("homework-progress")).toHaveText("0 of 3 done · 3 left");
  await expect(page.getByText("What was new to you?")).toBeVisible();

  await page.getByRole("textbox", { name: "Your answer" }).fill("I liked seeing the app with made-up data.");
  await page.getByRole("button", { name: "Done, next task" }).click();
  await expect(page.getByTestId("homework-progress")).toHaveText("1 of 3 done · 2 left");

  // task 2: multiple choice, with the optional why
  await expect(page.getByText("Which part of the demo week did you like most?")).toBeVisible();
  await page.getByRole("radio", { name: "The welcome video" }).click();
  await page.getByRole("button", { name: "Add why I picked it" }).click();
  await page.getByRole("textbox", { name: "Why I picked it" }).fill("It was short.");
  await page.getByRole("button", { name: "Done, next task" }).click();
  await expect(page.getByTestId("homework-progress")).toHaveText("2 of 3 done · 1 left");

  // task 3 shows its maths, and the timeline jumps back
  await expect(page.locator(".katex").first()).toBeVisible();
  await timeline.getByRole("button", { name: /Favourite part/ }).click();
  await expect(page.getByRole("radio", { name: "The welcome video" })).toHaveAttribute("aria-checked", "true");

  await page.reload();
  await expect(page.getByTestId("homework-progress")).toHaveText("2 of 3 done · 1 left");
  await timeline.getByRole("button", { name: /Your demo week/ }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveText("I liked seeing the app with made-up data.");
  await timeline.getByRole("button", { name: /Favourite part/ }).click();
  await expect(page.getByRole("textbox", { name: "Why I picked it" })).toHaveText("It was short.");

  // the course shows the count too
  await page.goto(`${SEM}/courses/DEMO101#work`);
  await expect(page.getByTestId("homework-count")).toHaveText("2 of 3 done");
});

test("answers can have bold, colours and formulas, and keep them after a reload", async ({ page }) => {
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Demo sum/ }).click();
  const box = page.getByRole("textbox", { name: "Your answer" });
  await box.click();
  await page.keyboard.type("The sum is ");
  await page.getByRole("button", { name: "Bold" }).click();
  await page.keyboard.type("three quarters");
  await page.getByRole("button", { name: "Bold" }).click();
  await page.getByRole("button", { name: "Blue text" }).click();
  await page.keyboard.type(" in blue");
  await expect(box.locator("strong")).toHaveText("three quarters");
  await expect(box.locator("span[style*=color]")).toHaveText(" in blue");

  await page.getByRole("button", { name: "Formula" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert a formula" });
  await dialog.getByRole("textbox", { name: "Formula in LaTeX" }).fill("= ");
  await dialog.getByRole("button", { name: "Fraction" }).click();
  await page.keyboard.type("3");
  await expect(dialog.getByRole("textbox", { name: "Formula in LaTeX" })).toHaveValue("= \\frac{3}{}");
  await expect(dialog.getByTestId("formula-preview").locator(".katex")).toBeVisible();
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog).toBeHidden();
  await expect(box.locator(".katex")).toHaveCount(1);

  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Demo sum/ }).click();
  const again = page.getByRole("textbox", { name: "Your answer" });
  await expect(again.locator("strong")).toHaveText("three quarters");
  await expect(again.locator(".katex")).toHaveCount(1);
  await expect(again.locator("span[style*=color]")).toHaveText(" in blue");
});

// a 1×1 PNG
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("a picture can be added to an answer and is still there after a reload", async ({ page }) => {
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Your demo week/ }).click();
  const box = page.getByRole("textbox", { name: "Your answer" });
  await box.click();
  await page.getByLabel("Add a picture").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PIXEL });
  const img = box.locator("img");
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute("src", /\/files\/2026-Demo\/assignments\/DEMO101\/09-28_Assignment-1\/homework\/images\/[0-9a-f]{16}\.png$/);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Your demo week/ }).click();
  const again = page.getByRole("textbox", { name: "Your answer" }).locator("img");
  await expect(again).toHaveCount(1);
  await expect.poll(() => again.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBe(1);
});

test("answers can have inline code and code blocks with syntax colours", async ({ page }) => {
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Your demo week/ }).click();
  const box = page.getByRole("textbox", { name: "Your answer" });
  await box.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Inline code" }).click();
  await page.keyboard.type("len(xs)");
  await expect(box.locator("p code")).toHaveText("len(xs)");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Code block" }).click();
  await page.keyboard.type("def total(xs):\n    return sum(xs)");
  await expect(box.locator("pre code")).toContainText("return sum(xs)");
  await expect(box.locator("pre .hljs-keyword").first()).toHaveText("def");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Your demo week/ }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" }).locator("pre code")).toContainText("def total(xs):");
});

test("the homework page fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await expect(page.getByTestId("homework-progress")).toBeVisible();
  const width = await page.locator("html").evaluate((el) => el.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
