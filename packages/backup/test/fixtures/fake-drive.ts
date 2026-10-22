// A small fake of the Drive v3 endpoints the backup and the restore use, on a local http server.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";

export interface Item { id: string; name: string; parents: string[]; mimeType?: string; data: Buffer }

/** A small fake of the Drive v3 endpoints the backup uses. */
export async function fakeDrive() {
  const items = new Map<string, Item>();
  const sessions = new Map<string, { id?: string; meta: Partial<Item>; got: Buffer[] }>();
  const puts: string[] = [];
  let n = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => chunks.push(d));
    req.on("end", () => handle(req, Buffer.concat(chunks), res));
  });
  const send = (res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  function handle(req: IncomingMessage, body: Buffer, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.headers.authorization !== "Bearer acc") return send(res, 401, { error: { message: "bad token" } });
    const id = url.pathname.split("/").pop() ?? "";
    if (req.method === "POST" && url.pathname === "/drive/v3/files") {
      const meta = JSON.parse(body.toString());
      const it = { id: `f${++n}`, name: meta.name, parents: meta.parents ?? [], mimeType: meta.mimeType, data: Buffer.alloc(0) };
      items.set(it.id, it);
      return send(res, 200, { id: it.id });
    }
    if (url.pathname === "/drive/v3/files" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      if (parent && parent !== "root") {
        const kids = [...items.values()].filter((i) => i.parents.includes(parent));
        return send(res, 200, { files: kids.map((i) => ({ id: i.id, name: i.name, mimeType: i.mimeType ?? "application/octet-stream", size: String(i.data.length), md5Checksum: i.mimeType ? undefined : createHash("md5").update(i.data).digest("hex") })) });
      }
      const name = /name = '([^']+)'/.exec(q)?.[1];
      return send(res, 200, { files: [...items.values()].filter((i) => i.name === name && i.mimeType?.includes("folder")).map((i) => ({ id: i.id })) });
    }
    if (req.method === "GET" && url.pathname.startsWith("/drive/v3/files/") && url.searchParams.get("alt") === "media") {
      const it = items.get(id);
      if (!it) return send(res, 404);
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(it.data);
    }
    if (url.pathname.startsWith("/upload/drive/v3/files") && (req.method === "POST" || req.method === "PATCH")) {
      const s = `s${++n}`;
      sessions.set(s, { id: req.method === "PATCH" ? id : undefined, meta: body.length ? JSON.parse(body.toString()) : {}, got: [] });
      return send(res, 200, undefined, { location: `http://${req.headers.host}/session/${s}` });
    }
    if (req.method === "PUT" && url.pathname.startsWith("/session/")) {
      const s = sessions.get(id);
      if (!s) return send(res, 404);
      s.got.push(body);
      const range = String(req.headers["content-range"] ?? "");
      const [, end, total] = /bytes \d+-(\d+)\/(\d+)/.exec(range) ?? [];
      if (end && Number(end) + 1 < Number(total)) return send(res, 308, undefined, { range: `bytes=0-${end}` });
      const data = Buffer.concat(s.got);
      const it = s.id ? items.get(s.id)! : { id: `f${++n}`, name: String(s.meta.name), parents: s.meta.parents ?? [], data };
      it.data = data;
      items.set(it.id, it);
      puts.push(it.name);
      return send(res, 200, { id: it.id });
    }
    if (req.method === "PATCH" && url.pathname.startsWith("/drive/v3/files/")) {
      const it = items.get(id);
      if (!it) return send(res, 404);
      const add = url.searchParams.get("addParents");
      const remove = url.searchParams.get("removeParents");
      if (add || remove) it.parents = [...it.parents.filter((p) => p !== remove), ...(add ? [add] : [])];
      return send(res, 200, { id });
    }
    send(res, 404);
  }
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // path of an item, by walking parents up to the backup folder
  const pathOf = (it: Item): string => {
    const p = items.get(it.parents[0] ?? "");
    return p && p.name !== "OUC Study backup" ? `${pathOf(p)}/${it.name}` : it.name;
  };
  const files = () => Object.fromEntries([...items.values()].filter((i) => !i.mimeType).map((i) => [pathOf(i), i.data.toString()]));
  return { base, items, files, puts, close: () => { server.closeAllConnections(); server.close(); } };
}
