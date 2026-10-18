import type { ClassSession, SemesterData } from "@ouc/content/types";
import { Link, enc } from "../lib/router";
import { courseMap } from "../lib/data";
import { at, fmtDay, fmtTime, relative } from "../lib/dates";
import { AskAiButton } from "./Assistant";
import { Card, CourseBadge, cx, kindIcon } from "./ui";

/** Classes still to come (or running now), oldest first. */
export function upcomingClasses(data: SemesterData, now = new Date()): ClassSession[] {
  return (data.classes ?? []).filter((c) => new Date(c.end) >= now);
}
/** The next class of each course. */
export function nextClassPerCourse(data: SemesterData, now = new Date()): ClassSession[] {
  const seen = new Set<string>();
  return upcomingClasses(data, now).filter((c) => c.status !== "cancelled" && !seen.has(c.code) && (seen.add(c.code), true));
}
export const isLive = (c: ClassSession, now = new Date()) => c.status !== "cancelled" && at(c.at) <= now && now <= new Date(c.end);

export function JoinButton({ c, now = new Date(), className }: { c: ClassSession; now?: Date; className?: string }) {
  if (!c.joinUrl || c.status === "cancelled") return null;
  const live = isLive(c, now);
  const soon = !live && at(c.at).getTime() - now.getTime() < 15 * 60_000;
  return (
    <a href={c.joinUrl} target="_blank" rel="noreferrer" title="Opens the course's Webconference on eClass"
      className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition",
        live || soon ? "bg-accent text-bg" : "border border-line bg-surface hover:border-muted", className)}>
      🎥 {live ? "Join now" : "Join"} ↗
    </a>
  );
}

const when = (c: ClassSession) => `${fmtDay(at(c.at))}, ${fmtTime(at(c.at))}`;

/** One class with what to look at before it: the week's notes, slides and readings, and any agenda. */
export function ClassCard({ c, data, now = new Date(), showCourse = true }: { c: ClassSession; data: SemesterData; now?: Date; showCourse?: boolean }) {
  const base = `/${enc(data.id)}`;
  const course = courseMap(data)[c.code];
  const week = course?.weeks.find((w) => w.index === c.weekIndex);
  const notes = week?.items.filter((i) => i.kind === "note") ?? [];
  const material = week?.items.filter((i) => i.kind === "file" || i.kind === "video") ?? [];
  const live = isLive(c, now);
  const cancelled = c.status === "cancelled";
  return (
    <Card className={cx("relative overflow-hidden p-4", live && "border-accent", cancelled && "opacity-60")}>
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: course?.color }} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {showCourse && <CourseBadge course={course} />}
            <span className={cx(cancelled && "line-through")}>{when(c)}</span>
            <span>· {live ? <b className="text-accent">live now</b> : cancelled ? "cancelled" : relative(at(c.at), now)}</span>
            {c.group && <span>· group {c.group}</span>}
          </div>
          <div className="mt-1 font-semibold leading-snug">
            {week ? <Link to={`${base}/courses/${enc(c.code)}#w${week.index}`} className="hover:underline">{week.label}</Link> : "Live class"}
          </div>
          {(c.status === "moved" || c.status === "extra" || c.note) && (
            <div className="mt-0.5 text-xs text-warn">
              {c.status === "moved" && c.movedFrom ? `Moved from ${when({ ...c, at: c.movedFrom })}` : c.status === "extra" ? "Extra class" : ""}
              {c.note && `${c.status === "moved" || c.status === "extra" ? " · " : ""}${c.note}`}
            </div>
          )}
        </div>
        <JoinButton c={c} now={now} />
      </div>
      {!cancelled && week && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Before class</div>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5 text-sm">
            {notes.map((n) => (
              <li key={n.noteSlug}><Link to={`${base}/notes/${enc(c.code)}/${enc(n.noteSlug!)}`} className="flex gap-2 rounded px-1 py-0.5 font-semibold hover:bg-surface-2">📒 <span className="min-w-0 truncate">My notes: {n.title}</span></Link></li>
            ))}
            {[...c.extras.map((f) => ({ ...f, kind: "file" as const })), ...material].slice(0, 4).map((f, i) => (
              <li key={i}><a href={f.href} target="_blank" rel="noreferrer" className="flex gap-2 rounded px-1 py-0.5 hover:bg-surface-2">
                {kindIcon(f.kind, f.ext)} <span className="min-w-0 truncate">{f.title}</span>
              </a></li>
            ))}
            {material.length + c.extras.length > 4 && (
              <li><Link to={`${base}/courses/${enc(c.code)}#w${week.index}`} className="px-1 text-xs text-muted hover:text-ink">+{material.length + c.extras.length - 4} more in this week →</Link></li>
            )}
            {!notes.length && !material.length && !c.extras.length && <li className="px-1 text-xs text-muted">Nothing posted for this week yet.</li>}
          </ul>
          {!notes.length && week.items.some((i) => i.kind === "file") && (
            <div className="mt-2"><AskAiButton action="make-notes" params={{ course: c.code, week: String(week.index) }}>Make notes</AskAiButton></div>
          )}
        </div>
      )}
    </Card>
  );
}
