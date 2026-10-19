/** Which look opens when the app starts ("/" → v2 or classic); remembered in this browser. */
export const UI_KEY = "ouc-ui";
export function rememberLook(look: "v2" | "classic") { try { localStorage.setItem(UI_KEY, look); } catch {} }
export function preferredLook(): "v2" | "classic" { try { return localStorage.getItem(UI_KEY) === "v2" ? "v2" : "classic"; } catch { return "classic"; } }
