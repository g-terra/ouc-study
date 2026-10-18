import { defineConfig, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-ignore: plain JS module shared with the `ouc` command line
import { createAiApi } from "../../packages/ai/api.mjs";
// @ts-ignore: plain JS module shared with the `ouc` command line
import { checkForUpdate, restartDetached } from "../../bin/lib/update.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const SEMESTERS = resolve(HERE, "../../semesters");
const MIME: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".json": "application/json", ".ipynb": "application/json", ".html": "text/html; charset=utf-8",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Runs a Node script from the repo root and resolves with its last JSON line on stdout. */
function runJson(args: string[]): Promise<any> {
  return new Promise((done) => {
    let out = "";
    const p = spawn(process.execPath, args, { cwd: resolve(HERE, "../..") });
    p.stdout.on("data", (d) => (out += d));
    p.on("exit", () => {
      const line = out.trim().split("\n").reverse().find((l) => l.startsWith("{"));
      try { done(line ? JSON.parse(line) : { ok: false, state: "error", error: "No response from sync script" }); }
      catch { done({ ok: false, state: "error", error: "Couldn't read the sync result" }); }
    });
  });
}
const SYNC = () => resolve(HERE, "../../packages/eclass-sync/daily.mjs");
/** Is the newest semester's course structure from the eClass API (so pull.mjs can fetch new files)? */
const apiSemester = () => {
  const dir = resolve(HERE, "../../semesters");
  const metas = existsSync(dir) ? readdirSync(dir).map((d) => resolve(dir, d, "_meta/eclass-meta.json")).filter(existsSync) : [];
  const newest = metas.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return !!newest && /"source":\s*"api"/.test(readFileSync(newest, "utf8"));
};
const TSX = () => resolve(HERE, "../../node_modules/tsx/dist/cli.mjs");

/** /api/eclass/status (GET, cached 5 min; ?fresh=1 to force) and /api/eclass/sync (POST). */
function eclassApi(): Plugin {
  let cache: { at: number; body: any } | undefined;
  let syncing: Promise<any> | undefined;
  const send = (res: any, body: any) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/eclass/")) return next();
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/eclass/status") {
      if (!cache || Date.now() - cache.at > 5 * 60_000 || url.searchParams.has("fresh")) {
        const body = await runJson([SYNC(), "--check", "--json"]);
        cache = { at: Date.now(), body: { ...body, checkedAt: new Date().toISOString(), syncing: !!syncing } };
      }
      return send(res, { ...cache.body, syncing: !!syncing });
    }
    if (url.pathname === "/api/eclass/sync" && req.method === "POST") {
      const node = (args: string[]) => new Promise((ok) => spawn(process.execPath, args, { cwd: resolve(HERE, "../..") }).on("exit", ok));
      syncing ??= runJson([SYNC(), "--json", "--quiet"]).then(async (r) => {
        // new course files too (like `ouc sync`), for semesters whose structure comes from the eClass API
        if (r.ok && apiSemester()) await node([resolve(HERE, "../../packages/eclass-sync/pull.mjs"), "--quiet"]);
        await node([TSX(), "packages/content/src/build.ts"]);
        cache = { at: Date.now(), body: { ok: r.ok, state: r.state, user: r.user ?? cache?.body?.user, error: r.error, checkedAt: new Date().toISOString() } };
        // then the AI makes whatever notes and prep packs are missing, in the background
        return { ...r, ai: r.ok ? aiHandler?.catchUp() : undefined };
      }).finally(() => { syncing = undefined; });
      return send(res, await syncing);
    }
    res.statusCode = 404; res.end("{}");
  };
  return { name: "eclass-api", configureServer: (s) => { s.middlewares.use(handler); }, configurePreviewServer: (s) => { s.middlewares.use(handler); } };
}

/** /api/ai/*: the Ask AI panel talks to the agent chosen with `ouc ai setup` (see packages/ai/api.mjs). */
let aiHandler: ReturnType<typeof createAiApi> | undefined;
function aiApi(): Plugin {
  const use = (s: { middlewares: Connect.Server }) => { aiHandler ??= createAiApi(resolve(HERE, "../..")); s.middlewares.use(aiHandler); };
  return {
    name: "ai-api", configurePreviewServer: use,
    configureServer(s) {
      use(s);
      // prepare open assignments that have no prep pack yet (again after each sync: see semesterFiles)
      setTimeout(() => aiHandler?.autoPrep(), 20_000).unref();
    },
  };
}

