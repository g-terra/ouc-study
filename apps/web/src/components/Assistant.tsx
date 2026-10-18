/**
 * The "Ask AI" panel: chat with the AI chosen in `ouc ai setup` and run any study action
 * (one per skill in ai/skills/). The conversation lives in AssistantProvider, so it keeps going
 * while the student moves around the app or closes the panel.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SemesterData } from "@ouc/content/types";
import { Link } from "../lib/router";
import { mdToHtml } from "../lib/markdown";
import { fileLink, getChat, listChats, refreshAi, runTurn, stopRun, useActions, useAiStatus, type AiAction, type Chat, type ChatSummary } from "../lib/ai";
import { cx } from "./ui";

interface Draft { action: string; params: Record<string, string> }
interface Ctx {
  open: boolean; setOpen: (o: boolean) => void;
  chat: Chat | null; busy: boolean; error?: string;
  draft: Draft | null; setDraft: (d: Draft | null) => void;
  /** Opens the panel with an action picked (and its inputs filled in). */
  start: (action: string, params?: Record<string, string>) => void;
  send: (sem: string, message: string, title?: string) => Promise<void>;
  stop: () => void; reset: () => void; load: (id: string) => Promise<void>;
}
const AssistantCtx = createContext<Ctx | null>(null);
const store = {
  get: (): { chat?: string; open?: boolean } | null => { try { return JSON.parse(sessionStorage.getItem("ouc-ai") ?? "null"); } catch { return null; } },
  set: (v: { chat?: string; open?: boolean }) => { try { sessionStorage.setItem("ouc-ai", JSON.stringify(v)); } catch { /* private mode */ } },
};
export const useAssistant = () => useContext(AssistantCtx)!;

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const poll = useRef<number | undefined>(undefined);

  const reset = () => { if (busy) return; setChat(null); setDraft(null); setError(undefined); };
  const start = (action: string, params: Record<string, string> = {}) => {
    setOpen(true);
    if (busy) return;
    setChat(null); setError(undefined); setDraft({ action, params });
  };
  // a run started earlier (before a reload) keeps going on the server: follow it until it ends
  const follow = (id: string) => {
    window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      const c = await getChat(id);
      if (!c) return;
      setChat(c);
      if (!c.running) { window.clearInterval(poll.current); setBusy(false); }
    }, 2000);
  };
  const load = async (id: string) => {
    if (busy) return;
    const c = await getChat(id);
    if (!c) return;
    setChat(c); setDraft(null); setError(undefined);
    if (c.running) { setBusy(true); follow(c.id); }
  };
  useEffect(() => () => window.clearInterval(poll.current), []);
  // The app reloads itself when an agent writes a note; pick the chat (and the open panel) back up.
  useEffect(() => {
    const saved = store.get();
    if (saved?.chat) load(saved.chat);
    if (saved?.open) setOpen(true);
  }, []);
  useEffect(() => { store.set({ chat: chat?.id || undefined, open }); }, [chat?.id, open]);

  const send = async (sem: string, message: string, title?: string) => {
    if (busy) return;
    const body = chat ? { sem, chatId: chat.id, message } : { sem, action: draft?.action, params: draft?.params, message };
    setError(undefined); setBusy(true);
    const user = message.trim() || null;
    let id = chat?.id;
    // show the message straight away; the reply fills in as events arrive
    setChat((c) => {
      const base: Chat = c ?? { id: "", title: user ?? "New chat", action: draft?.action, messages: [] };
      return { ...base, messages: [...base.messages, ...(user || !c ? [{ role: "user" as const, text: user ?? title ?? "…" }] : []), { role: "assistant" as const, text: "", steps: [], files: [] }] };
    });
    const patch = (f: (m: Chat["messages"][number]) => void) => setChat((c) => {
      if (!c) return c;
      const messages = c.messages.slice();
      const last = { ...messages[messages.length - 1] };
      f(last);
      messages[messages.length - 1] = last;
      return { ...c, messages };
    });
    try {
      await runTurn(body, (e) => {
        if (e.type === "chat") { id = e.id; setChat((c) => (c ? { ...c, id: e.id, title: e.title } : c)); }
        else if (e.type === "text") patch((m) => { m.text += e.text; });
        else if (e.type === "tool") patch((m) => { m.steps = [...(m.steps ?? []), e.label]; });
        else if (e.type === "file") patch((m) => { m.files = [...(m.files ?? []), e.path]; });
        else if (e.type === "error") patch((m) => { m.error = e.message; });
      });
      setDraft(null);
      setBusy(false);
    } catch (e) {
      // the turn never started: put the chat back as it was
      setChat(chat);
      setError((e as Error).message);
      setBusy(false);
      return;
    }
    if (!id) return;
    // the stream ended (finished, or the page lost the connection): re-read what was saved
    const saved = await getChat(id);
    if (saved) { setChat(saved); if (saved.running) { setBusy(true); follow(id); } }
  };
  const stop = () => { if (chat?.id) stopRun(chat.id); };

  return <AssistantCtx.Provider value={{ open, setOpen, chat, busy, error, draft, setDraft, start, send, stop, reset, load }}>{children}</AssistantCtx.Provider>;
}

