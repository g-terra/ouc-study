import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "../lib/theme";

let ready: Promise<typeof import("mermaid")["default"]> | null = null;
const loadMermaid = () => (ready ??= import("mermaid").then(({ default: m }) => m));

/** Diagram colours taken from the current theme's tokens (index.css). */
function themeConfig() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const dark = document.documentElement.dataset.mode === "dark";
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: "base" as const,
    darkMode: dark,
    fontFamily: "ui-sans-serif, -apple-system, system-ui, sans-serif",
    flowchart: { curve: "basis" as const, htmlLabels: true, padding: 12 },
    themeVariables: {
      darkMode: dark,
      background: v("--surface"),
      primaryColor: v("--surface-2"),
      primaryTextColor: v("--ink"),
      primaryBorderColor: v("--muted"),
      secondaryColor: v("--info-bg"),
      tertiaryColor: v("--warn-bg"),
      lineColor: v("--muted"),
      textColor: v("--ink"),
      mainBkg: v("--surface-2"),
      nodeBorder: v("--muted"),
      clusterBkg: v("--bg"),
      clusterBorder: v("--line"),
      edgeLabelBackground: v("--surface"),
      noteBkgColor: v("--warn-bg"),
      noteTextColor: v("--ink"),
      fontSize: "15px",
    },
  };
}

export function Mermaid({ code }: { code: string }) {
  const id = "m" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string>();
  const { theme } = useTheme();
  useEffect(() => {
    let alive = true;
    loadMermaid()
      .then((m) => { m.initialize(themeConfig()); return m.render(id, code); })
      .then(({ svg }) => { if (alive && ref.current) ref.current.innerHTML = svg; })
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => { alive = false; };
  }, [code, id, theme]);
  return (
    <figure className="my-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
      {err ? <pre className="overflow-auto text-xs text-bad">Diagram error: {err}</pre> : <div ref={ref} className="mermaid-box grid place-items-center" data-diagram />}
    </figure>
  );
}
