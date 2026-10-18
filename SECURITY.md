# Security

OUC Study handles a personal **eClass key** that gives access to a student's account, and their course data. Please treat anything that could expose either as a security problem.

## Report a problem

**Don't open a public issue.** Report it privately through [GitHub security advisories](https://github.com/g-terra/ouc-study/security/advisories/new), or contact the maintainer ([@g-terra](https://github.com/g-terra)) directly.
Include what is affected, how to reproduce it, and the impact. Never include a real key or someone's data: use a fake one.

You'll get a reply within a week. Fixes go out as a normal release, with credit if you want it.

## In scope

- The eClass key being printed, logged, sent anywhere other than eclass.ouc.ac.cy, or committed.
- Course data or personal files leaving the student's computer, or getting past `npm run check:public`.
- The local app server (`/api/ai`) being reachable from other sites or computers.
- AI agents getting access to the key despite `opencode.json` and the agent instructions.

## Supported versions

Only the latest release on `main` gets fixes.
