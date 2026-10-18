# OUC Study

Your Open University of Cyprus **eClass courses offline**, in a visual study app: every slide and file, assignment questions, your own submissions and grades, a semester timeline, daily alerts for new grades, feedback and deadlines, and AI study agents (Claude Code, Codex or a local model).

Built by students for students. Works with **your own** eClass account: nothing is shared between users.

## Install

You need [Node.js](https://nodejs.org) (the LTS version) and a few minutes.

```bash
git clone <this repo> OUC-Study
cd OUC-Study
npm run setup
```

On a Mac you can also double-click **`Install OUC Study.command`**.

The installer walks you through everything:

1. **Checks your computer** and installs the app.
2. **Connects to eClass** with your personal key. It shows you where to get it, and you paste it hidden (or it reads it from the clipboard).
3. **Lists your enrolled courses**. The current ones are already ticked.
4. **Downloads everything**: weekly slides and files, assignment briefs and questions, your submitted files, grades and feedback.
5. **Finishes the setup**: searchable text copies for your AI assistant, daily updates, your preferences for the assistant.
6. **Starts the app**, on a Mac automatically at every login. Open **http://localhost:5173**, or type `ouc open`.

Want to see first what it would download? Run `npm run setup -- --dry-run`. It changes nothing.

### Your eClass key

The app reads eClass through its official web-service API, the one the Moodle mobile app uses. It needs your personal key:

- eClass → **Preferences → Security keys** (https://eclass.ouc.ac.cy/user/managetoken.php), row **Moodle mobile web service** → copy (or **Reset** to get a new one).
- No such row? Install the **Moodle** app on your phone and sign in to `eclass.ouc.ac.cy` once (Office365 Login).

The key is saved in `.eclass-token`, readable only by you and never committed. **Don't share it**: it gives access to your eClass account.

## The `ouc` command

| Command | What it does |
|---|---|
| `ouc open` | open the app in your browser (starts it if needed) |
| `ouc sync` | check eClass **now**: grades, feedback, deadlines, announcements **and new files** |
| `ouc pull` | download any new course files (`--dry-run` just lists them) |
| `ouc setup` | add courses, start a new semester, or replace your key |
| `ouc status` | is the app running, is the daily sync scheduled, when was the last sync |
| `ouc start` · `ouc stop` · `ouc restart` | control the background app (macOS) |
| `ouc logs` · `ouc logs sync` | follow the logs (`~/Library/Logs/OUC-Study/`) |
| `ouc check-public` | before pushing to GitHub: is anything personal included? |
| `ouc uninstall` | turn off auto-start and the daily sync |

Not on a Mac, or prefer no background service? `npm run dev` runs the app in the current Terminal window.

## Pages

- **Dashboard**: next deadline with a countdown, the final exams, what's new on eClass, the next 14 days, and progress per course.
- **Timeline**: the semester at a glance, then week by week, with filters per course.
- **Courses**: each course week by week (slides, videos, assignments, your notes) plus your grades.
- **Notes**: visual notes with diagrams, LaTeX formulas, comparison tables and flip-card self-tests.
- **Assignments**: the question, files, PDF preview, study links, grade and feedback.
- **Updates**: what changed on eClass each day, with a live 🟢 connection status, **Re-check** and **Sync now**.

## Daily updates

Every morning at 07:30 (and every 4 hours while the app runs) it asks eClass what changed: **new grades, tutor feedback, submission status, new or updated files, deadline changes, new assignments, announcements, forum replies and notifications**. These appear on the **Updates** page and the dashboard. On a Mac you also get a notification.

New files are downloaded into the right week folder. Existing files are never overwritten: a newer version is saved next to the old one as `name (updated YYYY-MM-DD).ext`.

The dot in the top bar shows the connection: 🟢 connected, 🔴 key expired or wrong (run `ouc setup`), 🟠 offline, ⚪ not set up.

## Using it with an AI assistant

The study tools work with **Claude Code**, **OpenAI Codex** or a **local model through opencode**. Choose one with `ouc ai setup` (setup asks too); change it any time.

| AI | Runs on | Set up |
|---|---|---|
| Claude Code | your Claude Pro/Max subscription | `npm i -g @anthropic-ai/claude-code`, then `claude auth login` |
| Codex | your ChatGPT subscription | `npm i -g @openai/codex`, then `codex login` |
| opencode + local model | your computer, offline | `npm i -g opencode-ai`, plus [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) |
| a local model directly | your computer, offline | Ollama or LM Studio only; notes, plans and quizzes, works with smaller models |

Claude Code and Codex are used with **your own subscription login, never API credits**: `ouc ai` checks that you're signed in with your account, and it ignores `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` when it starts them.

**Local models.** opencode needs a model that can call tools: `gpt-oss:20b`, `qwen3:14b` or bigger. Give it a context window of 32k tokens or more (Ollama: `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`; LM Studio: Context Length when you load the model). Your model choice is saved in `.opencode/opencode.json`; the shared `opencode.json` keeps your eClass key off limits. On a smaller machine, "a local model directly" still makes notes, plans and quizzes: `ouc` gives it the week's material and checks the note format for it.

```
ouc ai                 open your assistant in this folder
ouc notes [course] [week]   visual notes for a week (default: the latest week without notes)
ouc plan               plan this week
ouc quiz [course] [week]    quiz yourself
ouc ai status          what's installed and signed in
--with claude|codex|opencode|local   use another one just this time
```

You can also just open the folder in the tool itself (`claude`, `codex` or `opencode`). `AGENTS.md` explains the workspace to all of them (Claude Code reads it through `CLAUDE.md`), and your personal context (name, learning style, current semester) is in `STUDENT.md`, which setup creates.

| Agent | Does |
|---|---|
| note-taker | turns slides and readings into visual notes, and fills in the glossary |
| study-planner | plans weekly study and deliverables, and flags risks |
| researcher | finds and checks papers, chapters, videos and tutorials, with citations |
| tutor | explains, quizzes, reviews drafts, and logs weak spots |

Skills: `plan-week`, `make-notes`, `research-topic`, `find-material`, `quiz-me`, `assignment-helper`, `sync-eclass`. They live in `ai/`; `ouc ai install` copies them to `.claude/` (Claude Code), `.agents/skills/` (Codex and opencode) and `.opencode/agents/` (opencode subagents). Run it again after editing them.

Try: "plan my week" · "make notes on lecture 7" · "find material on signal detection theory" · "quiz me on Naive Bayes" · "help me approach the term project" · "what's new on eClass?"

The assistant helps you understand, plan and review. It won't write answers for you to submit.

## How it's organised

```
apps/web/             the React app (Vite + Tailwind)
packages/content/     turns semesters/ into data for the app
packages/eclass-sync/ eClass API: daily changes (daily.mjs), file downloads (pull.mjs)
bin/                  the ouc command, the installer, the background server
semesters/<id>/       YOUR data for each semester: course files, notes, assignments (git-ignored)
memory/               the assistant's memory of your progress (git-ignored)
ai/  tools/  docs/    agents & skills, helpers, the note format
```

## Privacy and sharing

This repository holds **only code**. Everything personal is git-ignored: `semesters/` (OUC course materials, your submissions, grades and notes), `memory/`, `STUDENT.md`, `.opencode/opencode.json` and `.eclass-token`.
Course materials belong to OUC and their authors, so don't commit or redistribute them; everyone downloads their own copy through their own enrolment.
Run `ouc check-public` before you push.

## Troubleshooting

| Problem | Fix |
|---|---|
| The app doesn't open | `ouc status`, then `ouc logs`. Missing dependencies: `npm install`, then `ouc restart` |
| `ouc: command not found` | open a new Terminal window, or use `bash bin/ouc …` from this folder |
| 🔴 eClass key expired | `ouc setup` (it asks for a new key; your files stay) |
| A file failed to download | `ouc pull` retries; failures are listed in `semesters/<id>/_meta/pull-report.json` |
| Week dates are off for a course | edit `dating.first` for that course in `semesters/<id>/semester.json` |
| Log shows "Operation not permitted" | System Settings → Privacy & Security → Full Disk Access → add your `node` (`which node`) → `ouc restart` |
| Port 5173 already in use | another copy is running (e.g. `npm run dev`). Close it, or `ouc stop` |
| Notes or data look stale | `npm run content` (the running app also rebuilds automatically) |
