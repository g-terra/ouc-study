// The files `ouc install` writes for the background app and the daily sync (tested on any OS).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appPlist, hiddenLauncher, paths, syncPlist, syncTaskXml, winPaths } from "../src/background.ts";

test("macOS: LaunchAgents keep the app alive and run the sync at the chosen time", () => {
  const app = appPlist({ node: "/opt/homebrew/bin/node", root: "/Users/st/OUC Study", port: "5173", logs: "/Users/st/Library/Logs/OUC-Study" });
  assert.match(app, /<string>\/opt\/homebrew\/bin\/node<\/string><string>\/Users\/st\/OUC Study\/bin\/server\.mjs<\/string>/);
  assert.match(app, /<key>PATH<\/key><string>\/opt\/homebrew\/bin:\/usr\/bin:/);
  assert.match(app, /<key>KeepAlive<\/key><dict><key>SuccessfulExit<\/key><false\/>/);
  const sync = syncPlist({ node: "/usr/local/bin/node", root: "/r", logs: "/l", time: "07:05" });
  assert.match(sync, /<key>Hour<\/key><integer>7<\/integer><key>Minute<\/key><integer>5<\/integer>/);
  assert.match(sync, /\/r\/packages\/eclass-sync\/daily\.mjs/);
});

test("Windows: the hidden launcher runs node through cmd with its output in the log", () => {
  const vbs = hiddenLauncher({ node: "C:\\Program Files\\nodejs\\node.exe", root: "C:\\Users\\st\\OUC Study", script: "bin/server.mjs", log: "C:\\Users\\st\\AppData\\Local\\OUC-Study\\Logs\\app.log", env: { OUC_PORT: "5173" } });
  assert.ok(vbs.includes('sh.CurrentDirectory = "C:\\Users\\st\\OUC Study"'));
  assert.ok(vbs.includes('sh.Environment("Process")("OUC_PORT") = "5173"'));
  // VBScript doubles the quotes; cmd /c strips the outer pair
  assert.ok(vbs.includes('sh.Run "cmd /c """"C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\st\\OUC Study\\bin\\server.mjs"" >> ""C:\\Users\\st\\AppData\\Local\\OUC-Study\\Logs\\app.log"" 2>&1""", 0, False'));
  assert.match(vbs, /\r\n/);
});

test("Windows: the daily task catches up after the PC was off and runs the launcher hidden", () => {
  const x = syncTaskXml({ launcher: "C:\\a & b\\sync.vbs", time: "07:30", user: "PC\\st" });
  assert.match(x, /<StartBoundary>2026-01-01T07:30:00<\/StartBoundary>/);
  assert.match(x, /<StartWhenAvailable>true<\/StartWhenAvailable>/);
  assert.match(x, /<UserId>PC\\st<\/UserId>/);
  assert.match(x, /<Command>wscript\.exe<\/Command><Arguments>\/\/B "C:\\a &amp; b\\sync\.vbs"<\/Arguments>/);
});

test("logs and launchers go to the usual per-user places", () => {
  assert.equal(paths({ platform: "darwin", home: "/Users/st" }).logs, "/Users/st/Library/Logs/OUC-Study");
  const w = winPaths({ home: "/h", env: { LOCALAPPDATA: "/h/Local", APPDATA: "/h/Roaming" } });
  assert.ok(w.startup.endsWith("Microsoft/Windows/Start Menu/Programs/Startup/OUC Study.vbs") || w.startup.endsWith("Microsoft\\Windows\\Start Menu\\Programs\\Startup\\OUC Study.vbs"));
  assert.ok(w.logs.includes("OUC-Study"));
});
