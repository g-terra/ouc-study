// The study actions the app offers ("Make notes", "Quiz me"…), one per skill in ai/skills/, and the
// prompt each one sends. Shared by the study app (/api/ai) and the `ouc` command line, so both
// ask the AI the same thing. A new skill in ai/skills/ shows up in the app on its own.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findCourse, noteFileName, read, slug, weekMaterial, weekNumber } from "./context.ts";
import { loadReview, reviewDir, reviewFile } from "./review.ts";
import type { Assignment, Course, SemesterData, Week } from "../../content/src/types.ts";

/** An input an action asks for in the app. */
export interface Field { key: string; kind: "course" | "text" | "assignment"; label: string; required?: boolean; placeholder?: string }
export interface Action { id: string; title: string; icon: string; description: string; fields: Field[]; agentOnly: boolean }
/** What the app sends with an action: the field values (and a week from a shortcut button). */
export type Params = { course?: string; week?: string | number; topic?: string; assignment?: string; mode?: string; version?: string | number; [key: string]: unknown };
export interface PromptInput { root: string; semId: string; data: SemesterData; action?: string | null; params?: Params; message?: string; first?: boolean }

// The inputs each known skill asks for in the app; other skills just take a free-text request.
const FIELDS: Record<string, Field[]> = {
  // a week can still come from a shortcut button (e.g. "Make notes" on a course week)
  "make-notes": [{ key: "course", kind: "course", label: "Course", placeholder: "All courses" }],
  "quiz-me": [{ key: "course", kind: "course", label: "Course", required: true }],
  // a lecture quiz when a week comes from a shortcut button, else the whole course
  "make-quiz": [{ key: "course", kind: "course", label: "Course", required: true }],
  "plan-week": [],
  "research-topic": [{ key: "topic", kind: "text", label: "Topic", required: true, placeholder: "e.g. signal detection theory" }, { key: "course", kind: "course", label: "Course" }],
  "find-material": [{ key: "topic", kind: "text", label: "What are you looking for?", required: true, placeholder: "e.g. the slide about d′" }, { key: "course", kind: "course", label: "Course" }],
  "assignment-helper": [{ key: "course", kind: "course", label: "Course", placeholder: "All courses" }, { key: "assignment", kind: "assignment", label: "Assignment", required: true }],
  "assignment-prep": [{ key: "course", kind: "course", label: "Course", placeholder: "All courses" }, { key: "assignment", kind: "assignment", label: "Assignment", required: true }],
  "assignment-review": [{ key: "course", kind: "course", label: "Course", placeholder: "All courses" }, { key: "assignment", kind: "assignment", label: "Assignment", required: true }],
  "sync-eclass": [],
  "important-dates": [{ key: "course", kind: "course", label: "Course", placeholder: "All courses" }],
};
const TITLE: Record<string, string> = {
  "make-notes": "Make notes", "quiz-me": "Quiz me", "make-quiz": "Make a quiz", "plan-week": "Plan my week", "research-topic": "Research a topic",
  "find-material": "Find material", "assignment-helper": "Assignment help", "assignment-prep": "Prep an assignment",
  "assignment-review": "Review my draft", "sync-eclass": "Sync eClass", "important-dates": "Important dates",
};
// What the app shows the student about each action (the skill's description is written for the AI: paths, trigger phrases)
const SUMMARY: Record<string, string> = {
  "make-notes": "Makes visual study notes for a week or a whole course from its material, and saves them with your notes.",
  "quiz-me": "Asks you questions on a course in the chat, going back over what you got wrong before.",
  "make-quiz": "Makes a scored quiz on a lecture or a whole course for the Quizzes page.",
  "plan-week": "Plans your week across your courses from your deadlines and what you've done so far.",
  "research-topic": "Looks up a topic in good sources beyond the course material and sums up what they say, with links.",
  "find-material": "Finds which file, slide or week covers what you're looking for.",
  "assignment-helper": "Helps you understand, plan and check an assignment with hints and feedback, never the answers.",
  "assignment-prep": "Makes a prep pack for an assignment: what it asks, hints, the material to read and a plan.",
  "assignment-review": "Reviews the draft you uploaded against the brief and says what to fix, without rewriting it.",
  "sync-eclass": "Checks eClass for new files, grades, feedback and deadlines.",
  "important-dates": "Adds, changes or removes exam dates and other important dates on a course, as you tell it.",
};
const ICON: Record<string, string> = { "make-notes": "📒", "quiz-me": "❓", "make-quiz": "🏆", "plan-week": "🗓️", "research-topic": "🔎", "find-material": "📂", "assignment-helper": "📝", "assignment-prep": "🧭", "assignment-review": "🔍", "sync-eclass": "🔄", "important-dates": "📅" };
// What a plain local model (no file or web tools) can do from the app (it gets the material in its
// prompt; a quiz it answers with is saved by the app server).
const CHAT_OK = new Set(["quiz-me", "make-quiz"]);

