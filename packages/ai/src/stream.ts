// Runs an agent tool one turn at a time for the study app and turns its JSON output into a small
// set of events the app understands:
//   { type: "session", id }          the tool's conversation id (to continue the chat later)
//   { type: "text", text }           a piece of the reply (Markdown)
//   { type: "tool", label }          one line about what it's doing ("Reading notes/x.md")
//   { type: "file", path }           a file it wrote or changed (repo-relative)
//   { type: "error", message }
//   { type: "done", ok }
// Each tool prints its own JSON shape; parse<Tool>() maps one parsed line to zero or more events.
import { isAbsolute, relative, sep } from "node:path";
import { agentCommand, agentEnv, chat, spawnCli, type AiConfig, type ChatMessage, type LocalModel } from "./providers.ts";

export type AgentEvent =
  | { type: "session"; id: string }
  | { type: "text"; text: string; delta?: boolean }
  | { type: "tool"; label: string }
  | { type: "file"; path: string }
  | { type: "error"; message: string }
  | { type: "done"; ok: boolean };
/** A run in progress, handed to onStart so the caller can stop it. */
export interface RunHandle { stop(): void }
export interface TurnOptions { resume?: string; onEvent?: (e: AgentEvent) => void; onStart?: (h: RunHandle) => void; bin?: string }
/** One line of a tool's JSON output: each tool has its own shape, read field by field. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolJson = any;
type ToolInput = { [key: string]: string | undefined };

const short = (v: unknown, n = 90): string => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
export const relPath = (root: string, p: string | undefined) => {
  if (!p) return "";
  const r = isAbsolute(p) ? relative(root, p) : p;
  // the app links paths with forward slashes (Windows paths come back with backslashes)
  return (sep === "\\" ? r.replace(/\\/g, "/") : r).replace(/^\.\//, "");
};
const fileName = (p: unknown) => String(p ?? "").split(/[\\/]/).pop();

/** "Read" + {file_path} → "Reading x.md" (shared wording for every tool). */
export function toolLabel(name: unknown, input: ToolInput = {}, _root = ""): string {
  const n = String(name ?? "").toLowerCase();
  const path = input.file_path ?? input.filePath ?? input.path ?? input.notebook_path;
  if (/^read$|read_file|^view$/.test(n)) return `Reading ${fileName(path) || "a file"}`;
  if (/^(write|edit|multiedit|patch|apply_patch|notebookedit)$/.test(n)) return `Writing ${fileName(path) || "a file"}`;
  if (/^(grep|glob|search|find|list|ls)$/.test(n)) return `Searching ${short(input.pattern ?? input.query ?? path ?? "", 50)}`.trim();
  if (/web_?search/.test(n)) return `Searching the web: ${short(input.query, 60)}`;
  if (/web_?fetch|^fetch$/.test(n)) return `Opening ${short(input.url, 60)}`;
  if (/^bash$|command|shell/.test(n)) return `Running ${short(input.command ?? input.cmd, 70)}`;
  if (/^(task|agent)$/.test(n)) return `Asking the ${input.subagent_type ?? "helper"} agent`;
  if (/todo/.test(n)) return "Updating its to-do list";
  return short(name);
}
const WRITES = /^(write|edit|multiedit|notebookedit)$/i;

/** Claude Code: --output-format stream-json */
export function parseClaude(j: ToolJson, root = ""): AgentEvent[] {
  const ev: AgentEvent[] = [];
  if (j.type === "system" && j.subtype === "init" && j.session_id) ev.push({ type: "session", id: j.session_id });
  if (j.type === "assistant") {
    for (const c of j.message?.content ?? []) {
      if (c.type === "text" && c.text) ev.push({ type: "text", text: c.text });
      if (c.type === "tool_use") {
        ev.push({ type: "tool", label: toolLabel(c.name, c.input, root) });
        const p = c.input?.file_path ?? c.input?.notebook_path;
        if (WRITES.test(c.name) && p) ev.push({ type: "file", path: relPath(root, p) });
      }
    }
  }
  if (j.type === "result") {
    if (j.is_error || (j.subtype && j.subtype !== "success")) ev.push({ type: "error", message: short(j.result || j.subtype, 300) });
    if (j.session_id) ev.push({ type: "session", id: j.session_id });
  }
  return ev;
}

