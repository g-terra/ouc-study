import { useSyncExternalStore } from "react";

/** Colour themes. The colours live in index.css under [data-theme="<id>"]; index.html applies the saved one before the first paint. */
export const THEMES = [
  { id: "light", label: "Light", mode: "light", swatch: ["#f6f4ef", "#1c1b19", "#c2410c"] },
  { id: "dark", label: "Dark", mode: "dark", swatch: ["#131312", "#ecebe6", "#fb923c"] },
  { id: "paper", label: "Paper", mode: "light", swatch: ["#f3ead6", "#3b2f20", "#9a3412"] },
  { id: "midnight", label: "Midnight", mode: "dark", swatch: ["#0b1020", "#e3e8f4", "#a78bfa"] },
  { id: "forest", label: "Forest", mode: "dark", swatch: ["#0f1712", "#e4ece4", "#e9b949"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
/** What the student picked: a theme, or "system" to follow the computer's light/dark setting. */
export type ThemeChoice = ThemeId | "system";

const KEY = "ouc-theme";
const media = () => window.matchMedia?.("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch { /* private mode */ }
  return "system";
}

let choice: ThemeChoice = read();

export const resolveTheme = (c: ThemeChoice): ThemeId => (c === "system" ? (media()?.matches ? "dark" : "light") : c);
export const themeMode = (id: ThemeId) => THEMES.find((t) => t.id === id)?.mode ?? "light";

function apply() {
  const id = resolveTheme(choice);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.dataset.mode = themeMode(id);
  listeners.forEach((l) => l());
}

export function setTheme(c: ThemeChoice) {
  choice = c;
  try { c === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, c); } catch { /* private mode */ }
  apply();
}

media()?.addEventListener?.("change", () => choice === "system" && apply());
// another tab changed it
window.addEventListener("storage", (e) => { if (e.key === KEY) { choice = read(); apply(); } });
apply();

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => `${choice}|${resolveTheme(choice)}`;

/** The current choice and the theme it resolves to; re-renders when either changes. */
export function useTheme() {
  const [c, id] = useSyncExternalStore(subscribe, snapshot).split("|") as [ThemeChoice, ThemeId];
  return { choice: c, theme: id, mode: themeMode(id) };
}