const frontMatter = (md: string): Record<string, string> => Object.fromEntries((md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "").split("\n")
  .map((l) => l.match(/^(\w+):\s*(.*)$/)).filter((m) => m !== null).map((m) => [m[1], m[2]!.replace(/^["']|["']$/g, "")]));
const titleCase = (s: string) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
export const skillBody = (root: string, name: string) => read(join(root, "ai/skills", name, "SKILL.md")).replace(/^---[\s\S]*?---\n/, "");

/** [{ id, title, icon, description, fields, agentOnly }] from ai/skills/. */
export function listActions(root: string): Action[] {
  const dir = join(root, "ai/skills");
  const ids = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, "SKILL.md"))) : [];
  const order = Object.keys(TITLE);
  ids.sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99) || a.localeCompare(b));
  return ids.map((id) => {
    const fm = frontMatter(read(join(dir, id, "SKILL.md")));
    return {
      id, title: TITLE[id] ?? titleCase(id), icon: ICON[id] ?? "✨",
      description: SUMMARY[id] ?? (fm.description ?? "").replace(/\s*Use (for|when)\b[\s\S]*$/, ""),
      fields: FIELDS[id] ?? [], agentOnly: !CHAT_OK.has(id),
    };
  });
}

// downloaded files, videos included (their transcripts are what notes are made from)
const hasFiles = (w: Week) => w.items.some((i) => i.kind === "file" || (i.kind === "video" && !i.external));
// the sections notes are made for: the weekly ones with files, else (all files in General) the General one
const noteSections = (course: Course) => {
  const weekly = course.weeks.filter((w) => w.index > 0 && hasFiles(w));
  return weekly.length ? weekly : course.weeks.filter((w) => w.index === 0 && hasFiles(w));
};
/**
 * Weeks that have files and no note yet (started or not), oldest first. A course that keeps all its
 * files in the General section (no weekly sections with files) gets that section instead.
 */
export function weeksWithoutNotes(data: Pick<SemesterData, "notes">, courses: Course[]): { course: Course; week: Week }[] {
  return courses.flatMap((course) => noteSections(course)
    .filter((w) => !data.notes.some((n) => n.code === course.code && n.weekIndex === w.index))
    .map((week) => ({ course, week })));
}

/** Why a course has nothing left to make notes for, in a few words (for the "nothing to do" message). */
export function notesCoverage(_data: unknown, course: Course): string {
  const withFiles = noteSections(course);
  if (!withFiles.length) return `${course.short}: no downloaded files yet (run ouc pull)`;
  return `${course.short}: all ${withFiles.length} week${withFiles.length === 1 ? "" : "s"} with files have notes`;
}

/** The prompt `ouc notes` and the app use for an agent tool. */
export function notesPrompt(semId: string, course: Course, week: Week): { rel: string; prompt: string } {
  const rel = `semesters/${semId}/notes/${course.code}/${noteFileName(course, week)}`;
  return {
    rel,
    prompt: `Use the make-notes skill. Make visual study notes for ${course.title} (${course.code}), eClass section ${week.index} "${week.name}". ` +
      `The week's files are listed in semesters/${semId}/courses/ and their text copies in semesters/${semId}/text/; transcripts of its videos and narrated slides (*.transcript.md next to them), when there are any, are the base for the note. Save the note as ${rel} (front matter: course ${course.code}, section ${week.index}, week ${weekNumber(week)}). ` +
      `When done, run: node packages/ai/validate.mjs ${rel} and fix every error it reports.`,
  };
}

