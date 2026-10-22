/**
 * The app's sign-in clients for backups. Both are public by design: the GitHub device flow needs no
 * secret, and Google treats a desktop app's client secret as not secret. While they're empty
 * (CONTRIBUTING › Backup sign-in clients), GitHub offers only the token route and Drive isn't offered.
 * OUC_GITHUB_CLIENT_ID / OUC_GOOGLE_CLIENT_ID / OUC_GOOGLE_CLIENT_SECRET override them (forks, testing).
 */
const GITHUB_CLIENT_ID = "";
const GOOGLE_CLIENT_ID = "";
const GOOGLE_CLIENT_SECRET = "";

export const githubClientId = (env = process.env) => env.OUC_GITHUB_CLIENT_ID ?? GITHUB_CLIENT_ID;
export function googleClient(env = process.env) {
  const clientId = env.OUC_GOOGLE_CLIENT_ID ?? GOOGLE_CLIENT_ID;
  const clientSecret = env.OUC_GOOGLE_CLIENT_SECRET ?? GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
