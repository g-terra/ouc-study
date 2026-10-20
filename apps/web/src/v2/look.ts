/** Which look the app opens in; remembered in this browser. The new look (v2) is the default, the classic one is still a choice. */
export const UI_KEY = "ouc-ui";
export function rememberLook(look: "v2" | "classic") { try { localStorage.setItem(UI_KEY, look); } catch {} }
export function preferredLook(): "v2" | "classic" { try { return localStorage.getItem(UI_KEY) === "classic" ? "classic" : "v2"; } catch { return "v2"; } }
