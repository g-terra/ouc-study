/**
 * /api/backup for Settings › Backup and the one-time "Back up your study data" prompt (a Vite middleware).
 *   GET  /api/backup                   setup (never the sign-in), choices, last status, running and how far, prompt, sign-in in progress
 *   POST /api/backup/run               back up now (answers when it's done); ?auto=1 after a sync: only when set up and left on
 *   POST /api/backup/github/start      sign in to GitHub with a code → { userCode, verificationUri }; GET shows when it's done
 *   POST /api/backup/github/token      { token } sign in with a pasted token
 *   POST /api/backup/choices           { auto?, courseFiles?, videos? }
 *   POST /api/backup/prompt            { action: "later" | "never" }
 *   POST /api/backup/disconnect        forgets the sign-in (the backup itself stays where it is)
 * A new setup starts its first backup right away. Only pages from this app on this computer may call it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { connectGithub, loadBackupConfig, saveBackupConfig, type BackupChoices, type BackupConfig } from "./config.ts";
import { startDeviceLogin, waitForDeviceToken } from "./github.ts";
import { backupProgress, backupRunning } from "./now.ts";
import type { BackupStatus } from "./run.ts";

export interface BackupApiOptions {
  root: string;
  /** runs one backup (backupNow with the app's options) */
  backup: (root: string) => Promise<BackupStatus>;
  /** the OAuth app for "Sign in with GitHub"; "" offers only the token route */
  githubClientId: string;
  githubApi?: string;
  githubBase?: string;
  /** false: never show the one-time prompt (the smoke tests) */
  askToSetUp?: boolean;
  now?: () => Date;
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const WEEK_MS = 7 * 24 * 60 * 60_000;

export function createBackupApi(o: BackupApiOptions) {
  const now = o.now ?? (() => new Date());
  const promptFile = join(o.root, ".ouc", "backup-prompt.json");
  const statusFile = join(o.root, ".ouc", "backup-status.json");
  // a GitHub sign-in in progress (the code to type), so the page can show it and its outcome
  let signIn: { kind: "github"; userCode?: string; verificationUri?: string; error?: string } | null = null;

  const readJson = <T>(p: string): T | null => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
  const choicesOf = (c: BackupConfig | null) => ({ auto: c?.auto ?? true, courseFiles: c?.courseFiles ?? true, videos: c?.videos ?? true });
  const setupOf = (c: BackupConfig | null) => c && { target: c.target, repo: c.repo, login: c.login };
  function prompt(): "show" | "hide" {
    if (o.askToSetUp === false || loadBackupConfig(o.root)) return "hide";
    const p = readJson<{ never?: boolean; snoozedUntil?: string }>(promptFile);
    if (p?.never) return "hide";
    return p?.snoozedUntil && now() < new Date(p.snoozedUntil) ? "hide" : "show";
  }
  /** saves a new setup, keeping the choices made before, and starts its first backup */
  function connected(cfg: BackupConfig, before: BackupChoices) {
    saveBackupConfig(o.root, { ...cfg, ...before });
    signIn = null;
    void o.backup(o.root);
  }
  const pick = (c: Partial<BackupChoices>): BackupChoices => {
    const out: BackupChoices = {};
    for (const k of ["auto", "courseFiles", "videos"] as const) if (typeof c[k] === "boolean") out[k] = c[k];
    return out;
  };

  const send = (res: ServerResponse, body: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };
  const body = (req: IncomingMessage) => new Promise<Record<string, unknown>>((ok) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } });
  });

  /** the run after a sync: only when a backup is set up and left on */
  async function auto(): Promise<BackupStatus | { skipped: true }> {
    const c = loadBackupConfig(o.root);
    return c && c.auto !== false ? o.backup(o.root) : { skipped: true };
  }

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!/^\/api\/backup(\/|$)/.test(url.pathname)) return next();
    const origin = req.headers.origin;
    if (!LOCAL.test(req.headers.host ?? "") || (origin && !LOCAL.test(origin.replace(/^https?:\/\//, "")))) return send(res, { error: "Forbidden" }, 403);
    const cfg = loadBackupConfig(o.root);
    const before = pick(cfg ?? {});
    try {
      if (req.method === "GET" && url.pathname === "/api/backup") {
        return send(res, {
          setup: setupOf(cfg), choices: choicesOf(cfg), status: readJson<BackupStatus>(statusFile), running: backupRunning(o.root), progress: backupProgress(o.root),
          prompt: prompt(), signIn, can: { githubDevice: !!o.githubClientId },
        });
      }
      if (req.method !== "POST") return send(res, { error: "Not found" }, 404);
      const b = await body(req);
      switch (url.pathname) {
        case "/api/backup/run":
          if (url.searchParams.has("auto")) return send(res, await auto());
          if (!cfg) return send(res, { error: "Backup isn't set up yet." }, 409);
          return send(res, await o.backup(o.root));
        case "/api/backup/github/token": {
          const token = String(b.token ?? "").trim();
          if (!token) return send(res, { error: "Paste a GitHub token first." }, 400);
          const gh = await connectGithub({ root: o.root, token, api: o.githubApi });
          connected(gh, before);
          return send(res, { setup: setupOf(gh) });
        }
        case "/api/backup/github/start": {
          if (!o.githubClientId) return send(res, { error: "Sign in with a token instead." }, 409);
          const d = await startDeviceLogin({ clientId: o.githubClientId, base: o.githubBase });
          signIn = { kind: "github", userCode: d.userCode, verificationUri: d.verificationUri };
          waitForDeviceToken({ clientId: o.githubClientId, deviceCode: d.deviceCode, interval: d.interval, base: o.githubBase })
            .then((token) => connectGithub({ root: o.root, token, api: o.githubApi }))
            .then((gh) => connected(gh, before), (e: Error) => { signIn = { kind: "github", error: e.message }; });
          return send(res, signIn);
        }
        case "/api/backup/choices":
          if (!cfg) return send(res, { error: "Backup isn't set up yet." }, 409);
          saveBackupConfig(o.root, { ...cfg, ...pick(b) });
          return send(res, { choices: choicesOf(loadBackupConfig(o.root)) });
        case "/api/backup/prompt": {
          mkdirSync(join(o.root, ".ouc"), { recursive: true });
          const p = b.action === "never" ? { never: true } : { snoozedUntil: new Date(now().getTime() + WEEK_MS).toISOString() };
          writeFileSync(promptFile, `${JSON.stringify(p)}\n`);
          return send(res, { prompt: prompt() });
        }
        case "/api/backup/disconnect":
          if (existsSync(join(o.root, ".ouc", "backup.json"))) rmSync(join(o.root, ".ouc", "backup.json"));
          signIn = null;
          return send(res, { setup: null });
        default:
          return send(res, { error: "Not found" }, 404);
      }
    } catch (e) {
      return send(res, { error: (e as Error).message }, 400);
    }
  };
  return Object.assign(handler, { auto });
}
