/** "Update available": a newer release of the app on GitHub (checked by /api/update, at most once a day). */
import { useEffect, useState } from "react";

export interface UpdateInfo {
  current?: string; latest?: string | null; available?: boolean; notes?: string; url?: string;
  canUpdate?: boolean; updating?: boolean; error?: string;
}
export type UpdatePhase = "idle" | "updating" | "slow" | "failed";

/** The bullet lines of release-please notes, as plain text (no links or markup). */
export function releaseHighlights(notes = "", max = 6): string[] {
  return notes.split(/\r?\n/).filter((l) => /^\s*[*-]\s+/.test(l))
    .map((l) => l.replace(/^\s*[*-]\s+/, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s*\(\s*[0-9a-f]{7,}\s*\)\s*$/, "").replace(/\s*\(#\d+\)\s*/g, " ").replace(/[*_`]/g, "").trim())
    .filter(Boolean).slice(0, max);
}

export function useUpdate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/update").then((r) => (r.ok ? r.json() : null)).then((j) => alive && setInfo(j)).catch(() => {});
    load();
    const t = setInterval(load, 6 * 60 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function start() {
    const from = info?.current;
    setPhase("updating");
    const r = await fetch("/api/update", { method: "POST" }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { setPhase("failed"); setInfo((i) => ({ ...i, error: r.error ?? "Couldn't start the update." })); return; }
    // the app stops, updates and starts again: wait until it answers with a new version, then reload
    const began = Date.now();
    const poll = async () => {
      const j = await fetch("/api/update").then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (j && j.current && j.current !== from && !j.updating) { window.location.reload(); return; }
      if (Date.now() - began > 5 * 60_000) setPhase("slow");
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 5000);
  }
  return { info, phase, start };
}
