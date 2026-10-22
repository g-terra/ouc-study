import { useState } from "react";
import type { Assignment, SemesterData } from "@ouc/content/types";
import { Link, cameFrom, enc } from "../lib/router";
import { courseMap, stateOf, type State } from "../lib/data";
import { at, fmtFull, relative } from "../lib/dates";
import { Card, CourseBadge, CourseDot, Empty, FileCard, PageHeader, SectionTitle, StatePill, cx } from "../components/ui";
import { AskAiButton, useAssistant } from "../components/Assistant";
import { useAiStatus, usePrepStatus, type PrepStatus } from "../lib/ai";
import { NoteBody, useNoteBlocks } from "../notes/NoteRenderer";
import { mdToHtml } from "../lib/markdown";
import { ReviewSection } from "./Review";
import { HomeworkLink } from "../v2/Homework";

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
                {a.resources && <span>· 📚 {a.resources.links.length} study links</span>}
                {a.prep && <span>· 🧭 prep pack</span>}
              </span>
            </span>
            <StatePill state={stateOf(a, now)} grade={a.grade} />
          </Link>
        ))}
      </div>
    </>
  );
}

/** Opened from that course's page (a week's list): the way back is the course, not the assignments list. */
export const fromCourse = (code: string) => new RegExp(`/courses/${enc(code)}(#|$)`).test(cameFrom() ?? "");

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
      {fromCourse(a.code) && course
        ? <Link to={`${base}/courses/${enc(a.code)}${week ? `#w${week.index}` : ""}`} className="text-sm text-muted hover:text-ink">← {course.short}{week ? `, ${week.index === 0 ? "General" : week.label}` : ""}</Link>
        : <Link to={`${base}/assignments`} className="text-sm text-muted hover:text-ink">← All assignments</Link>}
      <PageHeader title={a.title} eyebrow={<><CourseBadge course={course} size="md" /><StatePill state={st} grade={a.grade} /></>}>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {a.due && <span>Due <b className="text-ink">{fmtFull(at(a.due))}</b> ({relative(at(a.due))})</span>}
          {a.opened && <span>Opened {at(a.opened).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
          {week && <Link to={`${base}/courses/${enc(a.code)}#w${week.index}`} className="underline decoration-line underline-offset-2 hover:text-ink">{week.name}</Link>}
          {a.eclassUrl && <a href={a.eclassUrl} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">eClass ↗</a>}
        </div>
        <AskAiButton action="assignment-helper" params={{ assignment: a.id }} className="mt-4">Help me with this</AskAiButton>
      </PageHeader>

      {(a.grade || a.feedback) && (
        <section aria-label="Grade and feedback" data-testid="assignment-grade" className="mb-8 flex flex-wrap gap-x-6 gap-y-3 rounded-2xl border border-ok/40 bg-surface p-5">
          {a.grade && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Grade</div>
              <div className="font-serif text-3xl font-semibold text-ok">{a.grade}</div>
            </div>
          )}
          <div className="min-w-[14rem] flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Tutor feedback</div>
            <div className="mt-1 whitespace-pre-line leading-6">{a.feedback || <span className="text-muted">No written feedback{a.eclassUrl ? " here. It may be in a file on eClass" : ""}.</span>}</div>
          </div>
        </section>
      )}

      {/* no question text (it's in the brief, or on eClass): no section */}
      {a.question && <><SectionTitle>Question</SectionTitle><Card className="p-5"><div className="md whitespace-pre-line">{a.question}</div></Card></>}

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

      {a.homework && a.homework.tasks.length > 0 && (
        <>
          <SectionTitle>Answer it in the app</SectionTitle>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <span className="text-sm text-muted">The brief as {a.homework.tasks.length} tasks you can answer here, one by one.</span>
            <HomeworkLink sem={data.id} a={a} tasks={a.homework.tasks} />
          </Card>
        </>
      )}

      <PrepSection a={a} color={course?.color ?? "#555"} />
      <ReviewSection sem={data.id} a={a} color={course?.color ?? "#555"} />

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

/** Why an assignment has no prep pack yet, in the student's terms. */
function prepWhy(a: Assignment, status: PrepStatus | null) {
  const n = status?.queue.indexOf(a.id) ?? -1;
  if (n >= 0) return `Queued: your AI is working through the missing notes and prep packs${n ? ` (${n} more before this one)` : ""}.`;
  if (a.submitted) return "Submitted, so it isn't prepared on its own. You can still ask for one.";
  if (!status?.enabled) return "No prep pack yet. Ask your AI for hints and extra material for this assignment.";
  if (status.error) return `Automatic prep stopped after an error (${status.error}). Press Sync now on the Updates page to try again, or prepare it now.`;
  return "Not prepared yet. Your AI prepares assignments on its own, and Sync now fills in any that are missing. Or prepare it now.";
}

const PREP_ASK = [
  { mode: "review", label: "Review & improve" },
  { mode: "more", label: "Add more" },
  { mode: "redo", label: "Start over" },
] as const;

/** The AI's prep pack (PREP.md): hints and extra material, with buttons to have another AI improve it. */
function PrepSection({ a, color }: { a: Assignment; color: string }) {
  const ai = useAiStatus();
  const status = usePrepStatus();
  const { start, load, setOpen } = useAssistant();
  const blocks = useNoteBlocks(a.prep?.body ?? "");
  const agents = ai.tools.filter((t) => t.id !== "local" && t.state === "connected");
  // by default ask a different AI than the one that last wrote it
  const author = agents.find((t) => a.prep?.by?.startsWith(t.label));
  const [pick, setPick] = useState<string>();
  const tool = pick ?? (agents.find((t) => t !== author) ?? agents[0])?.id;
  if (ai.state === "unavailable" && !a.prep) return null; // a static build without an app server
  const run = status?.running.find((x) => x.id === a.id);
  const running = !!run;
  const ask = (mode: string) => start("assignment-prep", { course: a.code, assignment: a.id, mode }, tool);
  const picker = agents.length > 1 && (
    <select aria-label="Which AI" value={tool} onChange={(e) => setPick(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
      {agents.map((t) => <option key={t.id} value={t.id}>{t.label}{t === author ? " (wrote it)" : ""}</option>)}
    </select>
  );

  return (
    <>
      <SectionTitle right={a.prep?.by && <span className="text-xs text-muted">By {a.prep.by}{a.prep.updated && ` · ${new Date(a.prep.updated).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}</span>}>Prep pack</SectionTitle>
      {running && (
        <Card className="mb-3 flex items-center gap-3 p-4 text-sm">
          <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span className="flex-1">{a.prep ? "Updating" : "Preparing"} hints and extra material for this assignment…</span>
          {run && <button type="button" className="underline" onClick={() => { setOpen(true); load(run.chatId); }}>Watch</button>}
        </Card>
      )}
      {a.prep ? (
        <Card className="p-5">
          <NoteBody blocks={blocks} color={color} />
          {a.prep.log.length > 0 && (
            <details className="mt-6 text-xs text-muted">
              <summary className="cursor-pointer select-none">History ({a.prep.log.length})</summary>
              <ul className="mt-1 flex flex-col gap-0.5 border-l border-line pl-3">{a.prep.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </details>
          )}
        </Card>
      ) : !running && (
        <Empty>
          {prepWhy(a, status)}
        </Empty>
      )}
      {agents.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {a.prep ? (
            <>
              <span className="text-muted">Ask</span>{picker}<span className="text-muted">to</span>
              {PREP_ASK.map((x) => (
                <button key={x.mode} type="button" disabled={running} onClick={() => ask(x.mode)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 font-medium hover:border-muted disabled:opacity-40">{x.label}</button>
              ))}
            </>
          ) : !running && (
            <>
              <button type="button" onClick={() => ask("new")} className="rounded-full bg-ink px-3 py-1.5 font-semibold text-bg">✨ Prepare now</button>
              {picker && <><span className="text-muted">with</span>{picker}</>}
            </>
          )}
        </div>
      )}
      {a.prep && <p className="mt-2 text-xs text-muted">Hints and pointers only. Write your answers in your own words.</p>}
    </>
  );
}
