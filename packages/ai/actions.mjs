// The study actions the app offers ("Make notes", "Quiz me"…), one per skill in ai/skills/, and the
// prompt each one sends. Shared by the study app (/api/ai) and the `ouc` command line, so both
// ask the AI the same thing. A new skill in ai/skills/ shows up in the app on its own.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findCourse, noteFileName, read, weekNumber } from "./context.mjs";

// The inputs each known skill asks for in the app; other skills just take a free-text request.
const FIELDS = {
  // a week can still come from a shortcut button (e.g. "Make notes" on a course week)
  "make-notes": [{ key: "course", kind: "course", label: "Course", placeholder: "All courses" }],
  "quiz-me": [{ key: "course", kind: "course", label: "Course", required: true }],
  "plan-week": [],
  "research-topic": [{ key: "topic", kind: "text", label: "Topic", required: true, placeholder: "e.g. signal detection theory" }, { key: "course", kind: "course", label: "Course" }],
  "find-material": [{ key: "topic", kind: "text", label: "What are you looking for?", required: true, placeholder: "e.g. the slide about d′" }, { key: "course", kind: "course", label: "Course" }],
  "assignment-helper": [{ key: "course", kind: "course", label: "Course", placeholder: "All courses" }, { key: "assignment", kind: "assignment", label: "Assignment", required: true }],
  "assignment-prep": [{ key: "course", kind: "course", label: "Course", placeholder: "All courses" }, { key: "assignment", kind: "assignment", label: "Assignment", required: true }],
  "sync-eclass": [],
};
const TITLE = {
  "make-notes": "Make notes", "quiz-me": "Quiz me", "plan-week": "Plan my week", "research-topic": "Research a topic",
  "find-material": "Find material", "assignment-helper": "Assignment help", "assignment-prep": "Prep an assignment", "sync-eclass": "Sync eClass",
};
const ICON = { "make-notes": "📒", "quiz-me": "❓", "plan-week": "🗓️", "research-topic": "🔎", "find-material": "📂", "assignment-helper": "📝", "assignment-prep": "🧭", "sync-eclass": "🔄" };
// What a plain local model (no file or web tools) can do from the app.
const CHAT_OK = new Set(["quiz-me"]);

const frontMatter = (md) => Object.fromEntries((md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "").split("\n")
  .map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const titleCase = (s) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
export const skillBody = (root, name) => read(join(root, "ai/skills", name, "SKILL.md")).replace(/^---[\s\S]*?---\n/, "");

/** [{ id, title, icon, description, fields, agentOnly }] from ai/skills/. */
export function listActions(root) {
  const dir = join(root, "ai/skills");
  const ids = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, "SKILL.md"))) : [];
  const order = Object.keys(TITLE);
  ids.sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99) || a.localeCompare(b));
  return ids.map((id) => {
    const fm = frontMatter(read(join(dir, id, "SKILL.md")));
    return {
      id, title: TITLE[id] ?? titleCase(id), icon: ICON[id] ?? "✨",
      description: (fm.description ?? "").replace(/\s*Use (for|when)\b[\s\S]*$/, ""),
      fields: FIELDS[id] ?? [], agentOnly: !CHAT_OK.has(id),
    };
  });
}

const hasFiles = (w) => w.items.some((i) => i.kind === "file");
// the sections notes are made for: the weekly ones with files, else (all files in General) the General one
const noteSections = (course) => {
  const weekly = course.weeks.filter((w) => w.index > 0 && hasFiles(w));
  return weekly.length ? weekly : course.weeks.filter((w) => w.index === 0 && hasFiles(w));
};
/**
 * Weeks that have started, have files and have no note yet, oldest first. A course that keeps all
 * its files in the General section (no weekly sections with files) gets that section instead.
 */
export function weeksWithoutNotes(data, courses, today = new Date().toISOString().slice(0, 10)) {
  return courses.flatMap((course) => noteSections(course)
    .filter((w) => !w.start || w.start <= today)
    .filter((w) => !data.notes.some((n) => n.code === course.code && n.weekIndex === w.index))
    .map((week) => ({ course, week })));
}

/** Why a course has nothing left to make notes for, in a few words (for the "nothing to do" message). */
export function notesCoverage(data, course, today = new Date().toISOString().slice(0, 10)) {
  const withFiles = noteSections(course);
  if (!withFiles.length) return `${course.short}: no downloaded files yet (run ouc pull)`;
  const started = withFiles.filter((w) => !w.start || w.start <= today);
  if (!started.length) return `${course.short}: its weeks with files haven't started yet`;
  return `${course.short}: all ${started.length} started week${started.length === 1 ? "" : "s"} with files have notes`;
}

/** The prompt `ouc notes` and the app use for an agent tool. */
export function notesPrompt(semId, course, week) {
  const rel = `semesters/${semId}/notes/${course.code}/${noteFileName(course, week)}`;
  return {
    rel,
    prompt: `Use the make-notes skill. Make visual study notes for ${course.title} (${course.code}), eClass section ${week.index} "${week.name}". ` +
      `The week's files are listed in semesters/${semId}/courses/ and their text copies in semesters/${semId}/text/. Save the note as ${rel} (front matter: course ${course.code}, section ${week.index}, week ${weekNumber(week)}). ` +
      `When done, run: node packages/ai/validate.mjs ${rel} and fix every error it reports.`,
  };
}

