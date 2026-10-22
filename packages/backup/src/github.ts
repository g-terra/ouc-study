/**
 * GitHub for the backup: sign-in with a code typed on github.com/login/device (OAuth device flow, no
 * secret in the app), the private repo the backup goes to, and handing the sign-in to git as a header
 * so it never lands in a URL, a log or git's settings. `base`/`api` point at a fake server in tests.
 */

const GITHUB = "https://github.com";
const API = "https://api.github.com";
const TIMEOUT_MS = 30_000;

export interface DeviceLogin { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresIn: number }

async function post(url: string, form: Record<string, string>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`GitHub sign-in failed (${r.status})`);
  return r.json() as Promise<Record<string, unknown>>;
}

export async function startDeviceLogin(o: { clientId: string; base?: string }): Promise<DeviceLogin> {
  const d = await post(`${o.base ?? GITHUB}/login/device/code`, { client_id: o.clientId, scope: "repo" });
  if (typeof d.device_code !== "string") throw new Error(`GitHub sign-in failed: ${d.error_description ?? d.error ?? "no code"}`);
  return { deviceCode: d.device_code, userCode: String(d.user_code), verificationUri: String(d.verification_uri), interval: Number(d.interval ?? 5), expiresIn: Number(d.expires_in ?? 900) };
}

/** Waits until the student has typed the code (or gives up), then returns the sign-in token. */
export async function waitForDeviceToken(o: { clientId: string; deviceCode: string; interval: number; base?: string; sleep?: (ms: number) => Promise<void> }): Promise<string> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  let interval = o.interval;
  for (;;) {
    await sleep(interval * 1000);
    const d = await post(`${o.base ?? GITHUB}/login/oauth/access_token`, { client_id: o.clientId, device_code: o.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
    if (typeof d.access_token === "string") return d.access_token;
    if (d.error === "authorization_pending") continue;
    if (d.error === "slow_down") { interval = Number(d.interval ?? interval + 5); continue; }
    if (d.error === "access_denied") throw new Error("GitHub sign-in was cancelled.");
    if (d.error === "expired_token") throw new Error("The GitHub code expired. Start again for a new one.");
    throw new Error(`GitHub sign-in failed: ${d.error_description ?? d.error}`);
  }
}

async function api(token: string, base: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "content-type": "application/json", "x-github-api-version": "2022-11-28" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function githubUser(token: string, base = API): Promise<string> {
  const r = await api(token, base, "/user");
  if (r.status === 401) throw new Error("GitHub sign-in expired. Sign in again.");
  if (!r.ok) throw new Error(`GitHub didn't answer (${r.status})`);
  return String(((await r.json()) as { login: string }).login);
}

/** The backup repo, made private if it doesn't exist. Refuses a public one: personal files never go there. */
export async function ensurePrivateRepo(token: string, owner: string, name: string, base = API): Promise<string> {
  const got = await api(token, base, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  let repo: { full_name: string; private: boolean };
  if (got.status === 404) {
    const made = await api(token, base, "/user/repos", {
      method: "POST",
      body: JSON.stringify({ name, private: true, auto_init: false, description: "OUC Study backup: my notes, course files and progress (private)" }),
    });
    if (!made.ok) throw new Error(`Couldn't make the backup repo on GitHub (${made.status})`);
    repo = (await made.json()) as typeof repo;
  } else if (got.ok) repo = (await got.json()) as typeof repo;
  else throw new Error(`GitHub didn't answer (${got.status})`);
  if (!repo.private) throw new Error(`${repo.full_name} is public. Make it private on GitHub or pick another name: a backup holds your personal files.`);
  return repo.full_name;
}

export const githubRemote = (fullName: string) => `${GITHUB}/${fullName}.git`;

/** Environment that gives git the sign-in for one host only (GIT_CONFIG_* needs git 2.31+). */
export function gitAuthEnv(token: string, host = `${GITHUB}/`): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${host}.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };
}
