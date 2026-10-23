// Backups: Settings › Backup (connect GitHub with a token, Back up now, the choices), the one-time prompt
// and the bar when a backup failed. /api/backup is mocked: no GitHub in tests.
import { expect, test, type Page } from "@playwright/test";

const SETTINGS = "/v2/2026-Demo/settings";
let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("ouc-tour-seen", "1"); } catch {} });
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
});
test.afterEach(async () => expect(errors, "browser errors").toEqual([]));

const base = {
  setup: null, choices: { auto: true, courseFiles: true, videos: true }, status: null, running: false,
  prompt: "hide", signIn: null, can: { githubDevice: false },
};
/** a small stand-in for /api/backup that remembers what the page did */
async function mockBackup(page: Page, start: Record<string, unknown> = {}) {
  let state: Record<string, any> = { ...base, ...start };
  const posts: { path: string; body: any }[] = [];
  await page.route("**/api/backup**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/backup", "");
    if (req.method() === "GET") return route.fulfill({ json: state });
    const body = req.postDataJSON?.() ?? null;
    posts.push({ path, body });
    if (path === "/github/token") {
      state = { ...state, setup: { target: "github", repo: "student1/ouc-study-backup", login: "student1" }, status: { ok: true, target: "github", at: new Date().toISOString(), summary: "3 notes", files: 1214, bytes: 306 * 1024 * 1024 } };
      return route.fulfill({ json: { setup: state.setup } });
    }
    if (path === "/choices") { state = { ...state, choices: { ...state.choices, ...body } }; return route.fulfill({ json: { choices: state.choices } }); }
    if (path === "/run") return route.fulfill({ json: state.status });
    if (path === "/prompt") { state = { ...state, prompt: "hide" }; return route.fulfill({ json: { prompt: "hide" } }); }
    route.fulfill({ json: {} });
  });
  return posts;
}

test("backup is set up from Settings with a GitHub token, then backs up now and keeps the choices", async ({ page }) => {
  const posts = await mockBackup(page);
  await page.goto(SETTINGS);
  const section = page.getByRole("region", { name: "Backup" });
  await expect(section.getByRole("heading", { name: "A private GitHub repo" })).toBeVisible();
  await expect(section.getByText(/Google Drive/)).toHaveCount(0);
  await section.getByLabel(/GitHub token/).fill("github_pat_x");
  await section.getByRole("button", { name: "Connect GitHub" }).click();
  await expect(section.getByTestId("backup-status")).toContainText("1,214 files · 306 MB");
  await expect(section.getByRole("link", { name: "student1/ouc-study-backup" })).toBeVisible();
  await section.getByRole("button", { name: "Back up now" }).click();
  await section.getByRole("switch", { name: "Back up class videos" }).click();
  await expect(section.getByRole("switch", { name: "Back up class videos" })).toHaveAttribute("aria-checked", "false");
  expect(posts.map((p) => p.path)).toEqual(["/github/token", "/run", "/choices"]);
  expect(posts[0].body).toEqual({ token: "github_pat_x" });
  expect(posts[2].body).toEqual({ videos: false });
});

test("students who installed before get a one-time prompt: Later hides it, Set up now opens Settings", async ({ page }) => {
  const posts = await mockBackup(page, { prompt: "show" });
  await page.goto("/v2/2026-Demo");
  const dialog = page.getByRole("dialog", { name: "Back up your study data" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Later" }).click();
  await expect(dialog).toBeHidden();
  expect(posts).toEqual([{ path: "/prompt", body: { action: "later" } }]);

  await mockBackup(page, { prompt: "show" });
  await page.goto("/v2/2026-Demo");
  await page.getByRole("dialog", { name: "Back up your study data" }).getByRole("link", { name: "Set up now" }).click();
  await expect(page).toHaveURL(/\/settings#settings-backup$/);
});

test("a failed backup shows a bar with the reason, at phone width too", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockBackup(page, {
    setup: { target: "github", repo: "student1/ouc-study-backup", login: "student1" },
    status: { ok: false, at: new Date().toISOString(), summary: "", files: 0, bytes: 0, error: "GitHub sign-in expired. Sign in again." },
  });
  await page.goto("/v2/2026-Demo");
  const bar = page.getByRole("alert").filter({ hasText: "Backup didn't run." });
  await expect(bar).toContainText("GitHub sign-in expired");
  await bar.getByRole("link", { name: "Backup settings" }).click();
  await expect(page.getByRole("region", { name: "Backup" }).getByTestId("backup-status")).toContainText("The last backup didn't work");
});

test("How to get a token shows both ways, with commands to copy and links", async ({ page }) => {
  await mockBackup(page);
  await page.goto(SETTINGS);
  const section = page.getByRole("region", { name: "Backup" });
  await section.getByRole("button", { name: "How to get a token" }).click();
  const help = page.getByRole("dialog", { name: "How to get a GitHub token" });
  await expect(help.getByRole("region", { name: "With the GitHub CLI (gh)" })).toContainText(/gh auth token/);
  await expect(help.getByRole("button", { name: /^Copy gh auth token/ })).toBeVisible();
  const web = help.getByRole("region", { name: /On github\.com/ });
  await expect(web.getByRole("link", { name: "Open" }).first()).toHaveAttribute("href", /github\.com\/new\?name=ouc-study-backup&visibility=private/);
  await expect(web).toContainText("Contents → Read and write");
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

test("a running backup shows files saved out of the total and about how long is left", async ({ page }) => {
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  await mockBackup(page, {
    setup: { target: "github", repo: "student1/ouc-study-backup", login: "student1" }, running: true,
    progress: { step: "saving", done: 120, total: 340, bytesDone: 50, bytesTotal: 100, startedAt },
  });
  await page.goto(SETTINGS);
  const section = page.getByRole("region", { name: "Backup" });
  await expect(section.getByTestId("backup-status")).toHaveText("Saving files: 120 of 340 · about 2 min left");
  await expect(section.getByRole("progressbar", { name: "Backup progress" })).toHaveAttribute("aria-valuenow", "50");
  await expect(section.getByRole("button", { name: "Backing up…" })).toBeDisabled();
});