// ---------- quizzes (docs/QUIZ_FORMAT.md) ----------
/** The section and course a quiz request covers: a week from a shortcut button makes it a lecture quiz. */
export function quizScope(data: Pick<SemesterData, "courses">, params: Params): { course: Course; week: Week | null } {
  const course = params.course ? findCourse(data, params.course) : null;
  if (!course) throw new Error("Choose a course first.");
  const week = params.week !== undefined && params.week !== "" ? course.weeks.find((w) => String(w.index) === String(params.week)) ?? null : null;
  return { course, week };
}
/** The name the student gave the quiz in the pop-up, if any (one line, at most 120 characters). */
export const quizTitle = (params: Params): string | undefined => String(params.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || undefined;
/** Where a new quiz goes (repo-relative): after the name the student gave, else like the week's note or course-<short>; never an existing file. */
export function quizPath(root: string, semId: string, course: Course, week: Week | null, title?: string): string {
  // ASCII only: quiz ids are [\w.-]
  const named = title ? slug(title.normalize("NFKD"), 50).replace(/[^\w-]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "") : "";
  const base = named || (week ? noteFileName(course, week).replace(/\.md$/, "") : `course-${slug(course.short, 30)}`);
  const dir = `semesters/${semId}/quizzes/${course.code}`;
  let rel = `${dir}/${base}.json`;
  for (let n = 2; existsSync(join(root, rel)); n++) rel = `${dir}/${base}-${n}.json`;
  return rel;
}
const fileItems = (w: Week) => w.items.filter((i) => i.kind === "file" && i.href?.startsWith("/files/")).map((i) => decodeURIComponent(i.href!.split("/").slice(3).join("/")));
/** The material a quiz may use: the files of the week (or of every week) and the student's notes on it, relative to the semester folder. */
export function quizMaterial(data: Pick<SemesterData, "notes">, course: Course, week: Week | null): { files: string[]; notes: string[] } {
  return {
    files: (week ? [week] : course.weeks).flatMap(fileItems),
    notes: data.notes.filter((n) => n.code === course.code && (!week || n.weekIndex === week.index)).map((n) => `notes/${n.code}/${n.slug}.md`),
  };
}
/** The classes of a course with material and no lecture quiz yet: what "Every class" makes quizzes for. */
export function weeksWithoutQuiz(root: string, semId: string, data: Pick<SemesterData, "notes" | "quizzes">, course: Course): Week[] {
  return course.weeks.filter((w) => {
    const m = quizMaterial(data, course, w);
    return (m.files.length > 0 || m.notes.length > 0)
      && !(data.quizzes ?? []).some((q) => q.code === course.code && q.scope === "lecture" && q.section === w.index)
      && !existsSync(join(root, `semesters/${semId}/quizzes/${course.code}/${noteFileName(course, w).replace(/\.md$/, "")}.json`));
  });
}
/** The prompt for an agent tool that makes a quiz and saves it at `rel`. */
export function quizPrompt(root: string, semId: string, data: SemesterData, course: Course, week: Week | null, title?: string): { rel: string; prompt: string } {
  const rel = quizPath(root, semId, course, week, title);
  const { files, notes } = quizMaterial(data, course, week);
  const what = week ? `eClass section ${week.index} "${week.name}"` : "the whole course so far";
  if (!files.length && !notes.length) throw new Error(`No material for ${course.short}${week ? `, ${week.label}` : ""} yet. Download the course files first (ouc pull).`);
  const sem = `semesters/${semId}`;
  const shown = files.slice(0, 40).map((f) => `\`${sem}/${f}\``);
  return {
    rel,
    prompt: `Use the make-quiz skill (ai/skills/make-quiz/SKILL.md; format in docs/QUIZ_FORMAT.md). Make a ${week ? "lecture" : "course"} quiz for ${course.title} (${course.code}) covering ${what}. ` +
      "Use this material to decide the topics and the level; the questions can go wider (examples, scenarios, related ideas from the field) and every explanation must be full and self-contained, never a pointer to the material:" +
      (shown.length ? `\n- files (text copies in \`${sem}/text/\`): ${shown.join(", ")}${files.length > shown.length ? ` and ${files.length - shown.length} more in \`${sem}/courses/\`` : ""}` : "") +
      (notes.length ? `\n- the student's notes: ${notes.map((n) => `\`${sem}/${n}\``).join(", ")}` : "") +
      `\n\nSave it as ${rel} (${title ? `"title": ${JSON.stringify(title)}, ` : ""}"course": "${course.code}", "scope": "${week ? "lecture" : "course"}"${week ? `, "section": ${week.index}` : ""}). ` +
      `When done, run: node packages/ai/validate.mjs ${rel} and fix every error it reports.`,
  };
}

/** Where an assignment's prep pack lives (repo-relative). */
export const prepPath = (semId: string, a: Pick<Assignment, "id">) => `semesters/${semId}/assignments/${a.id}/PREP.md`;
export const PREP_MODES: Record<string, string> = {
  new: "Write it from scratch.",
  redo: "Start over: don't read the existing PREP.md, write a new one from scratch and replace it.",
  review: "Review the existing PREP.md critically (another AI wrote it): fix mistakes, sharpen vague hints, fill gaps, remove anything that gives answers away. Keep what's good and edit the file in place.",
  more: "Keep everything in the existing PREP.md and add depth: more hints, practice questions on the same ideas, more sources, a worked example on a different problem.",
};
/** The prompt for an assignment's prep pack (also used by the app's automatic prep after a sync). */
export function prepPrompt(semId: string, a: Assignment, mode = "new"): string {
  const rel = prepPath(semId, a);
  return `Use the assignment-prep skill (ai/skills/assignment-prep/SKILL.md). Prepare the study pack for ${a.fullTitle} (${a.code}${a.due ? `, due ${a.due}` : ""}). ` +
    `Its folder is semesters/${semId}/assignments/${a.id}/; save the pack as ${rel}. Mode: ${PREP_MODES[mode] ? mode : "new"}. ${PREP_MODES[mode] ?? PREP_MODES.new} ` +
    "Explain and give hints, but never write answers the student could submit. " +
    `When done, run: node packages/ai/validate.mjs ${rel} and fix every error it reports.`;
}

/**
 * The prompt for reviewing the student's uploaded draft (version `v`, default the latest), with the
 * paths of everything about the subject the reviewer should read first.
 */
export function reviewPrompt(root: string, semId: string, data: SemesterData, a: Assignment, v?: string | number): string {
  const { versions } = loadReview(root, semId, a);
  const ver = v ? versions.find((x) => String(x.v) === String(v)) : versions.at(-1);
  if (!ver) throw new Error("Upload your .docx on the assignment page first.");
  const prev = versions.filter((x) => x.v < ver.v).at(-1);
  const sem = `semesters/${semId}`;
  const course = data.courses.find((c) => c.code === a.code);
  const week = course?.weeks.find((w) => w.index === a.weekIndex);
  const fromHref = (h: string) => `${sem}/${decodeURIComponent(h.split("/").slice(3).join("/"))}`;
  const briefs = a.briefs.map((f) => fromHref(f.href));
  const rubric = [...briefs, ...(course?.weeks.find((w) => w.index === 0)?.items ?? []).filter((i) => i.href?.startsWith("/files/")).map((i) => fromHref(i.href!))]
    .filter((p) => /rubric|marking|criteria|grading|assessment|αξιολόγ/i.test(p.split("/").pop() ?? ""));
  const weekFiles = (week?.items ?? []).filter((i) => i.kind === "file" && i.href?.startsWith("/files/")).map((i) => fromHref(i.href!));
  const notes = data.notes.filter((n) => n.code === a.code).sort((x, y) => Math.abs(x.weekIndex - a.weekIndex) - Math.abs(y.weekIndex - a.weekIndex)).slice(0, 4)
    .map((n) => `${sem}/notes/${n.code}/${n.slug}.md`);
  const prep = a.prep ? `${sem}/assignments/${a.id}/PREP.md` : null;
  const list = (label: string, xs: string[]) => (xs.length ? `\n- ${label}: ${xs.map((x) => `\`${x}\``).join(", ")}` : "");
  return "Use the assignment-review skill (ai/skills/assignment-review/SKILL.md) and act as the assignment reviewer (ai/agents/assignment-reviewer.md). " +
    "Do the review yourself in this conversation: the student will discuss it with you next. " +
    `Review version ${ver.v} of the student's own work for ${a.fullTitle} (${a.code}${a.due ? `, due ${a.due}` : ""}), uploaded as "${ver.name}" (${ver.words} words). ` +
    `Read its text in \`${reviewDir(semId, a)}/v${ver.v}.md\` (the original is \`${reviewDir(semId, a)}/v${ver.v}.docx\`; never change either).\n\nContext about the subject, read first:` +
    list("the brief", briefs.length ? briefs : [`${sem}/assignments/${a.id}/`]) + (a.question ? "\n- the question text on eClass, in the assignment's entry in `" + sem + "/_meta/eclass-meta.json`" : "") +
    list("rubric or marking criteria", rubric) + (rubric.length ? "" : "\n- rubric: none found; look for marking criteria in the brief and the syllabus in `" + sem + "/courses/` (00-General)") +
    list(`material of ${week?.name ?? "its week"} (text copies in \`${sem}/text/\`)`, weekFiles) + list("the student's notes", notes) + list("the prep pack", prep ? [prep] : []) +
    (prev ? `\n- the previous round: version ${prev.v} \`${reviewDir(semId, a)}/v${prev.v}.md\` and its review \`${reviewFile(semId, a, prev.v)}\`: say what was fixed and what is still open` : "") +
    `\n\nSave the review as \`${reviewFile(semId, a, ver.v)}\`. Give feedback and say what to fix and why, but never write replacement answers or text the student could paste in.`;
}

