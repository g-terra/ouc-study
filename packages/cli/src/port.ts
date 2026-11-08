// The app's port: OUC_PORT, else the one saved with `ouc port <n>` in .ouc/settings.json, else 5173.
// `ouc`, the background server and the LaunchAgent all read it here, so they agree on one address.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_PORT = "5173";
const file = (root: string) => join(root, ".ouc/settings.json");

/** The port as a string, or null unless it's a whole number from 1024 to 65535 (no admin rights needed). */
export function parsePort(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1024 && n <= 65535 ? String(n) : null;
}

const readSettings = (root: string): Record<string, unknown> => {
  try { const j = JSON.parse(readFileSync(file(root), "utf8")); return j && typeof j === "object" ? j : {}; } catch { return {}; }
};

export function readPort({ root, env = process.env }: { root: string; env?: NodeJS.ProcessEnv }): string {
  return parsePort(env.OUC_PORT) ?? parsePort(readSettings(root).port) ?? DEFAULT_PORT;
}

export function savePort(root: string, value: string): string {
  const port = parsePort(value);
  if (!port) throw new Error(`Not a usable port: ${value} (pick a number from 1024 to 65535)`);
  mkdirSync(join(root, ".ouc"), { recursive: true });
  writeFileSync(file(root), `${JSON.stringify({ ...readSettings(root), port }, null, 2)}\n`);
  return port;
}

/** What `ouc port <n>` redoes: rewrite the autostart files that hold the port, and restart an app still on the old one. */
export function afterPortChange({ platform, autostart, running }: { platform: NodeJS.Platform; autostart: boolean; running: boolean }): { reinstall: boolean; restart: boolean } {
  // reloading a LaunchAgent restarts the app; the Windows Startup launcher only runs at login
  return { reinstall: autostart, restart: running && !(platform === "darwin" && autostart) };
}
