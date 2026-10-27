/**
 * Pre-submission review on the assignment page: upload your own .docx, your AI reviews it against the
 * brief, rubric and course material (feedback only, never rewritten answers), discuss it in Ask AI,
 * upload the fixed version for the next round, and approve one to get it as a PDF to submit.
 */
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { Assignment } from "@ouc/content/types";
import { Card, FileLink, SectionTitle, cx } from "../components/ui";
import { useAssistant } from "../components/Assistant";
import { approveDraft, getReview, uploadDraft, useAiStatus, type ReviewState, type ReviewVersion, type Verdict } from "../lib/ai";
import { NoteBody, useNoteBlocks } from "../notes/NoteRenderer";

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  ready: { label: "Ready to submit", cls: "bg-ok-bg text-ok" },
  almost: { label: "Almost there", cls: "bg-warn-bg text-warn" },
  "needs-work": { label: "Needs work", cls: "bg-bad-bg text-bad" },
};
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export function ReviewSection({ sem, a, color }: { sem: string; a: Assignment; color: string }) {
  const ai = useAiStatus();
  const { start, load, setOpen } = useAssistant();
  const [state, setState] = useState<ReviewState | null>(null);
  const [busy, setBusy] = useState<"upload" | "approve" | null>(null);
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState(false);
  const [pick, setPick] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const agents = ai.tools.filter((t) => t.id !== "local" && t.state === "connected");
  const tool = pick ?? (agents.find((t) => t.chosen) ?? agents[0])?.id;

  const refresh = () => getReview(sem, a.id).then(setState).catch(() => setState(null));
  useEffect(() => { if (ai.state === "ok") refresh(); }, [sem, a.id, ai.state]);
  const running = state?.versions.some((v) => v.review?.running);
  // while a review runs, or the student just pressed Start in Ask AI, look again every few seconds
  const [watch, setWatch] = useState(0);
  useEffect(() => {
    if (running && watch) setWatch(0);
    if (!running && !watch) return;
    const t = window.setInterval(refresh, 3000);
    const stop = watch && !running ? window.setTimeout(() => setWatch(0), 120_000) : undefined;
    return () => { window.clearInterval(t); window.clearTimeout(stop); };
  }, [running, watch]);

  if (ai.state !== "ok") return null; // a static build has no app server to upload to
  const review = (v: ReviewVersion) => { start("assignment-review", { course: a.code, assignment: a.id, version: String(v.v) }, tool); setWatch(Date.now()); };
  const upload = async (file?: File) => {
    if (!file) return;
    setError(undefined);
    if (!/\.docx$/i.test(file.name)) { setError("Upload a Word .docx file. In Word or Pages, use Save As → .docx."); return; }
    setBusy("upload");
    try {
      const r = await uploadDraft(sem, a.id, file);
      setState(r);
      // Ask AI opens with the review ready to start (add anything you want it to look at first)
      if (r.version && agents.length) review(r.version);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); if (input.current) input.current.value = ""; }
  };
  const approve = async (v: number) => {
    setError(undefined); setBusy("approve");
    try { setState(await approveDraft(sem, a.id, v)); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); };

  const versions = state?.versions ?? [];
  const latest = versions.at(-1);
  const older = versions.slice(0, -1).reverse();
  const picker = agents.length > 1 && (
    <select aria-label="Which AI reviews it" value={tool} onChange={(e) => setPick(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
      {agents.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
    </select>
  );
  const drop = (
    <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
      className={cx("flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4 text-sm", drag ? "border-accent bg-surface-2" : "border-line")}>
      <input ref={input} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <button type="button" disabled={!!busy} onClick={() => input.current?.click()} className="rounded-full bg-ink px-3 py-1.5 font-semibold text-bg disabled:opacity-40">
        {busy === "upload" ? "Uploading…" : latest ? `⬆ Upload version ${latest.v + 1}` : "⬆ Upload your .docx"}
      </button>
      <span className="text-muted">{latest ? "Fixed things? Upload the new .docx for another round." : "or drop it here."}</span>
      {picker && <span className="flex items-center gap-2 text-muted">Reviewed by {picker}</span>}
    </div>
  );

  return (
    <>
      <SectionTitle right={versions.length > 0 && <span className="text-xs text-muted">{versions.length} {versions.length === 1 ? "round" : "rounds"}</span>}>Review before submitting</SectionTitle>
      {!latest && (
        <Card className="p-5">
          <p className="mb-4 text-sm">Upload your solution as a Word <b>.docx</b>. Your AI reviews it against the brief, the marking criteria and this week's material, and says what to fix and why. It won't rewrite it: you make the changes, upload the next version, and when you're happy, approve it to get a PDF to submit.</p>
          {drop}
        </Card>
      )}
      {latest && (
        <Card className="p-5">
          <Round v={latest} color={color} />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            {latest.review?.chatId && (
              <button type="button" onClick={() => { setOpen(true); load(latest.review!.chatId!); }} className="rounded-full border border-line bg-surface px-3 py-1.5 font-medium hover:border-muted">
                💬 {latest.review.running ? "Watch" : "Discuss in Ask AI"}
              </button>
            )}
            {agents.length > 0 && !latest.review?.running && (
              <button type="button" onClick={() => review(latest)} className="rounded-full border border-line bg-surface px-3 py-1.5 font-medium hover:border-muted">
                🔍 {latest.review?.body ? "Review again" : "Review it"}
              </button>
            )}
          </div>
          <Approve state={state!} v={latest} busy={busy === "approve"} onApprove={() => approve(latest.v)} />
          <div className="mt-5">{drop}</div>
        </Card>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">{error}</p>}
      {older.length > 0 && (
        <div className="mt-3 grid gap-2">
          {older.map((v) => (
            <details key={v.v} className="rounded-2xl border border-line bg-surface px-5 py-3">
              <summary className="cursor-pointer select-none text-sm font-semibold">
                Version {v.v} <span className="font-normal text-muted">· {v.name} · {when(v.uploaded)}{v.review?.verdict ? ` · ${VERDICT[v.review.verdict]?.label ?? v.review.verdict}` : ""}{state?.approved?.v === v.v ? " · approved" : ""}</span>
              </summary>
              <div className="mt-3">
                <Round v={v} color={color} />
                {v.review?.chatId && <button type="button" className="mt-3 text-sm underline" onClick={() => { setOpen(true); load(v.review!.chatId!); }}>Open that discussion</button>}
              </div>
            </details>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Feedback and pointers only. Your files stay on this computer, in this assignment's folder.</p>
    </>
  );
}

/** One version: the file and the AI's review of it. */
function Round({ v, color }: { v: ReviewVersion; color: string }) {
  const blocks = useNoteBlocks(v.review?.body ?? "");
  const verdict = v.review?.verdict && VERDICT[v.review.verdict];
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">Version {v.v}</span>
        <a href={v.href} download={v.name} className="text-sm underline decoration-line underline-offset-2 hover:text-ink">📄 {v.name}</a>
        <span className="text-xs text-muted">{v.words.toLocaleString("en-GB")} words · uploaded {when(v.uploaded)}</span>
        {verdict && <span className={cx("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", verdict.cls)}>{verdict.label}</span>}
        {v.review?.by && v.review.body && <span className="text-xs text-muted">Reviewed by {v.review.by}</span>}
      </div>
      {v.review?.running ? (
        <p className="mt-4 flex items-center gap-3 text-sm">
          <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Reviewing against the brief and the course material…
        </p>
      ) : v.review?.body ? (
        <div className="mt-4"><NoteBody blocks={blocks} color={color} /></div>
      ) : (
        <p className="mt-4 text-sm text-muted">{v.review?.chatId && v.review.ok === false ? "The review stopped before it finished. Open the discussion to see why, or review it again." : "Not reviewed yet."}</p>
      )}
    </>
  );
}

/** Approve: the student's own .docx, converted to a PDF on this computer. */
function Approve({ state, v, busy, onApprove }: { state: ReviewState; v: ReviewVersion; busy: boolean; onApprove: () => void }) {
  const ap = state.approved;
  if (ap?.v === v.v) {
    return (
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-ok-bg px-4 py-3 text-sm text-ok">
        <span className="font-semibold">✅ Version {v.v} approved</span>
        <FileLink href={ap.href} className="font-semibold underline">Open {ap.pdf}</FileLink>
        <a href={ap.href} download={ap.pdf} className="underline">Download</a>
        <span className="text-ink/70">Made with {ap.with} on {when(ap.at)}. Upload it on eClass yourself.</span>
      </div>
    );
  }
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm">
      <button type="button" disabled={busy || v.review?.running} onClick={onApprove} className="rounded-full bg-ok px-3 py-1.5 font-semibold text-bg disabled:opacity-40">
        {busy ? "Making the PDF…" : `✓ Approve version ${v.v} and make the PDF`}
      </button>
      <span className="text-xs text-muted">
        {ap ? `Version ${ap.v} was approved before. ` : ""}
        {state.converter ? `Your .docx is converted as it is, with ${state.converter}.` : "Making the PDF needs LibreOffice (free). Without it, use File → Save as PDF in Word."}
      </span>
    </div>
  );
}
