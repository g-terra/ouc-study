// A scanned book with two pages side by side on each wide PDF page is read one book page at a time.
import { expect, test, type Page } from "@playwright/test";

const BOOK = `/v2/2026-Demo/pdf/${encodeURIComponent("courses/DEMO101-Demo-Studies/01-Week-1-Getting-started/Scanned book.pdf")}`;

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("ouc-tour-seen", "1"); } catch {} });
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

const counter = (page: Page) => page.getByTestId("slide-counter");
/** The drawn page is taller than wide: one book page, not two. */
// a <canvas> (e2e types have no DOM library)
type Canvas = { width: number; height: number; getContext(t: "2d"): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };
const portrait = async (page: Page) => page.getByRole("img", { name: /^Page \d+/ }).evaluate((el) => { const c = el as unknown as Canvas; return c.height > c.width; });
/** Scans are often fax-coded (CCITT/JBIG2) pictures, which pdf.js decodes with its wasm files: the page must show ink, not stay blank. */
const inked = (page: Page) => expect.poll(() => page.getByRole("img", { name: /^Page \d+/ }).evaluate((el) => {
  const c = el as unknown as Canvas, px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < px.length; i += 4) if (px[i] < 100) return true;
  return false;
}), { timeout: 10_000 }).toBe(true);

test("a scanned double page is split into its left and right pages, and links keep the PDF's page", async ({ page }) => {
  await page.goto(BOOK);
  // the first PDF a fresh dev server opens waits for Vite to bundle pdf.js
  await expect(counter(page)).toHaveText("Page 1 / 5", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Split pages" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(counter(page)).toHaveText("Page 2 / 5");
  await expect(page).toHaveURL(/#page=2$/);
  expect(await portrait(page)).toBe(true);
  await inked(page);
  await page.keyboard.press("ArrowRight");
  await expect(counter(page)).toHaveText("Page 3 / 5");
  await expect(page).toHaveURL(/#page=2$/);

  // a link to PDF page 3 opens its left half
  await page.goto("about:blank");
  await page.goto(`${BOOK}#page=3`);
  await expect(counter(page)).toHaveText("Page 4 / 5", { timeout: 20_000 });
});

test("splitting can be turned off for a file, and the app remembers it", async ({ page }) => {
  await page.goto(`${BOOK}#page=2`);
  await expect(counter(page)).toHaveText("Page 2 / 5", { timeout: 20_000 });
  await page.getByRole("button", { name: "Split pages" }).click();
  await expect(counter(page)).toHaveText("Page 2 / 3");
  expect(await portrait(page)).toBe(false);
  await page.reload();
  await expect(counter(page)).toHaveText("Page 2 / 3", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Split pages" })).toHaveAttribute("aria-pressed", "false");
});

test("a PDF without wide pages offers no splitting", async ({ page }) => {
  await page.goto(`/v2/2026-Demo/pdf/${encodeURIComponent("courses/DEMO101-Demo-Studies/01-Week-1-Getting-started/Demo reading.pdf")}`);
  await expect(counter(page)).toHaveText("Page 1 / 3", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Split pages" })).toHaveCount(0);
});
