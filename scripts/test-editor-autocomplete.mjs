/**
 * Headless-browser checks for editor autocomplete (SS-netscript-2).
 *
 * BAR 2: a device id that looks like HTML must appear as literal text in
 * the dropdown, and window.__pwn must stay undefined.
 * BAR 3: on a new line after `core switch "c"`, typing `co` offers `core`,
 * and Tab inserts it.
 *
 * Uses the system Chrome/Edge DevTools Protocol so we do not add Playwright
 * or Puppeteer (neither is a current dependency; a CDP client is enough for
 * these two interactions). Set CHROME_PATH to override the browser binary.
 *
 *   node scripts/test-editor-autocomplete.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDITOR_DIR = path.join(ROOT, "editor");
const EDITOR_HTML = path.join(EDITOR_DIR, "netscript-editor.html");
const SHOT_DIR = path.join(ROOT, "docs", "images");

function fail(msg) {
  console.error("FAIL: " + msg);
  process.exitCode = 1;
  throw new Error(msg);
}

function ok(msg) {
  console.log("PASS: " + msg);
}

function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  fail("No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser.");
}

function startServer(root) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/netscript-editor.html";
      const fp = path.normalize(path.join(root, rel));
      const rootN = path.normalize(root + path.sep);
      if (fp !== path.normalize(root) && !fp.startsWith(rootN)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!existsSync(fp)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const ext = path.extname(fp);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
      res.end(readFileSync(fp));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, url: "http://127.0.0.1:" + addr.port });
    });
    server.on("error", reject);
  });
}

async function freePort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function waitForJson(url, timeoutMs) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      last = String(r.status);
    } catch (e) {
      last = e && e.message ? e.message : String(e);
    }
    await delay(50);
  }
  throw new Error("timeout waiting for " + url + " (" + last + ")");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.events = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const list = this.events.get(msg.method) || [];
        for (const fn of list) fn(msg.params);
      }
    });
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    const list = this.events.get(method) || [];
    list.push(fn);
    this.events.set(method, list);
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error("evaluate exception: " + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    }
    return r.result ? r.result.value : undefined;
  }
  async waitFor(expression, timeoutMs, msg) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeoutMs) {
      last = await this.evaluate(expression);
      if (last) return last;
      await delay(50);
    }
    throw new Error((msg || "waitFor timeout") + " last=" + JSON.stringify(last));
  }
  async key(key, opts = {}) {
    const def = {
      Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
      Tab: { code: "Tab", windowsVirtualKeyCode: 9, text: "" },
      Escape: { code: "Escape", windowsVirtualKeyCode: 27, text: "" },
    };
    const info = def[key] || {
      code: "Key" + key.toUpperCase(),
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
      text: opts.text != null ? opts.text : key,
    };
    const base = {
      key,
      code: info.code,
      windowsVirtualKeyCode: info.windowsVirtualKeyCode,
      nativeVirtualKeyCode: info.windowsVirtualKeyCode,
    };
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    if (info.text) {
      await this.send("Input.dispatchKeyEvent", { type: "char", ...base, text: info.text, unmodifiedText: info.text });
    }
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  async typeText(s) {
    for (const ch of s) {
      await this.key(ch, { text: ch });
      await delay(30);
    }
  }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {}
}

function hashFor(src) {
  return Buffer.from(src, "utf8").toString("base64");
}

function inspectEditor(src) {
  if (!existsSync(src)) fail("missing " + src);
  const text = readFileSync(src, "utf8");
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes("acEl.innerHTML")) hits.push((i + 1) + ":" + line.trim());
  });
  return { hits, hasFix: lineHasFix(text) };
}

function lineHasFix(text) {
  return text.includes("div.textContent = it") && text.includes("document.createElement(\"div\")");
}

async function main() {
  if (!existsSync(EDITOR_HTML)) fail("missing editor/netscript-editor.html; run npm run build:editor");

  const srcInspect = inspectEditor(path.join(EDITOR_DIR, "index.html"));
  const builtInspect = inspectEditor(EDITOR_HTML);
  if (srcInspect.hits.length) {
    fail("BAR 1: acEl.innerHTML still in editor/index.html:\n  " + srcInspect.hits.join("\n  "));
  }
  if (builtInspect.hits.length) {
    fail("BAR 1/4: acEl.innerHTML still in editor/netscript-editor.html:\n  " + builtInspect.hits.join("\n  "));
  }
  if (!srcInspect.hasFix || !builtInspect.hasFix) {
    fail("BAR 1/4: createElement+textContent fix not found in editor source/build");
  }
  ok("BAR 1/4 static: no acEl.innerHTML in editor/; DOM API fix present in source and build");

  const browser = findBrowser();
  console.log("browser: " + browser);
  const profile = mkdtempSync(path.join(tmpdir(), "ns-ac-"));
  const dbgPort = await freePort();
  let closing = false;
  const child = spawn(browser, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-popup-blocking",
    "--disable-features=Translate,MediaRouter",
    "--remote-debugging-port=" + dbgPort,
    "--remote-allow-origins=*",
    "--user-data-dir=" + profile,
    "--window-size=1200,900",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-4000); });
  child.on("exit", (code, sig) => {
    if (closing) return;
    if (code && code !== 0) console.error("browser exited " + code + " " + (sig || "") + " stderr: " + stderr.slice(-500));
  });

  let serverWrap;
  let ws;
  try {
    await waitForJson("http://127.0.0.1:" + dbgPort + "/json/version", 20000);
    serverWrap = await startServer(EDITOR_DIR);
    const pages = await waitForJson("http://127.0.0.1:" + dbgPort + "/json/list", 5000);
    const target = pages.find((p) => p.type === "page") || pages[0];
    if (!target || !target.webSocketDebuggerUrl) fail("no CDP page target");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () => reject(new Error("ws error")));
      setTimeout(() => reject(new Error("ws open timeout")), 10000);
    });
    const cdp = new Cdp(ws);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Input.enable").catch(() => {});

    const bar2Src = "x desktop \"a\"\n<img/src=x/onerror=window.__pwn=1> desktop \"b\"\n";
    await runXssCase(cdp, serverWrap.url, "BAR 2", bar2Src, "<img/src=x/onerror=window.__pwn=1>", "autocomplete-xss-bar2.png");

    const extras = [
      { name: "EXTRA svg-onload", src: "x desktop \"a\"\n\"><svg/onload=window.__pwn=1> desktop \"b\"\n", expect: "\"><svg/onload=window.__pwn=1>" },
      { name: "EXTRA attr-quote", src: "x desktop \"a\"\nfoo\"/onclick=\"window.__pwn=1 desktop \"b\"\n", expect: "foo\"/onclick=\"window.__pwn=1" },
      { name: "EXTRA breakout", src: "x desktop \"a\"\n</div><img/src=x/onerror=window.__pwn=1> desktop \"b\"\n", expect: "</div><img/src=x/onerror=window.__pwn=1>" },
    ];
    for (const ex of extras) {
      await runXssCase(cdp, serverWrap.url, ex.name, ex.src, ex.expect, null);
    }

    await runBar3(cdp, serverWrap.url);
    ok("all headless editor autocomplete checks passed");
  } finally {
    try { if (ws) ws.close(); } catch {}
    try { if (serverWrap) serverWrap.server.close(); } catch {}
    closing = true;
    killTree(child.pid);
    await delay(200);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

async function navigate(cdp, url) {
  const loaded = new Promise((resolve) => {
    const fn = () => resolve();
    cdp.on("Page.loadEventFired", fn);
  });
  await cdp.send("Page.navigate", { url });
  await Promise.race([loaded, delay(10000).then(() => { throw new Error("navigate timeout: " + url); })]);
  await delay(150);
  await cdp.waitFor("document.getElementById('src') && document.getElementById('ac')", 5000, "editor DOM not ready");
}

async function acState(cdp) {
  return cdp.evaluate(`({
    display: document.getElementById('ac').style.display,
    items: Array.prototype.map.call(document.getElementById('ac').children, function (ch) {
      return { text: ch.textContent, html: ch.innerHTML, tag: ch.tagName, childCount: ch.childElementCount };
    }),
    pwn: window.__pwn,
    pwnType: typeof window.__pwn,
    value: document.getElementById('src').value
  })`);
}

async function runXssCase(cdp, base, name, src, expectText, shotName) {
  const url = base + "/netscript-editor.html?case=" + encodeURIComponent(name) + "&t=" + Date.now() + "#n=" + hashFor(src);
  await navigate(cdp, url);
  const before = await cdp.evaluate(`({ pwn: window.__pwn, value: document.getElementById('src').value })`);
  if (before.pwn !== undefined) {
    fail(name + ": window.__pwn was set on load (preview sink?). value=" + JSON.stringify(before.pwn));
  }
  if (!before.value.includes(expectText)) {
    fail(name + ": loaded source did not contain expected id. value=" + JSON.stringify(before.value));
  }
  await cdp.evaluate(`(function () {
    var ta = document.getElementById('src');
    ta.focus();
    var n = ta.value.length;
    ta.selectionStart = ta.selectionEnd = n;
  })()`);
  await cdp.key("Enter");
  const state = await cdp.waitFor(
    `(function () {
      var ac = document.getElementById('ac');
      if (ac.style.display !== 'block' || !ac.children.length) return null;
      return {
        display: ac.style.display,
        items: Array.prototype.map.call(ac.children, function (ch) {
          return { text: ch.textContent, html: ch.innerHTML, tag: ch.tagName, childCount: ch.childElementCount };
        }),
        pwn: window.__pwn,
        pwnType: typeof window.__pwn
      };
    })()`,
    4000,
    name + ": autocomplete dropdown did not open after Enter",
  );
  if (state.pwn !== undefined && state.pwnType !== "undefined") {
    fail(name + ": window.__pwn was set (" + JSON.stringify(state.pwn) + ")");
  }
  const texts = state.items.map((it) => it.text);
  if (!texts.includes(expectText)) {
    fail(name + ": dropdown missing literal " + JSON.stringify(expectText) + " items=" + JSON.stringify(texts));
  }
  const item = state.items.find((it) => it.text === expectText);
  if (item.childCount !== 0) {
    fail(name + ": expected item to be a single text node, childCount=" + item.childCount + " html=" + JSON.stringify(item.html));
  }
  // innerHTML of a textContent-built node is the escaped form (e.g. &lt;img...).
  // Fail only on a literal start-tag, which would mean the payload parsed as HTML.
  if (/<[a-zA-Z!?/]/.test(item.html)) {
    fail(name + ": item innerHTML still contains raw markup: " + JSON.stringify(item.html));
  }
  if (item.html !== expectText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")) {
    fail(name + ": item innerHTML was not the escaped literal. html=" + JSON.stringify(item.html));
  }
  if (shotName) {
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    mkdirSync(SHOT_DIR, { recursive: true });
    writeFileSync(path.join(SHOT_DIR, shotName), Buffer.from(shot.data, "base64"));
    console.log("wrote docs/images/" + shotName);
  }
  ok(name + ": __pwn undefined, literal " + JSON.stringify(expectText) + " shown");
}

async function runBar3(cdp, base) {
  const src = "core switch \"c\"\n";
  const url = base + "/netscript-editor.html?case=bar3&t=" + Date.now() + "#n=" + hashFor(src);
  await navigate(cdp, url);
  await cdp.evaluate(`(function () {
    var ta = document.getElementById('src');
    ta.focus();
    var n = ta.value.length;
    ta.selectionStart = ta.selectionEnd = n;
  })()`);
  await cdp.typeText("co");
  const state = await cdp.waitFor(
    `(function () {
      var ac = document.getElementById('ac');
      if (ac.style.display !== 'block' || !ac.children.length) return null;
      return {
        display: ac.style.display,
        items: Array.prototype.map.call(ac.children, function (ch) { return ch.textContent; }),
        value: document.getElementById('src').value
      };
    })()`,
    4000,
    "BAR 3: dropdown did not open after typing co",
  );
  if (!state.items.includes("core")) {
    fail("BAR 3: typing co did not offer core; items=" + JSON.stringify(state.items));
  }
  ok("BAR 3: typing co offered core (" + JSON.stringify(state.items) + ")");
  await cdp.key("Tab");
  const after = await cdp.evaluate(`({
    value: document.getElementById('src').value,
    display: document.getElementById('ac').style.display
  })`);
  const expect = "core switch \"c\"\ncore ";
  if (after.value !== expect) {
    fail("BAR 3: Tab did not insert core; value=" + JSON.stringify(after.value) + " expected=" + JSON.stringify(expect));
  }
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(path.join(SHOT_DIR, "autocomplete-xss-bar3.png"), Buffer.from(shot.data, "base64"));
  console.log("wrote docs/images/autocomplete-xss-bar3.png");
  ok("BAR 3: Tab inserted " + JSON.stringify(expect));
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});