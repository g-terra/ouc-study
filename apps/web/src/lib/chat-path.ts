/**
 * The full-page Ask AI chat lives at /<sem>/chat (or /v2/<sem>/chat), and /…/chat/<chat id> for one chat,
 * so a conversation can be bookmarked or opened in a new tab. No imports: unit-tested on its own (apps/web/test/chat-path.test.ts).
 */
const CHAT = /^((?:\/v2)?\/[^/#]+\/chat)(?:\/[^/#]+)?\/?(?:#.*)?$/;

/** Whether a path is the full-page chat. */
export const isChatPath = (path: string) => CHAT.test(path);

/** A full-page chat path moved to another chat (or a new one), in the same semester and look. */
export function chatPathFor(path: string, id?: string): string {
  const base = path.match(CHAT)?.[1];
  if (!base) return path;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}
