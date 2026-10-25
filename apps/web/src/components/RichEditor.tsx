import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import katex from "katex";
import { FORMULA_SNIPPETS, insertSnippet, toEditorHtml } from "../lib/answer-html";
import { AlignCenter, AlignLeft, AlignRight, Code, ImagePlus, List, ListOrdered, SquareCode } from "./icons";
import { cx } from "./ui";

const tex = (latex: string, display = false) => katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: false });

/** A formula in an answer: saved as <span data-latex="…">, drawn with KaTeX, edited in the formula pop-up. */
const Formula = Node.create({
  name: "formula",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: "", parseHTML: (el) => el.getAttribute("data-latex") ?? "", renderHTML: (a) => ({ "data-latex": a.latex }) } };
  },
  parseHTML() { return [{ tag: "span[data-latex]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { class: "formula" })]; },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "formula";
      dom.dataset.latex = node.attrs.latex;
      dom.innerHTML = tex(node.attrs.latex);
      return { dom };
    };
  },
});

// code blocks get syntax colours; with no language set, lowlight guesses it
const lowlight = createLowlight(common);

const EXTENSIONS = [
  StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false, link: false }),
  TextStyle, Color, Highlight, Formula, CodeBlockLowlight.configure({ lowlight }), Image.configure({ allowBase64: false }),
  TextAlign.configure({ types: ["paragraph"], alignments: ["left", "center", "right"] }),
];

/** An answer shown as the editor shows it (formulas drawn, code coloured), but not editable: for the print page. */
export function AnswerView({ html, className }: { html?: string; className?: string }) {
  const editor = useEditor({ extensions: EXTENSIONS, content: toEditorHtml(html), editable: false, editorProps: { attributes: { class: cx("answer-text", className) } } });
  return <EditorContent editor={editor} />;
}

// fixed colours (not theme tokens): the answer goes into a PDF on white paper
const COLOURS = [["Black text", null], ["Orange text", "#c2410c"], ["Blue text", "#1d4ed8"], ["Green text", "#15803d"]] as const;

/**
 * A rich answer box: bold, italic, underline, colours, highlight, lists, code, formulas and pictures.
 * Saves HTML through onChange; `upload` stores a picture and returns its address.
 */
