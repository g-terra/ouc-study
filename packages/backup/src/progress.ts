/**
 * A running backup's progress (no Node imports: the app's Settings page uses it too). Each step counts
 * on its own: compressing class videos, saving the files that changed, then uploading (git's push).
 * Time left is a guess from how fast the current step has gone so far.
 */
export interface BackupProgress {
  step: "compressing" | "saving" | "uploading";
  /** files (or percent, for uploading) done out of `total` */
  done: number;
  total: number;
  /** the same in bytes, when known (0 otherwise) */
  bytesDone: number;
  bytesTotal: number;
  /** when this step started (ISO) */
  startedAt: string;
}

const STEP = { compressing: "Making smaller copies of class videos", saving: "Saving files", uploading: "Uploading to the backup" };

/** Seconds left in this step, or null while it's too early to tell. */
export function timeLeft(p: BackupProgress, now = new Date()): number | null {
  const elapsed = (now.getTime() - Date.parse(p.startedAt)) / 1000;
  const part = p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : p.total > 0 ? p.done / p.total : 0;
  if (elapsed < 5 || part < 0.03) return null;
  return Math.max(0, Math.round((elapsed * (1 - part)) / part));
}

export function formatLeft(s: number): string {
  if (s < 60) return "less than a minute left";
  const min = Math.round(s / 60);
  if (min < 60) return `about ${min} min left`;
  const h = Math.floor(min / 60);
  return `about ${h} h${min % 60 ? ` ${min % 60} min` : ""} left`;
}

/** "Saving files: 120 of 340 · about 2 min left" */
export function progressText(p: BackupProgress, now = new Date()): string {
  const count = p.step === "uploading" ? `${Math.round((p.done / Math.max(1, p.total)) * 100)}%` : `${p.done.toLocaleString("en-GB")} of ${p.total.toLocaleString("en-GB")}`;
  const left = timeLeft(p, now);
  return `${STEP[p.step]}: ${count} · ${left === null ? "working out how long it takes…" : formatLeft(left)}`;
}
