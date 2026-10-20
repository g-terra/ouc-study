import { Fragment, useState } from "react";
import katex from "katex";
import { mdInline, mdToHtml } from "../lib/markdown";
import { cx } from "../components/ui";

const Html = ({ html, className }: { html: string; className?: string }) => <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
const Inline = ({ text, className }: { text: unknown; className?: string }) => <span className={cx("md-inline", className)} dangerouslySetInnerHTML={{ __html: mdInline(String(text ?? "")) }} />;
const tex = (s: string, display = true) => katex.renderToString(s, { displayMode: display, throwOnError: false, strict: false });
const asList = (d: any): any[] => (Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : []);

// ---------- callouts ----------
const CALLOUT: Record<string, { icon: string; label: string; cls: string }> = {
  IDEA: { icon: "💡", label: "Big idea", cls: "border-amber-300/70 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" },
  KEY: { icon: "🔑", label: "Key point", cls: "border-violet-300/70 bg-violet-50 dark:border-violet-500/40 dark:bg-violet-500/10" },
  TIP: { icon: "✅", label: "Tip", cls: "border-emerald-300/70 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10" },
  WARN: { icon: "⚠️", label: "Watch out", cls: "border-rose-300/70 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10" },
  EXAM: { icon: "🎯", label: "Assignment & exam angle", cls: "border-sky-300/70 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-500/10" },
  ANALOGY: { icon: "🧠", label: "Think of it like", cls: "border-orange-300/70 bg-orange-50 dark:border-orange-500/40 dark:bg-orange-500/10" },
  LINK: { icon: "🔗", label: "Connects to", cls: "border-slate-300/70 bg-slate-50 dark:border-slate-500/40 dark:bg-slate-500/10" },
};
export function Callout({ kind, title, text }: { kind: string; title: string; text: string }) {
  const c = CALLOUT[kind] ?? CALLOUT.KEY;
  return (
    <aside className={cx("my-5 rounded-2xl border p-4 sm:p-5", c.cls)}>
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <span className="text-lg">{c.icon}</span>
        <span>{title || c.label}</span>
      </div>
      <Html html={mdToHtml(text)} className="md [&>p:first-child]:mt-1 [&>p:last-child]:mb-0" />
    </aside>
  );
}