export function RichEditor({ label, value, onChange, upload, onError, minHeight = "10rem" }: {
  label: string; value?: string; onChange: (html: string) => void; upload?: (file: File) => Promise<string>; onError?: (msg: string) => void; minHeight?: string;
}) {
  const change = useRef(onChange);
  change.current = onChange;
  const editorRef = useRef<Editor | null>(null);
  const addPictures = (files: File[], at?: number) => {
    const pics = files.filter((f) => f.type.startsWith("image/"));
    if (!upload || !pics.length) return false;
    for (const f of pics) {
      upload(f).then((src) => {
        const e = editorRef.current;
        if (!e) return;
        const chain = e.chain().focus();
        (at === undefined ? chain : chain.setTextSelection(at)).setImage({ src, alt: f.name }).run();
      }, (err: Error) => onError?.(err.message));
    }
    return true;
  };
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: toEditorHtml(value),
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": label, class: "answer-text px-4 py-3 outline-none", style: `min-height: ${minHeight}` },
      handlePaste: (_v, ev) => addPictures([...(ev.clipboardData?.files ?? [])]),
      handleDrop: (view, ev) => addPictures([...((ev as DragEvent).dataTransfer?.files ?? [])], view.posAtCoords({ left: ev.clientX, top: ev.clientY })?.pos),
    },
    onUpdate: ({ editor: e }) => change.current(e.isEmpty ? "" : e.getHTML()),
  });
  editorRef.current = editor;
  const [formula, setFormula] = useState<string | null>(null);
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-semibold" aria-hidden>{label}</span>
      <div className="rounded-xl border border-line bg-surface focus-within:border-muted">
        <Toolbar editor={editor} onPictures={upload ? (files) => addPictures(files) : undefined} onFormula={() => {
          const sel = editor.state.selection;
          setFormula(sel instanceof NodeSelection && sel.node.type.name === "formula" ? sel.node.attrs.latex : "");
        }} />
        {formula !== null && (
          <FormulaPopup initial={formula} onCancel={() => { setFormula(null); editor.commands.focus(); }}
            onInsert={(latex) => {
              setFormula(null);
              if (latex.trim()) editor.chain().focus().insertContent({ type: "formula", attrs: { latex: latex.trim() } }).run();
              else editor.commands.focus();
            }} />
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor, onFormula, onPictures }: { editor: Editor; onFormula: () => void; onPictures?: (files: File[]) => void }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), highlight: e.isActive("highlight"),
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), code: e.isActive("code"), align: (["center", "right"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left", codeBlock: e.isActive("codeBlock"), color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
    }),
  });
  // buttons keep the focus (and the cursor) in the answer
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const btn = (active: boolean) => cx("grid h-8 min-w-8 place-items-center rounded-md px-1.5", active ? "bg-ink text-bg" : "hover:bg-surface");
  const sep = <span aria-hidden className="mx-1 h-5 w-px bg-line" />;
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-line bg-surface-2 p-1.5">
      <button type="button" aria-label="Bold" aria-pressed={on.bold} onMouseDown={keep} onClick={() => editor.chain().focus().toggleBold().run()} className={cx(btn(on.bold), "font-extrabold")}>B</button>
      <button type="button" aria-label="Italic" aria-pressed={on.italic} onMouseDown={keep} onClick={() => editor.chain().focus().toggleItalic().run()} className={cx(btn(on.italic), "font-serif italic")}>I</button>
      <button type="button" aria-label="Underline" aria-pressed={on.underline} onMouseDown={keep} onClick={() => editor.chain().focus().toggleUnderline().run()} className={cx(btn(on.underline), "underline")}>U</button>
      {sep}
      {COLOURS.map(([name, c]) => (
        <button key={name} type="button" aria-label={name} aria-pressed={on.color === c} onMouseDown={keep}
          onClick={() => (c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run())} className={btn(false)}>
          <span className={cx("size-4 rounded-full", on.color === c && "ring-2 ring-muted ring-offset-2 ring-offset-surface-2", !c && "bg-ink")} style={c ? { background: c } : undefined} />
        </button>
      ))}
      <button type="button" aria-label="Highlight" aria-pressed={on.highlight} onMouseDown={keep} onClick={() => editor.chain().focus().toggleHighlight().run()} className={btn(on.highlight)}>
        <span className="rounded-sm bg-warn-bg px-1 text-xs font-bold text-warn">H</span>
      </button>
      {sep}
      <button type="button" aria-label="Bulleted list" aria-pressed={on.bullet} onMouseDown={keep} onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(on.bullet)}><List aria-hidden className="size-4" /></button>
      <button type="button" aria-label="Numbered list" aria-pressed={on.ordered} onMouseDown={keep} onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(on.ordered)}><ListOrdered aria-hidden className="size-4" /></button>
      {sep}
      {([["Align left", "left", AlignLeft], ["Centre", "center", AlignCenter], ["Align right", "right", AlignRight]] as const).map(([name, a, Icon]) => (
        <button key={a} type="button" aria-label={name} aria-pressed={on.align === a} onMouseDown={keep}
          onClick={() => editor.chain().focus().setTextAlign(a).run()} className={btn(on.align === a)}><Icon aria-hidden className="size-4" /></button>
      ))}
      {sep}
      <button type="button" aria-label="Inline code" aria-pressed={on.code} onMouseDown={keep} onClick={() => editor.chain().focus().toggleCode().run()} className={btn(on.code)}><Code aria-hidden className="size-4" /></button>
      <button type="button" aria-label="Code block" aria-pressed={on.codeBlock} onMouseDown={keep} onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={btn(on.codeBlock)}><SquareCode aria-hidden className="size-4" /></button>
      {onPictures && (
        <label title="Add a picture (or paste or drop one)" className={cx(btn(false), "cursor-pointer focus-within:ring-2 focus-within:ring-muted")} onMouseDown={keep}>
          <ImagePlus aria-hidden className="size-4" />
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple aria-label="Add a picture" className="sr-only"
            onChange={(e) => { onPictures([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </label>
      )}
      <button type="button" onMouseDown={keep} onClick={onFormula} title="Insert a formula, or change the one selected"
        className="ml-1 h-8 rounded-md bg-surface px-2.5 font-serif font-semibold ring-1 ring-line hover:ring-muted">∑ Formula</button>
    </div>
  );
}

/** Writes a formula: symbol buttons, the LaTeX and a live preview. */
function FormulaPopup({ initial, onInsert, onCancel }: { initial: string; onInsert: (latex: string) => void; onCancel: () => void }) {
  const [latex, setLatex] = useState(initial);
  const input = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (caret.current === null || !input.current) return;
    input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [latex]);
  const add = (snippet: string) => {
    const el = input.current;
    const r = insertSnippet(latex, el?.selectionStart ?? latex.length, el?.selectionEnd ?? latex.length, snippet);
    caret.current = r.caret;
    setLatex(r.value);
    el?.focus();
  };
  return (
    <div role="dialog" aria-label="Insert a formula" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
      className="m-2 grid gap-2.5 rounded-xl border border-line bg-surface p-3.5 shadow-lg">
      <div className="flex flex-wrap gap-1.5">
        {FORMULA_SNIPPETS.map((s) => (
          <button key={s.label} type="button" aria-label={s.label} title={s.label} onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.tex)}
            className="min-w-9 rounded-lg border border-line bg-surface-2 px-2 py-1 font-serif hover:border-muted">{s.show}</button>
        ))}
      </div>
      <label className="grid gap-1">
        <span className="text-xs font-semibold text-muted">Formula in LaTeX</span>
        <textarea ref={input} value={latex} rows={2} onChange={(e) => setLatex(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onInsert(latex); } }}
          className="rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-muted" />
      </label>
      <div className="text-xs font-semibold text-muted">Preview</div>
      <div data-testid="formula-preview" className="grid min-h-12 place-items-center overflow-x-auto rounded-lg bg-bg px-3 py-2"
        dangerouslySetInnerHTML={{ __html: latex.trim() ? tex(latex, true) : '<span class="text-sm text-muted">Type a formula, or start with a button above.</span>' }} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-full border border-line px-4">Cancel</button>
        <button type="button" onClick={() => onInsert(latex)} className="min-h-10 rounded-full bg-ink px-4 font-semibold text-bg">Insert</button>
      </div>
    </div>
  );
}
