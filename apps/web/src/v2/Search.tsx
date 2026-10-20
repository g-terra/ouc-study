/**
 * Search, from the header or ⌘K / Ctrl K: notes, slides and PDFs, video and slide transcripts, assignments
 * and eClass posts, on this computer (/api/search, packages/content/src/search.ts). Results are grouped by
 * course and week; a transcript hit opens the video at that moment or the slides at that slide.
 */
import { useEffect, useRef, useState, type KeyboardEvent as KeyEvent } from "react";
import type { SemesterData } from "@ouc/content/types";
import { marks, queryWords, type SearchHit, type SearchKind } from "@ouc/content/search-text";
import { useRouter } from "../lib/router";
import { stamp } from "../lib/transcript";
import { CourseBadge, cx } from "../components/ui";
import { ClipboardList, Clapperboard, FileText, Megaphone, NotebookPen, Presentation, Search, type LucideIcon } from "../components/icons";

const KIND: Record<SearchKind, [string, LucideIcon]> = {
  note: ["Note", NotebookPen], slides: ["Slides", Presentation], file: ["File", FileText], transcript: ["Transcript", Clapperboard],
  assignment: ["Assignment", ClipboardList], post: ["eClass post", Megaphone],
};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** What kind of result it is and where it opens: "Transcript · at 2:30", "Slides · slide 4", "PDF · page 2". */
function where(h: SearchHit): string {
  const kind = h.kind === "file" ? (h.to.match(/\.(\w+)(#|$)/)?.[1]?.toUpperCase() ?? "File") : KIND[h.kind][0];
  const at = h.at !== undefined ? `at ${stamp(h.at)}` : h.slide ? `slide ${h.slide}` : h.page ? `page ${h.page}` : "";
  return [kind, at].filter(Boolean).join(" · ");
}

/** The header's search button; ⌘K / Ctrl K opens it from anywhere. */
export function SearchButton({ data }: { data?: SemesterData | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const keys = isMac() ? "⌘K" : "Ctrl K";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search" title={`Search (${keys})`} aria-haspopup="dialog"
        className="flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-2.5 text-sm text-muted hover:border-muted hover:text-ink">
        <Search aria-hidden className="size-[18px]" />
        <span className="hidden md:inline">Search</span>
        <kbd className="hidden rounded border border-line px-1 font-sans text-[11px] md:inline">{keys}</kbd>
      </button>
      {open && data && <SearchDialog data={data} onClose={() => setOpen(false)} />}
    </>
  );
}

type Result = { q: string; hits: SearchHit[] } | { q: string; error: string };

export function SearchDialog({ data, onClose }: { data: SemesterData; onClose: () => void }) {
  const { navigate } = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Result>();
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (!queryWords(query).length) { setRes(undefined); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?sem=${encodeURIComponent(data.id)}&q=${encodeURIComponent(query)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((b) => { setRes(b.hits ? { q: query, hits: b.hits } : { q: query, error: b.error ?? "Search isn't available." }); setSel(0); })
        .catch((e) => { if (e.name !== "AbortError") setRes({ q: query, error: "Search isn't available: is the app running?" }); });
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, data.id]);

  const hits = res && "hits" in res ? res.hits : [];
  // grouped by course and week, the groups in the order of their best result
  const groups: { key: string; code?: string; label: string; hits: SearchHit[] }[] = [];
  for (const h of hits) {
    const key = `${h.code ?? ""}|${h.kind === "post" ? "post" : h.weekIndex ?? ""}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, code: h.code, label: h.kind === "post" ? "Announcements and forum" : h.weekLabel ?? "", hits: [] }));
    g.hits.push(h);
  }
  const order = groups.flatMap((g) => g.hits);
  const words = queryWords(res?.q ?? "");

  const open = (h: SearchHit) => {
    onClose();
    if (h.external) window.open(h.to, "_blank", "noreferrer");
    else navigate(h.to);
  };
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-hit="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const onKey = (e: KeyEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(order.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && order[sel]) { e.preventDefault(); open(order[sel]!); }
  };

  const course = (code?: string) => data.courses.find((c) => c.code === code);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search aria-hidden className="size-5 shrink-0 text-muted" />
          <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes, slides, transcripts, assignments…"
            aria-label="Search your courses" aria-controls="search-results" aria-activedescendant={order.length ? `search-hit-${sel}` : undefined}
            className="min-w-0 flex-1 bg-transparent py-3.5 text-base outline-none placeholder:text-muted" />
          <button type="button" onClick={onClose} className="rounded border border-line px-1.5 text-xs text-muted hover:text-ink">Esc</button>
        </div>
        <div ref={list} id="search-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
          {!queryWords(q).length ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              Find a word in your notes, slides and PDFs, class transcripts, assignments and eClass posts. Everything stays on this computer.
            </p>
          ) : !res ? (
            <p className="px-3 py-6 text-center text-sm text-muted">Searching…</p>
          ) : "error" in res ? (
            <p className="px-3 py-6 text-center text-sm text-muted">{res.error}</p>
          ) : !hits.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted">Nothing found for “{res.q}”.</p>
          ) : groups.map((g) => (
            <section key={g.key} className="mb-2">
              <h3 className="flex items-center gap-2 px-2 pb-1 pt-2 text-xs font-semibold text-muted">
                {course(g.code) && <CourseBadge course={course(g.code)} />}
                <span className="truncate">{g.label}</span>
              </h3>
              {g.hits.map((h) => {
                const i = order.indexOf(h);
                const Icon = KIND[h.kind][1];
                return (
                  <div key={i} id={`search-hit-${i}`} data-hit={i} role="option" aria-selected={i === sel}
                    onClick={() => open(h)} onMouseMove={() => setSel(i)}
                    className={cx("flex cursor-pointer gap-3 rounded-xl px-3 py-2", i === sel && "bg-surface-2")}>
                    <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold leading-snug">{marks(h.title, words).map((m, j) => m.hit ? <mark key={j} className="rounded bg-accent/20 text-ink">{m.text}</mark> : m.text)}</span>
                        <span className="text-xs text-muted">{where(h)}{h.external ? " ↗" : ""}</span>
                      </div>
                      {h.snippet && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted">
                          {marks(h.snippet, words).map((m, j) => m.hit ? <mark key={j} className="rounded bg-accent/20 text-ink">{m.text}</mark> : m.text)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        {hits.length > 0 && (
          <div className="border-t border-line px-4 py-2 text-xs text-muted">↑ ↓ to move, Enter to open, Esc to close</div>
        )}
      </div>
    </div>
  );
}
