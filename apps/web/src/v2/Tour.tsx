import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SemesterData } from "@ouc/content/types";
import { enc, useRouter } from "../lib/router";
import { TOUR, clampStep, markTourSeen, placeCard, tourSeen } from "./tour-steps";

// which step is open (null = closed), shared by the profile menu (Take the tour) and the tour itself
let current: number | null = null;
const listeners = new Set<() => void>();
const set = (i: number | null) => { current = i; listeners.forEach((l) => l()); };
export const startTour = () => set(0);
const useStep = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);

type Box = { top: number; left: number; width: number; height: number };
/** The first match that is on screen (the nav is there twice: the header on wide screens, the bottom bar on phones). */
function find(sel?: string): HTMLElement | null {
  if (!sel) return null;
  return [...document.querySelectorAll<HTMLElement>(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null;
}

/** The guided tour: dims the page, rings one part of it and explains it, one step at a time. Opens by itself once. */
export function Tour({ data }: { data?: SemesterData | null }) {
  const step = useStep();
  const { path, navigate } = useRouter();
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const s = step === null ? null : TOUR[step];
  const base = data ? `/v2/${enc(data.id)}` : "";

  // the first time the app opens (once its data is there)
  useEffect(() => { if (data && !tourSeen()) startTour(); }, [!!data]);

  // open the step's page
  useEffect(() => {
    if (!s?.page || !base) return;
    const to = base + s.page(data?.courses[0]?.code);
    if (path.split("#")[0] !== to) navigate(to, { raw: true });
  }, [step, base]);

  // follow what the step points at: it can appear after the page opens, and moves on scroll and resize
  useEffect(() => {
    if (!s) return;
    let el: HTMLElement | null = null;
    let tries = 0;
    const measure = () => {
      if (!el?.isConnected) { el = find(s.target); if (el) el.scrollIntoView({ block: "nearest" }); }
      const r = el?.getBoundingClientRect();
      const b = r ? { top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 } : null;
      setBox((o) => (o && b && o.top === b.top && o.left === b.left && o.width === b.width && o.height === b.height ? o : b));
    };
    measure();
    const t = setInterval(() => { if (!el && ++tries > 20) return; measure(); }, 100);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { clearInterval(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step, path]);

  useLayoutEffect(() => {
    if (!card.current) return;
    const r = card.current.getBoundingClientRect();
    setPos(placeCard(box, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [box, step]);

  const close = () => { markTourSeen(); set(null); };
  const go = (d: number) => { if (step === null) return; if (step + d >= TOUR.length) { close(); if (base) navigate(base, { raw: true }); } else set(clampStep(step + d)); };

  useEffect(() => {
    if (step === null) return;
    next.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [step, base]);

  if (!s || step === null) return null;
  const last = step === TOUR.length - 1;
  return (
    <div className="fixed inset-0 z-[60]" data-tour-open>
      {/* the dimmed page; clicks on it do nothing, so a stray click doesn't end the tour */}
      {box
        ? <div aria-hidden className="pointer-events-none fixed rounded-2xl ring-2 ring-accent transition-all duration-300" style={{ ...box, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)" }} />
        : <div aria-hidden className="fixed inset-0 bg-black/55" />}
      <div ref={card} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text"
        className="fixed w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-4 text-sm shadow-2xl transition-[top,left] duration-300"
        style={pos}>
        <div className="mb-1 text-xs text-muted">{step + 1} of {TOUR.length}</div>
        <h2 id="tour-title" className="flex items-center gap-2 font-serif text-lg font-semibold">{s.icon && <s.icon aria-hidden className="size-5 shrink-0 text-accent" />}{s.title}</h2>
        <p id="tour-text" className="mt-1.5 leading-relaxed text-muted">{s.text}</p>
        <div className="mt-4 flex items-center gap-2">
          {!last && <button type="button" onClick={close} className="mr-auto text-muted hover:text-ink">Skip tour</button>}
          {last && <span className="mr-auto" />}
          {step > 0 && <button type="button" onClick={() => go(-1)} className="rounded-full border border-line px-3.5 py-1.5 hover:border-muted">Back</button>}
          <button ref={next} type="button" onClick={() => go(1)} className="rounded-full bg-ink px-4 py-1.5 font-semibold text-bg hover:opacity-90">
            {step === 0 ? "Show me" : last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
