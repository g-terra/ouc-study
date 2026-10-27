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
  await expect(page.getByTestId("homework-count")).toHaveText("0 of 5 done");
  await page.getByRole("link", { name: "Answer Assignment 1 in the app" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Assignment 1" })).toBeVisible();
  const timeline = page.getByRole("navigation", { name: "Tasks" });
  await expect(timeline.getByRole("button")).toHaveCount(5);
  await expect(page.getByTestId("homework-progress")).toHaveText("0 of 5 done · 5 left");
  await expect(page.getByText("What was new to you?")).toBeVisible();

  await page.getByRole("textbox", { name: "Your answer" }).fill("I liked seeing the app with made-up data.");
  await page.getByRole("button", { name: "Done, next task" }).click();
  await expect(page.getByTestId("homework-progress")).toHaveText("1 of 5 done · 4 left");

  // task 2: multiple choice, with the optional why
  await expect(page.getByText("Which part of the demo week did you like most?")).toBeVisible();
  await page.getByRole("radio", { name: "The welcome video" }).click();
  await page.getByRole("button", { name: "Add why I picked it" }).click();
  await page.getByRole("textbox", { name: "Why I picked it" }).fill("It was short.");
  await page.getByRole("button", { name: "Done, next task" }).click();
  await expect(page.getByTestId("homework-progress")).toHaveText("2 of 5 done · 3 left");

  // task 3 shows its maths, and the timeline jumps back
  await expect(page.locator(".katex").first()).toBeVisible();
  await timeline.getByRole("button", { name: /Favourite part/ }).click();
  await expect(page.getByRole("radio", { name: "The welcome video" })).toHaveAttribute("aria-checked", "true");

  await page.reload();
  await expect(page.getByTestId("homework-progress")).toHaveText("2 of 5 done · 3 left");
  await timeline.getByRole("button", { name: /Your demo week/ }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveText("I liked seeing the app with made-up data.");
  await timeline.getByRole("button", { name: /Favourite part/ }).click();
  await expect(page.getByRole("textbox", { name: "Why I picked it" })).toHaveText("It was short.");

  // the course shows the count too
  await page.goto(`${SEM}/courses/DEMO101#work`);
  await expect(page.getByTestId("homework-count")).toHaveText("2 of 5 done");
});

test("a task that takes more than one answer lets several options be picked, and keeps them after a reload", async ({ page }) => {
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Good habits/ }).click();
  const group = page.getByRole("group", { name: "Your choices (more than one can be right)" });
  await group.getByRole("checkbox", { name: "Spaced practice" }).click();
  await group.getByRole("checkbox", { name: "Testing yourself" }).click();
  await expect(group.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await group.getByRole("checkbox", { name: "Spaced practice" }).click();
  await group.getByRole("checkbox", { name: "Spaced practice" }).click();
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Good habits/ }).click();
  await expect(group.getByRole("checkbox", { checked: true })).toHaveText([/Spaced practice/, /Testing yourself/]);
  await page.goto("/print/homework/2026-Demo/DEMO101/09-28_Assignment-1?name=Demo%20Student");
  // every option is printed, the picked ones struck through in red
  const q4 = page.getByRole("region", { name: "Question 4" });
  await expect(q4.getByRole("listitem")).toHaveCount(3);
  await expect(q4.locator("li[data-picked]")).toHaveText(["A. Spaced practice", "C. Testing yourself"]);
  await expect(q4.locator("li[data-picked]").first()).toHaveCSS("text-decoration-line", "line-through");
  await expect(q4.locator("li[data-picked]").first()).toHaveCSS("color", "rgb(200, 16, 46)");
});

test("an answer that starts with a picture opens as a picture, not as code, after moving away and back", async ({ page }) => {
  const html = '<img src="/files/2026-Demo/assignments/DEMO101/09-28_Assignment-1/homework/images/0000000000000000.png" alt="image.png"><p>after the picture</p>';
  await page.route("**/api/homework?*", async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    data.answers["DEMO101/09-28_Assignment-1"] = { 1: { text: html } };
    return route.fulfill({ response: res, json: data });
  });
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  const timeline = page.getByRole("navigation", { name: "Tasks" });
  await timeline.getByRole("button", { name: /Favourite part/ }).click();
  await timeline.getByRole("button", { name: /Your demo week/ }).click();
  const box = page.getByRole("textbox", { name: "Your answer" });
  await expect(box.locator("img")).toHaveCount(1);
  await expect(box).toHaveText("after the picture");
});