/** A small button that opens the panel with an action ready to go. */
export function AskAiButton({ action, params, children, className }: { action: string; params?: Record<string, string>; children: ReactNode; className?: string }) {
  const { start } = useAssistant();
  const ai = useAiStatus();
  if (ai.state === "unavailable") return null;
  return (
    <button type="button" onClick={() => start(action, params)}
      className={cx("inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition hover:border-muted", className)}>
      <span aria-hidden>✨</span>{children}
    </button>
  );
}

// ---------------------------------------------------------------------------
export function AssistantPanel({ data }: { data: SemesterData }) {
  const a = useAssistant();
  const ai = useAiStatus();
  const actions = useActions();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<ChatSummary[] | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const last = a.chat?.messages[a.chat.messages.length - 1];
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [a.chat?.messages.length, last?.text, last?.steps?.length]);
  useEffect(() => {
    if (!a.open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && a.setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [a.open]);
  if (!a.open) return null;

  const meta = actions.find((x) => x.id === (a.draft?.action ?? a.chat?.action));
  const blocked = ai.state === "ok" && !ai.ready ? ai.reason : ai.state === "unavailable" ? "The AI only works in the app on your computer (npm run dev or ouc open)." : undefined;
  const needsAgent = meta?.agentOnly && ai.state === "ok" && !ai.agentic ? `"${meta.title}" needs Claude Code, Codex or opencode.` : undefined;
  const canSend = !a.busy && !blocked && !needsAgent && (a.chat ? !!input.trim() : !!a.draft || !!input.trim());
  const submit = async () => {
    if (!canSend) return;
    const msg = input;
    setInput("");
    await a.send(data.id, msg, meta?.title);
  };

  return (
    <aside role="dialog" aria-label="Ask AI"
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-bg shadow-2xl sm:w-[440px]">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-serif text-lg font-semibold leading-tight">Ask AI</div>
          <div className="flex items-center gap-1.5 truncate text-xs text-muted">
            <span className={cx("inline-block size-2 rounded-full", ai.state === "checking" ? "animate-pulse bg-muted" : ai.ready ? "bg-ok" : "bg-warn")} />
            {ai.state === "checking" ? "Checking your AI…" : ai.label ?? "No AI chosen"}
          </div>
        </div>
        <button type="button" className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink" disabled={a.busy}
          onClick={async () => setHistory(history ? null : await listChats())}>History</button>
        <button type="button" className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40" disabled={a.busy || (!a.chat && !a.draft)}
          onClick={() => { a.reset(); setHistory(null); }}>New</button>
        <button type="button" aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" onClick={() => a.setOpen(false)}>✕</button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {history ? (
          <HistoryList chats={history} onPick={async (id) => { setHistory(null); await a.load(id); }} />
        ) : !a.chat ? (
          <>
            {!a.draft && <Intro />}
            <ActionPicker actions={actions} agentic={ai.agentic !== false} picked={a.draft?.action} onPick={(id) => a.setDraft(id === a.draft?.action ? null : { action: id, params: {} })} />
            {a.draft && meta && <ActionForm data={data} action={meta} params={a.draft.params} onChange={(params) => a.setDraft({ action: meta.id, params })} />}
          </>
        ) : (
          <div className="flex flex-col gap-4">
            {a.chat.messages.map((m, i) => <Message key={i} msg={m} live={a.busy && i === a.chat!.messages.length - 1} />)}
          </div>
        )}
        {a.error && <p className="mt-4 rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">{a.error}</p>}
        <div ref={end} />
      </div>

      <footer className="border-t border-line p-3">
        {(blocked || needsAgent) && (
          <p className="mb-2 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
            {needsAgent ?? blocked} <button type="button" className="underline" onClick={() => refreshAi(true)}>Check again</button>
          </p>
        )}
        {meta?.id === "assignment-helper" && <p className="mb-2 text-xs text-muted">The AI explains, hints and reviews; it won't write answers for you to submit.</p>}
        <div className="flex items-end gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={a.chat ? "Reply…" : a.draft ? "Anything to add? (optional)" : "Ask anything about your courses…"}
            className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-muted" />
          {a.busy
            ? <button type="button" onClick={a.stop} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold">Stop</button>
            : <button type="button" onClick={submit} disabled={!canSend} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-40">{!a.chat && a.draft ? "Start" : "Send"}</button>}
        </div>
      </footer>
    </aside>
  );
}

function Intro() {
  return (
    <div className="mb-4 text-sm text-muted">
      Pick something for your AI to do, or just ask. It works in this study folder on your computer, with your own Claude, ChatGPT or local model.
    </div>
  );
}

function ActionPicker({ actions, agentic, picked, onPick }: { actions: AiAction[]; agentic: boolean; picked?: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((x) => {
        const off = x.agentOnly && !agentic;
        return (
          <button key={x.id} type="button" onClick={() => onPick(x.id)} disabled={off} title={off ? "Needs Claude Code, Codex or opencode" : x.description}
            className={cx("flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition disabled:opacity-40",
              picked === x.id ? "border-ink bg-surface font-semibold" : "border-line bg-surface hover:border-muted")}>
            <span aria-hidden>{x.icon}</span><span className="min-w-0 truncate">{x.title}</span>
          </button>
        );
      })}
    </div>
  );
}

