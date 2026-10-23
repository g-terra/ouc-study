/**
 * How to get a GitHub token for the backup, shown by "How to get a token" in Settings › Backup and by
 * `ouc backup setup` (no Node imports: the app uses it too). Two ways: the GitHub CLI's own sign-in, or a
 * fine-grained token limited to a backup repo made by hand.
 */
export const BACKUP_REPO = "ouc-study-backup";

export interface HelpStep { text: string; command?: string; link?: string }
export interface HelpWay { title: string; note: string; steps: HelpStep[] }

export type HelpOs = "mac" | "windows" | "linux";

/** The commands for this computer: how to install gh and copy to the clipboard. */
export function tokenHelp(os: HelpOs = "mac"): HelpWay[] {
  const install = os === "mac" ? "brew install gh && gh auth login" : os === "windows" ? "winget install GitHub.cli; gh auth login" : "gh auth login";
  const copy = os === "mac" ? " | pbcopy" : os === "windows" ? " | clip" : "";
  return [
    {
      title: "With the GitHub CLI (gh)",
      note: "Quickest, if you have gh. Its sign-in can reach all your repos; the app keeps it on this computer only.",
      steps: [
        { text: os === "linux" ? "Install gh (cli.github.com has the steps for your Linux), then sign in once." : "Install gh if you don't have it, then sign in once.", command: install, link: "https://cli.github.com" },
        { text: copy ? "Copy your gh sign-in, then paste it below." : "Show your gh sign-in, copy it, then paste it below.", command: `gh auth token${copy}` },
      ],
    },
    {
      title: "On github.com (a token for the backup repo only)",
      note: "No extra tools. The token can only reach the backup repo.",
      steps: [
        { text: `Make a private repo named ${BACKUP_REPO} (or with gh: gh repo create ${BACKUP_REPO} --private).`, link: `https://github.com/new?name=${BACKUP_REPO}&visibility=private` },
        { text: `Make a fine-grained token: Repository access → Only select repositories → ${BACKUP_REPO}; Repository permissions → Contents → Read and write. Pick how long it lasts; when it runs out, the app says so and you paste a new one.`, link: "https://github.com/settings/personal-access-tokens/new?name=OUC%20Study%20backup&contents=write" },
        { text: "Copy the token GitHub shows (it starts with github_pat_), then paste it below." },
      ],
    },
  ];
}
