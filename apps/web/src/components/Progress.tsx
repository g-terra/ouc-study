import type { Week, WeekItem } from "@ouc/content/types";
import { itemKey, type Count } from "@ouc/content/progress";
import { markDone, useProgress } from "../lib/progress";
import { cx } from "./ui";
import { Check } from "./icons";

const HOW: Record<string, string> = { watched: "played to the end", viewed: "looked through to the last slide", ticked: "ticked" };

/** The tick box next to a video, file or link of a week. Hidden when there's no app server to save it (a static build). */
export function DoneBox({ sem, code, w, it }: { sem: string; code: string; w: Pick<Week, "index">; it: WeekItem }) {
  const { state, done } = useProgress(sem);
  if (state === "unavailable") return null;
  const entry = done[itemKey(code, w.index, it)];
  const verb = it.kind === "video" ? "watched" : "read";
  return (
    <button type="button" role="checkbox" aria-checked={Boolean(entry)} aria-label={`${entry ? "Done" : "Not done"}: ${it.title}`}
      title={entry ? `Done ${new Date(entry.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} (${HOW[entry.how ?? "ticked"]}). Click to untick.` : `Tick when you've ${verb} it`}
      onClick={() => markDone(sem, code, w, it, !entry)}
      className={cx("mt-1.5 grid size-4 shrink-0 place-items-center rounded border transition", entry ? "border-ok bg-ok text-white" : "border-muted/60 hover:border-ink")}>
      {entry && <Check aria-hidden className="size-3" strokeWidth={3} />}
    </button>
  );
}

/** "3/5" done, green with a tick once everything is. */
export function DoneCount({ count, className, long = false }: { count: Count; className?: string; long?: boolean }) {
  if (!count.total) return null;
  const all = count.done === count.total;
  return (
    <span className={cx("inline-flex items-center gap-0.5 tabular-nums", all ? "font-semibold text-ok" : "text-muted", className)} title={`${count.done} of ${count.total} watched or read`} data-testid="done-count">
      <Check aria-hidden className="size-3.5" />{long ? `${count.done} of ${count.total} done` : `${count.done}/${count.total}`}
    </span>
  );
}
