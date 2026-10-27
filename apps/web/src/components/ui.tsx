import type { ReactNode, CSSProperties } from "react";
import { Link } from "../lib/router";
import { pdfPage, slidesPage, videoPage } from "../lib/links";
import type { Course, FileRef, ItemKind, WeekItem } from "@ouc/content/types";
import { STATE_LABEL, type State } from "../lib/data";
import { KindIcon } from "./icons";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function CourseBadge({ course, size = "sm" }: { course?: Pick<Course, "short" | "color">; size?: "sm" | "md" }) {
  if (!course) return null;
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 rounded-full font-semibold text-white whitespace-nowrap", size === "sm" ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs")}
      style={{ background: course.color }}
    >
      {course.short}
    </span>
  );
}

export function CourseDot({ color, className }: { color: string; className?: string }) {
  return <span className={cx("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

const STATE_STYLE: Record<State, string> = {
  done: "bg-ok-bg text-ok",
  late: "bg-bad-bg text-bad",
  soon: "bg-warn-bg text-warn ring-1 ring-warn/40",
  todo: "bg-surface-2 text-muted",
};
/** An assignment's state; once it has a grade, "Graded 7.5" instead. */
export function StatePill({ state, grade }: { state: State; grade?: string }) {
  return <span className={cx("rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", STATE_STYLE[grade ? "done" : state])}>{grade ? `Graded ${grade}` : STATE_LABEL[state]}</span>;
}

export function Card({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={cx("rounded-2xl border border-line bg-surface", className)} style={style}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-10 flex items-end justify-between gap-4 first:mt-0">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8">
      {eyebrow && <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted">{eyebrow}</div>}
      <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h1>
      {children && <div className="mt-3 text-muted">{children}</div>}
    </header>
  );
}

export function ProgressRing({ value, color, size = 56, label }: { value: number; color: string; size?: number; label?: string }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={label}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${c * Math.min(1, value)} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" className="fill-ink text-[12px] font-semibold">{label}</text>
    </svg>
  );
}

/** Course material that is on this computer: files and downloaded videos (what notes and quizzes are made from). */
export const isMaterial = (i: WeekItem) => i.kind === "file" || (i.kind === "video" && !i.external);
export const kindIcon = (k: ItemKind, ext?: string) => <KindIcon kind={k} ext={ext} />;

/** The app page that shows a file in place (a PDF, slides, a video), or null when it opens in a new tab. */
export const viewerPage = (href?: string) => pdfPage(href) ?? slidesPage(href) ?? videoPage(href);

/** A link to a course file: PDFs, slides and videos open in the app's viewers, anything else in a new tab. */
export function FileLink({ href, className, title, children }: { href?: string; className?: string; title?: string; children: ReactNode }) {
  const page = viewerPage(href);
  return page ? <Link to={page} className={className} title={title}>{children}</Link>
    : <a href={href} target="_blank" rel="noreferrer" className={className} title={title}>{children}</a>;
}

export function FileCard({ file, label }: { file: FileRef; label: string }) {
  return (
    <FileLink href={file.href} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition hover:border-muted">
      <KindIcon kind="file" ext={file.ext} className="size-7" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{file.name}</span>
        <span className="text-xs text-muted">{label} · {file.ext.toUpperCase()} · {viewerPage(file.href) ? "opens in the app" : "opens in a new tab"}</span>
      </span>
    </FileLink>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>;
}

/** An on/off setting: a sliding switch (a button with role="switch"; Space and Enter flip it), in the theme's accent colour. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-line bg-surface-2")}>
      <span aria-hidden className={cx("inline-block size-[18px] rounded-full shadow transition-transform", checked ? "translate-x-[21px] bg-bg" : "translate-x-[2px] bg-muted")} />
    </button>
  );
}
