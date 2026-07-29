/**
 * NetScript `.net` parser — text DSL → NetModel.
 *
 * Grammar:
 *
 *   ---                         # optional frontmatter
 *   title: My Lab
 *   theme: blueprint
 *   ---
 *
 *   <id> <kind> "label" [tier <tier>] [mgmt <addr>]      # device
 *   <id> <kind> "label" ... {                            # device, with a member block
 *     port    <id> "<name>" [speed <speed>] [media <media>] [addr <addr>]
 *     service <id> "<name>" <proto>/<port> [exe <exe>]   # listening service (L4)
 *   }
 *   rack <id> "role" { <device>... }                     # group (members default tier host)
 *   vlan <id> "name" [subnet <cidr>] {                    # VLAN (logical layer)
 *     member <device>[.<port>] [tagged] [addr <addr>]     # port optional
 *   }
 *   segment <id> "name" [subnet <cidr>] {                 # Ethernet tube (L2 bus)
 *     member <device>[.<port>] [addr <addr>]              # port optional (scan-style)
 *   }
 *   bond <id> on <device> [mode <mode>] {                 # LAG/bond (logical layer)
 *     member <port>
 *   }
 *   <a>[.<port>] (->|--) <b>[.<port>] : <speed> [lag]     # link (-- = peer; class inferred)
 *   flow <from> -> <to>.<service> ["label"]               # flow to a declared service
 *   flow <from> -> <to> : <proto>[/<port>] ["label"]      # ad-hoc flow (e.g. icmp)
 *
 *   # line comments with '#'
 *
 * Blocks nest via a small mode stack (rack ⊃ device is the only real nesting;
 * vlan/bond are top-level). Link class (uplink / peer / intra / e2c / wan) is
 * inferred from tiers by the router, so authors never hand-classify. `tier` is
 * optional where it can be inferred from kind (cloud→wan, firewall/router→edge,
 * host kinds→host, a switch→core at top level / tor inside a rack).
 */
import type { NetModel, Device, Link, Kind, Tier, Speed, Port, Vlan, Bond, Flow, Proto, Segment } from "./model.ts";

const KINDS = new Set<string>(["cloud", "router", "firewall", "switch", "server", "storage", "ap", "desktop", "camera"]);
const TIERS = new Set<string>(["wan", "edge", "core", "tor", "host"]);
const SPEEDS = new Set<string>(["WAN", "1G", "10G", "25G", "40G", "100G", "LAG"]);