test("a task's type can be changed in the app when the AI got it wrong, and changed back", async ({ page }) => {
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  const timeline = page.getByRole("navigation", { name: "Tasks" });
  await timeline.getByRole("button", { name: /Good habits/ }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await page.getByRole("button", { name: "Wrong type? Change it" }).click();
  const form = page.getByRole("region", { name: "Change the task's type" });
  await expect(form.getByRole("combobox", { name: "Type" })).toHaveValue("multiple");
  await form.getByRole("combobox", { name: "Type" }).selectOption("choice");
  await expect(form.getByRole("textbox", { name: "Options, one per line" })).toHaveValue("Spaced practice\nCramming the night before\nTesting yourself");
  await form.getByRole("button", { name: "Save type" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("radio")).toHaveCount(3, { timeout: 10_000 });
  await expect(timeline.getByRole("button", { name: /Good habits/ })).toContainText("Multiple choice");
  // a written task needs its options to become a choice
  await timeline.getByRole("button", { name: /Your demo week/ }).click();
  await page.getByRole("button", { name: "Wrong type? Change it" }).click();
  await form.getByRole("combobox", { name: "Type" }).selectOption("choice");
  await form.getByRole("button", { name: "Save type" }).click();
  await expect(form.getByRole("alert")).toHaveText("Give 2 to 8 options, one per line.");
  await form.getByRole("button", { name: "Cancel" }).click();
  // and back
  await timeline.getByRole("button", { name: /Good habits/ }).click();
  await page.getByRole("button", { name: "Wrong type? Change it" }).click();
  await form.getByRole("combobox", { name: "Type" }).selectOption("multiple");
  await form.getByRole("button", { name: "Save type" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(3, { timeout: 10_000 });
});

test("a true-or-false task is one question: True or False and an explanation for each statement, printed with the answers", async ({ page }) => {
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Demo facts/ }).click();
  await expect(page.getByText("True or false", { exact: false }).first()).toBeVisible();
  const first = page.getByRole("radiogroup", { name: "Statement 1" });
  const second = page.getByRole("radiogroup", { name: "Statement 2" });
  await first.getByRole("radio", { name: "True" }).click();
  await second.getByRole("radio", { name: "False" }).click();
  await page.getByRole("button", { name: "Add an explanation" }).nth(1).click();
  await page.getByRole("textbox", { name: "Explanation for statement 2" }).fill("It has a website.");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Demo facts/ }).click();
  await expect(first.getByRole("radio", { name: "True" })).toHaveAttribute("aria-checked", "true");
  await expect(second.getByRole("radio", { name: "False" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("textbox", { name: "Explanation for statement 2" })).toHaveText("It has a website.");
  await page.goto("/print/homework/2026-Demo/DEMO101/09-28_Assignment-1?name=Demo%20Student");
  const q5 = page.getByRole("region", { name: "Question 5" });
  await expect(q5.getByTestId("tf-answer")).toHaveText(["True", "False"]);
  await expect(q5).toContainText("It has a website.");
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

test("a paragraph can be centred, and stays centred after a reload and in the PDF", async ({ page }) => {
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Demo sum/ }).click();
  const box = page.getByRole("textbox", { name: "Your answer" });
  await box.fill("The result");
  await page.getByRole("button", { name: "Centre" }).click();
  await expect(page.getByRole("button", { name: "Centre" })).toHaveAttribute("aria-pressed", "true");
  await expect(box.locator("p").first()).toHaveCSS("text-align", "center");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Demo sum/ }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" }).locator("p").first()).toHaveCSS("text-align", "center");
  await page.goto("/print/homework/2026-Demo/DEMO101/09-28_Assignment-1?name=Demo%20Student");
  await expect(page.locator(".answer-text p", { hasText: "The result" })).toHaveCSS("text-align", "center");
});

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

test("what was typed while the app server couldn't save it comes back after a reload, and is then saved", async ({ page }) => {
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Your demo week/ }).click();
  // the server is down: the save fails, as it would if the page crashed before it
  await page.route("**/api/homework", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
  await page.getByRole("textbox", { name: "Your answer" }).fill("Typed before the crash.");
  await expect(page.getByRole("alert")).toContainText("Couldn't save");
  await page.unroute("**/api/homework");
  await page.reload();
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Your demo week/ }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveText("Typed before the crash.");
  await expect(page.getByTestId("draft-restored")).toBeVisible();
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  // now it's on the server: gone from the browser, still there
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Your demo week/ }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveText("Typed before the crash.");
  await expect(page.getByTestId("draft-restored")).toHaveCount(0);
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
  // numbered questions with no task titles, a line between them
  await expect(page.getByRole("region", { name: /^Question \d$/ })).toHaveCount(5);
  await expect(page.getByRole("region", { name: "Question 1" })).toContainText("1.Write a short reflection");
  await expect(page.getByText("Your demo week")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Question 2" })).toHaveCSS("border-top-style", "solid");
  await expect(page.getByText("Which part of the demo week did you like most?")).toBeVisible();
  await expect(page.locator(".katex").first()).toBeVisible();
  // a long homework's last page is white below the answers too (the page behind the paper is the app's background)
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("Make PDF saves a PDF with the student's eClass name into the assignment's folder, without asking for it", async ({ page }) => {
  await page.route("**/api/eclass/status*", (r) => r.fulfill({ json: { state: "connected", ok: true, user: "Demo Student" } }));
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("button", { name: "Make PDF" }).click();
  const dialog = page.getByRole("dialog", { name: "Make the PDF" });
  await expect(dialog.getByRole("textbox", { name: "Name on the PDF" })).toHaveCount(0);
  await expect(dialog).toContainText("Demo Student");
  const link = dialog.getByRole("link", { name: "Open the PDF" });
  await expect(link).toBeVisible({ timeout: 60_000 });
  const href = (await link.getAttribute("href"))!;
  // it opens in the app's PDF viewer, not a new tab
  expect(decodeURIComponent(href)).toMatch(/\/pdf\/assignments\/DEMO101\/09-28_Assignment-1\/my-submission\/Assignment 1 - Demo Student\.pdf$/);
  await expect(link).not.toHaveAttribute("target", "_blank");
  const pdf = await page.request.get(`/files/2026-Demo/${decodeURIComponent(href.split("/pdf/")[1]).split("/").map(encodeURIComponent).join("/")}`);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await link.click();
  await expect(page.getByTestId("slide-counter")).toHaveText(/^Page 1 \/ \d+$/);
});

test("without an eClass name, Make PDF asks for the name once", async ({ page }) => {
  await page.route("**/api/eclass/status*", (r) => r.fulfill({ json: { state: "nokey", ok: false } }));
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("button", { name: "Make PDF" }).click();
  const dialog = page.getByRole("dialog", { name: "Make the PDF" });
  await dialog.getByRole("textbox", { name: "Name on the PDF" }).fill("Demo Student");
  await expect(dialog.getByRole("link", { name: "Preview" })).toHaveAttribute("href", /name=Demo%20Student/);
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

test("Ask AI about this task starts the tutor chat on the task being answered, with its question sent", async ({ page }) => {
  await aiReady(page);
  let sent: Record<string, unknown> | undefined;
  await page.route("**/api/ai/run", (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"text","text":"What does the question ask you to add?"}\n\ndata: {"type":"done","ok":true}\n\n' });
  });
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Demo sum/ }).click();
  // one click: the chat starts on its own, with the task's question as the first message
  await page.getByRole("button", { name: "Ask AI about this task" }).click();
  await expect(page.getByText("What does the question ask you to add?")).toBeVisible();
  expect(sent).toMatchObject({ action: "homework-tutor", params: { course: "DEMO101", assignment: "DEMO101/09-28_Assignment-1", task: "3" } });
  expect(String(sent?.message)).toMatch(/^Help me with task 3 \(Demo sum\):/);
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

test("the last task's button completes the homework and starts the AI check of every answer", async ({ page }) => {
  await aiReady(page);
  const job = { id: "j3", chatId: "c1", sem: "2026-Demo", assignment: "DEMO101/09-28_Assignment-1", started: "2026-09-15T10:00:00Z", running: true };
  let posted = false;
  await page.route("**/api/ai/homework-check", (route) => {
    if (route.request().method() === "POST") { posted = true; return route.fulfill({ json: { jobs: [job] } }); }
    return route.fulfill({ json: { jobs: posted ? [job] : [] } });
  });
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  const timeline = page.getByRole("navigation", { name: "Tasks" });
  await timeline.getByRole("button", { name: /Demo sum/ }).click();
  await expect(page.getByRole("button", { name: "Complete and review" })).toHaveCount(0);
  await timeline.getByRole("button", { name: /Demo facts/ }).click();
  await page.getByRole("button", { name: "Complete and review" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The AI is checking your answers…" })).toBeVisible();
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
  expect(posted).toBe(true);
});

test("Discuss on a task's check starts a chat about that check, and a corrected check shows when the chat ends", async ({ page }) => {
  await aiReady(page);
  let corrected = false;
  const check = (verdict: string, note: string) => ({ checked: "2026-09-15T10:00:00Z", tasks: { "3": { verdict, note } } });
  await page.route("**/api/homework?**", async (route) => {
    const res = await route.fetch();
    return route.fulfill({ response: res, json: { ...(await res.json()), checks: { "DEMO101/09-28_Assignment-1": corrected ? check("right", "You're right: the brief allows decimals.") : check("wrong", "Give it as a fraction.") } } });
  });
  let sent: Record<string, unknown> | undefined;
  await page.route("**/api/ai/run", (route) => {
    sent = route.request().postDataJSON();
    corrected = true;
    return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"text","text":"Fair point, I have updated the check."}\n\ndata: {"type":"file","path":"semesters/2026-Demo/assignments/DEMO101/09-28_Assignment-1/homework/check.json"}\n\ndata: {"type":"done","ok":true}\n\n' });
  });
  await page.goto(`${SEM}/homework/DEMO101/09-28_Assignment-1`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Demo sum/ }).click();
  const region = page.getByRole("region", { name: "AI check of this task" });
  await expect(region).toContainText("Give it as a fraction.");
  await region.getByRole("button", { name: "Discuss" }).click();
  await expect(page.getByText("Fair point, I have updated the check.")).toBeVisible();
  expect(sent).toMatchObject({ action: "discuss-check", params: { course: "DEMO101", assignment: "DEMO101/09-28_Assignment-1", task: "3" } });
  expect(String(sent?.message)).toMatch(/^I'd like to discuss your check of task 3 \(Demo sum\): you said "Not right yet"\./);
  await expect(region).toContainText("You're right: the brief allows decimals.", { timeout: 10_000 });
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

test("Make it more academic rewords an answer in the background; kept, it replaces the answer and is tagged AI-edited", async ({ page }) => {
  await aiReady(page);
  const A = "DEMO101/09-28_Assignment-1";
  const job = { id: "p1", kind: "polish", task: "1", chatId: "c1", sem: "2026-Demo", assignment: A, started: "2026-09-15T10:00:00Z", running: true };
  let sent: Record<string, unknown> | undefined, done = false, dropped: Record<string, unknown> | undefined;
  await page.route("**/api/ai/homework-polish", (route) => {
    if (route.request().method() === "POST") { sent = route.request().postDataJSON(); return route.fulfill({ json: { jobs: [job] } }); }
    return route.fulfill({ json: { jobs: done ? [{ ...job, running: false, ok: true }] : sent ? [job] : [] } });
  });
  await page.route("**/api/homework/polish", (route) => { dropped = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/homework?**", async (route) => {
    const res = await route.fetch();
    const polish = done && !dropped ? { [A]: { "1": { text: "<p>The demonstration week introduced several unfamiliar ideas.</p>", made: "2026-09-15T10:01:00Z" } } } : {};
    return route.fulfill({ response: res, json: { ...(await res.json()), polish } });
  });
  await page.goto(`${SEM}/homework/${A}`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Your demo week/ }).click();
  await page.getByRole("textbox", { name: "Your answer" }).fill("Loads of new stuff this week.");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  await page.getByRole("button", { name: "Make it more academic" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The AI is rewording your answer…" })).toBeVisible();
  expect(sent).toMatchObject({ sem: "2026-Demo", assignment: A, task: "1" });
  done = true;
  const offer = page.getByRole("region", { name: "More academic wording" });
  await expect(offer).toContainText("The demonstration week introduced several unfamiliar ideas.", { timeout: 10_000 });
  await expect(offer).toContainText("Loads of new stuff this week.");
  await offer.getByRole("button", { name: "Use this wording" }).click();
  await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveText("The demonstration week introduced several unfamiliar ideas.");
  await expect(page.getByText("AI-edited wording")).toBeVisible();
  expect(dropped).toMatchObject({ assignment: A, task: "1" });
  await expect(offer).toHaveCount(0);
});

test("a more academic wording can be turned down, and the answer stays as written", async ({ page }) => {
  await aiReady(page);
  const A = "DEMO101/09-28_Assignment-1";
  let dropped = false;
  await page.route("**/api/homework/polish", (route) => { dropped = true; return route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/homework?**", async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    j.answers[A] = { ...(j.answers[A] ?? {}), "1": { text: "<p>My own words.</p>" } };
    return route.fulfill({ response: res, json: { ...j, polish: dropped ? {} : { [A]: { "1": { text: "<p>Formal words.</p>", made: "2026-09-15T10:01:00Z" } } } } });
  });
  await page.goto(`${SEM}/homework/${A}`);
  await page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /Your demo week/ }).click();
  const offer = page.getByRole("region", { name: "More academic wording" });
  await offer.getByRole("button", { name: "Keep mine" }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Your answer" })).toHaveText("My own words.");
  await expect(page.getByText("AI-edited wording")).toHaveCount(0);
});
