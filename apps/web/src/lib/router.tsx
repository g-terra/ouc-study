/**
 * Tiny history-based router (no dependency). Routes are patterns like "/:sem/courses/:code".
 */
import { createContext, useContext, useEffect, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

type Params = Record<string, string>;
type Navigate = (to: string, opts?: { raw?: boolean; replace?: boolean }) => void;
const RouterCtx = createContext<{ path: string; navigate: Navigate }>({ path: "/", navigate: () => {} });

// Maps a link before it opens (the v2 preview keeps classic links inside v2, see v2/paths.ts); raw skips it.
let rewrite = (to: string) => to;
export function setLinkRewrite(fn: (to: string) => string) { rewrite = fn; }

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname + window.location.hash);
  const navigateRef = useRef((_to: string) => {});
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname + window.location.hash);
    window.addEventListener("popstate", onPop);
    // links that Markdown turned from file paths into app pages (lib/links.ts) open here, without a reload
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[data-internal]");
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigateRef.current(a.getAttribute("href")!);
    };
    document.addEventListener("click", onClick);
    return () => { window.removeEventListener("popstate", onPop); document.removeEventListener("click", onClick); };
  }, []);
  const navigate: Navigate = (target, opts) => {
    const to = opts?.raw ? target : rewrite(target);
    if (to === window.location.pathname + window.location.hash) return;
    // replace: same page, a new address (no history entry, no scroll)
    if (opts?.replace) { window.history.replaceState({}, "", to); setPath(to); return; }
    window.history.pushState({}, "", to);
    setPath(to);
    if (!to.includes("#")) window.scrollTo({ top: 0 });
  };
  navigateRef.current = navigate;
  return <RouterCtx.Provider value={{ path, navigate }}>{children}</RouterCtx.Provider>;
}

export const useRouter = () => useContext(RouterCtx);

export function matchPath(pattern: string, path: string): Params | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("#")[0].split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Routes({ routes, fallback }: { routes: [string, (p: Params) => ReactNode][]; fallback: ReactNode }) {
  const { path } = useRouter();
  for (const [pattern, render] of routes) {
    const m = matchPath(pattern, path);
    if (m) return <>{render(m)}</>;
  }
  return <>{fallback}</>;
}

export function Link({ to, children, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || rest.target === "_blank") return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export const enc = encodeURIComponent;
