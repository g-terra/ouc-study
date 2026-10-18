// How `ouc` runs the app in the background and checks eClass every day, per operating system:
//   macOS    two LaunchAgents (~/Library/LaunchAgents): the app at login (restarted if it crashes)
//            and the daily sync (run on wake if the Mac was asleep at that time)
//   Windows  a hidden launcher in the Startup folder (the app at login) and a Task Scheduler task
//            for the daily sync (run as soon as possible if the PC was off). Neither needs admin rights.
//   Linux    the app as a detached process; no autostart.
// The file contents are made by pure functions below so they can be tested on any OS.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";

export const APP_LABEL = "cy.ouc.study.app";
export const SYNC_LABEL = "cy.ouc.study.eclass-sync";
export const WIN_TASK = "OUC Study eClass sync";

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- macOS ----------
export function appPlist({ node, root, port, logs }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${APP_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(root)}/bin/server.mjs</string></array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(dirname(node))}:/usr/bin:/bin:/usr/sbin:/sbin</string><key>OUC_PORT</key><string>${port}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(logs)}/app.log</string>
  <key>StandardErrorPath</key><string>${xml(logs)}/app.log</string>
</dict></plist>
`;
}
export function syncPlist({ node, root, logs, time }) {
  const [h, m] = time.split(":").map(Number);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SYNC_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(root)}/packages/eclass-sync/daily.mjs</string></array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(logs)}/sync.log</string>
  <key>StandardErrorPath</key><string>${xml(logs)}/sync.log</string>
</dict></plist>
`;
}