// The chat draws ```mermaid blocks as diagrams (apps/web/src/notes/Mermaid.tsx), so flows come out as pictures, not ASCII arrows.
export const DIAGRAMS = "When you explain a flow, a process, a sequence of steps or how parts connect, draw it as a ```mermaid diagram " +
  "(flowchart TD/LR, sequenceDiagram or stateDiagram-v2) instead of arrows in text; the app shows it as a picture. Keep node labels short and put labels with symbols or maths in quotes, e.g. A[\"V ≥ threshold?\"].";

// Said once at the start of every chat from the app: nobody can answer a question mid-run.
export const APP_PREAMBLE = "You are running from the OUC Study app, one turn at a time: the student reads your reply in the app and answers in the next message. " +
  "Don't wait for confirmation in the middle of a task; make sensible choices and finish it. Keep the reply short, use Markdown, and name the repo-relative path of every file you write or point to in `backticks` (the app turns them into links). " +
  `${DIAGRAMS} Never read or print .eclass-token.`;

// A plain chat (no action picked) starts lean: the agent reads files only when the question needs them.
export const CHAT_START = "This is a chat. Be warm and helpful, and answer what the student asks. " +
  "If they only say hello or don't ask anything specific yet, greet them and ask how you can help, with two or three short suggestions " +
  "(explain a topic, quiz them, plan the week, help with an assignment); don't read files or give a status report for that. " +
  "Read STUDENT.md, memory/, deadlines, eClass updates or course files only when the question needs them: the start-of-session reading in AGENTS.md is for study sessions in Terminal, not this chat. " +
  "Where things are: STUDENT.md (the student, the current semester), memory/progress.md (what's been covered), semesters/<id>/DEADLINES.md, " +
  "semesters/<id>/notes/<CODE>/ (their notes), semesters/<id>/text/ (text of every course file: grep these), semesters/<id>/assignments/, semesters/<id>/updates/<date>.json (what changed on eClass). " +
  "Academic integrity: explain, hint, outline and review, but never write answers the student could submit.";

