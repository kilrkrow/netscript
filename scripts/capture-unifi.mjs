/**
 * capture-unifi.mjs — pull UniFi Network controller JSON for NetScript.
 *
 * Run this on a machine that can REACH the console (your LAN), not the sandbox.
 * Node 18+ (you already have 24 for NetScript). Local account, http or https.
 *
 *   node capture-unifi.mjs --host http://192.168.1.1 --user ro --pass 'secret'
 *   node capture-unifi.mjs --host http://192.168.1.1 --user ro --pass 'secret' --site default --out ./capture
 *
 * Writes unifi-*.json into the out dir. Scrub MAC/IP values before sharing if
 * you like — the adapter only needs the SHAPE, not the real values.
 *
 * If your console turns out to be https with a self-signed cert, run:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node capture-unifi.mjs --host https://192.168.1.1 ...
 */
import { writeFileSync, mkdirSync } from "node:fs";

const A = {};
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i++) if (av[i].startsWith("--")) A[av[i].slice(2)] = av[++i];

const host = (A.host || "").replace(/\/+$/, "");
if (!host || !A.user || A.pass === undefined) {
  console.error("usage: node capture-unifi.mjs --host http://IP --user U --pass P [--site default] [--out dir]");
  process.exit(1);
}
const outDir = A.out || "unifi-capture";

const cookiesFrom = (res) =>
  (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");

// 1) log in (UniFi OS consoles like the Dream Router use /api/auth/login)
const login = await fetch(`${host}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: A.user, password: A.pass }),
  redirect: "manual",
}).catch((e) => { console.error("connect failed:", e.message); process.exit(1); });

if (!login.ok) {
  console.error(`login failed: ${login.status} ${login.statusText}`);
  console.error("hints: wrong host/creds? Older controller uses /api/login. https self-signed → NODE_TLS_REJECT_UNAUTHORIZED=0 + https:// URL.");
  process.exit(1);
}
const cookie = cookiesFrom(login);
if (!cookie) { console.error("logged in but no session cookie returned — tell me your UniFi OS version."); process.exit(1); }

// 2) discover the site name (don't assume "default")
let site = A.site || "default";
if (!A.site) {
  try {
    const r = await fetch(`${host}/proxy/network/api/self/sites`, { headers: { cookie } });
    const j = await r.json();
    if (j?.data?.[0]?.name) site = j.data[0].name;
  } catch { /* keep default */ }
}

// 3) dump the endpoints the adapter needs
mkdirSync(outDir, { recursive: true });
const eps = [
  "stat/device",      // switches/APs/gateway + per-port table + LLDP neighbors
  "stat/sta",         // clients: mac/ip/hostname + the port/AP they're on
  "rest/networkconf", // networks: VLAN ids + subnets
  "rest/portconf",    // port profiles
];
for (const ep of eps) {
  try {
    const r = await fetch(`${host}/proxy/network/api/s/${site}/${ep}`, { headers: { cookie } });
    const body = await r.text();
    const file = `${outDir}/unifi-${ep.replace(/\//g, "-")}.json`;
    writeFileSync(file, body);
    console.log(`${r.ok ? "ok " : "ERR"} ${String(r.status).padEnd(3)} ${ep}  ->  ${file}`);
  } catch (e) {
    console.log(`ERR     ${ep}  (${e.message})`);
  }
}
console.log(`\nsite="${site}". Files in ${outDir}/ — share them here (scrub MAC/IP if you want; shape is what matters).`);
