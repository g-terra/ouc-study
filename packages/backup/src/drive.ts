/**
 * Google Drive for the backup. Sign-in: the browser opens Google (PKCE, only the `drive.file`
 * permission: the app sees the files it made and nothing else) and comes back to a one-off local page.
 * Backup: the study folder's tree is mirrored into "OUC Study backup" in My Drive; only new or changed
 * files are uploaded (resumable, in chunks), and removed ones are moved to "_removed" rather than lost.
 * What's where is kept in .ouc/drive-state.json. `api`/`tokenUrl` point at a fake server in tests.
 */
import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER = "OUC Study backup";
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const TIMEOUT_MS = 60_000;
const SIGN_IN_WAIT_MS = 10 * 60_000;

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function googleAuthUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string }) {
  const q = new URLSearchParams({
    client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code", scope: SCOPE,
    code_challenge: o.challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent", state: o.state,
  });
  return `${AUTH}?${q}`;
}

/** Listens on a free local port for Google's redirect; resolves once listening, `code` once the browser comes back. */
export async function waitForGoogleCode(o: { state: string }): Promise<{ redirectUri: string; code: Promise<string> }> {
  let done: (code: string) => void = () => {};
  let fail: (e: Error) => void = () => {};
  const code = new Promise<string>((ok, no) => { done = ok; fail = no; });
  code.catch(() => {}); // the caller may not be awaiting it yet
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!u.searchParams.has("code") && !u.searchParams.has("error")) { res.writeHead(404); res.end(); return; }
    const ok = u.searchParams.get("state") === o.state && u.searchParams.get("code");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(ok ? "<p>Signed in to Google. You can close this tab and go back to OUC Study.</p>" : "<p>Google sign-in didn't work. Go back to OUC Study and try again.</p>");
    server.close();
    clearTimeout(timer);
    if (ok) done(ok);
    else fail(new Error(u.searchParams.get("error") === "access_denied" ? "Google sign-in was cancelled." : "Google sign-in didn't match. Try again."));
  });
  const timer = setTimeout(() => { server.close(); fail(new Error("Google sign-in timed out. Try again.")); }, SIGN_IN_WAIT_MS);
  timer.unref();
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, code };
}

async function token(url: string, form: Record<string, string>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const d = (await r.json().catch(() => ({}))) as Record<string, string>;
  if (d.error === "invalid_grant") throw new Error("Google sign-in expired. Sign in again.");
  if (!r.ok || !d.access_token) throw new Error(`Google sign-in failed: ${d.error_description ?? d.error ?? r.status}`);
  return d;
}

export async function exchangeCode(o: { clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string; tokenUrl?: string }) {
  const d = await token(o.tokenUrl ?? TOKEN, {
    client_id: o.clientId, client_secret: o.clientSecret, code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri, grant_type: "authorization_code",
  });
  if (!d.refresh_token) throw new Error("Google didn't give a lasting sign-in. Try again.");
  return { refreshToken: d.refresh_token, accessToken: d.access_token };
}

export async function refreshAccess(o: { clientId: string; clientSecret: string; refreshToken: string; tokenUrl?: string }) {
  return (await token(o.tokenUrl ?? TOKEN, { client_id: o.clientId, client_secret: o.clientSecret, refresh_token: o.refreshToken, grant_type: "refresh_token" })).access_token;
}

interface DriveState {
  folderId?: string;
  removedId?: string;
  /** folder path ("" = the backup folder) → Drive id */
  folders: Record<string, string>;
  files: Record<string, { id: string; parent: string; size: number; mtimeMs: number }>;
}

export interface DriveBackupOptions {
  root: string;
  accessToken: string;
  /** relative to root, with "/" */
  files: string[];
  /** backup name → the file to upload under it, when that isn't the file itself (a video's smaller copy) */
  from?: Record<string, string>;
  api?: string;
  /** upload chunk size, a multiple of 256 KB */
  chunkBytes?: number;
}

