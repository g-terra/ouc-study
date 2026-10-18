/**
 * Tiny history-based router (no dependency). Routes are patterns like "/:sem/courses/:code".
 */
import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

type Params = Record<string, string>;
const RouterCtx = createContext<{ path: string; navigate: (to: string) => void }>({ path: "/", navigate: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname + window.location.hash);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname + window.location.hash);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to: string) => {
    if (to === window.location.pathname + window.location.hash) return;
    window.history.pushState({}, "", to);
    setPath(to);
    if (!to.includes("#")) window.scrollTo({ top: 0 });
  };
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
