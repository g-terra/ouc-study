/**
 * The guided tour of the new look: a few steps that each point at one part of the app. It opens by itself
 * the first time the app is opened (remembered in this browser) and again from the profile menu (Take the tour).
 */
export const TOUR_KEY = "ouc-tour-seen";

export type TourStep = {
  id: string;
  title: string;
  text: string;
  /** the page the step shows, relative to /v2/<sem> ("" = Today); left out = stay where we are */
  page?: (course?: string) => string;
  /** CSS selector of what to point at; left out (or not on screen) = a card in the middle */
  target?: string;
};

export const TOUR: TourStep[] = [
  { id: "welcome", title: "Welcome to OUC Study 👋", text: "A quick look at the main parts of the app. It takes a minute, and you can skip it any time (Esc) or take it again from the profile circle, top right." },
  { id: "today", page: () => "", target: '[data-tour="nav-today"]', title: "☀️ Today", text: "What to do next: the next deadline and class, this week's plan, the next 7 days, and what's new on eClass." },
  { id: "courses", page: () => "/courses", target: '[data-tour="nav-courses"]', title: "📚 Courses", text: "One card per course: the current week, what's due next, the exam date and how many assignments you've handed in." },
  { id: "course", page: (c) => (c ? `/courses/${encodeURIComponent(c)}` : "/courses"), target: '[data-tour="course-tabs"]', title: "Inside a course", text: "Weeks hold the eClass files: open a week for its slides (with the narration), class videos and transcripts. Notes are the visual notes your AI makes, Quizzes test you on the topics, and Assignments has each brief with its prep pack." },
  { id: "calendar", page: () => "/calendar", target: '[data-tour="nav-calendar"]', title: "🗓️ Calendar", text: "Every deadline, class and exam in one list, filtered by course. Overdue work shows at the top." },
  { id: "bell", target: '[data-tour="bell"]', title: "🔔 Notifications", text: "New grades, feedback, files, deadlines and announcements from eClass. The app checks every morning; Sync now checks right away and downloads new files." },
  { id: "ask-ai", target: "[data-ask-ai]", title: "🤖 Ask AI", text: "Your study assistant (Claude Code, Codex or a local model) on any page: explain a topic, plan your week, quiz you or review a draft. It gives hints and feedback, never answers to hand in." },
  { id: "profile", target: '[data-tour="profile"]', title: "👤 Profile and Settings", text: "Your eClass connection, Settings (AI tools, video transcripts, colour theme, updates), AI background work and past chats. Take the tour again from here." },
  { id: "done", title: "You're all set 🎉", text: "Start with Today. Questions about a topic? Ask AI is always bottom right." },
];

/** The step to show after a move, kept inside the tour. */
export const clampStep = (i: number) => Math.max(0, Math.min(TOUR.length - 1, i));

export function tourSeen(store: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): boolean {
  try { return store?.getItem(TOUR_KEY) === "1"; } catch { return true; } // no storage: don't open it on every visit
}
export function markTourSeen(store: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try { store?.setItem(TOUR_KEY, "1"); } catch {}
}

/** Where to put the step's card next to the highlighted box: below it when it fits, else above, kept on screen. */
export function placeCard(box: { top: number; left: number; width: number; height: number } | null, card: { width: number; height: number }, view: { width: number; height: number }, gap = 12) {
  const m = 12;
  if (!box) return { top: Math.max(m, (view.height - card.height) / 2), left: Math.max(m, (view.width - card.width) / 2) };
  const below = box.top + box.height + gap;
  const top = below + card.height <= view.height - m ? below : Math.max(m, box.top - gap - card.height);
  const left = Math.max(m, Math.min(view.width - card.width - m, box.left + box.width / 2 - card.width / 2));
  return { top, left };
}
