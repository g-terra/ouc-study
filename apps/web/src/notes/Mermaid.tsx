import { useEffect, useId, useRef, useState } from "react";

let ready: Promise<typeof import("mermaid")["default"]> | null = null;
function loadMermaid() {
  if (!ready) {
    ready = import("mermaid").then(({ default: m }) => {
      const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      m.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "neutral",
        fontFamily: "ui-sans-serif, -apple-system, system-ui, sans-serif",
        flowchart: { curve: "basis", htmlLabels: true, padding: 12 },
        themeVariables: dark ? {} : { primaryColor: "#f1eee7", primaryBorderColor: "#c9c3b6", lineColor: "#8a857b", fontSize: "15px" },
      });
      return m;
    });
  }
  return ready;
}

export function Mermaid({ code }: { code: string }) {
  const id = "m" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    let alive = true;
    loadMermaid()
      .then((m) => m.render(id, code))
      .then(({ svg }) => { if (alive && ref.current) ref.current.innerHTML = svg; })
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => { alive = false; };
  }, [code, id]);
  return (
    <figure className="my-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
      {err ? <pre className="overflow-auto text-xs text-bad">Diagram error: {err}</pre> : <div ref={ref} className="mermaid-box grid place-items-center" data-diagram />}
    </figure>
  );
}
