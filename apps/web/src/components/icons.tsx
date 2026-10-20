import type { ItemKind } from "@ouc/content/types";
import {
  Bell, BookOpen, Bot, Braces, CalendarDays, Clapperboard, ClipboardList, Compass, File, FileImage, FileText, Flame, GraduationCap, Hand, Headphones, Hourglass, Library, MessagesSquare, Monitor, NotebookPen, NotebookText, PartyPopper, Presentation, RefreshCw, Settings, Sparkles, Sun, Trash2, TriangleAlert, Trophy, User, Video, X,
  Link as LinkIcon, type LucideIcon,
} from "lucide-react";

// One icon set for the app (Lucide, ISC licence): thin line icons in the text colour, so they suit every colour theme.
export {
  Bell, Bot, BookOpen, CalendarDays, ClipboardList, Compass, FileImage, FileText, Flame, GraduationCap, Hand, Headphones, Hourglass, Library, MessagesSquare, NotebookPen, PartyPopper, RefreshCw, Settings, Sparkles, Sun, Trash2, TriangleAlert, Trophy, User, Video, X,
  type LucideIcon,
};

/** Classes for an icon that sits inside a line of text: as tall as the letters, on the same baseline. */
export const INLINE = "inline-block size-[1.1em] shrink-0 align-[-0.18em]";

const KIND_ICON: Record<ItemKind, LucideIcon> = { file: File, video: Clapperboard, link: LinkIcon, assignment: ClipboardList, forum: MessagesSquare, tool: Monitor, note: NotebookPen };
// the file type keeps a colour of its own, like the emoji had (PDF red, slides amber, Word blue)
const EXT_ICON: Record<string, [LucideIcon, string?]> = {
  pdf: [FileText, "text-bad"], pptx: [Presentation, "text-warn"], docx: [FileText, "text-info"], ipynb: [Braces, "text-ok"],
  png: [FileImage], jpg: [FileImage], jpeg: [FileImage], md: [NotebookText],
};

/** The icon for a week item, or for a file by its extension. */
export function KindIcon({ kind, ext, className = INLINE }: { kind: ItemKind; ext?: string; className?: string }) {
  const [Icon, tint] = (kind === "file" && ext && EXT_ICON[ext]) || [KIND_ICON[kind], "text-muted"];
  return <Icon aria-hidden className={`${className} ${tint ?? "text-muted"}`} />;
}

/** The OUC Study logo: an O with a bookmark ribbon, drawn in the theme's colours (docs/images/logo.svg and the favicon in index.html are fixed-colour copies). */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <circle cx="15" cy="15.5" r="7.5" fill="none" stroke="var(--bg)" strokeWidth="3.6" />
      <path d="M19.5 16h5.5v11l-2.75-2.2L19.5 27z" fill="var(--accent)" />
    </svg>
  );
}
