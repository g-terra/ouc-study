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

test("the print page shows the name, the title, every task in full and the answers", async ({ page }) => {
  await page.goto("/print/homework/2026-Demo/DEMO101/09-28_Assignment-1?name=Demo%20Student");
  await expect(page.getByRole("heading", { level: 1, name: "Assignment 1" })).toBeVisible();
  await expect(page.getByTestId("print-name")).toHaveText("Demo Student");
  await expect(page.getByText("DEMO101 · Introduction to Demo Studies")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([/Task 1/, /Task 2/, /Task 3/]);
  await expect(page.getByText("Which part of the demo week did you like most?")).toBeVisible();
  await expect(page.locator(".katex").first()).toBeVisible();
});

test("Make PDF saves a PDF with the student's name into the assignment's folder", async ({ page }) => {
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("button", { name: "Make PDF" }).click();
  const dialog = page.getByRole("dialog", { name: "Make the PDF" });
  await dialog.getByRole("textbox", { name: "Name on the PDF" }).fill("Demo Student");
  await dialog.getByRole("button", { name: "Make PDF" }).click();
  const link = dialog.getByRole("link", { name: "Open the PDF" });
  await expect(link).toBeVisible({ timeout: 60_000 });
  const href = (await link.getAttribute("href"))!;
  expect(decodeURIComponent(href)).toMatch(/\/assignments\/DEMO101\/09-28_Assignment-1\/my-submission\/Assignment 1 - Demo Student\.pdf$/);
  const pdf = await page.request.get(href);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("the homework page fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await expect(page.getByTestId("homework-progress")).toBeVisible();
  const width = await page.locator("html").evaluate((el) => el.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

/** A made-up AI status: Claude Code set up and signed in. */
const aiReady = (page: import("@playwright/test").Page) => page.route("**/api/ai/status**", (route) => route.fulfill({ json: {
  chosen: "claude", label: "Claude Code", agentic: true, ready: true, reason: "", token: "t",
  tools: [{ id: "claude", label: "Claude Code", state: "connected", chosen: true }],
} }));

test("Ask AI about this task opens the tutor on the task being answered", async ({ page }) => {
  await aiReady(page);
  let sent: Record<string, unknown> | undefined;
  await page.route("**/api/ai/run", (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"text","text":"What does the question ask you to add?"}\n\ndata: {"type":"done","ok":true}\n\n' });
  });
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Demo sum/ }).click();
  await page.getByRole("button", { name: "Ask AI about this task" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("I'm stuck");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("What does the question ask you to add?")).toBeVisible();
  expect(sent).toMatchObject({ action: "homework-tutor", params: { course: "DEMO101", assignment: "DEMO101/09-28_Assignment-1", task: "3" } });
});

test("Check my answers runs in the background, then shows a verdict on each task", async ({ page }) => {
  await aiReady(page);
  const job = { id: "j1", chatId: "c1", sem: "2026-Demo", assignment: "DEMO101/09-28_Assignment-1", started: "2026-09-15T10:00:00Z", running: true };
  let posted = false, done = false;
  await page.route("**/api/ai/homework-check", (route) => {
    if (route.request().method() === "POST") { posted = true; return route.fulfill({ json: { jobs: [job] } }); }
    return route.fulfill({ json: { jobs: done ? [{ ...job, running: false, ok: true }] : posted ? [job] : [] } });
  });
  // the check the AI saved, served with the answers
  const check = { checked: "2026-09-15T10:00:00Z", summary: "Good start: one to look at again.", tasks: {
    "1": { verdict: "right", note: "Clear and to the point." },
    "2": { verdict: "better", note: "Right; say *why* in a sentence." },
    "3": { verdict: "wrong", note: "Not quite: put both fractions over the same denominator first." },
  } };
  await page.route("**/api/homework?**", async (route) => {
    const res = await route.fetch();
    return route.fulfill({ response: res, json: { ...(await res.json()), ...(done ? { checks: { "DEMO101/09-28_Assignment-1": check } } : {}) } });
  });
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("button", { name: "Check my answers" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The AI is checking your answers…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Checking…" })).toBeDisabled();
  done = true;
  const summary = page.getByTestId("homework-check");
  await expect(summary).toContainText("Good start: one to look at again.", { timeout: 10_000 });
  await expect(summary).toContainText("1 right");
  await expect(summary).toContainText("1 not right yet");
  await expect(page.getByRole("button", { name: "Check again" })).toBeEnabled();
  const timeline = page.getByRole("navigation", { name: "Tasks" });
  await expect(timeline.getByText("Not right yet")).toBeVisible();
  await timeline.getByRole("button", { name: /Demo sum/ }).click();
  await expect(page.getByRole("region", { name: "AI check of this task" })).toContainText("same denominator");
});

test("a check that fails says why, with no chat", async ({ page }) => {
  await aiReady(page);
  const job = { id: "j2", sem: "2026-Demo", assignment: "DEMO101/09-28_Assignment-1", started: "2026-09-15T10:00:00Z", running: false, ok: false, error: "You've hit your usage limit." };
  await page.route("**/api/ai/homework-check", (route) => route.fulfill({ json: { jobs: [job] } }));
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("button", { name: "Check my answers" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your answers weren't checked: You've hit your usage limit." })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Your answers weren't checked")).toHaveCount(0);
});

test("an assignment without an interactive version can have one made in the background", async ({ page }) => {
  await aiReady(page);
  // the demo assignment, as if it had no tasks file yet
  await page.route("**/data/2026-Demo.json", async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    for (const a of data.assignments) delete a.homework;
    return route.fulfill({ response: res, json: data });
  });
  const job = { id: "m1", kind: "make", chatId: "c2", sem: "2026-Demo", assignment: "DEMO101/09-28_Assignment-1", started: "2026-09-15T10:00:00Z", running: true };
  let posted = false;
  await page.route("**/api/ai/homework-make", (route) => {
    if (route.request().method() === "POST") { posted = true; return route.fulfill({ json: { jobs: [job] } }); }
    return route.fulfill({ json: { jobs: posted ? [{ ...job, running: false, ok: false, error: "You've hit your usage limit." }] : [] } });
  });
  await page.goto(`${SEM}/assignments/DEMO101/09-28_Assignment-1`);
  await page.getByRole("button", { name: "Make it interactive" }).click();
  // it ran in the background (no chat) and says why it failed
  await expect(page.getByRole("alert").filter({ hasText: "The interactive version wasn't made: You've hit your usage limit." })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveCount(0);
  expect(posted).toBe(true);
});
