import { useCallback, useEffect, useState } from "react";
import { Link, enc } from "../lib/router";
import { progressText } from "@ouc/backup/progress";
import { tokenHelp, type HelpOs } from "@ouc/backup/help";
import { getBackup, postBackup, statusLine, type BackupInfo } from "../lib/backup";
import { Card, Switch, cx } from "../components/ui";
import { CircleHelp, CloudUpload, Copy, Check, TriangleAlert, X } from "../components/icons";

/** /api/backup, checked again every few seconds while a backup or a sign-in is under way. */
function useBackup() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const load = useCallback(() => getBackup().then((j) => j && setInfo(j)), []);
  useEffect(() => { load(); }, [load]);
  const busy = !!info && (info.running || (!!info.signIn && !info.signIn.error));
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(load, 2000);
    return () => window.clearInterval(t);
  }, [busy, load]);
  return { info, setInfo, load };
}

const percent = (p: NonNullable<BackupInfo["progress"]>) =>
  Math.round(100 * (p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : p.total > 0 ? p.done / p.total : 0));

const button = "rounded-full px-3.5 py-2 text-sm font-semibold";
const primary = cx(button, "bg-ink text-bg hover:opacity-90 disabled:opacity-50");
const secondary = cx(button, "border border-line hover:bg-surface-2");