// ---------- Windows ----------
const vbsStr = (s) => `"${String(s).replace(/"/g, '""')}"`;
/** A .vbs that runs `node script` with no window, appending its output to log (wscript has no console). */
export function hiddenLauncher({ node, root, script, log, env = {} }) {
  // cmd /c "<line>": cmd strips the outer quotes and keeps the inner ones
  const line = `cmd /c ""${node}" "${join(root, script).replace(/\//g, "\\")}" >> "${log}" 2>&1"`;
  return [
    "' OUC Study: made by `ouc install` / `ouc start`. Runs in the background with no window.",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = ${vbsStr(root)}`,
    ...Object.entries(env).map(([k, v]) => `sh.Environment("Process")(${vbsStr(k)}) = ${vbsStr(v)}`),
    `sh.Run ${vbsStr(line)}, 0, False`,
    "",
  ].join("\r\n");
}
/** Task Scheduler task: the daily sync at `time`, as the signed-in user, caught up if the PC was off. */
export function syncTaskXml({ launcher, time, user }) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>OUC Study: checks eClass for new grades, feedback, files and deadlines.</Description></RegistrationInfo>
  <Triggers><CalendarTrigger><StartBoundary>2026-01-01T${time}:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
  <Principals><Principal id="Author">${user ? `<UserId>${xml(user)}</UserId>` : ""}<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>//B ${xml(`"${launcher}"`)}</Arguments></Exec></Actions>
</Task>
`;
}

// ---------- where things go ----------
export function paths({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  const { join } = platform === "win32" ? win32 : posix;   // that OS's paths, whatever OS this runs on
  if (platform === "darwin") {
    const agents = join(home, "Library/LaunchAgents");
    return { logs: join(home, "Library/Logs/OUC-Study"), appPlist: join(agents, `${APP_LABEL}.plist`), syncPlist: join(agents, `${SYNC_LABEL}.plist`) };
  }
  if (platform === "win32") {
    const local = join(env.LOCALAPPDATA ?? join(home, "AppData/Local"), "OUC-Study");
    const startup = join(env.APPDATA ?? join(home, "AppData/Roaming"), "Microsoft/Windows/Start Menu/Programs/Startup");
    return { logs: join(local, "Logs"), dir: local, appLauncher: join(local, "app.vbs"), syncLauncher: join(local, "sync.vbs"), startup: join(startup, "OUC Study.vbs") };
  }
  return { logs: join(env.XDG_STATE_HOME ?? join(home, ".local/state"), "ouc-study") };
}

// ---------- the service per OS: { autostart, installed(), syncScheduled(), install(), uninstall(), start(), stop() } ----------
// start() and stop() return a short result; the caller prints messages and waits for the app.
export function service({ root, node, port, syncTime, platform = process.platform }) {
  const p = paths({ platform });
  const pidFile = join(root, ".ouc/app.pid");
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const readPid = () => { try { const n = Number(readFileSync(pidFile, "utf8").trim()); return n > 0 && alive(n) ? n : null; } catch { return null; } };

  if (platform === "darwin") {
    const uid = process.getuid?.() ?? 501;
    const lc = (...a) => spawnSync("launchctl", a, { stdio: "ignore" }).status === 0;
    const loaded = (label) => lc("print", `gui/${uid}/${label}`);
    const write = () => {
      mkdirSync(dirname(p.appPlist), { recursive: true }); mkdirSync(p.logs, { recursive: true });
      writeFileSync(p.appPlist, appPlist({ node, root, port, logs: p.logs }));
      writeFileSync(p.syncPlist, syncPlist({ node, root, logs: p.logs, time: syncTime }));
    };
    return {
      autostart: true, logs: p.logs,
      installed: () => loaded(APP_LABEL), running: () => loaded(APP_LABEL), syncScheduled: () => loaded(SYNC_LABEL),
      install() {
        write();
        for (const l of [APP_LABEL, SYNC_LABEL]) lc("bootout", `gui/${uid}/${l}`);
        const ok = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, p.appPlist], { stdio: "inherit" }).status === 0;
        return spawnSync("launchctl", ["bootstrap", `gui/${uid}`, p.syncPlist], { stdio: "inherit" }).status === 0 && ok;
      },
      uninstall() { for (const l of [APP_LABEL, SYNC_LABEL]) lc("bootout", `gui/${uid}/${l}`); rmSync(p.appPlist, { force: true }); rmSync(p.syncPlist, { force: true }); },
      start() {
        if (!existsSync(p.appPlist)) write();
        return loaded(APP_LABEL) ? lc("kickstart", `gui/${uid}/${APP_LABEL}`) : spawnSync("launchctl", ["bootstrap", `gui/${uid}`, p.appPlist], { stdio: "inherit" }).status === 0;
      },
      stop: () => lc("bootout", `gui/${uid}/${APP_LABEL}`),
    };
  }

  // Windows and Linux: the app is a detached process that writes its pid to .ouc/app.pid (bin/server.mjs)
  const stopPid = () => {
    const pid = readPid();
    if (!pid) return false;
    if (platform === "win32") {
      // only if that pid is still our Node (Windows reuses pids), then the whole tree (Vite runs under it)
      const img = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout ?? "";
      if (!/node/i.test(img)) { rmSync(pidFile, { force: true }); return false; }
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
    rmSync(pidFile, { force: true });
    return true;
  };

  if (platform === "win32") {
    const env = { OUC_PORT: port };
    const write = () => {
      mkdirSync(p.logs, { recursive: true });
      writeFileSync(p.appLauncher, hiddenLauncher({ node, root, script: "bin/server.mjs", log: join(p.logs, "app.log"), env }));
      writeFileSync(p.syncLauncher, hiddenLauncher({ node, root, script: "packages/eclass-sync/daily.mjs", log: join(p.logs, "sync.log") }));
    };
    const schtasks = (...a) => spawnSync("schtasks", a, { encoding: "utf8", windowsHide: true });
    return {
      autostart: true, logs: p.logs,
      installed: () => existsSync(p.startup), running: () => !!readPid(), syncScheduled: () => schtasks("/Query", "/TN", WIN_TASK).status === 0,
      install() {
        write();
        mkdirSync(dirname(p.startup), { recursive: true });
        writeFileSync(p.startup, readFileSync(p.appLauncher, "utf8"));
        const file = join(p.dir, "sync-task.xml");
        const user = process.env.USERNAME ? `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ""}${process.env.USERNAME}` : "";
        writeFileSync(file, `﻿${syncTaskXml({ launcher: p.syncLauncher, time: syncTime, user })}`, "utf16le");
        let r = schtasks("/Create", "/F", "/TN", WIN_TASK, "/XML", file);
        // plain daily task if the XML one is refused (it can't catch up after the PC was off)
        if (r.status !== 0) r = schtasks("/Create", "/F", "/TN", WIN_TASK, "/SC", "DAILY", "/ST", syncTime, "/TR", `wscript.exe //B "${p.syncLauncher}"`);
        if (r.status !== 0) process.stderr.write(r.stderr || r.stdout || "");
        return r.status === 0;
      },
      uninstall() { schtasks("/Delete", "/F", "/TN", WIN_TASK); rmSync(p.startup, { force: true }); },
      start() {
        if (readPid()) return true;
        write();
        spawn("wscript.exe", ["//B", p.appLauncher], { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
        return true;
      },
      stop: stopPid,
    };
  }

  return {
    autostart: false, logs: p.logs,
    installed: () => false, running: () => !!readPid(), syncScheduled: () => false,
    install: () => false, uninstall() {},
    start() {
      if (readPid()) return true;
      mkdirSync(p.logs, { recursive: true });
      const log = openSync(join(p.logs, "app.log"), "a");
      spawn(node, [join(root, "bin/server.mjs")], { cwd: root, detached: true, stdio: ["ignore", log, log], env: { ...process.env, OUC_PORT: port } }).unref();
      return true;
    },
    stop: stopPid,
  };
}
