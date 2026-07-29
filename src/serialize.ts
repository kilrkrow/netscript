/**
 * NetScript serializer — NetModel → `.net` text. The inverse of parser.ts;
 * emits exactly the grammar parser.ts accepts, so `parseNet(serializeNet(m))`
 * round-trips.
 *
 * Not on the SVG critical path: MCP's `compile_net` renders straight from the
 * NetModel object, and only uses this to hand back human-editable source. A
 * serializer edge case can therefore never corrupt the diagram.
 */
import type { NetModel, Device, Port } from "./model.ts";

const q = (s: string): string => `"${String(s).replace(/"/g, '\\"')}"`;

function portLine(p: Port): string {
  const bits = [`port ${p.id} ${q(p.name)}`];
  if (p.speed) bits.push(`speed ${p.speed}`);
  if (p.media) bits.push(`media ${p.media}`);
  if (p.addr) bits.push(`addr ${p.addr}`);
  return `  ${bits.join(" ")}`;
}

function serviceLine(s: NonNullable<Device["services"]>[number]): string {
  return `  service ${s.id} ${q(s.name)} ${s.proto}/${s.port}${s.exe ? ` exe ${s.exe}` : ""}`;
}

function deviceLines(d: Device, indent: string): string[] {
  const bits = [`${indent}${d.id} ${d.kind} ${q(d.label)}`, `tier ${d.tier}`];
  if (d.mgmt) bits.push(`mgmt ${d.mgmt}`);
  const members = [
    ...(d.ports ?? []).map((p) => indent + portLine(p)),
    ...(d.services ?? []).map((s) => indent + serviceLine(s)),
  ];
  const head = bits.join(" ") + (members.length ? " {" : "");
  if (!members.length) return [head];
  return [head, ...members, `${indent}}`];
}

export function serializeNet(m: NetModel): string {
  const out: string[] = [];

  // frontmatter
  if (m.title || m.theme) {
    out.push("---");
    if (m.title) out.push(`title: ${m.title}`);
    if (m.theme) out.push(`theme: ${m.theme}`);
    out.push("---", "");
  }

  const inRack = new Set(m.devices.filter((d) => d.rack).map((d) => d.id));
  const topLevel = m.devices.filter((d) => !inRack.has(d.id));

  for (const d of topLevel) out.push(...deviceLines(d, ""));
  if (topLevel.length && m.racks.length) out.push("");

  m.racks.forEach((r, i) => {
    out.push(`rack ${r.id} ${q(r.role)} {`);
    for (const d of m.devices.filter((dd) => dd.rack === r.id)) out.push(...deviceLines(d, "  "));
    out.push("}");
    if (i < m.racks.length - 1) out.push("");
  });

  if (m.links.length) {
    out.push("");
    for (const l of m.links) {
      const a = l.aPort ? `${l.a}.${l.aPort}` : l.a;
      const b = l.bPort ? `${l.b}.${l.bPort}` : l.b;
      out.push(`${a} -> ${b} : ${l.speed}${l.bond ? " lag" : ""}`);
    }
  }

  if (m.vlans?.length) {
    out.push("");
    m.vlans.forEach((v, i) => {
      const head = `vlan ${v.id} ${q(v.name)}` + (v.subnet ? ` subnet ${v.subnet}` : "");
      out.push(`${head} {`);
      for (const mem of v.members) {
        const bits = [`  member ${mem.device}.${mem.port}`];
        if (mem.tagged) bits.push("tagged");
        if (mem.addr) bits.push(`addr ${mem.addr}`);
        out.push(bits.join(" "));
      }
      out.push("}");
      if (i < m.vlans!.length - 1) out.push("");
    });
  }

  if (m.segments?.length) {
    out.push("");
    m.segments.forEach((s, i) => {
      const head = `segment ${s.id} ${q(s.name)}` + (s.subnet ? ` subnet ${s.subnet}` : "");
      out.push(`${head} {`);
      for (const mem of s.members) {
        const ep = mem.port ? `${mem.device}.${mem.port}` : mem.device;
        out.push(`  member ${ep}${mem.addr ? ` addr ${mem.addr}` : ""}`);
      }
      out.push("}");
      if (i < m.segments!.length - 1) out.push("");
    });
  }

  if (m.bonds?.length) {
    out.push("");
    m.bonds.forEach((b, i) => {
      const head = `bond ${b.id} on ${b.device}` + (b.mode ? ` mode ${b.mode}` : "");
      out.push(`${head} {`);
      for (const p of b.memberPorts) out.push(`  member ${p}`);
      out.push("}");
      if (i < m.bonds!.length - 1) out.push("");
    });
  }

  if (m.flows?.length) {
    out.push("");
    for (const f of m.flows) {
      const lbl = f.label ? ` ${q(f.label)}` : "";
      if (f.toService) {
        out.push(`flow ${f.from} -> ${f.to}.${f.toService}${lbl}`);
      } else {
        const svc = f.port === undefined ? f.proto : `${f.proto}/${f.port}`;
        out.push(`flow ${f.from} -> ${f.to} : ${svc}${lbl}`);
      }
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
