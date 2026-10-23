import { useEffect, useState } from "react";
import type { SemesterData } from "@ouc/content/types";
import { getChat, usePrepStatus, workLabel, type Chat } from "../lib/ai";
import { Markdown } from "../components/Assistant";
import { cx } from "../components/ui";
import { quizJobLabel, quizPhase } from "../components/MakeQuiz";
import { useQuizJobs } from "../lib/quiz";
import { useCheckJobs, useMakeJobs } from "../lib/homework";

/** Everything the AI is doing in the background (missing notes, prep packs, quizzes), live. Opened in its own window from the work bar. */
export function AiWorkPage({ data }: { data: SemesterData }) {
  const st = usePrepStatus();
  const quizzes = useQuizJobs(data.id, undefined, true);
  const homework = [...useMakeJobs(data.id, undefined, true), ...useCheckJobs(data.id, undefined, true)].sort((x, y) => x.started.localeCompare(y.started));
  const [shown, setShown] = useState<string | null>(null); // a finished job opened for reading
  if (!st) return <p className="text-muted">Checking what the AI is doing…</p>;
  if (!st.enabled) return <p className="text-muted">Background AI work only runs in the app on your computer (ouc open), with an AI set up (ouc ai setup).</p>;
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold">AI background work</h1>
        <p className="mt-1 text-muted">
          {st.busy ? `Making notes and prep packs: ${st.done} of ${st.total} done${st.queue.length ? `, ${st.queue.length} waiting` : ""}.`
            : st.total ? `Finished: ${st.done} of ${st.total} done.` : quizzes.some((j) => j.running || j.queued) ? "Making quizzes." : "Nothing running. Sync now starts it when notes or prep packs are missing."}
        </p>
        {st.total > 0 && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="AI progress">
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
          </div>
        )}
        {st.error && <p className="mt-3 rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">{st.error}</p>}
      </div>

      {quizzes.length > 0 && (
        <section aria-label="Quizzes">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Quizzes from Make a quiz</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {[...quizzes].reverse().map((j) => {
              const title = `Quiz · ${quizJobLabel(data, j.course, j.week)}`;
              return (
                <li key={j.id}>
                  {j.running && j.chatId ? <Job chatId={j.chatId} title={`${title}: ${quizPhase(j)}`} live sem={data.id} /> : (
                    <>
                      <button type="button" disabled={!j.chatId} onClick={() => setShown(shown === j.chatId ? null : j.chatId ?? null)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                        <span className={j.queued ? "text-muted" : j.ok ? "text-ok" : "text-bad"}>{j.queued ? "○" : j.ok ? "✓" : "✗"}</span>
                        <span className="flex-1 truncate">{title}{j.queued ? " (waiting its turn)" : !j.ok && j.error ? `: ${j.error}` : ""}</span>
                        {j.chatId && <span className="text-xs text-muted">{shown === j.chatId ? "Hide" : "Show"}</span>}
                      </button>
                      {j.chatId && shown === j.chatId && <Job chatId={j.chatId} title={title} sem={data.id} className="mt-1" />}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {homework.length > 0 && (
        <section aria-label="Homework">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Homework</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {[...homework].reverse().map((j) => {
              const a = data.assignments.find((x) => x.id === j.assignment);
              const title = `${j.kind === "check" ? "Check" : "Interactive"} · ${a ? `${a.code} ${a.title}` : j.assignment}`;
              return (
                <li key={j.id}>
                  {j.running && j.chatId ? <Job chatId={j.chatId} title={`${title}: ${j.kind === "check" ? "checking your answers" : "making the tasks"}`} live sem={data.id} /> : (
                    <>
                      <button type="button" disabled={!j.chatId} onClick={() => setShown(shown === j.chatId ? null : j.chatId ?? null)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                        <span className={j.ok ? "text-ok" : "text-bad"}>{j.ok ? "✓" : "✗"}</span>
                        <span className="flex-1 truncate">{title}{!j.ok && j.error ? `: ${j.error}` : ""}</span>
                        {j.chatId && <span className="text-xs text-muted">{shown === j.chatId ? "Hide" : "Show"}</span>}
                      </button>
                      {j.chatId && shown === j.chatId && <Job chatId={j.chatId} title={title} sem={data.id} className="mt-1" />}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {st.running.length > 0 && (
        <section className="grid gap-4 xl:grid-cols-2">
          {st.running.map((r) => <Job key={r.chatId} chatId={r.chatId} title={workLabel(r.id, data)} live sem={data.id} />)}
        </section>
      )}

      {st.queue.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Waiting</h2>
          <ul className="flex flex-wrap gap-1.5 text-sm">
            {st.queue.map((id) => <li key={id} className="rounded-full border border-line bg-surface px-3 py-1">{workLabel(id, data)}</li>)}
          </ul>
        </section>
      )}

      {st.finished.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Done</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {[...st.finished].reverse().map((f) => (
              <li key={f.chatId}>
                <button type="button" onClick={() => setShown(shown === f.chatId ? null : f.chatId)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                  <span className={f.ok ? "text-ok" : "text-bad"}>{f.ok ? "✓" : "✗"}</span>
                  <span className="flex-1 truncate">{workLabel(f.id, data)}</span>
                  <span className="text-xs text-muted">{shown === f.chatId ? "Hide" : "Show"}</span>
                </button>
                {shown === f.chatId && <Job chatId={f.chatId} title={workLabel(f.id, data)} sem={data.id} className="mt-1" />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One job's full log: every step, the progress updates and its answer so far. */
function Job({ chatId, title, live, sem, className }: { chatId: string; title: string; live?: boolean; sem: string; className?: string }) {
  const [chat, setChat] = useState<Chat | null>();
  useEffect(() => {
    let alive = true;
    const load = () => getChat(chatId).then((c) => alive && setChat(c));
    load();
    const t = live ? window.setInterval(load, 2000) : undefined;
    return () => { alive = false; window.clearInterval(t); };
  }, [chatId, live]);
  const msg = chat?.messages.filter((m) => m.role === "assistant").pop();
  const steps = msg?.steps ?? [];
  return (
    <article className={cx("flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface", className)}>
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        {live && <span aria-hidden className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
        <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
        <span className="text-xs text-muted">{steps.length} step{steps.length === 1 ? "" : "s"}{chat?.tool ? ` · ${chat.tool}` : ""}</span>
      </header>
      <div className="flex flex-col-reverse overflow-y-auto px-4 py-3">
        {/* column-reverse keeps the newest output in view while it grows */}
        <div className="flex flex-col gap-3 text-sm">
          {chat === undefined && <p className="text-muted">Loading…</p>}
          {chat === null && <p className="text-muted">Couldn't load this job.</p>}
          {msg && !steps.length && !msg.text && <p className="text-muted">Planning: reading the request and the study files…</p>}
          {steps.length > 0 && (
            <ol className="flex flex-col gap-0.5 border-l border-line pl-3 font-mono text-xs text-muted">
              {steps.map((s, i) => <li key={i} className={cx(live && i === steps.length - 1 && "font-semibold text-ink")}>{s}</li>)}
            </ol>
          )}
          {(msg?.updates ?? []).map((u, i) => <Markdown key={i} text={u} sem={sem} className="border-l-2 border-accent pl-3 text-xs text-muted" />)}
          {msg?.text && <Markdown text={msg.text} sem={sem} />}
          {msg?.error && <p className="rounded-lg bg-bad-bg px-3 py-2 text-xs text-bad">{msg.error}</p>}
        </div>
      </div>
    </article>
  );
}
