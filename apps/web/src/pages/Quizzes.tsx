import { useEffect, useMemo, useRef, useState } from "react";
import type { Course, Quiz, QuizQuestion, SemesterData } from "@ouc/content/types";
import { isCorrect, pointsFor, seededRandom, shuffledOptions, type QuizAnswer } from "@ouc/content/quiz";
import { Link, enc, useRouter } from "../lib/router";
import { courseMap } from "../lib/data";
import { pct, removeQuiz, resetProgress, saveAttempt, useAttempts } from "../lib/quiz";
import { Card, CourseBadge, CourseDot, Empty, PageHeader, ProgressRing, SectionTitle, cx } from "../components/ui";
import { AskAiButton } from "../components/Assistant";
import { MakeQuizButton, QuizJobs } from "../components/MakeQuiz";

/** Reset a quiz's progress, or remove it, each after a confirmation. Resolves true when something changed. */
export async function confirmReset(sem: string, q?: Pick<Quiz, "id" | "title">): Promise<boolean> {
  if (!window.confirm(q ? `Start “${q.title}” over? Its scores and best score are cleared.` : "Start every quiz over? All scores, points and the streak are cleared.")) return false;
  try { await resetProgress(sem, q?.id); return true; } catch (e) { window.alert((e as Error).message); return false; }
}
export async function confirmRemove(sem: string, q: Pick<Quiz, "id" | "title">): Promise<boolean> {
  if (!window.confirm(`Remove the quiz “${q.title}”? The quiz and its scores are deleted.`)) return false;
  try { await removeQuiz(sem, q.id); return true; } catch (e) { window.alert((e as Error).message); return false; }
}
const smallBtn = "rounded-full px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink";

export const quizHref = (sem: string, q: Pick<Quiz, "code" | "name">) => `/${enc(sem)}/quizzes/${enc(q.code)}/${enc(q.name)}`;
/** "Whole course" or the week's label. */
export const quizScopeLabel = (q: Quiz, course?: Course) =>
  q.scope === "course" ? "Whole course" : course?.weeks.find((w) => w.index === q.section)?.label ?? `Section ${q.section}`;

function Stat({ icon, value, label, hint }: { icon: string; value: string | number; label: string; hint?: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span aria-hidden className="text-3xl">{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold tabular-nums leading-tight">{value}</span>
        <span className="block text-xs text-muted">{label}{hint && <> · {hint}</>}</span>
      </span>
    </Card>
  );
}

/** Points, streak, mastered quizzes and attempts. */
export function QuizStatsRow({ data }: { data: SemesterData }) {
  const { stats } = useAttempts(data.id);
  const quizzes = data.quizzes ?? [];
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat icon="🏆" value={stats.points} label="points" />
      <Stat icon="🔥" value={`${stats.streak} day${stats.streak === 1 ? "" : "s"}`} label="streak"
        hint={stats.streak && !stats.playedToday ? "play one today to keep it" : !stats.streak ? "finish a quiz to start one" : undefined} />
      <Stat icon="⭐" value={`${quizzes.filter((q) => stats.best[q.id]?.pct === 1).length}/${quizzes.length}`} label="quizzes mastered (100%)" />
      <Stat icon="🎯" value={stats.attempts} label={stats.attempts === 1 ? "quiz finished" : "quizzes finished"} />
    </div>
  );
}

