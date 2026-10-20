// Shared data contract between the content builder and the web app.

export interface SemesterSummary {
  id: string;          // folder name, e.g. "2026-Fall"
  label: string;       // "Fall 2026"
  start: string;       // ISO date
  end: string;         // ISO date
  courses: { code: string; short: string; color: string }[];
}

export interface SemesterIndex {
  generated: string;
  semesters: SemesterSummary[];
}

export type ItemKind = "file" | "video" | "link" | "assignment" | "forum" | "tool" | "note";

export interface WeekItem {
  kind: ItemKind;
  title: string;
  href?: string;          // /files/... for local files, absolute URL for external
  external?: boolean;
  ext?: string;           // file extension for local files
  transcript?: string;    // /files/... of the transcript of a video or narrated slides, when there is one
  assignmentId?: string;
  noteSlug?: string;
}

export interface Week {
  index: number;          // eClass section index
  name: string;           // eClass section name
  label: string;          // short readable topic
  start?: string;         // ISO date (week start)
  end?: string;           // ISO date (week end)
  estimated: boolean;     // dates estimated (no dates on eClass)
  summary: string;
  items: WeekItem[];
}

export interface GradeItem {
  item: string;
  grade: string;
  feedback?: string;
  graded?: string;
}

export interface Course {
  code: string;
  grades?: GradeItem[];   // from the daily eClass sync (live.json)
  title: string;
  short: string;
  color: string;
  eclassUrl: string;
  joinUrl?: string;       // the course's Webconference link on eClass
  classTimeFrom?: string; // where the live-class time came from (the eClass sentence, or semester.json)
  weeks: Week[];
}

/** A live class (webconference); time read from eClass or semester.json "classes", see packages/content/src/classes.ts. */
export interface ClassSession {
  code: string;
  n: number;              // week / meeting number (0 for an extra class)
  at: string;             // ISO datetime with offset
  end: string;            // ISO datetime (UTC)
  weekIndex?: number;     // eClass section with the material for this class
  group?: string;         // teaching group, e.g. "F.03"
  joinUrl?: string;
  status: "scheduled" | "moved" | "cancelled" | "extra";
  movedFrom?: string;
  note?: string;
  extras: { title: string; href?: string; ext?: string }[];   // e.g. the meeting agenda
}

export interface FileRef {
  name: string;
  href: string;
  ext: string;
}

export interface Resource {
  focus: string;
  local: { title: string; href: string }[];
  links: { title: string; url: string; kind: string; why: string }[];
}

export interface Assignment {
  id: string;             // "COS511/10-26_Assignment-3"
  code: string;
  title: string;
  fullTitle: string;
  due?: string;           // ISO local datetime as shown on eClass
  opened?: string;
  status: string;
  submitted: boolean;
  grade?: string;
  feedback?: string;
  question: string;
  weekIndex: number;
  eclassUrl?: string;
  briefs: FileRef[];
  submissions: FileRef[];
  workingNotes?: string;  // href to README.md in the assignment folder
  resources?: Resource;
  prep?: Prep;            // PREP.md: hints and extra material prepared by the AI
}

export interface Prep {
  body: string;           // Markdown
  by?: string;            // the AI that last changed it
  updated?: string;       // ISO datetime
  log: string[];          // "2026-10-18 · Claude Code · prepared", newest last
}

/** A date the student added to a course (_meta/dates.json, see dates.ts). */
export interface ImportantDate {
  id: string;
  code: string;
  title: string;          // "Final exam", "Project presentation"
  kind: "exam" | "other";
  at: string;             // ISO local datetime
  noTime: boolean;        // only the day is known
  topics?: string;        // what it covers
}

/** The exams among the important dates (kind is the date's title). */
export interface Exam {
  code: string;
  kind: string;           // "Final exam", "Repeat exam"
  at: string;             // ISO local datetime
  noTime?: boolean;
}

export interface Note {
  code: string;
  slug: string;
  title: string;
  summary: string;
  week: number;
  weekIndex: number;      // eClass section this note belongs to
  source?: FileRef;
  tags: string[];
  body: string;           // visual-markdown (see docs/NOTE_FORMAT.md)
}

export type UpdateType = "grade" | "feedback" | "submission" | "assignment" | "deadline" | "material" | "announcement" | "forum" | "notification" | "event" | "baseline";
export interface UpdateItem {
  type: UpdateType;
  code: string;
  title: string;
  detail: string;
  url: string;
  at: string;
}
export interface UpdatesFeed {
  status?: { lastRun: string; ok: boolean; error?: string; found?: number; warnings?: string[] };
  liveUpdated?: string;
  days: { date: string; items: UpdateItem[] }[];
}

/** A week plan (semesters/<id>/plans/<YYYY>-W<NN>.md), parsed by src/plan.ts. */
export interface PlanTask { line: number; text: string; done: boolean }
export type PlanPart = { md: string; task?: undefined } | { task: PlanTask; md?: undefined };
export interface PlanDay { title: string; parts: PlanPart[] }
export interface PlanSection { title: string; parts: PlanPart[]; days: PlanDay[] }
export interface Plan {
  week: string;           // "2026-W42"
  file: string;
  title: string;
  start?: string;         // Monday, YYYY-MM-DD
  end?: string;           // Sunday
  updated?: string;
  intro: PlanPart[];
  sections: PlanSection[];
  done: number;           // ticked tasks
  total: number;
}

/** A quiz the AI made from the course material (semesters/<id>/quizzes/<CODE>/<name>.json, docs/QUIZ_FORMAT.md). */
export type QuizQuestion = { question: string; explanation?: string; source?: string } & (
  | { type: "true-false"; answer: boolean }
  | { type: "single" | "multiple"; options: { text: string; correct: boolean }[] }
);
export interface Quiz {
  id: string;             // "COS511/lecture-03-attention"
  code: string;
  name: string;           // file name without .json
  title: string;
  scope: "course" | "lecture";
  section?: number;       // eClass section of a lecture quiz
  description?: string;
  by?: string;            // the AI that made it
  created?: string;       // ISO datetime
  sources: string[];      // the material it was made from, relative to the semester folder
  questions: QuizQuestion[];
}
/** One finished attempt (semesters/<id>/quizzes/attempts.json, saved by the app; never committed). */
export interface QuizAttempt {
  quiz: string;           // Quiz.id
  title: string;
  at: string;             // ISO datetime
  score: number;          // right answers
  total: number;
  points: number;
  results: boolean[];     // right or wrong, per question
}

export interface SemesterData extends SemesterSummary {
  generated: string;
  updates: UpdatesFeed;
  courses: Course[];
  assignments: Assignment[];
  exams: Exam[];
  dates: ImportantDate[];
  classes: ClassSession[];
  timezone: string;       // of the class times on eClass (semester.json "timezone", default Europe/Nicosia)
  notes: Note[];
  plans: Plan[];          // newest first
  quizzes?: Quiz[];       // missing in data built before quizzes existed
}
