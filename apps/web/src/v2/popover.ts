import { useEffect, useRef, useState } from "react";

/** A header pop-up (the bell, the profile menu): open/close, and it closes on a click outside or Escape. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return { open, setOpen, box };
}

/** The pop-up panel under a header button. */
export const PANEL = "absolute right-0 top-full z-50 mt-2 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-3 text-sm shadow-xl";
