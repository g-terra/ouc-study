/**
 * Quizzes: the file format the AI writes (semesters/<id>/quizzes/<CODE>/<name>.json, see docs/QUIZ_FORMAT.md),
 * checking answers, and the points and streak the app shows. No Node imports: the web app uses it too.
 */
import type { Quiz, QuizAttempt, QuizQuestion } from "./types.ts";

/** The quiz JSON as written, before it is checked. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
export const QUESTION_TYPES = ["true-false", "single", "multiple"] as const;
/** "All of the above", "None of the above", "Both of the above": these stay last when options are shuffled. */
export const PINNED_OPTION = /^(all|none|both|neither) of the (above|options)\b/i;
/** An explanation that sends the student to the material instead of explaining ("see slide 9", "the lecture says"). */
const POINTS_TO_MATERIAL = /\b(see|on|in) (the )?(slide|page|lecture|notes?)\b|\bslides? \d|\bthe (lecture|slides?|notes?|reading) (says|said|contrasts|explains|shows|mentions|states)\b|\.(md|pdf|pptx)\b/i;

/**
 * Checks a quiz file and returns it in the app's shape (`id` and `code` come from where the file is).
 * errors: the quiz can't be played until they're fixed; warnings: it works, but could be better.
 */
export function parseQuiz(src: string | Raw, where: { code: string; name: string }): { quiz?: Quiz; errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  let d: Raw = src;
  if (typeof src === "string") {
    try { d = JSON.parse(src); } catch (e) { return { errors: [`Not valid JSON: ${(e as Error).message}`], warnings }; }
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return { errors: ["The file must be one JSON object: { \"title\", \"course\", \"scope\", \"questions\" }."], warnings };
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const title = str(d.title);
  if (!title) errors.push('Missing "title".');
  if (d.course !== undefined && str(d.course) !== where.code) errors.push(`"course" is "${d.course}" but the file is in the ${where.code} folder.`);
  const scope = d.scope === "course" ? "course" : d.scope === "lecture" ? "lecture" : null;
  if (!scope) errors.push('"scope" must be "course" (the whole course) or "lecture" (one eClass section).');
  const section = d.section === undefined || d.section === null ? undefined : Number(d.section);
  if (scope === "lecture" && (section === undefined || !Number.isInteger(section))) errors.push('A lecture quiz needs "section": the eClass section index (a number).');
  if (!Array.isArray(d.questions) || !d.questions.length) errors.push('"questions" must be a non-empty list.');
  const questions: QuizQuestion[] = [];
  (Array.isArray(d.questions) ? d.questions : []).forEach((q: Raw, i: number) => {
    const at = `Question ${i + 1}`;
    const need = (cond: unknown, msg: string) => { if (!cond) errors.push(`${at}: ${msg}`); return !!cond; };
    const text = str(q?.question);
    need(text, 'needs "question" (the text).');
    const base = { question: text, explanation: str(q?.explanation) || undefined, source: str(q?.source) || undefined };
    if (!base.explanation) warnings.push(`${at}: no "explanation" (why the answer is right helps the student learn).`);
    else if (base.explanation.split(/\s+/).length < 15) warnings.push(`${at}: the "explanation" is short; explain fully why the answer is right (and why the tempting wrong ones are wrong).`);
    if (base.explanation && POINTS_TO_MATERIAL.test(base.explanation)) warnings.push(`${at}: the "explanation" points to the material; explain the idea itself instead.`);
    if (q?.type === "true-false") {
      if (need(typeof q.answer === "boolean", '"answer" must be true or false (no quotes).')) questions.push({ type: "true-false", ...base, answer: q.answer });
      return;
    }
    if (!need(q?.type === "single" || q?.type === "multiple", `"type" must be one of ${QUESTION_TYPES.join(", ")}.`)) return;
    if (!need(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 8, '"options" must be a list of 2 to 8 { "text", "correct" } items.')) return;
    const options = (q.options as Raw[]).map((o) => ({ text: str(typeof o === "string" ? o : o?.text), correct: o?.correct === true }));
    if (!need(options.every((o) => o.text), 'every option needs "text".')) return;
    need(new Set(options.map((o) => o.text.toLowerCase())).size === options.length, "two options have the same text.");
    const right = options.filter((o) => o.correct).length;
    if (q.type === "single") need(right === 1, `a "single" question has exactly one option with "correct": true (found ${right}).`);
    else {
      need(right >= 1, 'a "multiple" question needs at least one option with "correct": true.');
      if (right === 1) warnings.push(`${at}: a "multiple" question with one right option; "single" may fit better.`);
    }
    const pinned = options.findIndex((o) => PINNED_OPTION.test(o.text));
    if (pinned >= 0 && pinned !== options.length - 1) warnings.push(`${at}: put "${options[pinned].text}" last.`);
    questions.push({ type: q.type, ...base, options });
  });
  if (errors.length) return { errors, warnings };
  return {
    quiz: {
      id: `${where.code}/${where.name}`, code: where.code, name: where.name, title, scope: scope!,
      section: scope === "lecture" ? section : undefined, description: str(d.description) || undefined,
      by: str(d.by) || undefined, created: str(d.created) || undefined,
      sources: Array.isArray(d.sources) ? d.sources.map(str).filter(Boolean) : [], questions,
    },
    errors, warnings,
  };
}

/** The name the Make a quiz pop-up proposes: "Lecture 9 · <topic>" for one class, "<course> · Whole course" for the course. */
export function proposedQuizName(course: { short: string }, week: { index: number; name: string; label: string } | null): string {
  if (!week) return `${course.short} · Whole course`;
  if (week.index === 0) return `${course.short} · General`;
  const n = Number((`${week.name} ${week.label}`.match(/\b(?:week|lecture)\s*(\d+)/i) ?? [])[1] ?? week.index);
  return `Lecture ${n} · ${week.label}`;
}

/** The name proposed for a custom quiz: the course and the start of the student's topics. */
export function proposedCustomQuizName(course: { short: string }, topics: string): string {
  const t = topics.replace(/\s+/g, " ").trim();
  return `${course.short} · ${!t ? "Custom quiz" : t.length > 40 ? `${t.slice(0, 40).trim()}…` : t}`;
}

/** What the student picked: true/false, or the indexes of the options they ticked. */
export type QuizAnswer = boolean | number[];

/** Is this the right answer? A multiple-answer question needs exactly the right options, no more and no fewer. */
export function isCorrect(q: QuizQuestion, answer: QuizAnswer | undefined): boolean {
  if (answer === undefined) return false;
  if (q.type === "true-false") return answer === q.answer;
  if (!Array.isArray(answer)) return false;
  const want = q.options.flatMap((o, i) => (o.correct ? [i] : []));
  const got = [...new Set(answer)].sort((a, b) => a - b);
  return got.length === want.length && got.every((x, i) => x === want[i]);
}

/** Points for one attempt: 10 per right answer, and 20 more for a perfect score. */
export function pointsFor(results: boolean[]): number {
  const right = results.filter(Boolean).length;
  return right * 10 + (results.length > 0 && right === results.length ? 20 : 0);
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface QuizStats {
  points: number;
  /** days in a row (ending today, or yesterday if not played yet today) with at least one quiz finished */
  streak: number;
  playedToday: boolean;
  attempts: number;
  /** quizzes with a perfect best score */
  mastered: number;
  best: Record<string, { score: number; total: number; pct: number; attempts: number; last: string }>;
}

/** Points, streak and the best score per quiz, from the saved attempts. */
export function quizStats(attempts: QuizAttempt[], now = new Date()): QuizStats {
  const best: QuizStats["best"] = {};
  for (const a of attempts) {
    const pct = a.total ? a.score / a.total : 0;
    const b = best[a.quiz];
    if (!b) best[a.quiz] = { score: a.score, total: a.total, pct, attempts: 1, last: a.at };
    else {
      b.attempts++;
      if (a.at > b.last) b.last = a.at;
      if (pct > b.pct) Object.assign(b, { score: a.score, total: a.total, pct });
    }
  }
  const days = new Set(attempts.map((a) => localDay(new Date(a.at))));
  const today = localDay(now);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(today)) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(localDay(d))) { streak++; d.setDate(d.getDate() - 1); }
  return {
    points: attempts.reduce((n, a) => n + (a.points || 0), 0), streak, playedToday: days.has(today),
    attempts: attempts.length, mastered: Object.values(best).filter((b) => b.pct === 1).length, best,
  };
}

/** Options in a random order, with "All of the above" and the like kept last. Returns the original indexes. */
export function shuffledOptions(n: number, texts: string[], random = Math.random): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  const free = idx.filter((i) => !PINNED_OPTION.test(texts[i] ?? ""));
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [free[i], free[j]] = [free[j]!, free[i]!]; }
  return [...free, ...idx.filter((i) => PINNED_OPTION.test(texts[i] ?? ""))];
}

/** A random number generator that always gives the same numbers for the same seed (so options keep their order while the page redraws). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A saved attempt, checked: what POST /api/quiz/attempts accepts (the points are worked out here, not trusted). */
export function makeAttempt(body: Raw, now = new Date()): QuizAttempt {
  const quiz = String(body?.quiz ?? "");
  if (!/^[\w-]+\/[\w.-]+$/.test(quiz)) throw new Error("Bad quiz id.");
  const results = Array.isArray(body?.results) ? body.results.map((r: unknown) => r === true) : null;
  if (!results?.length || results.length > 200) throw new Error("Bad results.");
  const score = results.filter(Boolean).length;
  return { quiz, title: String(body?.title ?? "").slice(0, 200) || quiz, at: now.toISOString(), score, total: results.length, points: pointsFor(results), results };
}
