import { useEffect, type ReactNode } from "react";
import type { SemesterData } from "@ouc/content/types";
import { useRouter } from "../lib/router";
import { refreshAi, useAiStatus } from "../lib/ai";
import { Card, PageHeader } from "../components/ui";
import { AiTools, AppVersion, DefaultAi, DefaultModels, ThemePicker, VideoTranscripts } from "../components/Layout";
import { ConnectionCard, SetupCard } from "../pages/Updates";
import { toClassic } from "./paths";
import { rememberLook } from "./look";

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className="mb-3 font-serif text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** The default AI and models: only when an AI is installed. */
function DefaultsCard() {
  const ai = useAiStatus();
  if (ai.state !== "ok" || !ai.tools.some((t) => t.state !== "missing")) return null;
  return (
    <Card className="mt-3 p-3 text-sm">
      <DefaultAi />
      <DefaultModels className="mt-4 border-t border-line pt-3" />
    </Card>
  );
}

/** Settings (from the profile menu): eClass, AI tools, video transcripts, appearance and the app version, one section each. */
export function SettingsPage({ data }: { data: SemesterData }) {
  const { path, navigate } = useRouter();
  useEffect(() => { refreshAi(); }, []);
  const s = data.updates.status;
  const sub = "mb-1 px-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted";
  return (
    <>
      <PageHeader title="Settings" eyebrow={data.label} />
      <Section title="eClass" id="settings-eclass">
        <ConnectionCard className="mb-3" />
        {(!s || !s.ok) && <SetupCard error={s?.error} />}
      </Section>
      <Section title="AI tools" id="settings-ai">
        <Card className="p-3 text-sm"><AiTools /></Card>
        <DefaultsCard />
      </Section>
      <Section title="Video transcripts" id="settings-transcripts">
        <Card className="p-3 text-sm"><VideoTranscripts head="hidden" fallback={<p className="px-2 text-muted">Only shown when the app runs on your computer (ouc open).</p>} /></Card>
      </Section>
      <Section title="Appearance" id="settings-appearance">
        <Card className="p-3 text-sm">
          <div className={sub}>Colour theme</div>
          <ThemePicker />
          <div className={`${sub} mt-4 border-t border-line pt-3`}>Look</div>
          <div className="space-y-1 px-2">
            <p className="text-muted">This is the new look. The classic one is still here for now.</p>
            <button type="button" className="font-semibold underline" onClick={() => { rememberLook("classic"); navigate(toClassic(path), { raw: true }); }}>
              Back to the classic look
            </button>
          </div>
        </Card>
      </Section>
      <Section title="About" id="settings-about">
        <Card className="p-3 text-sm"><AppVersion /></Card>
      </Section>
    </>
  );
}
