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

/** A live class (webconference); time read from eClass or semester.json "classes", see packages/content/src/classes.mjs. */
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

export interface Exam {
  code: string;
  kind: string;           // "Final exam" | "Repeat exam"
  at: string;             // ISO local datetime
  noTime?: boolean;
  source?: string;        // href to timetable
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

/** A week plan (semesters/<id>/plans/<YYYY>-W<NN>.md), parsed by src/plan.mjs. */
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

export interface SemesterData extends SemesterSummary {
  generated: string;
  updates: UpdatesFeed;
  courses: Course[];
  assignments: Assignment[];
  exams: Exam[];
  classes: ClassSession[];
  notes: Note[];
  plans: Plan[];          // newest first
}
