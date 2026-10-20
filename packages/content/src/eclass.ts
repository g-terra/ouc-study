// The files under semesters/<id>/ that `ouc setup` and the eClass sync write and the content build reads.

/** One course in semester.json. */
export interface CourseConfig {
  code: string;
  title: string;
  short: string;
  color: string;
  eclassId?: number;
  dir: string;                               // folder under courses/
  dating: { mode: "title" } | { mode: "weekly"; first: string; pattern: string };
  label?: "firstResource" | "stripWeek" | "lecture" | "name";
  language?: string;                         // spoken in its recordings ("en", "el", "auto"), for transcripts
}
/** semesters/<id>/semester.json */
export interface SemesterConfig {
  id?: string;
  label: string;
  start: string;
  end: string;
  courses: CourseConfig[];
}

/** An activity in a course section of _meta/eclass-meta.json. */
export interface MetaActivity {
  type: string;            // Moodle module name: resource, folder, url, page, assign, forum…
  name: string;
  url: string;
  desc: string;
  file?: string;           // resources: the main file's name, size and type
  ctype?: string;
  size?: number;
  fileurl?: string;
  local?: string;          // "<CODE>/<NN>/<path in the section folder>" (page: the video on it)
  target?: string;         // url: where it points
  transcript?: string;     // url to a Panopto recording: where its transcript goes (same form as local)
  links?: string[];        // page: the links on it
  body?: string;
  dates?: string[];        // assign: "Opened: …", "Due: …"
  onlineText?: string;
  folder?: string;         // assign: assignments/<CODE>/<MM-DD>_<name>
  due?: number;            // assign: unix seconds
  kept?: boolean;          // kept from an earlier import that the API no longer lists
}
export interface MetaSection { i: number; name: string; summary: string; acts: MetaActivity[] }
/** One course of _meta/eclass-meta.json (the course structure). */
export interface MetaCourse { id: string; code: string; title: string; source?: "api"; secs: MetaSection[] }
/** One assignment of _meta/submissions.json: your submission status as rows of label → value. */
export interface SubmissionRecord { code: string; name: string; url: string; rows: Record<string, string>; source?: "api" }