export function inferTier(kind: Kind, inRack: boolean): Tier {
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

/** Split "device.port" → ["device", "port"] on the FIRST dot; no dot → [tok, undefined]. */
function splitPort(tok: string): [string, string | undefined] {
  const i = tok.indexOf(".");
  return i < 0 ? [tok, undefined] : [tok.slice(0, i), tok.slice(i + 1)];
}

type Frame =
  | { kind: "rack"; id: string }
  | { kind: "device"; dev: Device }
  | { kind: "vlan"; vlan: Vlan }
  | { kind: "segment"; segment: Segment }
  | { kind: "bond"; bond: Bond };

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
  const stack: Frame[] = [];
  const currentRack = (): string | null => {
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === "rack") return (stack[k] as { kind: "rack"; id: string }).id;
    return null;
  };
  const top = (): Frame | undefined => stack[stack.length - 1];

  for (; i < lines.length; i++) {
    const ln = i + 1;
    const t = stripComment(lines[i]).trim();
    if (!t) continue;

    if (t === "}") {
      if (!stack.length) throw new Error(`line ${ln}: unexpected "}"`);
      stack.pop();
      continue;
    }

    const blockOpen = t.endsWith("{");
    const header = blockOpen ? t.slice(0, -1).trim() : t;

    // ---- lines only valid inside a specific frame ----
    const tf = top();
    if (tf?.kind === "device") {
      // service <id> "<name>" <proto>/<port> [exe <exe>]
      const svc = header.match(/^service\s+(\S+)\s+"([^"]*)"\s+(tcp|udp|icmp|any)\/(\d+)(?:\s+exe\s+(\S+))?$/i);
      if (svc) {
        const [, sid, sname, sproto, sport, sexe] = svc;
        tf.dev.services ??= [];
        if (tf.dev.services.some((s) => s.id === sid)) throw new Error(`line ${ln}: duplicate service "${sid}" on device "${tf.dev.id}"`);
        const portNum = Number(sport);
        if (portNum < 0 || portNum > 65535) throw new Error(`line ${ln}: port out of range "${sport}"`);
        tf.dev.services.push({ id: sid, name: sname, proto: sproto.toLowerCase() as Proto, port: portNum, ...(sexe ? { exe: sexe } : {}) });
        continue;
      }
      const m = header.match(/^port\s+(\S+)\s+"([^"]*)"\s*(.*)$/);
      if (!m) throw new Error(`line ${ln}: expected "port <id> \\"<name>\\"" or "service <id> \\"<name>\\" <proto>/<port>" inside device block → ${header}`);
      const [, id, name, rest] = m;
      if (tf.dev.ports!.some((p) => p.id === id)) throw new Error(`line ${ln}: duplicate port "${id}" on device "${tf.dev.id}"`);
      const port: Port = { id, name };
      const sm = rest.match(/\bspeed\s+(\S+)/);
      if (sm) { if (!SPEEDS.has(sm[1].toUpperCase())) throw new Error(`line ${ln}: unknown speed "${sm[1]}"`); port.speed = sm[1].toUpperCase() as Speed; }
      const mm = rest.match(/\bmedia\s+(\S+)/);
      if (mm) port.media = mm[1];
      const am = rest.match(/\baddr\s+(\S+)/);
      if (am) port.addr = am[1];
      tf.dev.ports!.push(port);
      continue;
    }
    if (tf?.kind === "vlan") {
      const m = header.match(/^member\s+(\S+)((?:\s+tagged)?)(?:\s+addr\s+(\S+))?$/);
      if (!m) throw new Error(`line ${ln}: expected "member <device>[.<port>] [tagged] [addr <addr>]" inside vlan block → ${header}`);
      const [dev, port] = splitPort(m[1]);
      if (m[2]?.includes("tagged") && !port) {
        throw new Error(`line ${ln}: "tagged" requires a port (device.port) → ${header}`);
      }
      tf.vlan.members.push({
        device: dev,
        ...(port ? { port } : {}),
        ...(m[2]?.includes("tagged") ? { tagged: true } : {}),
        ...(m[3] ? { addr: m[3] } : {}),
      });
      continue;
    }
    if (tf?.kind === "segment") {
      const m = header.match(/^member\s+(\S+)(?:\s+addr\s+(\S+))?$/);
      if (!m) throw new Error(`line ${ln}: expected "member <device>[.<port>] [addr <addr>]" inside segment block → ${header}`);
      const [dev, port] = splitPort(m[1]);
      tf.segment.members.push({
        device: dev,
        ...(port ? { port } : {}),
        ...(m[2] ? { addr: m[2] } : {}),
      });
      continue;
    }
    if (tf?.kind === "bond") {
      const m = header.match(/^member\s+(\S+)$/);
      if (!m) throw new Error(`line ${ln}: expected "member <port>" inside bond block → ${header}`);
      tf.bond.memberPorts.push(m[1]);
      continue;
    }
    if (header.startsWith("port ")) throw new Error(`line ${ln}: "port" is only valid inside a device block`);
    if (header.startsWith("member ")) throw new Error(`line ${ln}: "member" is only valid inside a vlan, segment, or bond block`);

    // ---- top-level / rack-level lines ----

    // rack <id> "role" {
    let m = header.match(/^rack\s+(\S+)\s+"([^"]*)"$/);
    if (blockOpen && m) {
      if (stack.length) throw new Error(`line ${ln}: "rack" blocks cannot nest`);
      const id = m[1];
      if (model.racks.some((r) => r.id === id)) throw new Error(`line ${ln}: duplicate rack "${id}"`);
      model.racks.push({ id, label: `Rack ${id}`, role: m[2] });
      stack.push({ kind: "rack", id });
      continue;
    }

    // vlan <id> "name" [subnet <cidr>] {
    m = header.match(/^vlan\s+(\d+)\s+"([^"]*)"(?:\s+subnet\s+(\S+))?$/);
    if (blockOpen && m && !stack.length) {
      const id = Number(m[1]);
      model.vlans ??= [];
      if (model.vlans.some((v) => v.id === id)) throw new Error(`line ${ln}: duplicate vlan "${id}"`);
      const vlan: Vlan = { id, name: m[2], members: [], ...(m[3] ? { subnet: m[3] } : {}) };
      model.vlans.push(vlan);
      stack.push({ kind: "vlan", vlan });
      continue;
    }

    // segment <id> "name" [subnet <cidr>] {
    m = header.match(/^segment\s+(\S+)\s+"([^"]*)"(?:\s+subnet\s+(\S+))?$/);
    if (blockOpen && m && !stack.length) {
      const id = m[1];
      model.segments ??= [];
      if (model.segments.some((s) => s.id === id)) throw new Error(`line ${ln}: duplicate segment "${id}"`);
      const segment: Segment = { id, name: m[2], members: [], ...(m[3] ? { subnet: m[3] } : {}) };
      model.segments.push(segment);
      stack.push({ kind: "segment", segment });
      continue;
    }

    // bond <id> on <device> [mode <mode>] {
    m = header.match(/^bond\s+(\S+)\s+on\s+(\S+)(?:\s+mode\s+(\S+))?$/);
    if (blockOpen && m && !stack.length) {
      const id = m[1];
      model.bonds ??= [];
      if (model.bonds.some((b) => b.id === id)) throw new Error(`line ${ln}: duplicate bond "${id}"`);
      const bond: Bond = { id, device: m[2], memberPorts: [], ...(m[3] ? { mode: m[3] } : {}) };
      model.bonds.push(bond);
      stack.push({ kind: "bond", bond });
      continue;
    }

    // flow <from> -> <to>.<service> ["label"]           (port comes from the service)
    // flow <from> -> <to> : <proto>[/<port>] ["label"]  (ad-hoc, no declared service)
    // Keyword-prefixed so it can never be confused with a physical link line
    // (`a -> b : 10G`), which shares the arrow shape but means something else.
    m = header.match(/^flow\s+(\S+)\s*->\s*(\S+)(?:\s*:\s*(tcp|udp|icmp|any)(?:\/(\d+))?)?(?:\s+"([^"]*)")?$/i);
    if (!blockOpen && m && !stack.length) {
      const [, from, target, proto, port, label] = m;
      const flow: Flow = { from, to: target };
      if (proto) {
        flow.proto = proto.toLowerCase() as Proto;
        if (port !== undefined) {
          const p = Number(port);
          if (p < 0 || p > 65535) throw new Error(`line ${ln}: port out of range "${port}"`);
          flow.port = p;
        }
      } else {
        // No `: proto/port` given, so the target must name a service: `host.svc`.
        const [devId, svcId] = splitPort(target);
        if (!svcId) throw new Error(`line ${ln}: flow needs either "<host>.<service>" or ": <proto>[/<port>]" → ${header}`);
        flow.to = devId;
        flow.toService = svcId;
      }
      if (label) flow.label = label;
      (model.flows ??= []).push(flow);
      continue;
    }

    // <a>[.<port>] (->|--) <b>[.<port>] : <speed> [lag]
    m = header.match(/^(\S+)\s*(->|--)\s*(\S+)\s*:\s*([A-Za-z0-9]+)(\s+lag)?$/i);
    if (!blockOpen && m && (!stack.length || tf?.kind === "rack")) {
      const [aId, aPort] = splitPort(m[1]);
      const [bId, bPort] = splitPort(m[3]);
      const speed = m[4].toUpperCase();
      if (!SPEEDS.has(speed)) throw new Error(`line ${ln}: unknown speed "${m[4]}"`);
      const link: Link = { a: aId, b: bId, speed: speed as Speed, ...(m[5] ? { bond: true } : {}) };
      if (aPort) link.aPort = aPort;
      if (bPort) link.bPort = bPort;
      model.links.push(link);
      continue;
    }

    // <id> <kind> "label" [tier X] [mgmt Y] [{]
    m = header.match(/^(\S+)\s+(\S+)\s+"([^"]*)"\s*(.*)$/);
    if (m && (!stack.length || tf?.kind === "rack")) {
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
        dev.tier = inferTier(kind, currentRack() !== null);
      }
      const mm = rest.match(/\bmgmt\s+(\S+)/);
      if (mm) dev.mgmt = mm[1];
      const rackId = currentRack();
      if (rackId !== null) dev.rack = rackId;
      model.devices.push(dev);
      if (blockOpen) { dev.ports = []; stack.push({ kind: "device", dev }); }
      continue;
    }

    throw new Error(`line ${ln}: cannot parse → ${t}`);
  }

  if (stack.length) throw new Error(`unexpected end of file: unclosed "${stack[stack.length - 1].kind}" block`);

  validateModel(model);
  return model;
}

