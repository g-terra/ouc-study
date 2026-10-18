// Starting the agent CLIs on Windows, where npm installs them as .cmd shims (tested on any OS).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCmdShim, resolveCommand } from "../providers.mjs";

// what npm's cmd-shim writes for `npm i -g @anthropic-ai/claude-code`
const NODE_SHIM = `@ECHO off\r
GOTO start\r
:find_dp0\r
SET dp0=%~dp0\r
EXIT /b\r
:start\r
SETLOCAL\r
CALL :find_dp0\r
\r
IF EXIST "%dp0%\\node.exe" (\r
  SET "_prog=%dp0%\\node.exe"\r
) ELSE (\r
  SET "_prog=node"\r
  SET PATHEXT=%PATHEXT:;.JS;=;%\r
)\r
\r
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r
`;
const EXE_SHIM = `@ECHO off\r\nGOTO start\r\n:start\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n`;
const NPM = "C:\\Users\\st\\AppData\\Roaming\\npm";

test("an npm .cmd shim is read back to the script it runs", () => {
  assert.deepEqual(parseCmdShim(NODE_SHIM, `${NPM}\\claude.cmd`), { node: true, target: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js` });
  assert.deepEqual(parseCmdShim(EXE_SHIM, `${NPM}\\opencode.cmd`), { node: false, target: `${NPM}\\node_modules\\opencode-ai\\bin\\opencode.exe` });
  assert.equal(parseCmdShim("@echo off\r\nsomething else %*\r\n", `${NPM}\\x.cmd`), null);
});

test("Windows: .cmd shims run their script with this Node, so a multi-line prompt survives", () => {
  const prompt = 'line one\nline "two" & | <three>';
  const find = () => [`${NPM}\\claude`, `${NPM}\\claude.cmd`];
  const [file, args, opts] = resolveCommand("claude", ["-p", prompt], { platform: "win32", find, read: () => NODE_SHIM });
  assert.equal(file, process.execPath);
  assert.deepEqual(args, [`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`, "-p", prompt]);
  assert.deepEqual(opts, {});
});

test("Windows: an .exe (Claude's native installer) wins over a shim and starts directly", () => {
  const exe = "C:\\Users\\st\\.local\\bin\\claude.exe";
  const [file, args] = resolveCommand("claude", ["auth", "status"], { platform: "win32", find: () => [`${NPM}\\claude.cmd`, exe], read: () => NODE_SHIM });
  assert.equal(file, exe);
  assert.deepEqual(args, ["auth", "status"]);
});

test("Windows: an unreadable shim falls back to cmd.exe with quoted arguments", () => {
  const [file, args, opts] = resolveCommand("codex", ["exec", 'say "hi"\nnow'], { platform: "win32", find: () => [`${NPM}\\codex.cmd`], read: () => "nothing useful" });
  assert.equal(opts.shell, true);
  assert.deepEqual(args, []);
  assert.equal(file, `"${NPM}\\codex.cmd" "exec" "say \\"hi\\" now"`);
});

test("macOS/Linux: commands are left alone; scripts run with this Node everywhere", () => {
  assert.deepEqual(resolveCommand("claude", ["-p", "x"], { platform: "darwin" }), ["claude", ["-p", "x"], {}]);
  assert.deepEqual(resolveCommand("/t/fake-agent.mjs", ["a"], { platform: "linux" }), [process.execPath, ["/t/fake-agent.mjs", "a"], {}]);
  assert.deepEqual(resolveCommand("C:\\t\\fake-agent.mjs", [], { platform: "win32" }), [process.execPath, ["C:\\t\\fake-agent.mjs"], {}]);
});

test("Windows for real: a CLI installed as an npm shim gets every argument intact", { skip: process.platform !== "win32" }, async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnCliSync } = await import("../providers.mjs");
  const dir = mkdtempSync(join(tmpdir(), "ouc-shim-"));
  mkdirSync(join(dir, "node_modules/fake"), { recursive: true });
  writeFileSync(join(dir, "node_modules/fake/cli.js"), "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
  writeFileSync(join(dir, "fakeagent.cmd"), NODE_SHIM.replace("@anthropic-ai\\claude-code\\cli.js", "fake\\cli.js"));
  const args = ["-p", 'two\nlines with "quotes" & %PATH% | <pipes>'];
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[key] = `${dir};${env[key] ?? ""}`;
  const r = spawnCliSync("fakeagent", args, { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), args);
});
