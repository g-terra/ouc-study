/** The backup's settings and sign-in, .ouc/backup.json: git-ignored, never backed up, readable only by this user. */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensurePrivateRepo, githubUser } from "./github.ts";

export interface GithubConfig {
  target: "github";
  /** owner/name */
  repo: string;
  login: string;
  token: string;
  /** where to push instead of github.com/<repo> (tests, GitHub Enterprise) */
  remote?: string;
}
/** What goes in and when. */
export interface BackupChoices {
  /** after each eClass sync (default on) */
  auto?: boolean;
  courseFiles?: boolean;
  videos?: boolean;
}
export type BackupConfig = GithubConfig & BackupChoices;

const file = (root: string) => join(root, ".ouc", "backup.json");

/** null when not set up (a Google Drive setup from an older version counts as not set up) */
export function loadBackupConfig(root: string): BackupConfig | null {
  try {
    const cfg = JSON.parse(readFileSync(file(root), "utf8"));
    return cfg?.target === "github" ? cfg : null;
  } catch { return null; }
}

export function saveBackupConfig(root: string, cfg: BackupConfig) {
  mkdirSync(join(root, ".ouc"), { recursive: true });
  writeFileSync(file(root), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file(root), 0o600); // an older file keeps its mode on overwrite
}

/** Checks a GitHub sign-in, makes (or finds) the private backup repo and saves both. Nothing is saved if a step fails. */
export async function connectGithub(o: { root: string; token: string; repoName?: string; api?: string }): Promise<GithubConfig> {
  const login = await githubUser(o.token, o.api);
  const repo = await ensurePrivateRepo(o.token, login, o.repoName ?? "ouc-study-backup", o.api);
  const cfg: GithubConfig = { target: "github", repo, login, token: o.token };
  saveBackupConfig(o.root, cfg);
  return cfg;
}
