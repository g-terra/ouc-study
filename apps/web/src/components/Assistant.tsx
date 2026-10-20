/**
 * The "Ask AI" panel: chat with the AI chosen in `ouc ai setup` and run any study action
 * (one per skill in ai/skills/). The conversation lives in AssistantProvider, so it keeps going
 * while the student moves around the app or closes the panel. The same chat opens as a full page
 * (ChatPage, at /<sem>/chat/<id>) for longer conversations.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SemesterData } from "@ouc/content/types";
import { Link, useRouter, enc } from "../lib/router";
import { chatPathFor, isChatPath } from "../lib/chat-path";
import { mdToHtml } from "../lib/markdown";
import { linkLabel } from "../lib/links";
import { TOOL_STATE, deleteChats, pickedModels, rememberModel, fileLink, viewUrl, visualsOf, getChat, listChats, refreshAi, runTurn, stopRun, useActions, useAiStatus, usePrepStatus, type AiAction, type Chat, type ChatMessage, type ChatSummary } from "../lib/ai";
import { refreshData } from "../lib/data";
import { cx } from "./ui";
import { renderMermaid } from "../notes/Mermaid";
import { useTheme } from "../lib/theme";

interface Draft { action: string; params: Record<string, string> }
/** One tab in the panel: a chat (or a draft action), with its own run. */
export interface Session { key: string; chat: Chat | null; busy: boolean; error?: string; draft: Draft | null; tool?: string; /** a saved chat being read back after a reload */ loading?: string }
interface Ctx {
  open: boolean; setOpen: (o: boolean) => void;
  /** All open chats (tabs); several can run at the same time. */
  sessions: Session[]; activeKey: string; activate: (key: string) => void; close: (key: string) => void;
  // the active tab
  chat: Chat | null; busy: boolean; error?: string; draft: Draft | null; setDraft: (d: Draft | null) => void;
  /** Opens the panel with an action picked (and its inputs filled in), in a free tab; `tool` picks the AI for that tab only. */
  start: (action: string, params?: Record<string, string>, tool?: string) => void;
  send: (sem: string, message: string, title?: string, model?: string) => Promise<void>;
  /** The coding tool for the active tab: its own, else the one picked in the panel (null = the one from `ouc ai setup`). */
  tool: string | null; setTool: (t: string | null) => void;
  stop: () => void; reset: () => void; load: (id: string) => Promise<void>;
  /** What's typed in the reply box: shared by the popup and the full page, so it survives switching. */
  input: string; setInput: (s: string) => void;
  /** The chats saved before a reload are back in their tabs (they may still be loading). */
  ready: boolean;
  /** Deletes a saved chat (or all of them, when no id) and closes their tabs; resolves to an error message, if any. */
  remove: (id?: string) => Promise<string | undefined>;
}
const AssistantCtx = createContext<Ctx | null>(null);
const store = {
  get: (): { chats?: string[]; active?: number; open?: boolean } | null => { try { return JSON.parse(sessionStorage.getItem("ouc-ai") ?? "null"); } catch { return null; } },
  set: (v: { chats: string[]; active: number; open: boolean }) => { try { sessionStorage.setItem("ouc-ai", JSON.stringify(v)); } catch { /* private mode */ } },
};
export const useAssistant = () => useContext(AssistantCtx)!;
export const MAX_TABS = 6;