export async function driveBackup(o: DriveBackupOptions): Promise<{ uploaded: number; removed: number }> {
  const api = o.api ?? API;
  const statePath = join(o.root, ".ouc", "drive-state.json");
  let state: DriveState = { folders: {}, files: {} };
  try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch {}
  const save = () => { mkdirSync(join(o.root, ".ouc"), { recursive: true }); writeFileSync(statePath, JSON.stringify(state)); };

  async function call(method: string, url: string, body?: string | Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) {
    const r = await fetch(url, { method, body, headers: { authorization: `Bearer ${o.accessToken}`, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 401) throw new Error("Google sign-in expired. Sign in again.");
    if (r.status === 403 && /storageQuota/i.test(await r.clone().text())) throw new Error("Your Google Drive is full.");
    if (!r.ok && r.status !== 308) throw new Error(`Google Drive didn't take it (${r.status}): ${(await r.text()).slice(0, 200)}`);
    return r;
  }
  const json = { "content-type": "application/json; charset=utf-8" };
  const makeFolder = async (name: string, parent?: string) =>
    String(((await (await call("POST", `${api}/drive/v3/files`, JSON.stringify({ name, mimeType: FOLDER_TYPE, ...(parent ? { parents: [parent] } : {}) }), json)).json()) as { id: string }).id);

  if (!state.folderId) {
    const q = `name = '${FOLDER}' and mimeType = '${FOLDER_TYPE}' and 'root' in parents and trashed = false`;
    const found = (await (await call("GET", `${api}/drive/v3/files?${new URLSearchParams({ q, fields: "files(id)" })}`)).json()) as { files: { id: string }[] };
    state.folderId = found.files[0]?.id ?? (await makeFolder(FOLDER));
    state.folders = { "": state.folderId };
    save();
  }
  async function folder(dir: string): Promise<string> {
    if (state.folders[dir]) return state.folders[dir];
    const cut = dir.lastIndexOf("/");
    const parent = await folder(cut < 0 ? "" : dir.slice(0, cut));
    state.folders[dir] = await makeFolder(dir.slice(cut + 1), parent);
    save();
    return state.folders[dir];
  }

  const source = (path: string) => o.from?.[path] ?? join(o.root, path);
  async function upload(path: string, size: number, existing?: string): Promise<string> {
    const cut = path.lastIndexOf("/");
    const parent = await folder(cut < 0 ? "" : path.slice(0, cut));
    const start = existing
      ? await call("PATCH", `${api}/upload/drive/v3/files/${existing}?uploadType=resumable`, "{}", json)
      : await call("POST", `${api}/upload/drive/v3/files?uploadType=resumable`, JSON.stringify({ name: path.slice(cut + 1), parents: [parent] }), json);
    const session = start.headers.get("location");
    if (!session) throw new Error("Google Drive didn't start the upload.");
    const chunk = o.chunkBytes ?? 8 * 1024 * 1024;
    const fd = openSync(source(path), "r");
    try {
      if (size === 0) return String(((await (await call("PUT", session, new Uint8Array(0), { "content-range": "bytes */0" })).json()) as { id: string }).id);
      for (let at = 0; ; at += chunk) {
        const buf = Buffer.alloc(Math.min(chunk, size - at));
        readSync(fd, buf, 0, buf.length, at);
        const r = await call("PUT", session, new Uint8Array(buf), { "content-range": `bytes ${at}-${at + buf.length - 1}/${size}` });
        if (r.status !== 308) return String(((await r.json()) as { id: string }).id);
      }
    } finally { closeSync(fd); }
  }

  let uploaded = 0;
  for (const path of o.files) {
    const st = statSync(source(path));
    const was = state.files[path];
    const mtimeMs = Math.round(st.mtimeMs);
    if (was && was.size === st.size && was.mtimeMs === mtimeMs) continue;
    const id = await upload(path, st.size, was?.id);
    state.files[path] = { id, parent: await folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""), size: st.size, mtimeMs };
    save();
    uploaded++;
  }
  const keep = new Set(o.files);
  let removed = 0;
  for (const [path, f] of Object.entries(state.files)) {
    if (keep.has(path)) continue;
    state.removedId ??= await makeFolder("_removed", state.folderId);
    await call("PATCH", `${api}/drive/v3/files/${f.id}?${new URLSearchParams({ addParents: state.removedId, removeParents: f.parent })}`, "{}", json);
    delete state.files[path];
    save();
    removed++;
  }
  return { uploaded, removed };
}