/** Codex: codex exec --json */
export function parseCodex(j: ToolJson, root = ""): AgentEvent[] {
  const ev: AgentEvent[] = [];
  if (j.type === "thread.started" && j.thread_id) ev.push({ type: "session", id: j.thread_id });
  const it = j.item;
  if (it && j.type === "item.started") {
    if (it.type === "command_execution") ev.push({ type: "tool", label: toolLabel("bash", { command: it.command }) });
    if (it.type === "web_search") ev.push({ type: "tool", label: toolLabel("web_search", { query: it.query }) });
    if (it.type === "mcp_tool_call") ev.push({ type: "tool", label: short(`${it.server ?? ""} ${it.tool ?? ""}`) });
  }
  if (it && j.type === "item.completed") {
    if (it.type === "agent_message" && it.text) ev.push({ type: "text", text: it.text });
    if (it.type === "file_change") for (const ch of it.changes ?? []) {
      ev.push({ type: "tool", label: toolLabel("write", { path: ch.path }) }, { type: "file", path: relPath(root, ch.path) });
    }
    if (it.type === "error" && it.message) ev.push({ type: "error", message: short(it.message, 300) });
  }
  if (j.type === "turn.failed") ev.push({ type: "error", message: short(j.error?.message ?? "Codex stopped with an error", 300) });
  if (j.type === "error" && j.message) ev.push({ type: "error", message: short(j.message, 300) });
  return ev;
}

/** opencode: opencode run --format json */
export function parseOpencode(j: ToolJson, root = ""): AgentEvent[] {
  const ev: AgentEvent[] = [];
  const sid = j.sessionID ?? j.part?.sessionID;
  if (sid) ev.push({ type: "session", id: sid });
  const part = j.part ?? {};
  if (j.type === "text" && part.text) ev.push({ type: "text", text: part.text });
  if (j.type === "tool_use" || part.type === "tool") {
    const input = part.state?.input ?? {};
    ev.push({ type: "tool", label: toolLabel(part.tool, input, root) });
    const p = input.filePath ?? input.file_path ?? input.path;
    if (/^(write|edit|patch)$/i.test(part.tool ?? "") && p && part.state?.status !== "error") ev.push({ type: "file", path: relPath(root, p) });
  }
  if (j.type === "error") ev.push({ type: "error", message: short(j.error?.data?.message ?? j.error?.message ?? j.error?.name ?? "opencode stopped with an error", 300) });
  return ev;
}

const PARSER: Record<string, (j: ToolJson, root: string) => AgentEvent[]> = { claude: parseClaude, codex: parseCodex, opencode: parseOpencode };

/**
 * One turn with an agent tool. onEvent gets the events above; resolves when the tool exits.
 * Returns { stop } synchronously through opts.onStart so the caller can cancel the run.
 */
export function runAgentTurn(root: string, cfg: Pick<AiConfig, "tool">, prompt: string, { resume, onEvent, onStart, bin }: TurnOptions = {}): Promise<{ ok: boolean }> {
  const [cmd, args] = agentCommand(cfg, prompt, { json: true, resume });
  const parse = PARSER[cfg.tool ?? ""] ?? (() => []);
  return new Promise((done) => {
    let buf = "", err = "", sawError = false, finished = false;
    const emit = (e: AgentEvent) => { if (e.type === "error") sawError = true; onEvent?.(e); };
    const seenSession = new Set<string>();
    const handle = (line: string) => {
      line = line.trim();
      if (!line.startsWith("{")) return;
      let j;
      try { j = JSON.parse(line); } catch { return; }
      for (const e of parse(j, root)) {
        if (e.type === "session") { if (seenSession.has(e.id)) continue; seenSession.add(e.id); }
        emit(e);
      }
    };
    const p = spawnCli(bin ?? cmd, args, { cwd: root, env: agentEnv(cfg.tool ?? ""), stdio: ["ignore", "pipe", "pipe"] });
    const finish = (ok: boolean) => { if (finished) return; finished = true; done({ ok }); };
    onStart?.({ stop: () => { if (!finished) p.kill("SIGTERM"); } });
    p.stdout!.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    p.stderr!.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => { emit({ type: "error", message: `Couldn't start ${cmd}: ${e.message}` }); emit({ type: "done", ok: false }); finish(false); });
    p.on("exit", (code, signal) => {
      if (buf) handle(buf);
      if (signal) emit({ type: "error", message: "Stopped." });
      else if (code !== 0 && !sawError) emit({ type: "error", message: short(err.trim().split("\n").filter(Boolean).slice(-3).join(" ") || `${cmd} exited with code ${code}`, 400) });
      const ok = code === 0 && !signal;
      emit({ type: "done", ok });
      finish(ok);
    });
  });
}

/** One turn with a plain local model (no tools): the whole history is sent each time. */
export async function runChatTurn(local: LocalModel, messages: ChatMessage[], { onEvent, onStart }: Omit<TurnOptions, "resume" | "bin"> = {}): Promise<{ ok: boolean }> {
  const ctl = new AbortController();
  onStart?.({ stop: () => ctl.abort() });
  try {
    await chat(local, messages, { onToken: (t) => onEvent?.({ type: "text", text: t, delta: true }), temperature: 0.5, signal: ctl.signal });
    onEvent?.({ type: "done", ok: true });
    return { ok: true };
  } catch (e) {
    onEvent?.({ type: "error", message: ctl.signal.aborted ? "Stopped." : (e as Error).message });
    onEvent?.({ type: "done", ok: false });
    return { ok: false };
  }
}
