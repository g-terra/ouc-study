import { useMemo } from "react";
import { parseNote, type Block } from "./parse";
import { Callout, DataBlock, Markdown } from "./Blocks";
import { Mermaid } from "./Mermaid";

export function useNoteBlocks(body: string) {
  return useMemo(() => parseNote(body), [body]);
}

export function NoteBody({ blocks, color }: { blocks: Block[]; color: string }) {
  return (
    <div>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "h2":
            return (
              <h2 key={i} id={b.id} className="mb-3 mt-12 flex scroll-mt-24 items-center gap-3 font-serif text-2xl font-semibold first:mt-0">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg font-sans text-sm font-bold text-white" style={{ background: color }}>{b.n}</span>
                {b.text}
              </h2>
            );
          case "md": return <Markdown key={i} text={b.text} />;
          case "callout": return <Callout key={i} kind={b.kind} title={b.title} text={b.text} />;
          case "mermaid": return <Mermaid key={i} code={b.code} />;
          case "data": return <DataBlock key={i} kind={b.kind} data={b.data} />;
        }
      })}
    </div>
  );
}
