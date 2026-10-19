/** File paths in Markdown (AI replies, prep packs, notes) → links to the app's pages and the files. */

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
const TOP = /^(notes|courses|assignments|text|plans|research|updates|_meta|visuals)\//;
/**
 * Where a path an agent wrote or named opens in the app: a note page, an assignment page, or the file
 * itself (in a new tab). Takes repo-relative or absolute paths, and paths inside the semester folder
 * when `sem` is given ("notes/COS514/x.md"). Null when the app can't open it.
 */
export function fileLink(path: string, sem?: string): { to: string; internal: boolean } | null {
  let p = path.trim().replace(/^\.\//, "").replace(/[),.;:]+$/, "");
  const at = p.indexOf("semesters/");
  if (at > 0 && p[at - 1] === "/") p = p.slice(at);   // an absolute path inside the study folder
  else if (sem && TOP.test(p)) p = `semesters/${sem}/${p}`;
  const m = p.match(/^semesters\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, s, rest] = m;
  const plan = rest.match(/^plans\/(\d{4}-W\d{1,2})\.md$/);
  if (plan) return { to: `/${encodeURIComponent(s)}/plan/${plan[1]}`, internal: true };
  const note = rest.match(/^notes\/([^/]+)\/([^/]+)\.md$/);
  if (note) return { to: `/${encodeURIComponent(s)}/notes/${encodeURIComponent(note[1])}/${encodeURIComponent(note[2])}`, internal: true };
  // an assignment's folder, its working notes or its prep pack open the assignment page; its files open as files
  const asg = rest.match(/^assignments\/([^/]+)\/([^/]+)(?:\/(README\.md|PREP\.md)?)?$/);
  if (asg) return { to: `/${encodeURIComponent(s)}/assignments/${encodeURIComponent(asg[1])}/${encodeURIComponent(asg[2])}`, internal: true };
  if (!/\.\w{1,6}$/.test(rest)) return null;   // a folder
  const href = `/files/${s}/${enc(rest)}`;
  return slidesPage(href) ? { to: slidesPage(href)!, internal: true } : { to: href, internal: false };
}

/** PowerPoint files open in the app's slide viewer: /files/<sem>/<path>.pptx → /<sem>/slides/<path>. Null for other files. */
export function slidesPage(href?: string): string | null {
  const m = href?.match(/^\/files\/([^/]+)\/(.+\.(?:pptx|ppsx|ppt|pps|odp))$/i);
  if (!m) return null;
  try { return `/${m[1]}/slides/${encodeURIComponent(decodeURIComponent(m[2]))}`; } catch { return null; }
}

/** What a link to a path shows: the file (or folder) name; a note's slug, an assignment's folder, "Week 42 plan". */
export function linkLabel(path: string, l = fileLink(path)): string {
  const parts = path.trim().replace(/[),.;:]+$/, "").replace(/\/+$/, "").split("/");
  const name = parts.pop() || path;
  if (!l?.internal) return name;
  if (/^(README|PREP)\.md$/.test(name)) return parts.pop() ?? name;
  const wk = name.match(/^\d{4}-W(\d{1,2})\.md$/);
  return wk ? `Week ${Number(wk[1])} plan` : name.replace(/\.md$/, "");
}

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
/** Turns `paths` in a reply's HTML (and links to paths) into links to the app's pages and files. */
export function linkPaths(html: string, sem?: string): string {
  return html
    .replace(/<a href="([^"]+)"/g, (all, href) => {
      const l = /^[a-z]+:/i.test(href) || href.startsWith("/files/") ? null : fileLink(decodeURIComponent(unescape(href)), sem);
      return l ? `<a href="${attr(l.to)}"${l.internal ? " data-internal" : ' target="_blank" rel="noreferrer"'}` : all;
    })
    .replace(/(<a [^>]*>[\s\S]*?<\/a>)|<code>([^<]+)<\/code>/g, (all, link, code) => {
      if (link) return all;   // already a link
      const path = unescape(code);
      const l = fileLink(path, sem);
      // the link shows just the file (or folder) name; the full path is in the tooltip
      const name = linkLabel(path, l);
      return l ? `<a href="${attr(l.to)}"${l.internal ? " data-internal" : ' target="_blank" rel="noreferrer"'} title="${attr(path)}"><code>${attr(name).replace(/</g, "&lt;")}</code></a>` : all;
    });
}
