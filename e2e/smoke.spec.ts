// Every page of the app renders on the demo semester, with no errors in the browser console.
import { expect, test } from "@playwright/test";

const SEM = "/2026-Demo";
const PAGES: [path: string, name: string][] = [
  ["", "Dashboard"], ["/plan", "Plan"], ["/timeline", "Timeline"], ["/courses", "Courses"],
  ["/notes", "Notes"], ["/quizzes", "Quizzes"], ["/assignments", "Assignments"], ["/updates", "Updates"],
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

test("a quiz plays to the end, and its score is saved and shown", async ({ page }) => {
  await page.goto(`${SEM}/quizzes`);
  await page.getByText("Week 1 · Getting started").first().click();
  // true or false: right
  await page.getByRole("radio", { name: "True" }).click();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Right!")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();
  // one answer: wrong
  await page.getByRole("radio", { name: "Your own semester" }).click();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Not quite. The answer: The demo semester")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();
  // select all that apply, with "None of the above" kept last
  await expect(page.getByRole("checkbox").last()).toHaveText(/None of the above/);
  for (const name of ["Demo data", "App", "Smoke test"]) await page.getByRole("checkbox", { name }).click();
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.getByRole("button", { name: "See my score" }).click();
  await expect(page.getByText("You scored 2 out of 3")).toBeVisible();
  await expect(page.getByText("+20 points")).toBeVisible();
  await expect(page.getByText("Score saved on this computer.")).toBeVisible();
  // the quiz list and the course page show the best score
  await page.getByRole("link", { name: "All quizzes" }).last().click();
  await expect(page.getByText(/Best 2\/3 · \d+ tr(y|ies)/)).toBeVisible();   // (a retry adds a try)
  await page.goto(`${SEM}/courses/DEMO101`);
  await expect(page.getByText("best 67%").first()).toBeVisible();
});

test("a quiz's progress can be reset; Make a quiz opens a pop-up; Remove asks first", async ({ page }) => {
  await page.goto(`${SEM}/quizzes/DEMO101/week-01-getting-started`);
  for (const pick of [page.getByRole("radio", { name: "True" }), page.getByRole("radio").first(), page.getByRole("checkbox").first()]) {
    await pick.click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await page.getByRole("button", { name: /Next question|See my score/ }).click();
  }
  await expect(page.getByText("Score saved on this computer.")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "↺ Reset progress" }).click();
  await expect(page.getByText("Question 1 of 3")).toBeVisible();
  await page.goto(`${SEM}/quizzes`);
  await expect(page.getByText("Not played yet")).toBeVisible();
  // Remove: cancelling keeps the quiz
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "🗑 Remove" }).click();
  await expect(page.getByText("Week 1 · Getting started")).toBeVisible();
  // the pop-up picks one class or the whole course, without opening the chat
  await page.getByRole("button", { name: "Make a quiz" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Make a quiz" });
  await dialog.getByText("One class").click();
  await expect(dialog.getByRole("combobox", { name: "Class", exact: true })).toHaveValue("1");
  // "Every class" makes one quiz per class without one; the demo's only class already has a quiz
  await expect(dialog.getByRole("radio", { name: /Every class with material already has a quiz/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("settings shows the installed app version", async ({ page }) => {
  const { version } = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
  await page.goto(SEM);
  await page.getByRole("button", { name: /^Settings/ }).click();
  await expect(page.getByRole("dialog", { name: "Settings" }).getByTestId("app-version")).toContainText(`v${version}`);
});

test("the app's local APIs answer", async ({ request }) => {
  const u = await request.get("/api/update");
  expect(u.ok()).toBeTruthy();
  expect(await u.json()).toHaveProperty("current");
  expect((await request.get("/api/eclass/status")).status()).toBeLessThan(500);
  expect((await request.get("/api/quiz/attempts?sem=2026-Demo")).ok()).toBeTruthy();
  expect((await request.post("/api/quiz/attempts", { data: { sem: "2026-Demo", quiz: "../x", results: [true] } })).status()).toBe(400);
  expect((await request.delete("/api/quiz?sem=2026-Demo&quiz=DEMO101/nope")).status()).toBe(404);
  expect((await request.get("/api/ai/quiz")).ok()).toBeTruthy();
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

test("Ask AI expands to a full page and back to the pop-up, keeping what's typed", async ({ page }) => {
  await page.goto(`${SEM}/courses`);
  await page.getByRole("button", { name: "Ask AI" }).click();
  const popup = page.getByRole("dialog", { name: "Ask AI" });
  await popup.getByRole("textbox", { name: "Message" }).fill("Explain week 1 in depth");
  await popup.getByRole("button", { name: "Open as a full page" }).click();
  await expect(page).toHaveURL(/\/2026-Demo\/chat$/);
  await expect(popup).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Ask AI" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Chat history" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("Explain week 1 in depth");
  await page.getByRole("button", { name: "Back to the pop-up" }).click();
  await expect(page).toHaveURL(/\/2026-Demo\/courses$/);
  await expect(popup.getByRole("textbox", { name: "Message" })).toHaveValue("Explain week 1 in depth");
});

test("chat history can be hidden on the full page, and chats deleted one by one or all at once", async ({ page }) => {
  // made-up chats served by the test, so your own saved chats are never touched
  let chats = ["one", "two", "three"].map((id, i) => ({ id: `chat-${id}`, title: `Chat ${id}`, updatedAt: `2026-10-0${3 - i}T10:00:00Z` }));
  await page.route("**/api/ai/chats**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/api/ai/chats")[1].replace(/^\//, "");
    if (route.request().method() === "DELETE") {
      const before = chats.length;
      chats = id ? chats.filter((c) => c.id !== id) : [];
      return route.fulfill({ json: { deleted: before - chats.length, kept: 0 } });
    }
    const c = chats.find((x) => x.id === id);
    return id ? route.fulfill(c ? { json: { ...c, messages: [] } } : { status: 404, json: {} }) : route.fulfill({ json: { chats } });
  });
  page.on("dialog", (d) => d.accept());
  await page.goto(`${SEM}/chat`);
  const side = page.getByRole("navigation", { name: "Chat history" });
  await expect(side.getByText("Chat two")).toBeVisible();
  await side.getByRole("button", { name: "Delete Chat two" }).click();
  await expect(side.getByText("Chat two")).toBeHidden();
  await expect(side.getByText("Chat one")).toBeVisible();
  // hidden stays hidden after a reload
  await side.getByRole("button", { name: "Hide" }).click();
  await expect(side).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Ask AI" })).toBeVisible();
  await expect(side).toBeHidden();
  await page.getByRole("button", { name: "Show history" }).click();
  await side.getByRole("button", { name: "Delete all chats" }).click();
  await expect(side.getByText("No chats yet.")).toBeVisible();
});
