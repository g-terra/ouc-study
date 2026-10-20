import { useState, type FormEvent } from "react";
import type { ImportantDate, SemesterData } from "@ouc/content/types";
import { at, fmtWhen, relative } from "../lib/dates";
import { removeImportantDate, saveImportantDate, type DateInput } from "../lib/important-dates";
import { AskAiButton } from "../components/Assistant";
import { Card, Empty, cx } from "../components/ui";
import { CalendarDays, GraduationCap, Trash2 } from "../components/icons";

const FIELD = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm";
const blank = (code: string): DateInput => ({ code, title: "", kind: "exam", date: "", time: "", topics: "" });
const toInput = (d: ImportantDate): DateInput => ({ id: d.id, code: d.code, title: d.title, kind: d.kind, date: d.at.slice(0, 10), time: d.noTime ? "" : d.at.slice(11, 16), topics: d.topics ?? "" });

/** The form for one date: title, exam or other, day, optional time and what it covers. */
function DateForm({ sem, start, onDone }: { sem: string; start: DateInput; onDone: () => void }) {
  const [d, setD] = useState(start);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const set = (k: keyof DateInput) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await saveImportantDate(sem, d); onDone(); } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  return (
    <form aria-label="Important date" onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm sm:col-span-2">Title<input value={d.title} onChange={set("title")} placeholder="Final exam" className={FIELD} /></label>
      <label className="grid gap-1 text-sm">Kind
        <select value={d.kind} onChange={set("kind")} className={FIELD}><option value="exam">Exam</option><option value="other">Other</option></select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-sm">Date<input type="date" value={d.date} onChange={set("date")} className={FIELD} /></label>
        <label className="grid gap-1 text-sm">Time<input type="time" value={d.time} onChange={set("time")} className={FIELD} /></label>
      </div>
      <label className="grid gap-1 text-sm sm:col-span-2">Topics<textarea value={d.topics} onChange={set("topics")} rows={2} placeholder="What it covers (optional)" className={FIELD} /></label>
      {error && <p role="alert" className="text-sm text-bad sm:col-span-2">{error}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onDone} className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-ink">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-bg disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

/** A course's Dates tab: exams and other important dates the student keeps, each one editable and removable. */
export function DatesTab({ data, code }: { data: SemesterData; code: string }) {
  const now = new Date();
  const dates = (data.dates ?? []).filter((d) => d.code === code);
  const [editing, setEditing] = useState<DateInput>();
  const remove = async (d: ImportantDate) => {
    if (!window.confirm(`Remove “${d.title}”?`)) return;
    try { await removeImportantDate(data.id, d.id); } catch (e) { window.alert((e as Error).message); }
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <AskAiButton action="important-dates" params={{ course: code }}>Ask AI</AskAiButton>
        <button type="button" onClick={() => setEditing(blank(code))} className="rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-bg">Add a date</button>
      </div>
      {editing && !editing.id && <Card className="mb-3"><DateForm key="new" sem={data.id} start={editing} onDone={() => setEditing(undefined)} /></Card>}
      {dates.length ? (
        <Card className="p-2">
          <ul className="grid gap-0.5">
            {dates.map((d) => editing?.id === d.id ? (
              <li key={d.id} className="rounded-xl bg-surface-2"><DateForm sem={data.id} start={editing} onDone={() => setEditing(undefined)} /></li>
            ) : (
              <li key={d.id} className={cx("flex items-start gap-3 rounded-xl px-3 py-2.5", at(d.at) < now && "text-muted")}>
                {d.kind === "exam" ? <GraduationCap aria-hidden className="mt-0.5 size-4 shrink-0" /> : <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{d.title}</span>
                  <span className="block text-xs text-muted">{d.kind === "exam" ? "Exam" : "Date"} · {fmtWhen(at(d.at), d.noTime)}{at(d.at) >= now && ` · ${relative(at(d.at), now)}`}</span>
                  {d.topics && <span className="mt-1 block whitespace-pre-line text-sm">{d.topics}</span>}
                </span>
                <button type="button" onClick={() => setEditing(toInput(d))} aria-label={`Edit ${d.title}`} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-ink">Edit</button>
                <button type="button" onClick={() => remove(d)} aria-label={`Remove ${d.title}`} className="rounded-full p-1.5 text-muted hover:text-bad"><Trash2 aria-hidden className="size-4" /></button>
              </li>
            ))}
          </ul>
        </Card>
      ) : !editing && <Empty>No dates yet. Add exams and other important dates as the course announces them.</Empty>}
    </>
  );
}