export function QuizzesPage({ data }: { data: SemesterData }) {
  const [filter, setFilter] = useState("all");
  const C = courseMap(data);
  const { stats, state } = useAttempts(data.id);
  const quizzes = data.quizzes ?? [];
  const courses = data.courses.filter((c) => filter === "all" || c.code === filter);
  return (
    <>
      <PageHeader title="Quizzes" eyebrow={data.label}>
        Questions the AI made from your course material, for one lecture or the whole course. Your scores stay on this computer.
      </PageHeader>
      <QuizStatsRow data={data} />
      {state === "unavailable" && <p className="mb-6 text-sm text-warn">Scores are saved only when the app runs on your computer (ouc open).</p>}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <MakeQuizButton data={data} course={filter === "all" ? undefined : filter}>Make a quiz</MakeQuizButton>
        {stats.attempts > 0 && <button type="button" className={smallBtn} onClick={() => confirmReset(data.id)}>↺ Reset all progress</button>}
      </div>
      <QuizJobs data={data} />
      <div className="mb-6 flex flex-wrap gap-2">
        {[["all", "All courses"] as const, ...data.courses.map((c) => [c.code, c.short] as const)].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={cx("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", filter === k ? "border-ink bg-ink text-bg" : "border-line bg-surface text-muted")}>
            {k !== "all" && <CourseDot color={C[k].color} />} {label}
          </button>
        ))}
      </div>
      {courses.map((c) => {
        const list = quizzes.filter((q) => q.code === c.code)
          .sort((a, b) => (a.scope === b.scope ? (a.section ?? 0) - (b.section ?? 0) || a.name.localeCompare(b.name) : a.scope === "course" ? -1 : 1));
        return (
          <section key={c.code}>
            <SectionTitle right={<MakeQuizButton data={data} course={c.code}>Make a quiz</MakeQuizButton>}>
              <span className="flex items-center gap-2"><CourseDot color={c.color} />{c.short}</span>
            </SectionTitle>
            {list.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((q) => {
                  const b = stats.best[q.id];
                  return (
                    <Card key={q.id} className="relative flex h-full flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-muted">
                      <div className="absolute inset-x-0 top-0 h-1" style={{ background: c.color }} />
                      <Link to={quizHref(data.id, q)} className="flex flex-1 items-center gap-4 p-5 pb-2">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 text-xs text-muted">{quizScopeLabel(q, c)} · {q.questions.length} questions</div>
                          <div className="font-serif text-lg font-semibold leading-snug">{q.title}</div>
                          <div className="mt-2 text-xs text-muted">
                            {b ? <>Best {b.score}/{b.total} · {b.attempts} {b.attempts === 1 ? "try" : "tries"}{b.pct === 1 && <span className="ml-1.5 rounded-full bg-ok-bg px-2 py-0.5 font-semibold text-ok">⭐ Mastered</span>}</> : "Not played yet"}
                          </div>
                        </div>
                        <ProgressRing value={b?.pct ?? 0} color={c.color} label={b ? pct(b.pct) : "–"} />
                      </Link>
                      <div className="flex justify-end gap-1 px-3 pb-2">
                        {b && <button type="button" className={smallBtn} onClick={() => confirmReset(data.id, q)}>↺ Reset progress</button>}
                        <button type="button" className={smallBtn} onClick={() => confirmRemove(data.id, q)}>🗑 Remove</button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : <Empty>No quizzes for {c.short} yet. Press “Make a quiz” to make one for one class or the whole course.</Empty>}
          </section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Playing a quiz

const TF: [boolean, string][] = [[true, "True"], [false, "False"]];

function Question({ q, order, answer, setAnswer, checked }: {
  q: QuizQuestion; order: number[]; answer: QuizAnswer | undefined; setAnswer: (a: QuizAnswer) => void; checked: boolean;
}) {
  const tone = (picked: boolean, right: boolean) => !checked
    ? picked ? "border-ink bg-surface-2 font-semibold" : "border-line bg-surface hover:border-muted"
    : right ? "border-ok bg-ok-bg text-ok font-semibold" : picked ? "border-bad bg-bad-bg text-bad" : "border-line bg-surface opacity-70";
  if (q.type === "true-false") {
    return (
      <div role="radiogroup" aria-label="Your answer" className="grid grid-cols-2 gap-3">
        {TF.map(([v, label]) => (
          <button key={label} type="button" role="radio" aria-checked={answer === v} disabled={checked} onClick={() => setAnswer(v)}
            className={cx("rounded-xl border-2 px-4 py-4 text-lg transition", tone(answer === v, q.answer === v))}>{label}</button>
        ))}
      </div>
    );
  }
  const multi = q.type === "multiple";
  const picked = Array.isArray(answer) ? answer : [];
  return (
    <div role={multi ? "group" : "radiogroup"} aria-label="Your answer" className="grid gap-2">
      {order.map((i) => {
        const on = picked.includes(i);
        return (
          <button key={i} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on} disabled={checked}
            onClick={() => setAnswer(multi ? (on ? picked.filter((x) => x !== i) : [...picked, i]) : [i])}
            className={cx("flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition", tone(on, q.options[i].correct))}>
            <span aria-hidden className={cx("mt-0.5 grid size-5 shrink-0 place-items-center border-2 text-xs", multi ? "rounded-md" : "rounded-full", on ? "border-current" : "border-line")}>
              {on ? (multi ? "✓" : "●") : ""}
            </span>
            <span>{q.options[i].text}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The right answer in words (for the review at the end). */
const rightAnswer = (q: QuizQuestion) => q.type === "true-false" ? (q.answer ? "True" : "False") : q.options.filter((o) => o.correct).map((o) => o.text).join(" · ");

export function QuizPage({ data, code, name }: { data: SemesterData; code: string; name: string }) {
  const quiz = (data.quizzes ?? []).find((q) => q.code === code && q.name === name);
  const course = courseMap(data)[code];
  const { stats } = useAttempts(data.id);
  const { navigate } = useRouter();
  const [round, setRound] = useState(0);
  // shuffled once per visit and round: the app's data refreshes (sync, AI work) hand over a new quiz object, and the options must not move
  const [salt] = useState(() => Math.random().toString(36).slice(2));
  const orders = useMemo(() => quiz?.questions.map((q, j) => (q.type === "true-false" ? []
    : shuffledOptions(q.options.length, q.options.map((o) => o.text), seededRandom(`${salt}:${round}:${j}:${q.question}`)))) ?? [], [quiz, round, salt]);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(QuizAnswer | undefined)[]>([]);
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  const [save, setSave] = useState<{ state: "saving" | "saved" | "failed"; error?: string; prevBest?: number }>();
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ block: "nearest" }); }, [i, done]);
  if (!quiz || !course) return <Empty>Quiz not found. <Link to={`/${enc(data.id)}/quizzes`} className="underline">All quizzes</Link></Empty>;

  const q = quiz.questions[i];
  const answer = answers[i];
  const results = quiz.questions.map((x, j) => isCorrect(x, answers[j]));
  const chosen = answer !== undefined && (!Array.isArray(answer) || answer.length > 0);
  const restart = () => { setRound((r) => r + 1); setI(0); setAnswers([]); setChecked(false); setDone(false); setSave(undefined); };
  const finish = async () => {
    setDone(true);
    const prevBest = stats.best[quiz.id]?.pct;
    setSave({ state: "saving", prevBest });
    try { await saveAttempt(data.id, { quiz: quiz.id, title: quiz.title, results }); setSave({ state: "saved", prevBest }); }
    catch (e) { setSave({ state: "failed", error: (e as Error).message, prevBest }); }
  };
  const back = `/${enc(data.id)}/quizzes`;
  const header = (
    <div ref={top} className="mb-6 scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link to={back} className="hover:text-ink">← All quizzes</Link>
        <Link to={`/${enc(data.id)}/courses/${enc(code)}${quiz.section !== undefined ? `#w${quiz.section}` : ""}`}><CourseBadge course={course} size="md" /></Link>
        <span>{quizScopeLabel(quiz, course)}</span>
        <span className="ml-auto flex gap-1">
          {stats.best[quiz.id] && <button type="button" className={smallBtn} onClick={async () => { if (await confirmReset(data.id, quiz)) restart(); }}>↺ Reset progress</button>}
          <button type="button" className={smallBtn} onClick={async () => { if (await confirmRemove(data.id, quiz)) navigate(back); }}>🗑 Remove quiz</button>
        </span>
      </div>
      <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{quiz.title}</h1>
      {quiz.description && <p className="mt-2 text-muted">{quiz.description}</p>}
    </div>
  );

  if (done) {
    const score = results.filter(Boolean).length, total = results.length, p = total ? score / total : 0;
    const newBest = save?.state === "saved" && (save.prevBest === undefined || p > save.prevBest);
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <Card className="mb-8 flex flex-wrap items-center gap-6 p-6">
          <ProgressRing value={p} color={course.color} size={96} label={pct(p)} />
          <div className="min-w-0 flex-1">
            <div className="font-serif text-2xl font-semibold" role="status">You scored {score} out of {total}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-surface-2 px-3 py-1 font-semibold">🏆 +{pointsFor(results)} points</span>
              {p === 1 && <span className="rounded-full bg-ok-bg px-3 py-1 font-semibold text-ok">⭐ Perfect score</span>}
              {newBest && save?.prevBest !== undefined && <span className="rounded-full bg-warn-bg px-3 py-1 font-semibold text-warn">New best!</span>}
              {save?.state === "saved" && stats.streak > 0 && <span className="rounded-full bg-surface-2 px-3 py-1">🔥 {stats.streak}-day streak</span>}
            </div>
            <div className="mt-2 text-xs text-muted">
              {save?.state === "saving" ? "Saving your score…" : save?.state === "saved" ? "Score saved on this computer." : save?.error}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={restart} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg">Try again</button>
            <Link to={back} className="rounded-full border border-line px-4 py-2 text-sm font-semibold">All quizzes</Link>
          </div>
        </Card>
        <SectionTitle right={score < total && <AskAiButton action="quiz-me" params={{ course: code, ...(quiz.section !== undefined ? { week: String(quiz.section) } : {}) }}>Go over it with the AI</AskAiButton>}>
          Your answers
        </SectionTitle>
        <ol className="grid gap-2">
          {quiz.questions.map((x, j) => (
            <li key={j} className={cx("rounded-xl border px-4 py-3 text-sm", results[j] ? "border-line bg-surface" : "border-bad/40 bg-bad-bg/40")}>
              <div className="flex gap-2"><span aria-hidden>{results[j] ? "✅" : "❌"}</span><span className="font-semibold">{x.question}</span></div>
              {!results[j] && <div className="mt-1 pl-7">Answer: <b>{rightAnswer(x)}</b></div>}
              {x.explanation && <div className="mt-1 pl-7 text-muted">{x.explanation}</div>}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const last = i === quiz.questions.length - 1;
  const right = checked && results[i];
  return (
    <div className="mx-auto max-w-3xl">
      {header}
      <div className="mb-2 flex items-center justify-between text-sm text-muted">
        <span>Question {i + 1} of {quiz.questions.length}</span>
        <span>{results.slice(0, checked ? i + 1 : i).filter(Boolean).length} right so far</span>
      </div>
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Quiz progress" aria-valuenow={i + (checked ? 1 : 0)} aria-valuemin={0} aria-valuemax={quiz.questions.length}>
        <div className="h-full transition-[width] duration-300" style={{ width: `${((i + (checked ? 1 : 0)) / quiz.questions.length) * 100}%`, background: course.color }} />
      </div>
      <Card className="p-6">
        <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          {q.type === "true-false" ? "True or false" : q.type === "multiple" ? "Select all that apply" : "Choose one"}
        </div>
        <h2 className="mb-5 text-xl font-semibold leading-snug">{q.question}</h2>
        <Question q={q} order={orders[i] ?? []} answer={answer} checked={checked}
          setAnswer={(a) => setAnswers((all) => { const n = [...all]; n[i] = a; return n; })} />
        {checked && (
          <div className={cx("mt-5 rounded-xl px-4 py-3 text-sm", right ? "bg-ok-bg" : "bg-bad-bg")} role="status">
            <div className={cx("font-semibold", right ? "text-ok" : "text-bad")}>{right ? "Right!" : `Not quite. The answer: ${rightAnswer(q)}`}</div>
            {q.explanation && <p className="mt-1">{q.explanation}</p>}
          </div>
        )}
        <div className="mt-6 flex justify-end">
          {!checked
            ? <button type="button" disabled={!chosen} onClick={() => setChecked(true)} className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg disabled:opacity-40">Check answer</button>
            : last
              ? <button type="button" onClick={finish} className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg">See my score</button>
              : <button type="button" onClick={() => { setI(i + 1); setChecked(false); }} className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-bg">Next question →</button>}
        </div>
      </Card>
    </div>
  );
}