let seq = 0;
const blank = (): Session => ({ key: `s${++seq}`, chat: null, busy: false, draft: null });

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<Session[]>(() => [blank()]);
  const [activeKey, setActiveKey] = useState(() => sessions[0].key);
  const [tool, setToolState] = useState<string | null>(() => { try { return localStorage.getItem("ouc-ai-tool"); } catch { return null; } });
  const setTool = (t: string | null) => { setToolState(t); try { t ? localStorage.setItem("ouc-ai-tool", t) : localStorage.removeItem("ouc-ai-tool"); } catch { /* private mode */ } };
  const polls = useRef(new Map<string, number>());
  const live = useRef(sessions);
  live.current = sessions;

  const active = sessions.find((x) => x.key === activeKey) ?? sessions[0];
  const update = (key: string, f: (x: Session) => Session) => setSessions((all) => all.map((x) => (x.key === key ? f(x) : x)));
  const empty = (x: Session) => !x.chat && !x.busy && !x.loading;
  /** A tab to start something new in: the active one if it's empty, else a new one. */
  const freeTab = (): string => {
    const cur = live.current.find((x) => x.key === activeKey);
    if (cur && empty(cur)) return cur.key;
    const spare = live.current.find(empty);
    if (spare) { setActiveKey(spare.key); return spare.key; }
    const n = blank();
    // keep at most MAX_TABS: drop the oldest finished chat (it stays in History)
    const trim = (all: Session[]) => {
      let next = [...all, n];
      while (next.length > MAX_TABS) { const i = next.findIndex((x) => !x.busy); if (i < 0) break; next = next.filter((_, j) => j !== i); }
      return next;
    };
    // seen straight away by a second call before the next render (React runs effects twice in development)
    live.current = trim(live.current);
    setSessions(trim);
    setActiveKey(n.key);
    return n.key;
  };

  const reset = () => { const key = freeTab(); update(key, (x) => ({ ...x, draft: null, error: undefined, tool: undefined })); };
  const start = (action: string, params: Record<string, string> = {}, tool?: string) => {
    setOpen(true);
    const key = freeTab();
    update(key, (x) => ({ ...x, error: undefined, draft: { action, params }, tool }));
  };
  const close = (key: string) => {
    window.clearInterval(polls.current.get(key));
    polls.current.delete(key);
    const all = live.current;
    let next = all.filter((x) => x.key !== key);
    if (!next.length) next = [blank()];
    if (key === activeKey) setActiveKey((next[Math.max(0, all.findIndex((x) => x.key === key) - 1)] ?? next[0]).key);
    setSessions(next);
  };
  // a run started earlier (before a reload) keeps going on the server: follow it until it ends
  const follow = (key: string, id: string) => {
    window.clearInterval(polls.current.get(key));
    polls.current.set(key, window.setInterval(async () => {
      const c = await getChat(id);
      if (!c) return;
      update(key, (x) => ({ ...x, chat: c, busy: !!c.running }));
      if (!c.running) { window.clearInterval(polls.current.get(key)); polls.current.delete(key); if (c.messages.at(-1)?.files?.length) refreshData(); }
    }, 2000));
  };
  const openChat = async (key: string, id: string) => {
    const c = await getChat(id);
    if (!c) { update(key, (x) => ({ ...x, loading: undefined })); return false; }
    update(key, (x) => ({ ...x, chat: c, draft: null, error: undefined, busy: !!c.running, tool: c.tool, loading: undefined }));
    if (c.running) follow(key, c.id);
    return true;
  };
  const load = async (id: string) => {
    const there = live.current.find((x) => x.chat?.id === id || x.loading === id);
    if (there) { setActiveKey(there.key); return; }
    const key = freeTab();
    live.current = live.current.map((x) => (x.key === key ? { ...x, loading: id } : x));
    update(key, (x) => ({ ...x, loading: id }));
    await openChat(key, id);
  };
  useEffect(() => () => polls.current.forEach((t) => window.clearInterval(t)), []);
  // The app reloads itself when an agent writes a note; pick the chats (and the open panel) back up.
  useEffect(() => {
    const saved = store.get();
    if (saved?.open) setOpen(true);
    const ids = (saved?.chats ?? []).slice(0, MAX_TABS);
    setReady(true);
    if (!ids.length) return;
    const restored = ids.map((id) => ({ ...blank(), loading: id }));
    live.current = restored;
    setSessions(restored);
    setActiveKey(restored[Math.min(saved?.active ?? 0, restored.length - 1)].key);
    ids.forEach((id, i) => openChat(restored[i].key, id));
  }, []);
  useEffect(() => {
    const withChat = sessions.filter((x) => x.chat?.id || x.loading);
    store.set({ chats: withChat.map((x) => x.chat?.id ?? x.loading!), active: Math.max(0, withChat.findIndex((x) => x.key === activeKey)), open });
  }, [sessions.map((x) => x.chat?.id ?? x.loading).join(), activeKey, open]);

  const send = async (sem: string, message: string, title?: string, model?: string) => {
    const key = active.key;
    const { chat, draft } = active;
    const useTool = active.tool ?? tool ?? undefined;
    if (active.busy) return;
    const body = { ...(chat ? { sem, chatId: chat.id, message } : { sem, action: draft?.action, params: draft?.params, message }), ...(useTool ? { tool: useTool } : {}), ...(model ? { model } : {}) };
    const user = message.trim() || null;
    let id = chat?.id, wrote = false;
    // show the message straight away; the reply fills in as events arrive
    update(key, (x) => {
      const base: Chat = x.chat ?? { id: "", title: user ?? title ?? "New chat", action: draft?.action, messages: [] };
      return { ...x, busy: true, error: undefined, chat: { ...base, messages: [...base.messages, ...(user || !x.chat ? [{ role: "user" as const, text: user ?? title ?? "…" }] : []), { role: "assistant" as const, text: "", steps: [], files: [], updates: [] }] } };
    });
    const patch = (f: (m: ChatMessage) => void) => update(key, (x) => {
      if (!x.chat) return x;
      const messages = x.chat.messages.slice();
      const last = { ...messages[messages.length - 1] };
      f(last);
      messages[messages.length - 1] = last;
      return { ...x, chat: { ...x.chat, messages } };
    });
    try {
      await runTurn(body, (e) => {
        if (e.type === "chat") { id = e.id; update(key, (x) => (x.chat ? { ...x, chat: { ...x.chat, id: e.id, title: e.title } } : x)); }
        else if (e.type === "text") patch((m) => {
          // a whole new message from an agent tool: the previous one becomes a progress update
          if (e.replace) { if (m.text) m.updates = [...(m.updates ?? []), m.text]; m.text = e.text; }
          else m.text += e.text;
        });
        else if (e.type === "tool") patch((m) => { m.steps = [...(m.steps ?? []), e.label]; });
        else if (e.type === "file") { wrote = true; patch((m) => { m.files = [...(m.files ?? []), e.path]; }); }
        else if (e.type === "error") patch((m) => { m.error = e.message; });
      });
      update(key, (x) => ({ ...x, draft: null, busy: false }));
    } catch (e) {
      // the turn never started: put the chat back as it was
      update(key, (x) => ({ ...x, chat, busy: false, error: (e as Error).message }));
      return;
    }
    if (!id) return;
    // the app server rebuilds the data when a note changes; this catches a write it didn't see
    if (wrote) window.setTimeout(refreshData, 2000);
    // the stream ended (finished, or the page lost the connection): re-read what was saved
    const saved = await getChat(id);
    if (saved) { update(key, (x) => ({ ...x, chat: saved, busy: !!saved.running })); if (saved.running) follow(key, id); }
  };
  const stop = () => { if (active.chat?.id) stopRun(active.chat.id); };
  const remove = async (id?: string) => {
    const r = await deleteChats(id);
    if (r.error) return r.error;
    // close their tabs (a running chat stays: the server keeps it too)
    const gone = (x: Session) => !!x.chat?.id && !x.busy && (!id || x.chat.id === id);
    let next = live.current.filter((x) => !gone(x));
    if (!next.length) next = [blank()];
    if (!next.some((x) => x.key === activeKey)) setActiveKey(next[next.length - 1].key);
    live.current = next;
    setSessions(next);
    return r.kept ? `${r.kept} ${r.kept === 1 ? "chat is" : "chats are"} still working, so ${r.kept === 1 ? "it was" : "they were"} kept.` : undefined;
  };

  return (
    <AssistantCtx.Provider value={{
      open, setOpen, sessions, activeKey: active.key, activate: setActiveKey, close,
      chat: active.chat, busy: active.busy, error: active.error, draft: active.draft,
      setDraft: (d) => update(active.key, (x) => ({ ...x, draft: d })),
      start, send, stop, reset, load, input, setInput, ready, remove,
      tool: active.tool ?? tool,
      // a tab started for a given AI keeps its own choice; otherwise this is the default for new chats
      setTool: (t) => (active.tool ? update(active.key, (x) => ({ ...x, tool: t ?? undefined })) : setTool(t)),
    }}>{children}</AssistantCtx.Provider>
  );
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
// where "Back to the pop-up" returns to: the page the chat was expanded from
let expandedFrom: string | null = null;
const SIDE_KEY = "ouc-ai-history";
const PICK = "min-w-0 truncate rounded-lg border border-line bg-surface py-1 pl-2 pr-1 text-xs text-muted hover:text-ink disabled:opacity-60";
const BTN = "rounded-full px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink";

