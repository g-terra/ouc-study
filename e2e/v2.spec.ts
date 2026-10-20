// The new look (/v2/…): its three places, the notifications bell and the profile menu with Settings; links stay inside v2, and the look can be switched both ways.
import { expect, test } from "@playwright/test";

const SEM = "/2026-Demo";
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  // the guided tour opens on a first visit; it has its own tests in tour.spec.ts
  await page.addInitScript(() => { try { localStorage.setItem("ouc-tour-seen", "1"); } catch {} });
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

for (const [path, name, heading] of [["", "Today", /Good (morning|afternoon|evening)/], ["/courses", "Courses", "Courses"], ["/calendar", "Calendar", "Calendar"]] as const) {
  test(`v2 ${name} renders`, async ({ page }) => {
    await page.goto(`/v2${SEM}${path}`);
    await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  });
}

test("v2 header: the logo links home, and icons are drawn (SVG), not emoji", async ({ page }) => {
  // made-up: a newer release is out, so the update bar shows too (whatever version this checkout is)
  await page.route("**/api/update", (r) => r.fulfill({ json: { available: true, current: "0.1.0", latest: "9.9.9", canUpdate: false, notes: "" } }));
  await page.goto(`/v2${SEM}/calendar`);
  await expect(page.getByText("Update available: v9.9.9")).toBeVisible();
  const header = page.locator("header").first();
  await header.getByRole("link", { name: "OUC Study, Today" }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo$/);
  await expect(header.getByRole("button", { name: /Notifications/ }).locator("svg")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  const tabs = page.getByRole("navigation", { name: "Main" }).last();
  await expect(tabs.locator("svg")).toHaveCount(3);
  expect(await page.locator("header, nav").evaluateAll((els) => els.map((e) => e.textContent).join(""))).not.toMatch(/\p{Extended_Pictographic}/u);
});

test("v2 calendar lists the overdue assignment; a course keeps its notes and quizzes in tabs", async ({ page }) => {
  await page.goto(`/v2${SEM}/calendar`);
  await expect(page.getByRole("heading", { name: "Overdue" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Course" }).getByRole("button", { name: "All courses" })).toBeVisible();
  await expect(page.getByText("Assignment 1").first()).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Courses", exact: true }).click();
  // the ring says what it counts
  await expect(page.getByTitle("0 of 1 assignments handed in")).toContainText("assignments");
  // the demo timetable has a final on 5 Dec 2026 and a repeat on 11 Jan 2027; after those, no date
  await expect(page.getByText(/^Exam: (Final exam, |Repeat exam, |no date yet)/)).toBeVisible();
  await page.getByText("Demo Studies").click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/courses\/DEMO101$/);
  await page.getByRole("tab", { name: /Notes/ }).click();
  await page.getByText("Week 1 · Getting started").click();
  // the shared note page opens inside v2
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/notes\/DEMO101\/week-01-getting-started$/);
  await expect(page.getByText("Smoke tests open every page")).toBeVisible();
  // the demo note leaves out the ">" on the Big idea's second line; it still goes in the box
  await expect(page.getByRole("complementary").filter({ hasText: "Big idea" })).toContainText("Smoke tests open every page");
  await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Courses", exact: true })).toHaveAttribute("aria-current", "page");
});

test("the new look is the default; the classic look can be chosen and is remembered", async ({ page }) => {
  // a first visit, and classic addresses, open the new look
  await page.goto("/");
  await expect(page).toHaveURL(/\/v2\/2026-Demo$/);
  await page.goto(`${SEM}/updates`);
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/notifications$/);
  // choosing the classic look (in Settings) sticks
  await page.getByRole("button", { name: /^Profile/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/settings$/);
  await page.getByRole("button", { name: "Back to the classic look" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/2026-Demo$/);
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

test("v2: links to the AI background work page stay in v2, new windows included", async ({ page }) => {
  // made-up running AI work so the activity bar and Ask AI show their links
  await page.route("**/api/ai/prep", (r) => r.fulfill({ json: {
    enabled: true, busy: true, running: [{ id: "notes:DEMO101", chatId: "made-up" }], queue: [], finished: [], total: 2, done: 1, error: null,
  } }));
  await page.goto(`/v2${SEM}`);
  await expect(page.getByRole("link", { name: "Open ↗" })).toHaveAttribute("href", "/v2/2026-Demo/ai-work");
  await page.getByRole("button", { name: "Ask AI" }).click();
  await expect(page.getByRole("dialog", { name: "Ask AI" }).getByRole("link", { name: /background task/ })).toHaveAttribute("href", "/v2/2026-Demo/ai-work");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Profile/ }).click();
  const menuLink = page.getByRole("menuitem", { name: "AI background work" });
  await expect(menuLink).toHaveAttribute("href", "/v2/2026-Demo/ai-work");
  await menuLink.click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/ai-work$/);
});

test("v2: the bell counts what's new, its drop-down lists it with Sync now, and See all opens the full page", async ({ page }) => {
  await page.goto(`/v2${SEM}/calendar`);
  // no Inbox in the nav any more: the bell replaces it
  await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Inbox" })).toHaveCount(0);
  const bell = page.getByRole("button", { name: "Notifications · 3 new" });
  await bell.click();
  const drop = page.getByRole("dialog", { name: "Notifications" });
  await expect(drop.getByText("3 new")).toBeVisible();
  await expect(drop.getByText("New grade: Assignment 1")).toBeVisible();
  await expect(drop.getByRole("button", { name: "Sync now" })).toBeVisible();
  // opening it marked them read
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await drop.getByRole("link", { name: /See all notifications/ }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/notifications$/);
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
});

test("v2: forum posts and announcements show their whole message, long ones fold", async ({ page }) => {
  await page.goto(`/v2${SEM}/notifications`);
  const row = page.getByTestId("update-detail").filter({ hasText: "Final exam for Demo Studies" });
  await expect(row).toHaveClass(/line-clamp-4/);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(row).not.toHaveClass(/line-clamp/);
  // the whole text, paragraphs kept
  await expect(row).toContainText("so everyone can see the answer.");
  expect(await row.innerText()).toContain("Best wishes,\nThe demo tutor");
  await page.getByRole("button", { name: "Show less" }).click();
  await expect(row).toHaveClass(/line-clamp-4/);
  // a short reply needs no folding
  await expect(page.getByTestId("update-detail").filter({ hasText: "On 12 January." })).not.toHaveClass(/line-clamp/);
});

test("v2: the profile menu opens Settings, with eClass, AI tools, transcripts, appearance and the version", async ({ page }) => {
  const { version } = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
  await page.goto(`/v2${SEM}`);
  await page.getByRole("button", { name: /^Profile/ }).click();
  await expect(page.getByRole("menuitem", { name: "Ask AI chats" })).toHaveAttribute("href", "/v2/2026-Demo/chat");
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  for (const name of ["eClass", "AI tools", "Video transcripts", "Appearance", "About"]) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  await expect(page.getByTestId("app-version")).toContainText(`v${version}`);
  await expect(page.getByRole("radiogroup", { name: "Colour theme" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
});

test("v2: an open week groups its items under Watch, Read, My notes and Practice", async ({ page }) => {
  await page.goto(`/v2${SEM}/courses/DEMO101`);
  await page.getByRole("button", { name: /Getting started/ }).first().click();
  const week = page.locator("#w1");
  for (const name of ["Watch", "Read", "My notes", "Practice"]) await expect(week.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(week.getByRole("heading", { name: "Watch" }).locator("..")).toContainText("transcript");
  await expect(week.getByRole("heading", { name: "Practice" }).locator("..").getByRole("button", { name: /Quiz me/ })).toBeVisible();
});

test("v2: Today lists overdue work first, the same as the Calendar", async ({ page }) => {
  await page.goto(`/v2${SEM}`);
  const overdue = page.getByRole("region", { name: "Overdue" });
  await expect(overdue.getByRole("heading", { name: /Overdue · 1/ })).toBeVisible();
  await expect(overdue.getByText("Assignment 1")).toBeVisible();
  await expect(page.getByText("Next deadline")).toBeHidden();
});

test("v2: a grade update opens its assignment, with the grade and the tutor's feedback at the top", async ({ page }) => {
  // made-up: the demo assignment graded, with written feedback
  await page.route("**/data/2026-Demo.json", async (route) => {
    const data = await (await route.fetch()).json();
    const a = data.assignments.find((x: { title: string }) => x.title === "Assignment 1");
    Object.assign(a, { submitted: true, grade: "8.00", feedback: "Clear argument.\nCite the reading next time." });
    await route.fulfill({ json: data });
  });
  await page.goto(`/v2${SEM}`);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.getByRole("dialog", { name: "Notifications" }).getByRole("link", { name: "New grade: Assignment 1" }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/assignments\/DEMO101\//);
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeHidden();
  const box = page.getByTestId("assignment-grade");
  await expect(box).toContainText("8.00");
  await expect(box).toContainText("Cite the reading next time.");
  await expect(page.getByText("Graded 8.00").first()).toBeVisible();
  // the course's assignment list says Graded too
  await page.goto(`/v2${SEM}/courses/DEMO101`);
  await page.getByRole("tab", { name: /Assignments/ }).click();
  await expect(page.getByText("Graded 8.00")).toBeVisible();
});

test("v2: course cards count in the singular, and the bell's drop-down fits on a phone", async ({ page }) => {
  await page.goto(`/v2${SEM}/courses`);
  await expect(page.getByText(/1 note · .*1 quiz\b/).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const box = await page.getByRole("dialog", { name: "Notifications" }).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});

test("v2: going back from a video or an assignment keeps the course week open and Courses highlighted", async ({ page }) => {
  const nav = () => page.getByRole("navigation", { name: "Main" }).first();
  await page.goto(`/v2${SEM}/courses/DEMO101`);
  await page.getByRole("button", { name: /Getting started/ }).first().click();
  const week = page.locator("#w1");
  await expect(week.getByRole("heading", { name: "Watch" })).toBeVisible();
  // a class video, then the browser's Back
  await week.getByRole("heading", { name: "Watch" }).locator("..").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/video\//);
  await page.goBack();
  await expect(week.getByRole("heading", { name: "Watch" })).toBeVisible();
  // the video page's course chip goes back to the week
  await week.getByRole("heading", { name: "Watch" }).locator("..").getByRole("link").first().click();
  await page.getByRole("link", { name: /^Back to Demo Studies/ }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/courses\/DEMO101#w1$/);
  await expect(week.getByRole("heading", { name: "Watch" })).toBeVisible();
  // an assignment opened from the course: Courses stays highlighted, and its back link is the course week
  await page.getByRole("tab", { name: /Assignments/ }).click();
  await page.getByText("Assignment 1").first().click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/assignments\//);
  await expect(nav().getByRole("link", { name: "Courses", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: /^← Demo Studies/ }).click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/courses\/DEMO101(#w\d+)?$/);
});

test("v2 settings: each AI's default model is picked and saved", async ({ page }) => {
  let setting: string | undefined;
  const posted: unknown[] = [];
  await page.route("**/api/ai/status**", (route) => route.fulfill({ json: {
    chosen: "opencode", label: "opencode", agentic: true, ready: true, reason: "", token: "t",
    tools: [
      { id: "claude", label: "Claude Code", state: "missing" },
      { id: "opencode", label: "opencode", state: "connected", chosen: true, models: ["qwen3:8b", "gemma3:4b"], own: "qwen3:8b", model: setting ?? "qwen3:8b", setting },
    ],
  } }));
  await page.route("**/api/ai/defaults", (route) => {
    const body = route.request().postDataJSON();
    posted.push(body);
    setting = body.model || undefined;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/v2${SEM}/settings`);
  const pick = page.getByTestId("default-models").getByRole("combobox", { name: "opencode" });
  await expect(pick.locator("option")).toHaveText(["opencode's own (qwen3:8b)", "qwen3:8b", "gemma3:4b"]);
  await expect(pick).toHaveValue("");
  await pick.selectOption("gemma3:4b");
  await expect(pick).toHaveValue("gemma3:4b");
  expect(posted).toEqual([{ tool: "opencode", model: "gemma3:4b" }]);
  await expect(page.getByTestId("default-models").getByRole("combobox")).toHaveCount(1);   // not for AIs that aren't installed
});

test("a formula's symbol list is one aligned row per symbol", async ({ page }) => {
  await page.goto(`/v2${SEM}/notes/DEMO101/week-01-getting-started`);
  const where = page.getByTestId("formula-where").filter({ hasText: "candidate class" });
  await expect(where.locator("dt")).toHaveCount(3);
  const xs = await where.locator("dd").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  const ys = await where.locator("dd").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(xs).size).toBe(1);          // every meaning starts at the same place
  expect(ys[0]).toBeLessThan(ys[1]);           // and each symbol has its own row
  expect(ys[1]).toBeLessThan(ys[2]);
  await expect(page.locator(".katex-error")).toHaveCount(0);
});

test("v2 calendar lists the exams read from the exam timetable in the course files", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T10:00:00"));
  await page.goto(`/v2${SEM}/calendar`);
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Exams" }).click();
  await expect(page.getByText("Demo Studies · Final exam")).toBeVisible();
  await expect(page.getByText("Demo Studies · Repeat exam")).toBeVisible();
  await expect(page.getByText("Nothing coming up.")).toHaveCount(0);
});
