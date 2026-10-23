/**
 * The app's GitHub sign-in client for backups, public by design (the device flow needs no secret).
 * While it's empty (CONTRIBUTING › Backup sign-in client), GitHub offers only the token route.
 * OUC_GITHUB_CLIENT_ID overrides it (forks, testing).
 */
const GITHUB_CLIENT_ID = "";

export const githubClientId = (env = process.env) => env.OUC_GITHUB_CLIENT_ID ?? GITHUB_CLIENT_ID;
