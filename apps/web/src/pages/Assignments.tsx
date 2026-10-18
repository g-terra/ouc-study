import { useState } from "react";
import type { SemesterData } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { courseMap, stateOf, type State } from "../lib/data";
import { at, fmtFull, relative } from "../lib/dates";
import { Card, CourseBadge, CourseDot, Empty, FileCard, PageHeader, SectionTitle, StatePill, cx } from "../components/ui";
import { AskAiButton } from "../components/Assistant";
import { mdToHtml } from "../lib/markdown";

export function AssignmentsPage({ data }: { data: SemesterData }) {
  const base = `/${enc(data.id)}`;
  const C = courseMap(data);
  const [status, setStatus] = useState<"open" | "done" | "all">("open");
  const [course, setCourse] = useState("all");
  const now = new Date();
  const list = data.assignments.filter((a) => (status === "all" || (status === "done") === a.submitted) && (course === "all" || a.code === course));
  const counts = { open: data.assignments.filter((a) => !a.submitted).length, done: data.assignments.filter((a) => a.submitted).length, all: data.assignments.length };
  return (
    <>
      <PageHeader title="Assignments" eyebrow={data.label}>{counts.done} of {counts.all} submitted. Each assignment page has its question, files and study links.</PageHeader>
      <div className="mb-5 flex flex-wrap gap-2">
        {(["open", "done", "all"] as const).map((k) => (
          <button key={k} onClick={() => setStatus(k)} className={cx("rounded-full border px-3 py-1.5 text-sm", status === k ? "border-ink bg-ink text-bg" : "border-line bg-surface text-muted")}>
            {{ open: "To do", done: "Submitted", all: "All" }[k]} <span className="opacity-60">{counts[k]}</span>
          </button>
        ))}
        <span className="mx-1 h-5 w-px self-center bg-line" />
        {[["all", "All courses"] as const, ...data.courses.map((c) => [c.code, c.short] as const)].map(([k, label]) => (
          <button key={k} onClick={() => setCourse(k)} className={cx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", course === k ? "border-ink bg-ink text-bg" : "border-line bg-surface text-muted")}>
            {k !== "all" && <CourseDot color={C[k].color} />}{label}
          </button>
        ))}
      </div>
      <div className="grid gap-2">
        {list.length === 0 && <Empty>Nothing here.</Empty>}
        {list.map((a) => (
          <Link key={a.id} to={`${base}/assignments/${a.id.split("/").map(enc).join("/")}`}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-muted">
            <span className="h-10 w-1.5 rounded-full" style={{ background: C[a.code]?.color }} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{a.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span>{C[a.code]?.short}</span>
                {a.due && <span>· {fmtFull(at(a.due))}{!a.submitted && ` (${relative(at(a.due), now)})`}</span>}
                {a.grade && <span>· Grade: <b className="text-ink">{a.grade}</b></span>}
                {a.resources && <span>· 📚 {a.resources.links.length} study links</span>}
              </span>
            </span>
            <StatePill state={stateOf(a, now)} />
          </Link>
        ))}
      </div>
    </>
  );
}

export function AssignmentPage({ data, id }: { data: SemesterData; id: string }) {
  const base = `/${enc(data.id)}`;
  const a = data.assignments.find((x) => x.id === id);
  const C = courseMap(data);
  const pdfs = a ? [...a.briefs.map((f) => ({ f, l: "Brief" })), ...a.submissions.map((f) => ({ f, l: "My submission" }))].filter((x) => x.f.ext === "pdf") : [];
  const [preview, setPreview] = useState(0);
  if (!a) return <Empty>Assignment not found.</Empty>;
  const course = C[a.code];
  const st: State = stateOf(a);
  const week = course?.weeks.find((w) => w.index === a.weekIndex);
  const notes = data.notes.filter((n) => n.code === a.code && n.weekIndex === a.weekIndex);

  return (
    <div className="max-w-4xl">
      <Link to={`${base}/assignments`} className="text-sm text-muted hover:text-ink">← All assignments</Link>
      <PageHeader title={a.title} eyebrow={<><CourseBadge course={course} size="md" /><StatePill state={st} /></>}>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {a.due && <span>Due <b className="text-ink">{fmtFull(at(a.due))}</b> ({relative(at(a.due))})</span>}
          {a.opened && <span>Opened {at(a.opened).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
          {a.grade && <span>Grade <b className="text-ink">{a.grade}</b></span>}
          {week && <Link to={`${base}/courses/${enc(a.code)}#w${week.index}`} className="underline decoration-line underline-offset-2 hover:text-ink">{week.name}</Link>}
          {a.eclassUrl && <a href={a.eclassUrl} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">eClass ↗</a>}
        </div>
        <AskAiButton action="assignment-helper" params={{ assignment: a.id }} className="mt-4">Help me with this</AskAiButton>
      </PageHeader>

      <SectionTitle>Question</SectionTitle>
      {a.question ? <Card className="p-5"><div className="md whitespace-pre-line">{a.question}</div></Card>
        : <Empty>{a.briefs.length ? "The questions are in the brief below." : "No question text found. Check eClass."}</Empty>}

      <SectionTitle>Files</SectionTitle>
      {a.briefs.length + a.submissions.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {a.briefs.map((f) => <FileCard key={f.href} file={f} label="Brief" />)}
          {a.submissions.map((f) => <FileCard key={f.href} file={f} label="My submission" />)}
        </div>
      ) : <Empty>No attached files. The question above is all there is. Answer it in your own document and upload it on eClass.</Empty>}

      {pdfs.length > 0 && (
        <>
          <SectionTitle right={pdfs.length > 1 && (
            <div className="flex gap-1">{pdfs.map((p, i) => <button key={i} onClick={() => setPreview(i)} className={cx("rounded-full px-2.5 py-1 text-xs", i === preview ? "bg-ink text-bg" : "bg-surface-2 text-muted")}>{p.l}</button>)}</div>
          )}>Preview</SectionTitle>
          <Card className="overflow-hidden"><iframe title="PDF preview" src={pdfs[preview].f.href} className="h-[75vh] w-full" /></Card>
        </>
      )}

      {a.resources && (
        <>
          <SectionTitle>Study resources</SectionTitle>
          <Card className="p-5">
            <p className="mb-4"><b>Concepts to understand:</b> {a.resources.focus}</p>
            {(a.resources.local.length > 0 || notes.length > 0) && <h3 className="mb-2 text-sm font-semibold text-muted">From your course</h3>}
            <div className="mb-4 grid gap-1.5">
              {notes.map((n) => <Link key={n.slug} to={`${base}/notes/${enc(n.code)}/${enc(n.slug)}`} className="flex gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-surface-2">📒 My notes: {n.title}</Link>)}
              {a.resources.local.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="flex gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">📂 {l.title}</a>)}
            </div>
            <h3 className="mb-2 text-sm font-semibold text-muted">Further reading & practice</h3>
            <div className="grid gap-2">
              {a.resources.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="group rounded-xl border border-line px-4 py-3 transition hover:border-muted">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold group-hover:underline">{l.title}</span><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">{l.kind}</span></div>
                  <div className="mt-1 text-sm text-muted">{l.why}</div>
                </a>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted">These links help you understand the concepts. They don't give the answers. Write your answers in your own words.</p>
          </Card>
        </>
      )}

      {a.feedback && (<><SectionTitle>Tutor feedback</SectionTitle><Card className="border-ok/40 bg-ok-bg p-5"><div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(a.feedback) }} /></Card></>)}
      {a.workingNotes && <p className="mt-8 text-sm text-muted">Your working notes live in <a className="underline" href={a.workingNotes} target="_blank" rel="noreferrer">README.md</a> in this assignment's folder.</p>}
    </div>
  );
}