/**
 * The text sent for one turn. action/params come from the app's action picker (first turn only);
 * message is what the student typed. Throws Error with a readable message when an input is missing.
 */
export function buildPrompt({ root, semId, data, action, params = {}, message = "", first = true }: PromptInput): string {
  const msg = String(message ?? "").trim();
  const course = params.course ? findCourse(data, params.course) : null;
  if (params.course && !course) throw new Error(`No course matches "${params.course}".`);
  const week = course && params.week !== undefined && params.week !== "" ? course.weeks.find((w) => String(w.index) === String(params.week)) : null;
  const extra = msg ? `\n\nThe student adds: ${msg}` : "";
  const field = (FIELDS[action ?? ""] ?? []).find((f) => f.required && !params[f.key]);
  if (field) throw new Error(`Choose ${field.label.toLowerCase().replace(/\?$/, "")} first.`);
  let body: string;
  switch (action) {
    case undefined: case null: case "":
      if (!msg) throw new Error("Type a message first.");
      body = msg; break;
    case "make-notes": {
      if (week && course) { body = notesPrompt(semId, course, week).prompt + extra; break; }
      const todo = weeksWithoutNotes(data, course ? [course] : data.courses);
      if (!todo.length) throw new Error(`Nothing to make notes for. ${(course ? [course] : data.courses).map((c) => notesCoverage(data, c)).join("; ")}.`);
      if (todo.length === 1) { body = notesPrompt(semId, todo[0].course, todo[0].week).prompt + extra; break; }
      body = `Use the make-notes skill. Make visual study notes for each of these ${todo.length} weeks, which have material but no notes yet (some may not have started: use the files that are there). ` +
        `Delegate to the note-taker agent, one per course, in parallel if you can. The week's files are listed in semesters/${semId}/courses/ and their text copies in semesters/${semId}/text/; transcripts of the videos and narrated slides (*.transcript.md next to them), when there are any, are the base for each note.\n\n` +
        todo.map(({ course: c, week: w }) => `- ${c.code} section ${w.index} "${w.name}" → ${notesPrompt(semId, c, w).rel} (front matter: course ${c.code}, section ${w.index}, week ${weekNumber(w)})`).join("\n") +
        `\n\nAfter writing each note, run: node packages/ai/validate.mjs <its path> and fix every error it reports.${extra}`;
      break;
    }
    case "quiz-me":
      if (!course) throw new Error("Choose a course first.");
      body = `Use the quiz-me skill: quiz me on ${course.short}${week ? `, ${week.label}` : ""} (${course.code}${week ? `, eClass section ${week.index}` : ""}). Ask one question, then stop and wait for my answer in the next message.${extra}`; break;
    case "make-quiz": {
      const { course: c, week: w } = quizScope(data, params);
      body = quizPrompt(root, semId, data, c, w, quizTitle(params)).prompt + extra; break;
    }
    case "plan-week":
      body = `Use the plan-week skill: plan my study week.${extra}`; break;
    case "research-topic":
      body = `Use the research-topic skill: research "${params.topic}"${course ? ` for ${course.title} (${course.code})` : ""}.${extra}`; break;
    case "find-material":
      body = `Use the find-material skill: find "${params.topic}"${course ? ` in ${course.title} (${course.code})` : ""}. Give the file paths you find.${extra}`; break;
    case "assignment-helper": {
      const a = data.assignments.find((x) => x.id === params.assignment);
      if (!a) throw new Error("That assignment isn't in the app data.");
      body = `Use the assignment-helper skill: help me with ${a.fullTitle} (${a.code}${a.due ? `, due ${a.due}` : ""}). Its folder is semesters/${semId}/assignments/${a.id}/. ` +
        `Explain, give hints and outline, but don't write answers I could submit.${extra}`; break;
    }
    case "assignment-prep": {
      const a = data.assignments.find((x) => x.id === params.assignment);
      if (!a) throw new Error("That assignment isn't in the app data.");
      body = prepPrompt(semId, a, params.mode) + extra; break;
    }
    case "assignment-review": {
      const a = data.assignments.find((x) => x.id === params.assignment);
      if (!a) throw new Error("That assignment isn't in the app data.");
      body = reviewPrompt(root, semId, data, a, params.version) + extra; break;
    }
    case "important-dates":
      body = `Use the important-dates skill${course ? ` for ${course.title} (${course.code})` : ""}: the dates are in semesters/${semId}/_meta/dates.json. ` +
        `${msg ? `Add, change or remove what I say.${extra}` : "Ask me which dates to add, change or remove."}`; break;
    default:
      if (!existsSync(join(root, "ai/skills", action, "SKILL.md"))) throw new Error(`Unknown action "${action}".`);
      body = `Use the ${action} skill${msg ? `: ${msg}` : "."}`;
  }
  const visuals = semId ? ` When a picture would help (a diagram, a chart, a side-by-side), save it as one self-contained HTML or SVG file in semesters/${semId}/visuals/ and name its path in backticks: the app shows it right in the chat.` : "";
  return first ? `${APP_PREAMBLE}${visuals}${action ? "" : ` ${CHAT_START}`}\n\n${body}` : body;
}

