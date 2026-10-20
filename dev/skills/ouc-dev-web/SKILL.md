---
name: ouc-dev-web
description: Contributor only. Use when adding or changing a page, component, route, style or icon in the OUC Study React app (apps/web), especially in the new look (src/v2). Not for studying.
---

# Changing the study app (apps/web)

React 19, Vite, Tailwind 4, TypeScript. The app reads JSON that `packages/content` builds from `semesters/`, and talks to `/api/*` served by Vite plugins (`packages/ai/src/api.ts`, set up in `apps/web/vite.config.ts`).

## Where things go

- **Routes**: `src/App.tsx` lists them for the small router in `src/lib/router.tsx` (`Routes`, `useRouter`, `Link`, `enc`). New-look pages sit under `/v2/:sem/…` inside `V2Semester` (`src/v2/Shell.tsx` frame).
- **New look first.** `src/v2/` is the default look. The classic pages (`src/pages/`) stay working, but new features go to the new look; shared detail pages (note, quiz, assignment, slides, video) link with classic paths and `src/v2/paths.ts` maps them (`toV2`, `toClassic`, `V2_SECTIONS`). Changing a section? Update `paths.ts` and its test.
- **Data**: `useSemester(sem)` (`src/lib/data.tsx`): `undefined` while loading, `null` when missing. Its types are in `packages/content/src/types.ts`. A new field means: compute it in `packages/content`, add it to the type, test it there.
- **Logic** that isn't rendering goes in `src/lib/*.ts` with no React import, tested in `apps/web/test/`.
- **Look**: Tailwind classes plus the theme tokens in `src/index.css` (each theme, light and dark; Tailwind `dark:` follows `html[data-mode=dark]`). Icons come from `src/components/icons.tsx` (lucide line icons); add the icon there. No emoji in the new look.
- **Tour**: a new main place in the new look may need a step in `src/v2/tour-steps.ts`.

## React practices

- Function components and hooks. Keep state minimal and derive the rest during render; `useMemo` only for measurably heavy work.
- `useEffect` is for syncing with the outside (events, timers, fetch, `document.title`), with a cleanup and complete dependencies. Don't use it to copy props into state.
- Lists get stable `key`s from data, not the index. Components stay small; split when a file mixes unrelated parts.
- Accessible: real `<button>` and `<a>`/`Link`, `aria-label` on icon-only controls, `role="dialog"` with a name for pop-ups, headings in order, keyboard reachable. Tests find elements this way.
- Works at 390 px wide and on desktop; nothing scrolls sideways.
- Text is short, plain English for students. No time estimates for study work (the owner's rule); dates and deadlines are fine.

## Check it

1. Test first (red, green, refactor; `ouc-dev-testing`): a unit test for the logic, an e2e test for what the student sees, each run and failing before you write the code.
2. `npm run typecheck`, `npm run build`, `npm run e2e`.
3. Look at it: `npm run dev`, or the demo semester on port 5180 with `cd e2e && node --import tsx serve.ts`, and screenshot it with Playwright at desktop and phone widths, light and dark.
