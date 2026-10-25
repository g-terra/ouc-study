/**
 * Homework drafts: every change to an answer box is kept in the browser at once (localStorage), and dropped
 * when the app server has saved it. If the page crashes or the server is down, the draft comes back on reload.
 */

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const draftKey = (sem: string, assignment: string, task: string, field: "text" | "why") =>
  `ouc-homework-draft|${sem}|${assignment}|${task}|${field}`;

/** Keeps what was just typed. */
export function keepDraft(s: Store | undefined, key: string, html: string): void {
  try { s?.setItem(key, html); } catch {}
}

/** The server saved `html`: drop the draft, unless something newer was typed since. */
export function clearDraft(s: Store | undefined, key: string, html: string): void {
  try { if (s?.getItem(key) === html) s.removeItem(key); } catch {}
}

/** A draft the server doesn't have yet (to put back in the box and save), or null. */
export function restoreDraft(s: Store | undefined, key: string, saved: string | undefined): string | null {
  try {
    const d = s?.getItem(key);
    if (d == null) return null;
    if (d === (saved ?? "")) { s!.removeItem(key); return null; }
    return d;
  } catch { return null; }
}

/** The browser's storage, or undefined where it's blocked. */
export const browserStore = (): Store | undefined => { try { return window.localStorage; } catch { return undefined; } };
