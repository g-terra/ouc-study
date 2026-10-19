import { useEffect, useMemo, useState } from "react";
import type { SemesterData } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { courseMap } from "../lib/data";
import { Card, CourseBadge, CourseDot, Empty, FileLink, PageHeader, cx } from "../components/ui";
import { AskAiButton } from "../components/Assistant";
import { NoteBody, useNoteBlocks } from "../notes/NoteRenderer";

export function NotesIndex({ data }: { data: SemesterData }) {
  const base = `/${enc(data.id)}`;
  const [filter, setFilter] = useState<string>("all");
  const C = courseMap(data);
  const list = data.notes.filter((n) => filter === "all" || n.code === filter);
  return (
    <>
      <PageHeader title="Notes" eyebrow={data.label}>Visual notes for every class so far: big ideas, diagrams, formulas and self-check cards.</PageHeader>
      <div className="mb-6 flex flex-wrap gap-2">
        {[["all", "All courses"] as const, ...data.courses.map((c) => [c.code, c.short] as const)].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={cx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", filter === k ? "border-ink bg-ink text-bg" : "border-line bg-surface text-muted")}>
            {k !== "all" && <CourseDot color={C[k].color} />} {label}
          </button>
        ))}
      </div>
      {list.length === 0 && <Empty>No notes yet.</Empty>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((n) => (
          <Link key={n.code + n.slug} to={`${base}/notes/${enc(n.code)}/${enc(n.slug)}`} className="group">
            <Card className="relative h-full overflow-hidden p-5 transition group-hover:-translate-y-0.5 group-hover:border-muted">
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: C[n.code]?.color }} />
              <div className="mb-3 flex items-center justify-between gap-2"><CourseBadge course={C[n.code]} /><span className="text-xs text-muted">{n.week ? `Week ${n.week}` : "Intro"}</span></div>
              <div className="font-serif text-lg font-semibold leading-snug">{n.title}</div>
              {n.summary && <p className="mt-2 line-clamp-3 text-sm text-muted">{n.summary}</p>}
              {n.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{n.tags.slice(0, 4).map((t) => <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{t}</span>)}</div>}
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

export function NotePage({ data, code, slug }: { data: SemesterData; code: string; slug: string }) {
  const base = `/${enc(data.id)}`;
  const C = courseMap(data);
  const course = C[code];
  const list = data.notes.filter((n) => n.code === code);
  const idx = list.findIndex((n) => n.slug === slug);
  const note = list[idx];
  const blocks = useNoteBlocks(note?.body ?? "");
  const toc = useMemo(() => blocks.filter((b) => b.type === "h2") as { text: string; id: string; n: number }[], [blocks]);
  const [active, setActive] = useState<string>();
  useEffect(() => {
    const els = toc.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting)[0]; if (v) setActive(v.target.id); }, { rootMargin: "-80px 0px -70% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [toc]);
  if (!note || !course) return <Empty>Note not found.</Empty>;
  const prev = list[idx - 1], next = list[idx + 1];
  const week = course.weeks.find((w) => w.index === note.weekIndex);

  return (
    <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-1 text-sm">
          <Link to={`${base}/notes`} className="mb-4 block text-muted hover:text-ink">← All notes</Link>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">On this page</div>
          {toc.map((t) => (
            <a key={t.id} href={`#${t.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth" }); }}
              className={cx("flex gap-2 rounded-lg px-2 py-1.5 leading-snug", active === t.id ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>
              <span className="w-4 shrink-0 text-right tabular-nums" style={{ color: course.color }}>{t.n}</span>{t.text}
            </a>
          ))}
        </nav>
      </aside>
      <article className="min-w-0 max-w-3xl">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Link to={`${base}/courses/${enc(code)}`}><CourseBadge course={course} size="md" /></Link>
          {week && <Link to={`${base}/courses/${enc(code)}#w${week.index}`} className="hover:text-ink">{week.name}</Link>}
          {note.source && <FileLink href={note.source.href} className="hover:text-ink">📄 Slides / reading ↗</FileLink>}
          <AskAiButton action="quiz-me" params={{ course: code, week: String(note.weekIndex) }} className="ml-auto">Quiz me on this</AskAiButton>
        </div>
        <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight">{note.title}</h1>
        {note.summary && <p className="mt-4 text-lg leading-8 text-muted">{note.summary}</p>}
        {note.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{note.tags.map((t) => <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">{t}</span>)}</div>}
        <hr className="my-8 border-line" />
        <NoteBody blocks={blocks} color={course.color} />
        <nav className="mt-14 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
          {prev ? <Link to={`${base}/notes/${enc(code)}/${enc(prev.slug)}`} className="rounded-xl border border-line p-4 hover:border-muted"><div className="text-xs text-muted">← Previous</div><div className="font-semibold">{prev.title}</div></Link> : <span />}
          {next && <Link to={`${base}/notes/${enc(code)}/${enc(next.slug)}`} className="rounded-xl border border-line p-4 text-right hover:border-muted"><div className="text-xs text-muted">Next →</div><div className="font-semibold">{next.title}</div></Link>}
        </nav>
      </article>
    </div>
  );
}
