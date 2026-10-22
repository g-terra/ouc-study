// Starts the app for the smoke tests on the demo semester (e2e/demo), the way `ouc` starts it:
// the root node_modules/vite in apps/web. Data goes to a temp folder, so your own semesters and
// apps/web/public/data are never touched.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "ouc-e2e-"));
cpSync(join(ROOT, "e2e/demo"), join(tmp, "semesters"), { recursive: true });
// the homework PDF is printed by the same Chromium the tests run in
const pdfBrowser = process.env.PLAYWRIGHT_CHROMIUM ?? (() => { try { return createRequire(import.meta.url)("playwright-core").chromium.executablePath() as string; } catch { return ""; } })();
const env = { ...process.env, OUC_SEMESTERS: join(tmp, "semesters"), OUC_PUBLIC: join(tmp, "public"), NO_SYNC: "1", OUC_BACKUP_ROOT: tmp, OUC_NO_BACKUP_PROMPT: "1", OUC_PDF_BROWSER: pdfBrowser, OUC_PDF_NO_SANDBOX: "1" };
const built = spawnSync(process.execPath, [join(ROOT, "node_modules/tsx/dist/cli.mjs"), "packages/content/src/build.ts"], { cwd: ROOT, env, stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);
const port = process.env.E2E_PORT ?? "5180";
const vite = spawn(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "--port", port, "--strictPort", "--host", "127.0.0.1"], { cwd: join(ROOT, "apps/web"), env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => vite.kill(sig));
vite.on("exit", (code) => process.exit(code ?? 0));