/**
 * Cross-reference validation shared by the parser and by callers that build a
 * NetModel directly (e.g. the MCP `compile_net` tool) — links/vlan-members/
 * bond-members must resolve to real devices and, where a port id is given, a
 * real port on that device. Throws on the first problem found.
 */
export function validateModel(model: NetModel): void {
  const devById = new Map(model.devices.map((d) => [d.id, d]));
  const hasPort = (devId: string, portId?: string) => !portId || !!devById.get(devId)?.ports?.some((p) => p.id === portId);
  for (const l of model.links) {
    if (!devById.has(l.a)) throw new Error(`link references unknown device "${l.a}"`);
    if (!devById.has(l.b)) throw new Error(`link references unknown device "${l.b}"`);
    if (!hasPort(l.a, l.aPort)) throw new Error(`link references unknown port "${l.a}.${l.aPort}"`);
    if (!hasPort(l.b, l.bPort)) throw new Error(`link references unknown port "${l.b}.${l.bPort}"`);
  }
  // Ports are optional on vlan/segment members. When a port id is given AND the
  // device declares a ports list, it must resolve; freeform labels on port-less
  // devices (scan import) are allowed so interfaces are never mandatory.
  const portOk = (devId: string, portId?: string) => {
    if (!portId) return true;
    const ports = devById.get(devId)?.ports;
    if (!ports?.length) return true; // freeform interface name, not declared
    return ports.some((p) => p.id === portId);
  };
  for (const v of model.vlans ?? []) {
    for (const mem of v.members) {
      if (!devById.has(mem.device)) throw new Error(`vlan ${v.id}: unknown device "${mem.device}"`);
      if (!portOk(mem.device, mem.port)) throw new Error(`vlan ${v.id}: unknown port "${mem.device}.${mem.port}"`);
    }
  }
  for (const s of model.segments ?? []) {
    for (const mem of s.members) {
      if (!devById.has(mem.device)) throw new Error(`segment "${s.id}": unknown device "${mem.device}"`);
      if (!portOk(mem.device, mem.port)) throw new Error(`segment "${s.id}": unknown port "${mem.device}.${mem.port}"`);
    }
  }
  for (const b of model.bonds ?? []) {
    if (!devById.has(b.device)) throw new Error(`bond "${b.id}": unknown device "${b.device}"`);
    for (const p of b.memberPorts) if (!hasPort(b.device, p)) throw new Error(`bond "${b.id}": unknown port "${b.device}.${p}"`);
  }
  for (const f of model.flows ?? []) {
    if (!devById.has(f.from)) throw new Error(`flow references unknown device "${f.from}"`);
    if (!devById.has(f.to)) throw new Error(`flow references unknown device "${f.to}"`);
    if (f.from === f.to) throw new Error(`flow "${f.from}" targets itself`);
    if (f.toService && !devById.get(f.to)!.services?.some((s) => s.id === f.toService))
      throw new Error(`flow references unknown service "${f.to}.${f.toService}"`);
    if (!f.toService && !f.proto) throw new Error(`flow ${f.from} -> ${f.to} has neither a service nor a protocol`);
  }
}