// ---------- cards ----------
function Cards({ data }: { data: any }) {
  const items = asList(data);
  return (
    <div className={cx("my-6 grid gap-3", items.length >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
      {items.map((c, i) => (
        <div key={i} className="rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_0_var(--line)]">
          <div className="mb-2 flex items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-lg">{c.icon ?? "•"}</span>
            <Inline text={c.title} className="font-semibold leading-snug" />
          </div>
          <Html html={mdToHtml(String(c.text ?? ""))} className="md text-[14.5px] leading-6 [&>p]:my-1.5" />
        </div>
      ))}
    </div>
  );
}

// ---------- formula ----------
function Formula({ data }: { data: any }) {
  const list = Array.isArray(data) ? data : [data];
  return (
    <div className="my-6 grid gap-3">
      {list.map((f, i) => {
        const where: [string, string][] = (f.where ?? []).map((w: any) => (Array.isArray(w) ? w : [w.sym, w.desc]));
        return (
          <div key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
            {f.title && <div className="border-b border-line bg-surface-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">∑ {f.title}</div>}
            <div className="px-4 py-3 text-lg" dangerouslySetInnerHTML={{ __html: tex(String(f.tex ?? "")) }} />
            {where.length > 0 && (
              // one row per symbol: the symbols share one column as wide as the widest, so every meaning starts at the same place
              <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 border-t border-line px-4 py-3 text-sm" data-testid="formula-where">
                {where.map(([s, d], j) => (
                  <Fragment key={j}>
                    <dt dangerouslySetInnerHTML={{ __html: tex(String(s), false) }} />
                    <dd className="text-muted"><Inline text={d} /></dd>
                  </Fragment>
                ))}
              </dl>
            )}
            {f.note && <div className="border-t border-line px-4 py-2.5 text-sm text-muted"><Inline text={f.note} /></div>}
          </div>
        );
      })}
    </div>
  );
}

// ---------- compare ----------
function Compare({ data }: { data: any }) {
  const headers: string[] = data?.headers ?? [];
  const rows: any[][] = data?.rows ?? [];
  return (
    <figure className="my-6">
      {data?.title && <figcaption className="mb-2 text-sm font-semibold">{data.title}</figcaption>}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full border-collapse text-[14px]">
          {headers.length > 0 && (
            <thead>
              <tr className="bg-surface-2">
                {headers.map((h, i) => <th key={i} className="border-b border-line px-4 py-2.5 text-left font-semibold"><Inline text={h} /></th>)}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {r.map((c, j) => <td key={j} className={cx("px-4 py-2.5 align-top leading-6", j === 0 && "font-semibold")}><Inline text={c} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

// ---------- steps ----------
function Steps({ data }: { data: any }) {
  const steps = asList(data);
  return (
    <figure className="my-6">
      {data?.title && <figcaption className="mb-3 text-sm font-semibold">{data.title}</figcaption>}
      <ol className="relative grid gap-3">
        {steps.map((s, i) => (
          <li key={i} className="relative flex gap-3">
            <div className="flex flex-col items-center">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-bg">{i + 1}</span>
              {i < steps.length - 1 && <span className="mt-1 w-0.5 flex-1 bg-line" />}
            </div>
            <div className="flex-1 rounded-xl border border-line bg-surface px-4 py-3">
              <Inline text={typeof s === "string" ? s : s.title} className="font-semibold" />
              {s?.text && <Html html={mdToHtml(String(s.text))} className="md text-[14.5px] leading-6 text-muted [&>p]:my-1" />}
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

// ---------- flashcards ----------
function Flashcards({ data }: { data: any }) {
  const cards = asList(data);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const seen = Object.values(open).filter(Boolean).length;
  return (
    <div className="my-6">
      <div className="mb-3 flex items-center justify-between text-sm text-muted">
        <span>Tap a card to check yourself.</span>
        <span>{seen}/{cards.length} revealed {seen > 0 && <button className="ml-2 underline" onClick={() => setOpen({})}>reset</button>}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c, i) => (
          <button key={i} onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} className={cx("flip text-left", open[i] && "on")} aria-pressed={!!open[i]}>
            <div className="flip-inner relative min-h-36">
              <div className="flip-face absolute inset-0 flex flex-col rounded-2xl border border-line bg-surface p-4">
                <span className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Question {i + 1}</span>
                <Inline text={c.q} className="font-medium leading-6" />
                <span className="mt-auto pt-2 text-xs text-muted">↻ tap to reveal</span>
              </div>
              <div className="flip-face flip-back absolute inset-0 flex flex-col overflow-auto rounded-2xl border border-ok/40 bg-ok-bg p-4">
                <span className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ok">Answer / hint</span>
                <Inline text={c.a} className="leading-6" />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- terms ----------
function Terms({ data }: { data: any }) {
  const items = asList(data);
  return (
    <dl className="my-6 grid gap-2 sm:grid-cols-2">
      {items.map((t, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface px-4 py-3">
          <dt className="font-semibold"><Inline text={t.term} /></dt>
          <dd className="mt-0.5 text-[14px] leading-6 text-muted"><Inline text={t.def} /></dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- links ----------
function Links({ data }: { data: any }) {
  const items = asList(data);
  return (
    <div className="my-6 grid gap-2">
      {items.map((l, i) => {
        const local = !/^https?:/.test(String(l.url ?? ""));
        return (
          <a key={i} href={l.url} target="_blank" rel="noreferrer"
            className="group flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-muted">
            <span className="text-lg">{local ? "📂" : "🔗"}</span>
            <span className="min-w-0">
              <span className="block font-semibold group-hover:underline">{l.title}</span>
              {l.note && <span className="block text-sm text-muted">{l.note}</span>}
            </span>
          </a>
        );
      })}
    </div>
  );
}

export function DataBlock({ kind, data }: { kind: string; data: any }) {
  if (data?.error) return <pre className="my-4 overflow-auto rounded-xl bg-bad-bg p-3 text-xs text-bad">Block “{kind}” has invalid YAML: {data.error}</pre>;
  switch (kind) {
    case "cards": return <Cards data={data} />;
    case "formula": return <Formula data={data} />;
    case "compare": return <Compare data={data} />;
    case "steps": return <Steps data={data} />;
    case "flashcards": return <Flashcards data={data} />;
    case "terms": return <Terms data={data} />;
    case "links": return <Links data={data} />;
    default: return null;
  }
}

export function Markdown({ text }: { text: string }) {
  return <Html html={mdToHtml(text)} className="md" />;
}
