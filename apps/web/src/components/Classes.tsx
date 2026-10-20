import { useState } from "react";
import type { ClassSession, SemesterData } from "@ouc/content/types";
import { saveClassTime } from "../lib/ai";
import { Link, enc } from "../lib/router";
import { courseMap } from "../lib/data";
import { at, fmtDay, fmtTime, relative } from "../lib/dates";
import { AskAiButton } from "./Assistant";
import { Card, CourseBadge, FileLink, cx, isMaterial, kindIcon } from "./ui";
import { INLINE, NotebookPen, Video } from "./icons";

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
      <Video aria-hidden className="size-3.5" /> {live ? "Join now" : "Join"} ↗
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
              <li key={n.noteSlug}><Link to={`${base}/notes/${enc(c.code)}/${enc(n.noteSlug!)}`} className="flex gap-2 rounded px-1 py-0.5 font-semibold hover:bg-surface-2"><NotebookPen aria-hidden className={`${INLINE} mt-0.5`} /> <span className="min-w-0 truncate">My notes: {n.title}</span></Link></li>
            ))}
            {[...c.extras.map((f) => ({ ...f, kind: "file" as const })), ...material].slice(0, 4).map((f, i) => (
              <li key={i}><FileLink href={f.href} className="flex gap-2 rounded px-1 py-0.5 hover:bg-surface-2">
                {kindIcon(f.kind, f.ext)} <span className="min-w-0 truncate">{f.title}</span>
              </FileLink></li>
            ))}
            {material.length + c.extras.length > 4 && (
              <li><Link to={`${base}/courses/${enc(c.code)}#w${week.index}`} className="px-1 text-xs text-muted hover:text-ink">+{material.length + c.extras.length - 4} more in this week →</Link></li>
            )}
            {!notes.length && !material.length && !c.extras.length && <li className="px-1 text-xs text-muted">Nothing posted for this week yet.</li>}
          </ul>
          {!notes.length && week.items.some(isMaterial) && (
            <div className="mt-2"><AskAiButton action="make-notes" params={{ course: c.code, week: String(week.index) }}>Make notes</AskAiButton></div>
          )}
        </div>
      )}
    </Card>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** A weekday + time on this computer → the same moment in the semester's time zone ("Thu", "19:00"). */
export function toZone(day: string, time: string, timeZone: string, now = new Date()): { day: string; time: string } {
  const [h, m] = time.split(":").map(Number);
  const want = (WEEKDAYS.indexOf(day) + 1) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((want - now.getDay() + 7) % 7), h, m);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
  return { day: parts.weekday, time: `${parts.hour}:${parts.minute}` };
}

/** "Wrong time? Fix it": the student corrects the weekly class time (saved in semester.json). */
export function ClassTimeEditor({ data, code, current, source }: { data: SemesterData; code: string; current?: ClassSession; source?: string }) {
  const start = current ? at(current.at) : undefined;
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(start ? WEEKDAYS[(start.getDay() + 6) % 7] : "Mon");
  const [time, setTime] = useState(start ? `${pad2(start.getHours())}:${pad2(start.getMinutes())}` : "18:00");
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setMsg(undefined);
    const err = await saveClassTime(data.id, code, { ...toZone(day, time, data.timezone ?? "Europe/Nicosia"), group: current?.group });
    setBusy(false);
    if (err) setMsg(err); else { setOpen(false); setMsg("Saved. The classes update in a moment."); }
  };
  return (
    <div className="mt-1.5 px-1 text-[11px] leading-snug text-muted">
      {source && <span>Time from {source} · </span>}
      {!open && <button className="underline hover:text-ink" onClick={() => setOpen(true)}>{current ? "Wrong time? Fix it" : "Add the class time"}</button>}
      {open && (
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink">
          <select value={day} onChange={(e) => setDay(e.target.value)} className="rounded-md border border-line bg-surface px-1.5 py-1">
            {WEEKDAYS.map((d) => <option key={d}>{d}</option>)}
          </select>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-md border border-line bg-surface px-1.5 py-1" />
          <button disabled={busy} onClick={save} className="rounded-full bg-ink px-3 py-1 font-semibold text-bg disabled:opacity-50">Save</button>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">Cancel</button>
          <span className="basis-full text-[11px] text-muted">Your own time, as in your calendar. Every week from now on{current?.group ? `, for group ${current.group}` : ""}.</span>
        </span>
      )}
      {msg && <span className="block text-[11px]">{msg}</span>}
    </div>
  );
}