/** The chat as a popup over the page; it stays out of the way while the full-page chat is open. */
export function AssistantPanel({ data }: { data: SemesterData }) {
  const a = useAssistant();
  const { path } = useRouter();
  const box = useRef<HTMLElement>(null);
  const page = isChatPath(path);
  useEffect(() => {
    if (!a.open || page) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && a.setOpen(false);
    // it's a popup: a click on the page closes it (chats keep running; the robot button brings it back)
    const away = (e: MouseEvent) => { const t = e.target as HTMLElement; if (!box.current?.contains(t) && !t.closest?.("[data-ask-ai]")) a.setOpen(false); };
    window.addEventListener("keydown", esc);
    document.addEventListener("mousedown", away);
    return () => { window.removeEventListener("keydown", esc); document.removeEventListener("mousedown", away); };
  }, [a.open, page]);
  if (!a.open || page) return null;
  return (
    <aside ref={box} role="dialog" aria-label="Ask AI"
      className="fixed inset-0 z-50 flex flex-col bg-bg shadow-2xl sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(78vh,760px)] sm:w-[440px] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-line">
      <ChatView data={data} />
    </aside>
  );
}

/** The same chats as a full page, for longer conversations: history on the side, the address follows the open chat. */
export function ChatPage({ data, id }: { data: SemesterData; id?: string }) {
  const a = useAssistant();
  const { path, navigate } = useRouter();
  const [synced, setSynced] = useState(false);
  useEffect(() => { a.setOpen(false); }, []);
  // open the chat in the address (a bookmark, a new tab, Back)…
  useEffect(() => {
    if (!a.ready) return;
    if (!id || a.chat?.id === id) { setSynced(true); return; }
    a.load(id).finally(() => setSynced(true));
  }, [a.ready, id]);
  // …and once it's open, the address follows the chat on screen
  useEffect(() => {
    if (!synced) return;
    const want = chatPathFor(path, a.chat?.id || undefined);
    if (want !== path.split("#")[0]) navigate(want, { raw: true, replace: true });
  }, [synced, a.chat?.id]);
  return <ChatView data={data} page />;
}