/** The text of a quiz's material for a model without file tools: the student's notes, then the files' text copies. */
export function quizMaterialText(root: string, semId: string, data: SemesterData, course: Course, week: Week | null, budget = 40000): string {
  const notes = data.notes.filter((n) => n.code === course.code && (!week || n.weekIndex === week.index)).map((n) => `## Notes: ${n.title}\n\n${n.body}`).join("\n\n").slice(0, budget / 2);
  const weeks = (week ? [week] : course.weeks).filter((w) => fileItems(w).length);
  const each = Math.floor((budget - notes.length) / Math.max(1, weeks.length));
  const files = weeks.flatMap((w) => weekMaterial(root, semId, w, each).sources.map((x) => `## ${x.title} (${x.rel})\n\n${x.text}`));
  return [notes, ...files].filter(Boolean).join("\n\n");
}

/** System prompt for a plain local model chatting from the app (it has no tools). */
export function chatSystem({ root, semId, data, action, params = {} }: Omit<PromptInput, "message" | "first">): string {
  // a short guide, not all of AGENTS.md: a local model's context window is small
  const parts = ["You are the study assistant of a student at the Open University of Cyprus, chatting from their OUC Study app.",
    "Academic integrity: explain, give hints, outline and review, but never write answers the student could submit.", "",
    "# About the student", read(join(root, "STUDENT.md")).trim()];
  if (semId) parts.push("", "# Deadlines (mention them only when asked or relevant)", read(join(root, "semesters", semId, "DEADLINES.md")));
  if (action === "quiz-me" && params.course) {
    const course = findCourse(data, params.course);
    const notes = data.notes.filter((n) => n.code === course?.code && (params.week === undefined || params.week === "" || String(n.weekIndex) === String(params.week)));
    parts.push("", "# How to quiz (skill)", skillBody(root, "quiz-me"), "", "# Material (the student's notes)", notes.map((n) => n.body).join("\n\n").slice(0, 30000) || "_No notes for this yet: quiz from general knowledge of the topic and say so._");
  }
  if (action === "make-quiz" && params.course) {
    const { course, week } = quizScope(data, params);
    parts.push("", "# How to make a quiz (skill)", skillBody(root, "make-quiz"), "", "# Quiz format", read(join(root, "docs/QUIZ_FORMAT.md")),
      "", "# Material (the topics to cover; questions can go wider)", quizMaterialText(root, semId, data, course, week) || "_No material downloaded for this yet: say so and stop._",
      "", "You can't save files or run commands. Reply with only the quiz JSON (no other text): the app checks it and saves it for the Quizzes page.");
    return parts.join("\n");
  }
  parts.push("", "Be warm and helpful. If the student only says hello or doesn't ask anything specific, greet them and ask how you can help, with two or three short suggestions, instead of a status report.",
    "", DIAGRAMS, "", "You have no tools in this chat. If a task needs files or the web, say it needs Claude Code, Codex or opencode (`ouc ai setup`), or the `ouc notes` / `ouc plan` commands.");
  return parts.join("\n");
}