/**
 * /api/update (GET): is a newer release out? (asks GitHub at most once a day; ?fresh=1 to force)
 * /api/update (POST): update and restart the background app (`ouc restart`); the page waits for it to come back.
 */
function updateApi(): Plugin {
  const ROOT = resolve(HERE, "../..");
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  let updating = false;
  const send = (res: any, body: any, status = 200) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/update")) return next();
    // only pages from this app on this computer (the update runs git and npm)
    const origin = req.headers.origin;
    if (!LOCAL.test(req.headers.host ?? "") || (origin && !LOCAL.test(origin.replace(/^https?:\/\//, "")))) return send(res, { error: "Forbidden" }, 403);
    // the button restarts the background app; with `npm run dev` there is none, so it shows the command instead
    const canUpdate = process.env.OUC_BACKGROUND === "1";
    if (req.method === "POST") {
      if (!canUpdate) return send(res, { ok: false, error: "Run in Terminal: ouc update, then restart the app" }, 409);
      if (!updating) { updating = true; restartDetached(ROOT); }
      return send(res, { ok: true, updating: true });
    }
    const fresh = new URL(req.url, "http://x").searchParams.has("fresh");
    send(res, { ...(await checkForUpdate(ROOT, { fresh })), canUpdate, updating });
  };
  return { name: "update-api", configureServer: (s) => { s.middlewares.use(handler); }, configurePreviewServer: (s) => { s.middlewares.use(handler); } };
}

/** Serves the course files from ../../semesters at /files/<semester>/<path> (dev + preview). */
function semesterFiles(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith("/files/")) return next();
    const rel = decodeURIComponent(req.url.slice("/files/".length).split("?")[0]);
    const abs = resolve(SEMESTERS, rel);
    if (!(abs + sep).startsWith(SEMESTERS + sep) || !existsSync(abs) || !statSync(abs).isFile()) {
      res.statusCode = 404;
      return res.end("File not found");
    }
    const { size } = statSync(abs);
    res.setHeader("Content-Type", MIME[extname(abs).toLowerCase()] ?? "application/octet-stream");
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : size - 1;
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", end - start + 1);
      return createReadStream(abs, { start, end }).pipe(res);
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", size);
    createReadStream(abs).pipe(res);
  };
  return {
    name: "semester-files",
    configureServer(server) {
      server.middlewares.use(handler);
      // Rebuild the data when notes, metadata or semester config change.
      let timer: NodeJS.Timeout | undefined;
      // Vite's watcher takes paths, not globs: watch these folders of every semester (the handler below filters files)
      const sems = existsSync(SEMESTERS) ? readdirSync(SEMESTERS).filter((d) => existsSync(resolve(SEMESTERS, d, "semester.json"))) : [];
      for (const d of sems) for (const x of ["notes", "plans"]) mkdirSync(resolve(SEMESTERS, d, x), { recursive: true }); // so the first note or plan is seen
      server.watcher.add(sems.flatMap((d) => ["notes", "plans", "_meta", "updates", "assignments", "semester.json"].map((x) => resolve(SEMESTERS, d, x))));
      // Check eClass for news when the app starts (only if a key has been set up).
      if (existsSync(resolve(HERE, "../../.eclass-token")) && !process.env.NO_SYNC) {
        spawn(process.execPath, [resolve(HERE, "../../packages/eclass-sync/daily.mjs"), "--quiet"], { cwd: resolve(HERE, "../.."), stdio: "inherit" });
      }
      server.watcher.on("all", (_event, file) => {
        if (!file.startsWith(SEMESTERS) || !/(\/notes\/.*\.md|\/plans\/[^/]+\.md|\/assignments\/.*\/PREP\.md|\/_meta\/(?!sync-state).*\.json|\/updates\/(?!connection).*\.json|semester\.json)$/.test(file.replaceAll(sep, "/"))) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          // use this same Node + local tsx (works in the background service where npm isn't on PATH)
          const p = spawn(process.execPath, [resolve(HERE, "../../node_modules/tsx/dist/cli.mjs"), "packages/content/src/build.ts"], { cwd: resolve(HERE, "../.."), stdio: "inherit" });
          // the app re-reads its data in place (no page reload, so an Ask AI run on screen isn't interrupted)
          p.on("exit", () => {
            server.ws.send({ type: "custom", event: "ouc:data" });
            aiHandler?.autoPrep(); // a sync may have brought a new assignment
          });
        }, 300);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), semesterFiles(), eclassApi(), aiApi(), updateApi()],
  server: { port: 5173 },
});
