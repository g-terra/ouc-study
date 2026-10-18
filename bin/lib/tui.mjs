// Tiny zero-dependency terminal UI: colours, boxes, spinners, progress bars and prompts
// (text, hidden, confirm, single and multi select). Falls back to plain text when not a TTY.
import readline from "node:readline";

const out = process.stdout;
const inp = process.stdin;
export const TTY = !!(out.isTTY && inp.isTTY);
const COLOR = out.isTTY && !process.env.NO_COLOR;
const esc = (c) => (s) => (COLOR ? `\x1b[${c}m${s}\x1b[0m` : String(s));
export const c = {
  bold: esc("1"), dim: esc("2"), italic: esc("3"), under: esc("4"),
  red: esc("31"), green: esc("32"), yellow: esc("33"), blue: esc("34"), magenta: esc("35"), cyan: esc("36"), gray: esc("90"),
  violet: esc("38;5;141"), teal: esc("38;5;37"), pink: esc("38;5;205"),
  hex: (hex) => (s) => {
    if (!COLOR) return String(s);
    const n = parseInt(hex.replace("#", ""), 16);
    return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${s}\x1b[0m`;
  },
};
const ANSI = /\x1b\[[0-9;]*m/g;
export const width = (s) => [...String(s).replace(ANSI, "")].length;
const cols = () => Math.min(out.columns || 80, 92);
// cut a line to the terminal width so it never wraps: menus redraw by moving up one row per line
const fit = (s) => {
  const max = (out.columns || 80) - 1;
  if (width(s) <= max) return s;
  let n = 0, res = "";
  for (const part of String(s).split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b[")) { res += part; continue; }
    for (const ch of part) { if (n >= max - 1) break; res += ch; n++; }
  }
  return `${res}…${COLOR ? "\x1b[0m" : ""}`;
};

export const sym = {
  ok: c.green("✓"), no: c.red("✗"), warn: c.yellow("!"), dot: c.gray("·"), arrow: c.cyan("›"),
  on: c.green("◉"), off: c.gray("◯"), bullet: c.violet("●"),
};

export const say = (s = "") => out.write(`${s}\n`);
export const ok = (s) => say(`  ${sym.ok} ${s}`);
export const warn = (s) => say(`  ${sym.warn} ${s}`);
export const fail = (s) => say(`  ${sym.no} ${s}`);
export const info = (s) => say(`  ${c.gray(s)}`);

export function box(lines, { color = c.violet, pad = 2 } = {}) {
  const inner = Math.max(...lines.map(width)) + pad * 2;
  say(color(`  ╭${"─".repeat(inner)}╮`));
  for (const l of lines) say(`  ${color("│")}${" ".repeat(pad)}${l}${" ".repeat(inner - pad - width(l))}${color("│")}`);
  say(color(`  ╰${"─".repeat(inner)}╯`));
}

let stepN = 0;
export function step(total, title, hint = "") {
  stepN++;
  say();
  const tag = c.bold(c.violet(` ${stepN}/${total} `));
  say(`  ${COLOR ? `\x1b[48;5;54m${tag}\x1b[0m` : `[${stepN}/${total}]`} ${c.bold(title)}${hint ? `  ${c.gray(hint)}` : ""}`);
}

// ---------- spinner & progress ----------
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function spinner(text) {
  let i = 0, t = text, timer;
  const start = Date.now();
  const draw = () => out.write(`\r\x1b[2K  ${c.violet(FRAMES[i++ % FRAMES.length])} ${t}`);
  if (TTY) { out.write("\x1b[?25l"); draw(); timer = setInterval(draw, 80); }
  else say(`  … ${t}`);
  const stop = (mark, msg) => {
    if (timer) clearInterval(timer);
    const secs = ((Date.now() - start) / 1000).toFixed(0);
    if (TTY) out.write(`\r\x1b[2K\x1b[?25h`);
    say(`  ${mark} ${msg ?? t}${Number(secs) >= 3 ? c.gray(` (${secs}s)`) : ""}`);
  };
  return {
    set text(v) { t = v; if (!TTY) say(`  … ${v}`); },
    succeed: (m) => stop(sym.ok, m),
    fail: (m) => stop(sym.no, m),
    warn: (m) => stop(sym.warn, m),
  };
}

export function bar(done, total, w = 28) {
  const f = total ? Math.round((done / total) * w) : w;
  return `${c.violet("█".repeat(f))}${c.gray("░".repeat(w - f))}`;
}
export function progress(label) {
  let last = 0;
  return {
    update(done, total, detail = "") {
      if (!TTY) { if (Date.now() - last > 4000 || done === total) { last = Date.now(); say(`    ${label} ${done}/${total}`); } return; }
      const d = detail ? c.gray(` ${trunc(detail, cols() - 58)}`) : "";
      out.write(`\r\x1b[2K    ${label} ${bar(done, total)} ${c.bold(`${done}/${total}`)}${d}`);
    },
    end(msg) { if (TTY) out.write("\r\x1b[2K"); say(`  ${sym.ok} ${msg}`); },
  };
}
export const trunc = (s, n) => (n < 4 ? "" : width(s) > n ? `${[...s].slice(0, n - 1).join("")}…` : s);
export const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// ---------- prompts ----------
let lineRl;
const lineQueue = [], lineWaiters = [];
let lineClosed = false;
function lineReader() {
  if (!lineRl) {
    // buffer lines: piped answers arrive all at once, before the next question is asked
    lineRl = readline.createInterface({ input: inp, terminal: false });
    lineRl.on("line", (l) => (lineWaiters.length ? lineWaiters.shift()(l) : lineQueue.push(l)));
    lineRl.on("close", () => { lineClosed = true; while (lineWaiters.length) lineWaiters.shift()(""); });
  }
  return lineRl;
}
/** non-TTY: read one line from stdin (for piped answers / tests) */
function readLine() {
  lineReader();
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  if (lineClosed) return Promise.resolve("");
  return new Promise((res) => lineWaiters.push(res));
}

function raw(handler) {
  return new Promise((resolve) => {
    readline.emitKeypressEvents(inp);
    inp.setRawMode(true);
    inp.resume();
    const done = (v) => { inp.off("keypress", on); inp.setRawMode(false); inp.pause(); resolve(v); };
    const on = (str, key = {}) => {
      if (key.ctrl && key.name === "c") { inp.setRawMode(false); out.write("\x1b[?25h\n"); say(c.gray("  Setup cancelled. Nothing else was changed.")); process.exit(130); }
      handler(str, key, done);
    };
    inp.on("keypress", on);
  });
}

export async function ask(q, { def = "", validate } = {}) {
  for (;;) {
    const hint = def ? c.gray(` (${def})`) : "";
    let v;
    if (!TTY) { out.write(`  ${sym.arrow} ${q}${hint} `); v = (await readLine()).trim(); say(); }
    else {
      out.write(`  ${c.cyan("?")} ${c.bold(q)}${hint} `);
      let buf = "";
      v = await raw((s, k, done) => {
        if (k.name === "return" || k.name === "enter") { out.write("\n"); done(buf.trim()); }
        else if (k.name === "backspace") { if (buf) { buf = buf.slice(0, -1); out.write("\b \b"); } }
        else if (s && !k.ctrl && !k.meta && s >= " ") { buf += s; out.write(s); }
      });
    }
    v = v || def;
    const err = validate?.(v);
    if (!err) return v;
    say(`    ${c.red(err)}`);
    if (!TTY) throw new Error(err);
  }
}

export async function secret(q) {
  if (!TTY) { out.write(`  ${sym.arrow} ${q} `); const v = (await readLine()).trim(); say(); return v; }
  out.write(`  ${c.cyan("?")} ${c.bold(q)} `);
  let buf = "";
  return raw((s, k, done) => {
    if (k.name === "return" || k.name === "enter") { out.write("\n"); done(buf.trim()); }
    else if (k.name === "backspace") { if (buf) { buf = buf.slice(0, -1); out.write("\b \b"); } }
    else if (s && !k.ctrl && !k.meta) {
      for (const ch of s) if (ch >= " ") { buf += ch; out.write(c.violet("•")); }
    }
  });
}

export async function confirm(q, def = true) {
  const hint = c.gray(def ? " (Y/n)" : " (y/N)");
  if (!TTY) { out.write(`  ${sym.arrow} ${q}${hint} `); const v = (await readLine()).trim().toLowerCase(); say(); return v ? v.startsWith("y") : def; }
  out.write(`  ${c.cyan("?")} ${c.bold(q)}${hint} `);
  return raw((s, k, done) => {
    if (k.name === "return" || k.name === "enter") { out.write(`${def ? c.green("yes") : c.gray("no")}\n`); done(def); }
    else if (s?.toLowerCase() === "y") { out.write(`${c.green("yes")}\n`); done(true); }
    else if (s?.toLowerCase() === "n") { out.write(`${c.gray("no")}\n`); done(false); }
  });
}

/** choices: [{ label, hint?, value }] → value */
export async function select(q, choices, { initial = 0 } = {}) {
  if (!TTY) {
    say(`  ${sym.arrow} ${q}`);
    choices.forEach((ch, i) => say(`     ${i + 1}) ${ch.label}`));
    out.write(`     choose 1-${choices.length} (${initial + 1}) `);
    const n = Number((await readLine()).trim() || initial + 1);
    say();
    return choices[Math.min(Math.max(n, 1), choices.length) - 1].value;
  }
  let i = initial, drawn = 0;
  const render = () => {
    if (drawn) out.write(`\x1b[${drawn}A\x1b[J`);
    const lines = [`  ${c.cyan("?")} ${c.bold(q)} ${c.gray("↑↓ to move, enter to choose")}`,
      ...choices.map((ch, j) => `   ${j === i ? c.cyan("❯") : " "} ${j === i ? c.bold(ch.label) : ch.label}${ch.hint ? `  ${c.gray(ch.hint)}` : ""}`)];
    out.write(`${lines.map(fit).join("\n")}\n`);
    drawn = lines.length;
  };
  out.write("\x1b[?25l"); render();
  const v = await raw((s, k, done) => {
    if (k.name === "up" || s === "k") { i = (i - 1 + choices.length) % choices.length; render(); }
    else if (k.name === "down" || s === "j") { i = (i + 1) % choices.length; render(); }
    else if (k.name === "return" || k.name === "enter") done(i);
  });
  out.write(`\x1b[${drawn}A\x1b[J\x1b[?25h`);
  say(`  ${sym.ok} ${c.bold(q)} ${c.cyan(choices[v].label)}`);
  return choices[v].value;
}

/** choices: [{ label, hint?, value, checked? }] → value[] */
export async function multiselect(q, choices, { min = 1 } = {}) {
  const sel = choices.map((ch) => !!ch.checked);
  if (!TTY) {
    say(`  ${sym.arrow} ${q}`);
    choices.forEach((ch, i) => say(`     ${i + 1}) ${sel[i] ? "[x]" : "[ ]"} ${ch.label}`));
    out.write(`     numbers separated by commas (enter = the ticked ones) `);
    const a = (await readLine()).trim();
    say();
    if (a) a.split(/[ ,]+/).forEach((n, _, arr) => { if (_ === 0) sel.fill(false); sel[Number(n) - 1] = true; });
    return choices.filter((_, i) => sel[i]).map((ch) => ch.value);
  }
  let i = 0, drawn = 0, msg = "";
  const render = () => {
    if (drawn) out.write(`\x1b[${drawn}A\x1b[J`);
    const lines = [`  ${c.cyan("?")} ${c.bold(q)}`, `    ${c.gray("↑↓ move · space select · a all · enter confirm")}`,
      ...choices.map((ch, j) => `   ${j === i ? c.cyan("❯") : " "} ${sel[j] ? sym.on : sym.off} ${j === i ? c.bold(ch.label) : ch.label}${ch.hint ? `  ${c.gray(ch.hint)}` : ""}`),
      msg ? `    ${c.red(msg)}` : ""];
    out.write(`${lines.map(fit).join("\n")}\n`);
    drawn = lines.length;
  };
  out.write("\x1b[?25l"); render();
  await raw((s, k, done) => {
    msg = "";
    if (k.name === "up" || s === "k") i = (i - 1 + choices.length) % choices.length;
    else if (k.name === "down" || s === "j") i = (i + 1) % choices.length;
    else if (k.name === "space") sel[i] = !sel[i];
    else if (s === "a") { const all = sel.every(Boolean); sel.fill(!all); }
    else if (k.name === "return" || k.name === "enter") {
      if (sel.filter(Boolean).length >= min) return done();
      msg = `Choose at least ${min}.`;
    }
    render();
  });
  out.write(`\x1b[${drawn}A\x1b[J\x1b[?25h`);
  const picked = choices.filter((_, j) => sel[j]);
  say(`  ${sym.ok} ${c.bold(q)}`);
  for (const p of picked) say(`      ${sym.bullet} ${p.label}`);
  return picked.map((p) => p.value);
}

export function closeInput() { lineRl?.close(); inp.pause(); }