const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";
function ActionForm({ data, action, params, onChange }: { data: SemesterData; action: AiAction; params: Record<string, string>; onChange: (p: Record<string, string>) => void }) {
  const set = (k: string, v: string) => {
    const next = { ...params, [k]: v };
    if (k === "course") delete next.week;
    onChange(next);
  };
  const course = data.courses.find((c) => c.code === params.course);
  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-1 font-semibold">{action.icon} {action.title}</div>
      <p className="mb-3 text-xs text-muted">{action.description}</p>
      {!action.fields.length && <p className="text-sm text-muted">Nothing to fill in: press Start.</p>}
      <div className="flex flex-col gap-3">
        {action.fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-semibold text-muted">{f.label}{f.required ? "" : " (optional)"}</span>
            {f.kind === "course" ? (
              <select className={FIELD} value={params.course ?? ""} onChange={(e) => set("course", e.target.value)}>
                <option value="">{f.required ? "Choose a course" : "Any course"}</option>
                {data.courses.map((c) => <option key={c.code} value={c.code}>{c.short} · {c.code}</option>)}
              </select>
            ) : f.kind === "week" ? (
              <select className={FIELD} value={params.week ?? ""} onChange={(e) => set("week", e.target.value)} disabled={!course}>
                <option value="">{f.placeholder ?? "Any week"}</option>
                {course?.weeks.filter((w) => w.index > 0).map((w) => <option key={w.index} value={String(w.index)}>{w.label}</option>)}
              </select>
            ) : f.kind === "assignment" ? (
              <select className={FIELD} value={params.assignment ?? ""} onChange={(e) => set("assignment", e.target.value)}>
                <option value="">Choose an assignment</option>
                {data.assignments.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.title}{x.submitted ? " (submitted)" : ""}</option>)}
              </select>
            ) : (
              <input className={FIELD} value={params[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

function Message({ msg, live }: { msg: Chat["messages"][number]; live: boolean }) {
  if (msg.role === "user") {
    return <div className="ml-10 self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm text-bg">{msg.text}</div>;
  }
  const steps = msg.steps ?? [];
  return (
    <div className="flex flex-col gap-2">
      {steps.length > 0 && (
        <details className="text-xs text-muted" open={live}>
          <summary className="cursor-pointer select-none">{live ? "⏳ Working…" : `${steps.length} step${steps.length === 1 ? "" : "s"}`}</summary>
          <ul className="mt-1 flex flex-col gap-0.5 border-l border-line pl-3">{steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </details>
      )}
      {msg.text
        ? <div className="text-sm leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:overflow-x-auto [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: mdToHtml(msg.text) }} />
        : live && !steps.length && <div className="animate-pulse text-sm text-muted">Thinking…</div>}
      {(msg.files?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1">
          {[...new Set(msg.files)].map((f) => {
            const l = fileLink(f);
            const label = <><span aria-hidden>📄</span> <span className="truncate">{f.split("/").pop()}</span></>;
            const cls = "flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold hover:border-muted";
            return !l ? <code key={f} className="text-xs text-muted">{f}</code>
              : l.internal ? <Link key={f} to={l.to} className={cls}>{label}</Link>
              : <a key={f} href={l.to} target="_blank" rel="noreferrer" className={cls}>{label}</a>;
          })}
        </div>
      )}
      {msg.error && <p className="rounded-lg bg-bad-bg px-3 py-2 text-xs text-bad">{msg.error}</p>}
    </div>
  );
}

function HistoryList({ chats, onPick }: { chats: ChatSummary[]; onPick: (id: string) => void }) {
  if (!chats.length) return <p className="text-sm text-muted">No chats yet.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {chats.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => onPick(c.id)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-2">
            <div className="truncate text-sm font-semibold">{c.title}</div>
            <div className="text-xs text-muted">{new Date(c.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{c.tool ? ` · ${c.tool}` : ""}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}