/** Where an assignment's prep pack lives (repo-relative). */
export const prepPath = (semId, a) => `semesters/${semId}/assignments/${a.id}/PREP.md`;
export const PREP_MODES = {
  new: "Write it from scratch.",
  redo: "Start over: don't read the existing PREP.md, write a new one from scratch and replace it.",
  review: "Review the existing PREP.md critically (another AI wrote it): fix mistakes, sharpen vague hints, fill gaps, remove anything that gives answers away. Keep what's good and edit the file in place.",
  more: "Keep everything in the existing PREP.md and add depth: more hints, practice questions on the same ideas, more sources, a worked example on a different problem.",
};
/** The prompt for an assignment's prep pack (also used by the app's automatic prep after a sync). */
export function prepPrompt(semId, a, mode = "new") {
  const rel = prepPath(semId, a);
  return `Use the assignment-prep skill (ai/skills/assignment-prep/SKILL.md). Prepare the study pack for ${a.fullTitle} (${a.code}${a.due ? `, due ${a.due}` : ""}). ` +
    `Its folder is semesters/${semId}/assignments/${a.id}/; save the pack as ${rel}. Mode: ${PREP_MODES[mode] ? mode : "new"}. ${PREP_MODES[mode] ?? PREP_MODES.new} ` +
    "Explain and give hints, but never write answers the student could submit.";
}

// Said once at the start of every chat from the app: nobody can answer a question mid-run.
export const APP_PREAMBLE = "You are running from the OUC Study app, one turn at a time: the student reads your reply in the app and answers in the next message. " +
  "Don't wait for confirmation in the middle of a task; make sensible choices and finish it. Keep the reply short, use Markdown, and name the repo-relative path of every file you write. " +
  "Never read or print .eclass-token.";

/**
 * The text sent for one turn. action/params come from the app's action picker (first turn only);
 * message is what the student typed. Throws Error with a readable message when an input is missing.
 */
export function buildPrompt({ root, semId, data, action, params = {}, message = "", first = true }) {
  const msg = String(message ?? "").trim();
  const course = params.course ? findCourse(data, params.course) : null;
  if (params.course && !course) throw new Error(`No course matches "${params.course}".`);
  const week = course && params.week !== undefined && params.week !== "" ? course.weeks.find((w) => String(w.index) === String(params.week)) : null;
  const extra = msg ? `\n\nThe student adds: ${msg}` : "";
  const field = (FIELDS[action] ?? []).find((f) => f.required && !params[f.key]);
  if (field) throw new Error(`Choose ${field.label.toLowerCase().replace(/\?$/, "")} first.`);
  let body;
  switch (action) {
    case undefined: case null: case "":
      if (!msg) throw new Error("Type a message first.");
      body = msg; break;
    case "make-notes": {
      if (week) { body = notesPrompt(semId, course, week).prompt + extra; break; }
      const todo = weeksWithoutNotes(data, course ? [course] : data.courses);
      if (!todo.length) throw new Error(`Nothing to make notes for. ${(course ? [course] : data.courses).map((c) => notesCoverage(data, c)).join("; ")}.`);
      if (todo.length === 1) { body = notesPrompt(semId, todo[0].course, todo[0].week).prompt + extra; break; }
      body = `Use the make-notes skill. Make visual study notes for each of these ${todo.length} weeks, which have material but no notes yet. ` +
        `Delegate to the note-taker agent, one per course, in parallel if you can. The week's files are listed in semesters/${semId}/courses/ and their text copies in semesters/${semId}/text/.\n\n` +
        todo.map(({ course: c, week: w }) => `- ${c.code} section ${w.index} "${w.name}" → ${notesPrompt(semId, c, w).rel} (front matter: course ${c.code}, section ${w.index}, week ${weekNumber(w)})`).join("\n") +
        `\n\nAfter writing each note, run: node packages/ai/validate.mjs <its path> and fix every error it reports.${extra}`;
      break;
    }
    case "quiz-me":
      body = `Use the quiz-me skill: quiz me on ${course.short}${week ? `, ${week.label}` : ""} (${course.code}${week ? `, eClass section ${week.index}` : ""}). Ask one question, then stop and wait for my answer in the next message.${extra}`; break;
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
    default:
      if (!existsSync(join(root, "ai/skills", action, "SKILL.md"))) throw new Error(`Unknown action "${action}".`);
      body = `Use the ${action} skill${msg ? `: ${msg}` : "."}`;
  }
  const visuals = semId ? ` When a picture would help (a diagram, a chart, a side-by-side), save it as one self-contained HTML or SVG file in semesters/${semId}/visuals/ and name its path in backticks: the app shows it right in the chat.` : "";
  return first ? `${APP_PREAMBLE}${visuals}\n\n${body}` : body;
}

/** System prompt for a plain local model chatting from the app (it has no tools). */
export function chatSystem({ root, semId, data, action, params = {} }) {
  const parts = [read(join(root, "AGENTS.md")), "", "# About the student", read(join(root, "STUDENT.md")).trim()];
  if (semId) parts.push("", "# Deadlines", read(join(root, "semesters", semId, "DEADLINES.md")));
  if (action === "quiz-me" && params.course) {
    const course = findCourse(data, params.course);
    const notes = data.notes.filter((n) => n.code === course?.code && (params.week === undefined || params.week === "" || String(n.weekIndex) === String(params.week)));
    parts.push("", "# How to quiz (skill)", skillBody(root, "quiz-me"), "", "# Material (the student's notes)", notes.map((n) => n.body).join("\n\n").slice(0, 30000) || "_No notes for this yet: quiz from general knowledge of the topic and say so._");
  }
  parts.push("", "You have no tools in this chat. If a task needs files or the web, say it needs Claude Code, Codex or opencode (`ouc ai setup`), or the `ouc notes` / `ouc plan` commands.");
  return parts.join("\n");
}