const thisOs = (): HelpOs => {
  const p = typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`;
  return /Win/i.test(p) ? "windows" : /Mac/i.test(p) ? "mac" : "linux";
};

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
      <button type="button" aria-label={`Copy ${command}`} className="shrink-0 rounded p-1 text-muted hover:text-ink"
        onClick={() => { void navigator.clipboard?.writeText(command).then(() => setCopied(true)).catch(() => {}); }}>
        {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      </button>
    </div>
  );
}

/** "How to get a token": the gh way and the github.com way, step by step. */
function TokenHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="token-help-title" className="w-full max-w-lg space-y-4 rounded-2xl border border-line bg-surface p-6 text-sm shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="token-help-title" className="font-serif text-2xl font-semibold">How to get a GitHub token</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1 text-muted hover:bg-surface-2"><X aria-hidden className="size-4" /></button>
        </div>
        <p className="text-muted">Two ways. Either one ends with a token to paste into Settings › Backup.</p>
        {tokenHelp(thisOs()).map((way) => (
          <section key={way.title} aria-label={way.title} className="space-y-2 rounded-xl border border-line p-4">
            <h3 className="font-semibold">{way.title}</h3>
            <p className="text-xs text-muted">{way.note}</p>
            <ol className="list-decimal space-y-2 pl-5">
              {way.steps.map((st) => (
                <li key={st.text} className="space-y-1">
                  <span>{st.text}</span>
                  {st.link && <> <a className="underline" href={st.link} target="_blank" rel="noreferrer">Open</a></>}
                  {st.command && <CopyCommand command={st.command} />}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Not set up yet: GitHub (sign in with a code, or paste a token) or Google Drive. */
function Connect({ info, reload }: { info: BackupInfo; reload: () => void }) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(!info.can.githubDevice);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [help, setHelp] = useState(false);
  const act = async (path: string, body?: unknown) => {
    setError(null); setWorking(true);
    const r = await postBackup(path, body);
    setWorking(false);
    if (r.error) setError(r.error);
    else if (typeof r.url === "string") window.open(r.url, "_blank", "noopener");
    reload();
  };
  const code = info.signIn?.kind === "github" && info.signIn.userCode ? info.signIn : null;
  return (
    <div className="space-y-3">
      <p>Keep a copy of everything you made and downloaded: notes, course files, class videos, quizzes and scores, homework answers, progress, your AI memory and chats. Your eClass key and the backup's sign-in never go in.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-labelledby="backup-github" className="space-y-2 rounded-xl border border-line p-3">
          <h3 id="backup-github" className="font-semibold">A private GitHub repo</h3>
          <p className="text-xs text-muted">Every backup is kept as a version you can go back to. Big files go up in parts; class videos as smaller copies.</p>
          {code ? (
            <div className="space-y-1" role="status">
              <p className="font-mono text-xl font-bold tracking-widest">{code.userCode}</p>
              <p className="text-xs">Open <a className="underline" href={code.verificationUri} target="_blank" rel="noreferrer">{code.verificationUri}</a> and type this code. This page carries on by itself.</p>
            </div>
          ) : info.can.githubDevice && (
            <button type="button" className={primary} disabled={working} onClick={() => act("github/start")}>Sign in with GitHub</button>
          )}
          {info.can.githubDevice && !showToken && (
            <button type="button" className="block text-xs text-muted underline hover:text-ink" onClick={() => setShowToken(true)}>Use a token instead</button>
          )}
          {showToken && (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); act("github/token", { token }); }}>
              <label className="block text-xs">
                <span className="mb-1 block text-muted">GitHub token (fine-grained, Contents read and write; Administration to make the repo)</span>
                <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-sm" />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className={primary} disabled={working || !token.trim()}>Connect GitHub</button>
                <button type="button" className={cx(secondary, "inline-flex items-center gap-1.5")} onClick={() => setHelp(true)}><CircleHelp aria-hidden className="size-4" />How to get a token</button>
              </div>
            </form>
          )}
          {help && <TokenHelp onClose={() => setHelp(false)} />}
        </section>
        <section aria-labelledby="backup-drive" className="space-y-2 rounded-xl border border-line p-3">
          <h3 id="backup-drive" className="font-semibold">Google Drive</h3>
          <p className="text-xs text-muted">Uploads to an "OUC Study backup" folder in your Drive. The app can only see the files it made.</p>
          {info.can.google
            ? <button type="button" className={secondary} disabled={working} onClick={() => act("google/start")}>Sign in with Google</button>
            : <p className="text-xs text-muted">Not available in this version of the app yet.</p>}
          {info.signIn?.kind === "google" && !info.signIn.error && <p className="text-xs" role="status">Finish signing in in the browser tab that opened…</p>}
        </section>
      </div>
      {(error ?? info.signIn?.error) && <p className="text-sm text-bad" role="alert">{error ?? info.signIn?.error}</p>}
    </div>
  );
}

/** Set up: where it goes, the last backup, Back up now, and the choices. */
function Connected({ info, setInfo, reload }: { info: BackupInfo; setInfo: (i: BackupInfo) => void; reload: () => void }) {
  const setup = info.setup!;
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    setInfo({ ...info, running: true });
    const r = await postBackup("run");
    if (r.error) setError(r.error);
    reload();
  };
  const choose = async (k: keyof BackupInfo["choices"], on: boolean) => {
    setInfo({ ...info, choices: { ...info.choices, [k]: on } });   // the switch moves at once
    const r = await postBackup("choices", { [k]: on });
    if (r.error) { setError(r.error); reload(); }
  };
  const failed = info.status && !info.status.ok;
  const row = "flex items-center justify-between gap-3 border-t border-line pt-3";
  return (
    <div className="space-y-3">
      <p className={cx("flex items-start gap-1.5", failed ? "text-bad" : "")} data-testid="backup-status">
        {failed && <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
        {info.running ? (info.progress ? progressText(info.progress) : "Backing up…") : statusLine(info.status)}
      </p>
      {info.running && info.progress && (
        <div role="progressbar" aria-label="Backup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(info.progress)} className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent(info.progress)}%` }} />
        </div>
      )}
      <p className="text-xs text-muted">
        {setup.target === "github"
          ? <>To <a className="underline" href={`https://github.com/${setup.repo}`} target="_blank" rel="noreferrer">{setup.repo}</a> (private) · signed in as {setup.login}</>
          : <>To "OUC Study backup" in your Google Drive{setup.email ? ` · ${setup.email}` : ""}</>}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={run} disabled={info.running}>{info.running ? "Backing up…" : "Back up now"}</button>
        <button type="button" className={secondary} onClick={async () => { await postBackup("disconnect"); reload(); }}>Disconnect</button>
      </div>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <div className={row}>
        <span><span className="font-semibold">Back up automatically</span><br /><span className="text-xs text-muted">After each eClass sync, when something changed</span></span>
        <Switch checked={info.choices.auto} onChange={(on) => choose("auto", on)} label="Back up automatically" />
      </div>
      <div className={row}>
        <span><span className="font-semibold">Course files</span><br /><span className="text-xs text-muted">Slides, PDFs and readings (they can disappear from eClass after the semester)</span></span>
        <Switch checked={info.choices.courseFiles} onChange={(on) => choose("courseFiles", on)} label="Back up course files" />
      </div>
      <div className={row}>
        <span><span className="font-semibold">Class videos</span><br /><span className="text-xs text-muted">As smaller copies; the originals stay on this computer</span></span>
        <Switch checked={info.choices.videos && info.choices.courseFiles} disabled={!info.choices.courseFiles} onChange={(on) => choose("videos", on)} label="Back up class videos" />
      </div>
    </div>
  );
}

