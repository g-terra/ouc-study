// Search (header button or ⌘K / Ctrl K): results from notes, slides, transcripts and eClass posts, grouped by course and week, each opening the right moment.
import { expect, test } from "@playwright/test";

const SEM = "/v2/2026-Demo";
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("ouc-tour-seen", "1"); } catch {} });
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

test("Ctrl K finds a line of a video transcript and opens the video at that moment", async ({ page }) => {
  await page.goto(`${SEM}/calendar`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await dialog.getByRole("searchbox", { name: "Search your courses" }).fill("open the lecture SLIDES");
  const hit = dialog.getByRole("option", { name: /Video: Welcome to the demo/ });
  await expect(hit).toContainText("Transcript · at 0:30");
  await expect(hit.locator("p mark").first()).toHaveText("open");
  await expect(dialog.getByRole("heading", { name: /Getting started/ })).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/video\/.*Welcome\.mp4#t=30$/);
  await expect(page.getByTestId("transcript").getByRole("button", { name: /0:30 Next, open the lecture slides/ })).toHaveAttribute("aria-current", "true");
  await expect.poll(() => page.getByTestId("class-video").evaluate((v) => Math.round((v as unknown as { currentTime: number }).currentTime))).toBe(30);
});

test("the search button finds slides, notes and eClass posts; Enter opens the selected one", async ({ page }) => {
  await page.goto(SEM);
  await page.locator("header").getByRole("button", { name: "Search" }).click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  const box = dialog.getByRole("searchbox");
  await expect(dialog).toContainText("Everything stays on this computer");

  await box.fill("exam");
  await expect(dialog.getByRole("heading", { name: "Announcements and forum" })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Final exam arrangements/ })).toContainText("eClass post");

  await box.fill("nothing like this anywhere");
  await expect(dialog).toContainText("Nothing found for “nothing like this anywhere”");

  await box.fill("smoke tests");
  await expect(dialog.getByRole("option", { name: /Week 1 · Getting started/ }).first()).toContainText("Note");

  // a note's formula block shows as its words, not its YAML or LaTeX
  await box.fill("speed of light");
  const formula = dialog.getByRole("option", { name: /Week 1 · Getting started/ }).first();
  await expect(formula).toContainText("Mass-energy equivalence · c: speed of light");
  await expect(formula).not.toContainText("tex:");

  await box.fill("spaced repetition");
  const slides = dialog.getByRole("option", { name: /Demo lecture/ });
  await expect(slides).toContainText("Slides · slide 2");
  await expect(slides).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/v2\/2026-Demo\/slides\/.*Demo%20lecture\.pptx#2$/);
});

test("Escape closes search, and the API answers only for a semester it knows", async ({ page, request }) => {
  await page.goto(SEM);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  // like Spotlight: the whole page, header included, dimmed; the box in the middle, well below the header
  const view = page.viewportSize()!;
  const backdrop = (await page.getByTestId("search-backdrop").boundingBox())!;
  expect([backdrop.y, backdrop.height]).toEqual([0, view.height]);
  const box = (await page.getByRole("dialog", { name: "Search" }).boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(2);
  expect(box.y).toBeGreaterThan(view.height * 0.15);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeHidden();
  expect((await request.get("/api/search?sem=..&q=x")).status()).toBe(404);
  expect((await request.get("/api/search?sem=nope&q=x")).status()).toBe(404);
  const ok = await (await request.get("/api/search?sem=2026-Demo&q=welcome")).json();
  expect(ok.hits.length).toBeGreaterThan(0);
});
