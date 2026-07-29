/**
 * NetScript logical layer — helpers that project the LOGICAL overlay
 * (VLANs / subnets / bonds / interface addresses) over the same positioned
 * model the physical renderer uses.
 *
 * This module owns NO geometry and NO SVG. It answers questions the renderer
 * asks ("what VLANs does this link carry?", "is this link a bond member?",
 * "what colour is VLAN 20?") so render.ts stays a thin view. The model remains
 * the single source of truth; this is a derived projection, never stored back.
 */
import type { NetModel, Link, Vlan, Bond, Port, Segment, SegmentMember } from "./model.ts";

/** Stable VLAN-id → palette-index map (sorted by id, so colours are deterministic). */
export function vlanColorIndex(m: NetModel): Map<number, number> {
  const ids = [...new Set((m.vlans ?? []).map((v) => v.id))].sort((a, b) => a - b);
  return new Map(ids.map((id, i) => [id, i]));
}

/** device id → its Bond list (a device may own several). */
export function bondsByDevice(m: NetModel): Map<string, Bond[]> {
  const out = new Map<string, Bond[]>();
  for (const b of m.bonds ?? []) {
    const arr = out.get(b.device) ?? [];
    arr.push(b);
    out.set(b.device, arr);
  }
  return out;
}

/** Find the bond (if any) that a given `{device, port}` is a member of. */
export function bondForPort(m: NetModel, device: string, port?: string): Bond | undefined {
  if (!port) return undefined;
  return (m.bonds ?? []).find((b) => b.device === device && b.memberPorts.includes(port));
}

/**
 * For a link, the set of VLAN ids it carries. A link carries a VLAN when EITHER
 * endpoint's attached port is a member of that VLAN. Used to colour the link
 * and badge it in the logical view.
 */
export function vlansOnLink(m: NetModel, l: Link): Vlan[] {
  const hits: Vlan[] = [];
  for (const v of m.vlans ?? []) {
    const onA = l.aPort && v.members.some((mem) => mem.device === l.a && mem.port === l.aPort);
    const onB = l.bPort && v.members.some((mem) => mem.device === l.b && mem.port === l.bPort);
    if (onA || onB) hits.push(v);
  }
  return hits;
}

/** Resolve a port object on a device by id (for callouts / addresses). */
export function portOf(m: NetModel, device: string, port?: string): Port | undefined {
  if (!port) return undefined;
  return m.devices.find((d) => d.id === device)?.ports?.find((p) => p.id === port);
}

/**
 * Links that represent a bond should be COLLAPSED to a single logical link in
 * the logical view (the physical view still draws the offset pair). We treat a
 * link as bond-collapsible when it is `bond: true` OR both endpoints' ports are
 * bond members. Returns a key so callers can de-dupe parallel members.
 */
export function bondKey(m: NetModel, l: Link): string | null {
  if (l.bond) return `${l.a}~${l.b}~bond`;
  const ba = bondForPort(m, l.a, l.aPort);
  const bb = bondForPort(m, l.b, l.bPort);
  if (ba || bb) return `${l.a}~${l.b}~${ba?.id ?? ""}~${bb?.id ?? ""}`;
  return null;
}

/** True when the model carries any logical content worth overlaying. */
export const hasLogical = (m: NetModel): boolean =>
  !!(m.vlans?.length || m.bonds?.length || m.segments?.length ||
     m.devices.some((d) => d.ports?.some((p) => p.addr)));

/**
 * Segments to draw as Ethernet tubes.
 *
 * Prefer explicitly authored `m.segments`. When none are given, derive one
 * tube per VLAN that has a subnet — so existing logical models get buses for
 * free. Port.addr fills in when the member itself has no addr.
 */
export function resolveSegments(m: NetModel): Segment[] {
  if (m.segments?.length) return m.segments;
  const out: Segment[] = [];
  for (const v of m.vlans ?? []) {
    if (!v.subnet || !v.members.length) continue;
    const members: SegmentMember[] = v.members.map((mem) => {
      const portAddr = portOf(m, mem.device, mem.port)?.addr;
      // Prefer host address on the segment; fall back to interface addr (may be CIDR).
      const addr = mem.addr ?? (portAddr && !portAddr.includes("/") ? portAddr : portAddr?.split("/")[0]);
      return { device: mem.device, port: mem.port, ...(addr ? { addr } : {}) };
    });
    out.push({ id: `vlan${v.id}`, name: v.name, subnet: v.subnet, members });
  }
  return out;
}