/** Settings › Backup. */
export function BackupSettings() {
  const { info, setInfo, load } = useBackup();
  if (!info) return <Card className="p-3 text-sm"><p className="px-2 text-muted">Only shown when the app runs on your computer (ouc open).</p></Card>;
  return (
    <Card className="p-4 text-sm">
      {info.setup ? <Connected info={info} setInfo={setInfo} reload={load} /> : <Connect info={info} reload={load} />}
    </Card>
  );
}

/** Once, for students who installed before backups existed (and after the tour): Set up now, Later (a week) or Don't ask again. */
export function BackupPrompt({ sem }: { sem: string }) {
  const { info } = useBackup();
  const [closed, setClosed] = useState(false);
  let tourSeen = false;
  try { tourSeen = localStorage.getItem("ouc-tour-seen") === "1"; } catch {}
  if (closed || !tourSeen || info?.prompt !== "show") return null;
  const answer = (action: "later" | "never") => { setClosed(true); void postBackup("prompt", { action }); };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="backup-prompt-title" className="w-full max-w-md space-y-4 rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <CloudUpload aria-hidden className="size-9 text-accent" />
          <button type="button" aria-label="Close" onClick={() => answer("later")} className="rounded-full p-1 text-muted hover:bg-surface-2"><X aria-hidden className="size-4" /></button>
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">New</div>
        <h2 id="backup-prompt-title" className="font-serif text-2xl font-semibold">Back up your study data</h2>
        <p className="text-muted">Keep a copy of your notes, course files, class videos, quizzes, homework answers and progress in a private GitHub repo or your Google Drive. If this laptop breaks, a new one gets it all back.</p>
        <div className="flex flex-col gap-2">
          <Link to={`/v2/${enc(sem)}/settings#settings-backup`} onClick={() => answer("later")} className={cx(primary, "text-center")}>Set up now</Link>
          <button type="button" className={secondary} onClick={() => answer("later")}>Later</button>
          <button type="button" className="py-2 text-sm text-muted underline hover:text-ink" onClick={() => answer("never")}>Don't ask again</button>
        </div>
      </div>
    </div>
  );
}

/** Top of the app when the last backup failed: the reason and a way to fix it. Hidden for this visit once closed. */
export function BackupFailedBar({ sem }: { sem: string }) {
  const { info } = useBackup();
  const s = info?.status;
  const key = `ouc-backup-failed-${s?.at ?? ""}`;
  const [closed, setClosed] = useState(() => { try { return sessionStorage.getItem(key) === "1"; } catch { return false; } });
  if (!info?.setup || !s || s.ok || closed) return null;
  return (
    <div role="alert" className="border-b border-line bg-bad-bg text-bad">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 text-sm">
        <TriangleAlert aria-hidden className="size-4 shrink-0" />
        <span className="flex-1"><span className="font-semibold">Backup didn't run.</span> {s.error}{" "}
          <Link to={`/v2/${enc(sem)}/settings#settings-backup`} className="font-semibold underline">Backup settings</Link>
        </span>
        <button type="button" aria-label="Hide" className="rounded-full p-1 hover:bg-surface-2" onClick={() => { setClosed(true); try { sessionStorage.setItem(key, "1"); } catch {} }}><X aria-hidden className="size-4" /></button>
      </div>
    </div>
  );
}
