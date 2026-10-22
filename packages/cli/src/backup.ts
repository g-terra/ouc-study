// `ouc backup`: back up the study data now, set the backup up, or get it back on a new computer.
//   ouc backup            back up now (also: ouc backup now)
//   ouc backup setup      choose a private GitHub repo or Google Drive and sign in
//   ouc backup restore    get the backup back into this folder (asks before replacing a file that differs here)
//   ouc backup status     the last backup
// `backupStep` and `restoreStep` are also the backup step of `ouc setup`. Details: packages/backup.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ui from "./tui.ts";
import { findBin } from "../../ai/src/transcribe.ts";
import { githubClientId, googleClient } from "../../backup/src/clients.ts";
import { connectGithub, loadBackupConfig, saveBackupConfig } from "../../backup/src/config.ts";
import { exchangeCode, googleAuthUrl, pkce, waitForGoogleCode } from "../../backup/src/drive.ts";
import { startDeviceLogin, waitForDeviceToken } from "../../backup/src/github.ts";
import { backupNow, restoreNow } from "../../backup/src/now.ts";
import type { BackupStatus } from "../../backup/src/run.ts";
import { randomBytes } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WEEK_MS = 7 * 24 * 60 * 60_000;
const SHOW_FILES = 10;

/** The terminal, so tests can answer the questions. */
export interface BackupIo {
  select<T>(q: string, choices: ui.Choice<T>[]): Promise<T>;
  secret(q: string): Promise<string>;
  confirm(q: string, def?: boolean): Promise<boolean>;
  say(s: string): void;
  ok(s: string): void;
  warn(s: string): void;
  open(url: string): void;
}
export interface Clients {
  githubClientId: string;
  google: { clientId: string; clientSecret: string } | null;
  githubApi?: string;
  githubBase?: string;
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["explorer", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
export const terminal: BackupIo = {
  select: (q, choices) => ui.select(q, choices),
  secret: (q) => ui.secret(q),
  confirm: (q, def = true) => ui.confirm(q, def),
  say: (s) => ui.say(`  ${s}`), ok: ui.ok, warn: ui.warn,
  open: (url) => { ui.info(`Opening ${url}`); openBrowser(url); },
};

/** Asks where to back up and signs in. false: skipped (the app asks again in a week) or it didn't work. */
export async function backupStep(root: string, io: BackupIo, c: Clients): Promise<boolean> {
  const where = await io.select<"github" | "drive" | "skip">("Back up your study data?", [
    { label: "A private GitHub repo", hint: "every backup kept as a version", value: "github" },
    ...(c.google ? [{ label: "Google Drive", hint: "an \"OUC Study backup\" folder", value: "drive" as const }] : []),
    { label: "Not now", hint: "Settings › Backup in the app any time", value: "skip" },
  ]);
  if (where === "skip") {
    mkdirSync(join(root, ".ouc"), { recursive: true });
    writeFileSync(join(root, ".ouc", "backup-prompt.json"), `${JSON.stringify({ snoozedUntil: new Date(Date.now() + WEEK_MS).toISOString() })}\n`);
    return false;
  }
  const before = loadBackupConfig(root);
  const choices = { auto: before?.auto, courseFiles: before?.courseFiles, videos: before?.videos };
  try {
    if (where === "github") {
      let token: string;
      if (c.githubClientId) {
        const d = await startDeviceLogin({ clientId: c.githubClientId, base: c.githubBase });
        io.say(`Type this code on GitHub: ${ui.c.bold(d.userCode)}`);
        io.open(d.verificationUri);
        token = await waitForDeviceToken({ clientId: c.githubClientId, deviceCode: d.deviceCode, interval: d.interval, base: c.githubBase });
      } else {
        io.say("Make a fine-grained token on github.com › Settings › Developer settings › Personal access tokens:");
        io.say("all repositories (or just ouc-study-backup), Contents read and write, Administration read and write.");
        token = await io.secret("Paste the GitHub token");
        if (!token) { io.warn("No token: backup not set up."); return false; }
      }
      const gh = await connectGithub({ root, token, api: c.githubApi });
      saveBackupConfig(root, { ...gh, ...strip(choices) });
      io.ok(`Backups go to ${gh.repo} (private), signed in as ${gh.login}`);
      return true;
    }
    const google = c.google!;
    const { verifier, challenge } = pkce();
    const state = randomBytes(16).toString("hex");
    const back = await waitForGoogleCode({ state });
    io.say("Sign in with Google in the browser tab that opens.");
    io.open(googleAuthUrl({ clientId: google.clientId, redirectUri: back.redirectUri, challenge, state }));
    const t = await exchangeCode({ ...google, code: await back.code, verifier, redirectUri: back.redirectUri });
    saveBackupConfig(root, { target: "drive", refreshToken: t.refreshToken, ...strip(choices) });
    io.ok("Backups go to \"OUC Study backup\" in your Google Drive");
    return true;
  } catch (e) {
    io.warn(`Backup not set up: ${(e as Error).message}`);
    return false;
  }
}
const strip = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Gets the backup back into `root`, asking once before replacing files that differ here. */
export async function restoreStep(root: string, io: BackupIo, c: Pick<Clients, "google">): Promise<boolean> {
  const r = await restoreNow(root, {
    google: c.google,
    replace: async (differ) => {
      io.say(`${differ.length === 1 ? "This file is" : "These files are"} different on this computer and in the backup:`);
      for (const p of differ.slice(0, SHOW_FILES)) io.say(`  ${p}`);
      if (differ.length > SHOW_FILES) io.say(`  …and ${differ.length - SHOW_FILES} more`);
      return io.confirm(`Replace ${differ.length === 1 ? "this 1 file" : `these ${differ.length} files`} with the backup's? (No keeps yours)`, false);
    },
  });
  if (r.error || !r.result) { io.warn(`Restore didn't work: ${r.error}`); return false; }
  const { restored, same, kept, keptVideos } = r.result;
  io.ok(restored.length ? `Restored ${restored.length} file${restored.length === 1 ? "" : "s"} from the backup` : "Nothing to restore: this folder already has everything in the backup");
  if (same) io.say(`${same} already the same here`);
  if (kept.length) io.say(`${kept.length} kept as they are on this computer`);
  if (keptVideos.length) io.say(`${keptVideos.length} class video${keptVideos.length === 1 ? "" : "s"} kept (the originals on this computer)`);
  return true;
}

export function statusText(s: BackupStatus | null) {
  if (!s) return "No backup yet.";
  const when = new Date(s.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  return s.ok ? `Backed up ${when}: ${s.summary}` : `Backup failed ${when}: ${s.error}`;
}

const clients = (): Clients => ({ githubClientId: githubClientId(), google: googleClient() });
function lastStatus(root: string): BackupStatus | null {
  try { return JSON.parse(readFileSync(join(root, ".ouc", "backup-status.json"), "utf8")); } catch { return null; }
}

export async function main(args = process.argv.slice(2)) {
  const [sub = "now"] = args;
  const root = process.env.OUC_BACKUP_ROOT ?? ROOT;
  try {
    if (sub === "setup") {
      if (await backupStep(root, terminal, clients()) && await terminal.confirm("Back up now?", true)) await main(["now"]);
    } else if (sub === "restore") {
      if (!loadBackupConfig(root) && !(await backupStep(root, terminal, clients()))) { process.exitCode = 1; return; }
      if (!(await restoreStep(root, terminal, clients()))) process.exitCode = 1;
    } else if (sub === "status") {
      const cfg = loadBackupConfig(root);
      ui.say(cfg ? `  To ${cfg.target === "github" ? `${cfg.repo} on GitHub` : "Google Drive"}` : "  Backup isn't set up yet: ouc backup setup");
      ui.say(`  ${statusText(lastStatus(root))}`);
    } else if (sub === "now") {
      if (!loadBackupConfig(root)) { ui.warn("Backup isn't set up yet. Run: ouc backup setup"); process.exitCode = 1; return; }
      const sp = ui.spinner("Backing up…");
      const s = await backupNow(root, { google: clients().google, ffmpeg: findBin("ffmpeg") });
      s.ok ? sp.succeed(statusText(s)) : sp.fail(statusText(s));
      if (!s.ok) process.exitCode = 1;
    } else {
      ui.say("  ouc backup [now|setup|restore|status]");
      process.exitCode = 1;
    }
  } finally { ui.closeInput(); }
}