/** Header, tabs, the conversation (or the action picker) and the reply box, as a popup or a full page. */
function ChatView({ data, page = false }: { data: SemesterData; page?: boolean }) {
  const a = useAssistant();
  const ai = useAiStatus();
  const actions = useActions();
  const { path, navigate } = useRouter();
  const { input, setInput } = a;
  const [history, setHistory] = useState<ChatSummary[] | null>(null);
  // the full page lists the chats on the side (wide screens, unless hidden); refreshed when a chat starts or ends
  const [side, setSide] = useState<ChatSummary[] | null>(null);
  const [sideOn, setSideOn] = useState(() => { try { return localStorage.getItem(SIDE_KEY) !== "hidden"; } catch { return true; } });
  const showSide = (on: boolean) => { setSideOn(on); try { localStorage.setItem(SIDE_KEY, on ? "shown" : "hidden"); } catch { /* private mode */ } };
  useEffect(() => { if (page) listChats().then(setSide); }, [page, a.chat?.id, a.busy]);
  const [note, setNote] = useState<string>();
  const remove = async (id?: string) => {
    const n = id ? 1 : (side ?? history ?? []).length;
    if (!window.confirm(id ? "Delete this chat? This can't be undone." : `Delete all ${n} saved chats? This can't be undone.`)) return;
    setNote(await a.remove(id));
    const fresh = await listChats();
    if (page) setSide(fresh);
    if (history) setHistory(fresh);
  };
  const end = useRef<HTMLDivElement>(null);
  // the reply box starts at four lines and grows with what's typed (up to its max height, then it scrolls)
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = field.current; if (t) { t.style.height = "auto"; t.style.height = `${t.scrollHeight + 2}px`; } }, [input]);
  const last = a.chat?.messages[a.chat.messages.length - 1];
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [a.chat?.messages.length, last?.text, last?.steps?.length]);

  const meta = actions.find((x) => x.id === (a.draft?.action ?? a.chat?.action));
  // the tool picked in the panel, if it's still there; else the one from `ouc ai setup`
  const picked = ai.tools.find((t) => t.id === a.tool && t.state !== "missing") ?? ai.tools.find((t) => t.chosen);
  const ready = picked?.state === "connected";
  const agentic = picked ? picked.id !== "local" : ai.agentic !== false;
  const blocked = ai.state === "unavailable" ? "The AI only works in the app on your computer (npm run dev or ouc open)."
    : ai.state !== "ok" ? undefined
    : !picked ? (ai.reason || "No AI chosen yet. In Terminal, run: ouc ai setup")
    : !ready ? `${picked.label}: ${picked.detail ?? "not ready"}${picked.fix ? `. Fix: ${picked.fix}` : ""}` : undefined;
  // the model for the picked AI: the one picked for it last (if it still has it), else its default
  const [models, setModels] = useState(pickedModels);
  const model = picked && picked.models?.includes(models[picked.id]) ? models[picked.id] : "";
  const pickModel = (m: string) => { if (!picked) return; rememberModel(picked.id, m); setModels(pickedModels()); };
  const needsAgent = meta?.agentOnly && ai.state === "ok" && !agentic ? `"${meta.title}" needs Claude Code, Codex or opencode.` : undefined;
  const canSend = !a.busy && !blocked && !needsAgent && (a.chat ? !!input.trim() : !!a.draft || !!input.trim());
  const submit = async () => {
    if (!canSend) return;
    const msg = input;
    setInput("");
    await a.send(data.id, msg, meta?.title, model || undefined);
  };
  const pick = async (id: string) => { setHistory(null); await a.load(id); };
  // on the full page's wide layout, History shows or hides the side list; otherwise it opens the list in place
  const wide = () => page && window.matchMedia("(min-width: 1024px)").matches;
  const expand = () => {
    expandedFrom = path;
    a.setOpen(false);
    // a classic path: the router keeps it in v2 while v2 is open
    navigate(`/${enc(data.id)}/chat${a.chat?.id ? `/${enc(a.chat.id)}` : ""}`);
  };
  const collapse = () => {
    const back = expandedFrom && !isChatPath(expandedFrom) ? expandedFrom : path.replace(/\/chat(\/.*)?$/, "");
    expandedFrom = null;
    navigate(back, { raw: true });
    a.setOpen(true);
  };

  const conversation = (
    <>
      {history ? (
        <HistoryList chats={history} onPick={pick} onDelete={remove} />
      ) : !a.chat ? (
        <>
          {!a.draft && <Intro />}
          <ActionPicker actions={actions} agentic={agentic} picked={a.draft?.action} wide={page} onPick={(id) => a.setDraft(id === a.draft?.action ? null : { action: id, params: {} })} />
          {a.draft && meta && <ActionForm data={data} action={meta} params={a.draft.params} onChange={(params) => a.setDraft({ action: meta.id, params })} />}
        </>
      ) : (
        <div className="flex flex-col gap-4">
          {a.chat.messages.map((m, i) => <Message key={i} msg={m} sem={a.chat!.sem ?? data.id} live={a.busy && i === a.chat!.messages.length - 1} />)}
        </div>
      )}
      {a.error && <p className="mt-4 rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">{a.error}</p>}
      {note && <p role="status" className="mt-4 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">{note} <button type="button" className="underline" onClick={() => setNote(undefined)}>OK</button></p>}
      <div ref={end} className={cx(page && "scroll-mb-48")} />
    </>
  );

  const view = (
    <>
      <header className={cx("flex items-center gap-2 border-b border-line", page ? "pb-3" : "px-4 py-3")}>
        <div className="min-w-0 flex-1">
          {page ? <h1 className="font-serif text-2xl font-semibold leading-tight">Ask AI</h1> : <div className="font-serif text-lg font-semibold leading-tight">Ask AI</div>}
        </div>
        <button type="button" className={BTN} aria-pressed={page ? undefined : !!history}
          onClick={async () => (wide() ? showSide(!sideOn) : setHistory(history ? null : await listChats()))}>
          {page ? <><span className="hidden lg:inline">{sideOn ? "Hide history" : "Show history"}</span><span className="lg:hidden">History</span></> : "History"}
        </button>
        <button type="button" className={cx(BTN, "disabled:opacity-40")} disabled={!a.chat && !a.draft}
          onClick={() => { a.reset(); setHistory(null); }}>New chat</button>
        {page ? (
          <button type="button" aria-label="Back to the pop-up" title="Back to the pop-up" className={BTN} onClick={collapse}>
            <span aria-hidden>⤡</span><span className="hidden sm:inline"> Pop-up</span>
          </button>
        ) : (
          <button type="button" aria-label="Open as a full page" title="Open as a full page (for longer chats)" className="hidden size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink sm:grid" onClick={expand}>⤢</button>
        )}
        {!page && <button type="button" aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" onClick={() => a.setOpen(false)}>✕</button>}
      </header>
      <RunningTasks sem={data.id} />
      {a.sessions.length > 1 && <Tabs actions={actions} onPick={() => setHistory(null)} />}

      {page ? <div className="flex-1 py-6">{conversation}</div> : <div className="flex-1 overflow-y-auto px-4 py-4">{conversation}</div>}

      <footer className={cx("border-t border-line", page ? "sticky bottom-16 z-20 bg-bg py-3 sm:bottom-0" : "p-3")}>
        {(blocked || needsAgent) && (
          <p className="mb-2 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
            {needsAgent ?? blocked} <button type="button" className="underline" onClick={() => refreshAi(true)}>Check again</button>
          </p>
        )}
        {(meta?.id === "assignment-helper" || meta?.id === "assignment-prep") && <p className="mb-2 text-xs text-muted">The AI explains, hints and reviews; it won't write answers for you to submit.</p>}
        <textarea ref={field} value={input} onChange={(e) => setInput(e.target.value)} rows={4} aria-label="Message"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={a.chat ? "Reply…" : a.draft ? "Anything to add? (optional)" : "Ask anything about your courses…"}
          className="block max-h-64 min-h-[6.5rem] w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-muted" />
        {/* which AI answers (and its model), next to Send */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted">
            <span className={cx("inline-block size-2 shrink-0 rounded-full", ai.state === "checking" ? "animate-pulse bg-muted" : ready ? "bg-ok" : "bg-warn")} />
            {ai.state === "ok" && ai.tools.some((t) => t.state !== "missing") ? (
              <>
                <select aria-label="Which AI answers" value={picked?.id ?? ""} disabled={a.busy}
                  onChange={(e) => a.setTool(ai.tools.find((t) => t.id === e.target.value)?.chosen ? null : e.target.value)}
                  className={cx(PICK, "max-w-[11rem]")}>
                  {!picked && <option value="">Choose an AI</option>}
                  {ai.tools.filter((t) => t.state !== "missing").map((t) => (
                    <option key={t.id} value={t.id}>{t.id === "opencode" || t.id === "local" ? `${t.label}${t.detail && t.state === "connected" ? ` · ${t.detail}` : ""}` : t.label}{t.state === "connected" ? "" : ` (${TOOL_STATE[t.state].text.toLowerCase()})`}</option>
                  ))}
                </select>
                {!!picked?.models?.length && (
                  <select aria-label="Model" title="The model for this AI (remembered as its default)" value={model} disabled={a.busy}
                    onChange={(e) => pickModel(e.target.value)} className={cx(PICK, "max-w-[9rem]")}>
                    <option value="">{picked.model ? `Default (${picked.model})` : "Default model"}</option>
                    {picked.models.filter((m) => m !== picked.model).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </>
            ) : <span className="truncate">{ai.state === "checking" ? "Checking your AI…" : ai.label ?? "No AI chosen"}</span>}
          </div>
          {a.busy
            ? <button type="button" onClick={a.stop} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold">Stop</button>
            : <button type="button" onClick={submit} disabled={!canSend} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-40">{!a.chat && a.draft ? "Start" : "Send"}</button>}
        </div>
      </footer>
    </>
  );

  if (!page) return view;
  return (
    <section aria-label="Ask AI" className="flex gap-8">
      {sideOn && (
        <nav aria-label="Chat history" className="sticky top-24 hidden max-h-[calc(100vh-8rem)] w-64 shrink-0 self-start overflow-y-auto lg:block">
          <div className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wide text-muted">
            <span className="flex-1">History</span>
            <button type="button" className="rounded px-1.5 py-0.5 normal-case tracking-normal hover:bg-surface-2 hover:text-ink" onClick={() => showSide(false)}>Hide</button>
          </div>
          {side ? <HistoryList chats={side} active={a.chat?.id} onPick={pick} onDelete={remove} /> : <p className="text-sm text-muted">Loading…</p>}
        </nav>
      )}
      <div className="flex min-h-[70vh] min-w-0 flex-1 flex-col">{view}</div>
    </section>
  );
}

/** One tab per open chat; a dot marks the ones still working. */
function Tabs({ actions, onPick }: { actions: AiAction[]; onPick: () => void }) {
  const a = useAssistant();
  return (
    <nav aria-label="Open chats" className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
      {a.sessions.map((x) => {
        const title = x.chat?.title || (x.draft ? actions.find((y) => y.id === x.draft!.action)?.title : "") || "New chat";
        const on = x.key === a.activeKey;
        return (
          <div key={x.key} className={cx("flex max-w-[11rem] shrink-0 items-center rounded-full border text-xs", on ? "border-ink bg-surface font-semibold" : "border-line text-muted hover:border-muted")}>
            <button type="button" onClick={() => { a.activate(x.key); onPick(); }} className="flex min-w-0 items-center gap-1.5 py-1 pl-3 pr-1" title={title}>
              {x.busy && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
              <span className="truncate">{title}</span>
            </button>
            <button type="button" aria-label={`Close ${title}`} onClick={() => a.close(x.key)} className="px-2 py-1 text-muted hover:text-ink">×</button>
          </div>
        );
      })}
    </nav>
  );
}

function Intro() {
  return (
    <div className="mb-4 text-sm text-muted">
      Pick something for your AI to do, or just ask. It works in this study folder on your computer, with your own Claude, ChatGPT or local model.
    </div>
  );
}

function ActionPicker({ actions, agentic, picked, wide, onPick }: { actions: AiAction[]; agentic: boolean; picked?: string; wide?: boolean; onPick: (id: string) => void }) {
  return (
    <div className={cx("grid grid-cols-2 gap-2", wide && "md:grid-cols-3")}>
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
    if (k === "course") {
      delete next.week;
      if (v && next.assignment && !next.assignment.startsWith(`${v}/`)) delete next.assignment;
    }
    onChange(next);
  };
  const course = data.courses.find((c) => c.code === params.course);
  const week = course && params.week ? course.weeks.find((w) => String(w.index) === params.week) : undefined;
  const assignments = data.assignments.filter((x) => !params.course || x.code === params.course);
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
                <option value="">{f.placeholder ?? (f.required ? "Choose a course" : "Any course")}</option>
                {data.courses.map((c) => <option key={c.code} value={c.code}>{c.short} · {c.code}</option>)}
              </select>
            ) : f.kind === "assignment" ? (
              <select className={FIELD} value={params.assignment ?? ""} onChange={(e) => set("assignment", e.target.value)}>
                <option value="">Choose an assignment</option>
                {assignments.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.title}{x.submitted ? " (submitted)" : ""}</option>)}
              </select>
            ) : (
              <input className={FIELD} value={params[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      {week && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <span>Week: <b className="text-ink">{week.label}</b></span>
          <button type="button" className="underline" onClick={() => set("week", "")}>{action.id === "make-notes" ? "all weeks without notes" : "whole course"}</button>
        </p>
      )}
      {action.id === "assignment-prep" && params.mode && PREP_MODE[params.mode] && <p className="mt-3 text-xs text-muted">{PREP_MODE[params.mode]}</p>}
      {action.id === "assignment-review" && <p className="mt-3 text-xs text-muted">Reviews {params.version ? `version ${params.version}` : "the latest version"} of the .docx you uploaded on the assignment page: feedback and what to fix, never rewritten answers.</p>}
      {action.id === "make-notes" && !week && <p className="mt-3 text-xs text-muted">Makes notes for every week{course ? ` of ${course.short}` : ""} that has material and no notes yet.</p>}
    </div>
  );
}

/** A strip under the Ask AI header, only while background AI work runs: how many tasks; opens the live page with all of them in a new window. */
function RunningTasks({ sem }: { sem: string }) {
  const st = usePrepStatus();
  const n = st?.busy ? st.running.length + st.queue.length : 0;
  if (!n) return null;
  return (
    <a href={`/${enc(sem)}/ai-work`} target="_blank" rel="noreferrer" title="See the AI's background tasks in a new window"
      className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-1.5 text-xs hover:text-ink">
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
      <span className="flex-1 font-semibold">{n} background {n === 1 ? "task" : "tasks"} running</span>
      <span className="text-muted">See them ↗</span>
    </a>
  );
}

/** A reply in Markdown; file paths in it link to the app's pages (notes, assignments) or open the file; ```mermaid blocks become diagrams. */
export function Markdown({ text, className, sem, diagrams = true }: { text: string; className?: string; sem?: string; diagrams?: boolean }) {
  const { setOpen } = useAssistant();
  const box = useRef<HTMLDivElement>(null);
  const html = mdToHtml(text, sem);
  const { theme } = useTheme();
  useEffect(() => { if (diagrams && box.current) drawDiagrams(box.current); }, [html, theme, diagrams]);
  return (
    <div ref={box} className={cx("text-sm leading-relaxed [&_a]:underline [&_a_code]:text-accent [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:break-all [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre_code]:break-normal [&_pre_code]:whitespace-pre [&_ul]:list-disc", className)}
      // file paths open their page (the router follows the link); on phones the chat covers the page, so close it
      onClick={(e) => { if ((e.target as HTMLElement).closest("a[data-internal]") && !window.matchMedia("(min-width: 640px)").matches) setOpen(false); }}
      dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/** Swaps each ```mermaid code block for its diagram (again on a theme change); a block that isn't a valid diagram stays as code. */
function drawDiagrams(root: HTMLElement) {
  const blocks = [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")].map((c) => ({ el: c.parentElement!, code: c.textContent ?? "" }))
    .concat([...root.querySelectorAll<HTMLElement>("[data-mermaid]")].map((el) => ({ el, code: el.dataset.mermaid ?? "" })));
  for (const { el, code } of blocks) {
    renderMermaid(code).then((svg) => {
      if (!el.isConnected) return;
      const fig = document.createElement("figure");
      fig.dataset.mermaid = code;
      fig.dataset.diagram = "";
      fig.className = "my-3 grid place-items-center overflow-x-auto rounded-xl border border-line bg-surface p-3 [&_svg]:max-w-full";
      fig.innerHTML = svg;
      el.replaceWith(fig);
    }).catch(() => { /* not a valid diagram: the code stays */ });
  }
}

const PREP_MODE: Record<string, string> = {
  review: "Reviews the current prep pack: fixes mistakes, sharpens the hints and fills gaps.",
  more: "Keeps the current prep pack and adds more hints, practice and sources.",
  redo: "Starts the prep pack over from scratch.",
};
const LIVE_STEPS = 3;
const SHOW_FILES = 3;
/** A visual the AI saved, shown in the chat. It runs sandboxed: it can't reach the app or your files. */
function Visual({ path }: { path: string }) {
  const src = viewUrl(path);
  const [ok, setOk] = useState<boolean>();
  const [big, setBig] = useState(false);
  useEffect(() => { fetch(src).then((r) => setOk(r.ok)).catch(() => setOk(false)); }, [src]);
  if (!ok) return null;
  const name = path.split("/").pop();
  const img = /\.(png|jpe?g|gif|webp)$/i.test(path);
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-white">
      {img ? <img src={src} alt={name} className="w-full" />
        : <iframe title={name} src={src} sandbox="allow-scripts allow-popups" className={cx("block w-full bg-white", big ? "h-[75vh]" : "h-80")} />}
      <figcaption className="flex items-center gap-3 border-t border-line bg-surface px-3 py-1.5 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate" title={path}>🖼️ {name}</span>
        {!img && <button type="button" className="hover:text-ink" onClick={() => setBig(!big)}>{big ? "Smaller" : "Bigger"}</button>}
        <a href={src} target="_blank" rel="noreferrer" className="hover:text-ink">Open ↗</a>
      </figcaption>
    </figure>
  );
}
function FileLinks({ files, className }: { files: string[]; className?: string }) {
  const cls = "flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold hover:border-muted";
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      {files.map((f) => {
        const l = fileLink(f)!;
        const label = <><span aria-hidden>{/\/plans\//.test(f) ? "🗓️" : "📄"}</span> <span className="truncate">{linkLabel(f, l)}</span></>;
        return l.internal ? <Link key={f} to={l.to} className={cls}>{label}</Link>
          : <a key={f} href={l.to} target="_blank" rel="noreferrer" className={cls}>{label}</a>;
      })}
    </div>
  );
}
function Message({ msg, live, sem }: { msg: ChatMessage; live: boolean; sem?: string }) {
  if (msg.role === "user") {
    return <div className="ml-10 self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm text-bg">{msg.text}</div>;
  }
  const steps = msg.steps ?? [];
  const updates = msg.updates ?? [];
  // visuals it made are shown inline; the other files the app can open are listed (memory and other bookkeeping files aren't)
  const visuals = live ? [] : visualsOf(msg);
  const files = [...new Set(msg.files ?? [])].filter((f) => fileLink(f) && !visuals.includes(f));
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return (
    <div className="flex flex-col gap-2">
      {live ? (
        // while it works: a fixed-size box with what it's doing now, the last few steps and the latest message
        <div className="rounded-xl border border-line bg-surface p-3 text-xs text-muted">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
            <span aria-hidden className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            {!steps.length && !msg.text ? "Planning the answer…" : msg.text && !steps.length ? "Writing the answer…" : "Working on it…"}
            <span className="ml-auto font-normal text-xs text-muted">{[steps.length && plural(steps.length, "step"), files.length && plural(files.length, "file")].filter(Boolean).join(" · ")}</span>
          </div>
          {!steps.length && !msg.text && <p className="pl-6">Reading your request and the study files to work out what to do.</p>}
          {steps.length > LIVE_STEPS && <div className="pl-6">… {steps.length - LIVE_STEPS} earlier</div>}
          <ul className="flex flex-col gap-0.5 pl-6">{steps.slice(-LIVE_STEPS).map((s, i, a) => <li key={steps.length - LIVE_STEPS + i} className={cx("truncate", i === a.length - 1 && "font-medium text-ink")}>{s}</li>)}</ul>
          {msg.text && <div className="mt-2 flex max-h-36 flex-col justify-end overflow-hidden border-t border-line pt-1 [mask-image:linear-gradient(to_bottom,transparent,black_2.5rem)]"><Markdown text={msg.text} sem={sem} className="text-ink" diagrams={false} /></div>}
        </div>
      ) : (
        <>
          {(steps.length > 0 || updates.length > 0) && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer select-none">{[steps.length && plural(steps.length, "step"), updates.length && plural(updates.length, "progress update")].filter(Boolean).join(" · ")}</summary>
              <ul className="mt-1 flex flex-col gap-0.5 border-l border-line pl-3">{steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
              {updates.map((u, i) => <Markdown key={i} text={u} sem={sem} className="mt-2 border-l border-line pl-3 text-xs text-muted" />)}
            </details>
          )}
          {msg.text && <Markdown text={msg.text} sem={sem} />}
          {visuals.map((v) => <Visual key={v} path={v} />)}
        </>
      )}
      {!live && files.length > 0 && (files.length <= SHOW_FILES ? <FileLinks files={files} /> : (
        <details className="text-xs">
          <summary className="cursor-pointer select-none font-semibold text-ink">📄 {plural(files.length, "file")} written</summary>
          <FileLinks files={files} className="mt-1.5" />
        </details>
      ))}
      {msg.error && <p className="rounded-lg bg-bad-bg px-3 py-2 text-xs text-bad">{msg.error}</p>}
    </div>
  );
}

/** Saved chats, newest first; each can be deleted, or all at once (onDelete asks first). */
function HistoryList({ chats, active, onPick, onDelete }: { chats: ChatSummary[]; active?: string; onPick: (id: string) => void; onDelete: (id?: string) => void }) {
  if (!chats.length) return <p className="text-sm text-muted">No chats yet.</p>;
  return (
    <>
      <ul className="flex flex-col gap-1">
        {chats.map((c) => (
          <li key={c.id} className={cx("group flex items-center rounded-lg hover:bg-surface-2", c.id === active && "bg-surface-2")}>
            <button type="button" onClick={() => onPick(c.id)} aria-current={c.id === active ? "true" : undefined} className="min-w-0 flex-1 px-3 py-2 text-left">
              <div className="truncate text-sm font-semibold">{c.title}</div>
              <div className="text-xs text-muted">{new Date(c.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{c.tool ? ` · ${c.tool}` : ""}</div>
            </button>
            <button type="button" aria-label={`Delete ${c.title}`} title="Delete this chat" onClick={() => onDelete(c.id)}
              className="mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-bad-bg hover:text-bad sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100">🗑</button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => onDelete()} className="mt-3 rounded-full px-3 py-1.5 text-xs text-muted hover:bg-bad-bg hover:text-bad">Delete all chats</button>
    </>
  );
}
