/**
 * NetScript `.net` parser — text DSL → NetModel.
 *
 * Grammar (physical layer, v0.1):
 *
 *   ---                         # optional frontmatter
 *   title: My Lab
 *   theme: blueprint
 *   ---
 *
 *   <id> <kind> "label" [tier <tier>] [mgmt <addr>]      # device
 *   rack <id> "role" { ... }                             # group (members default tier host)
 *   <a> -> <b> : <speed> [lag]                           # link (-- = peer; class inferred)
 *
 *   # line comments with '#'
 *
 * Link class (uplink / peer / intra / e2c / wan) is inferred from tiers by the
 * router, so authors never hand-classify. `tier` is optional where it can be
 * inferred from kind (cloud→wan, firewall/router→edge, host kinds→host, a
 * switch→core at top level / tor inside a rack).
 */
import type { NetModel, Device, Link, Kind, Tier, Speed } from "./model.ts";

const KINDS = new Set<string>(["cloud", "router", "firewall", "switch", "server", "storage", "ap", "desktop"]);
const TIERS = new Set<string>(["wan", "edge", "core", "tor", "host"]);
const SPEEDS = new Set<string>(["WAN", "1G", "10G", "25G", "40G", "100G", "LAG"]);

function inferTier(kind: Kind, inRack: boolean): Tier {
  if (kind === "cloud") return "wan";
  if (kind === "firewall" || kind === "router") return "edge";
  if (kind === "switch") return inRack ? "tor" : "core";
  return "host"; // server / storage / ap / desktop
}

/** Strip an unquoted `#` comment from a line. */
function stripComment(line: string): string {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === "#" && !q) return line.slice(0, i);
  }
  return line;
}

export function parseNet(src: string): NetModel {
  const lines = src.split(/\r?\n/);
  const model: NetModel = { title: "Untitled", devices: [], links: [], racks: [] };
  let i = 0;

  // ---- frontmatter ----
  if (lines[0] !== undefined && lines[0].trim() === "---") {
    i = 1;
    for (; i < lines.length && lines[i].trim() !== "---"; i++) {
      const m = lines[i].match(/^\s*([\w-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase(), val = m[2].trim();
      if (key === "title") model.title = val;
      else if (key === "theme") model.theme = val;
    }
    i++; // consume closing ---
  }

  // ---- body ----
  let rack: string | null = null;
  for (; i < lines.length; i++) {
    const ln = i + 1;
    const t = stripComment(lines[i]).trim();
    if (!t) continue;

    if (t === "}") { rack = null; continue; }

    // rack <id> "role" {
    let m = t.match(/^rack\s+(\S+)\s+"([^"]*)"\s*\{$/);
    if (m) {
      const id = m[1];
      if (model.racks.some((r) => r.id === id)) throw new Error(`line ${ln}: duplicate rack "${id}"`);
      model.racks.push({ id, label: `Rack ${id}`, role: m[2] });
      rack = id;
      continue;
    }

    // <a> (->|--) <b> : <speed> [lag]
    m = t.match(/^(\S+)\s*(->|--)\s*(\S+)\s*:\s*([A-Za-z0-9]+)(\s+lag)?$/i);
    if (m) {
      const speed = m[4].toUpperCase();
      if (!SPEEDS.has(speed)) throw new Error(`line ${ln}: unknown speed "${m[4]}"`);
      model.links.push({ a: m[1], b: m[3], speed: speed as Speed, ...(m[5] ? { bond: true } : {}) });
      continue;
    }

    // <id> <kind> "label" [tier X] [mgmt Y]
    m = t.match(/^(\S+)\s+(\S+)\s+"([^"]*)"\s*(.*)$/);
    if (m) {
      const id = m[1], kindRaw = m[2].toLowerCase(), label = m[3], rest = m[4];
      if (model.devices.some((d) => d.id === id)) throw new Error(`line ${ln}: duplicate device id "${id}"`);
      if (!KINDS.has(kindRaw)) throw new Error(`line ${ln}: unknown kind "${m[2]}"`);
      const kind = kindRaw as Kind;
      const dev: Device = { id, kind, label, tier: "host" };
      const tm = rest.match(/\btier\s+(\S+)/);
      if (tm) {
        if (!TIERS.has(tm[1])) throw new Error(`line ${ln}: unknown tier "${tm[1]}"`);
        dev.tier = tm[1] as Tier;
      } else {
        dev.tier = inferTier(kind, rack !== null);
      }
      const mm = rest.match(/\bmgmt\s+(\S+)/);
      if (mm) dev.mgmt = mm[1];
      if (rack !== null) dev.rack = rack;
      model.devices.push(dev);
      continue;
    }

    throw new Error(`line ${ln}: cannot parse → ${t}`);
  }

  // ---- light validation (resolvable endpoints) ----
  const ids = new Set(model.devices.map((d) => d.id));
  for (const l of model.links) {
    if (!ids.has(l.a)) throw new Error(`link references unknown device "${l.a}"`);
    if (!ids.has(l.b)) throw new Error(`link references unknown device "${l.b}"`);
  }
  return model;
}
