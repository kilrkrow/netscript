/**
 * NetScript layout — assigns x/y/w/h to a declarative model and derives zone
 * boxes.
 *
 * Multi-segment bus layout (no wan/edge/core fabric):
 *
 *     [Default clients L→R]
 *            ↓ drops
 *     ═══ Default tube ═══
 *
 *     ═══ iot tube ═══
 *            ↓ drops
 *     [iot clients L→R]
 *
 * First segment: hosts above its tube. Later segments: tube above hosts so
 * lines run down from that tube to its clients without crossing the tube above.
 */
import type { NetModel, Device, Segment } from "./model.ts";

const SIZE: Record<string, [number, number]> = {
  wan: [120, 46], edge: [150, 54], core: [150, 52], tor: [150, 50], host: [104, 48],
};
const LEFT = 92, RIGHT = 92, GAP = 80;
const Y = { wan: 44, edge: 150, core: 278, tor: 400, host0: 520 };
const HOST_SLOT = 148;
const HOST_STAGGER = 40;
const RACK_MIN_W = 280;
/** Room under a host band for its tube (hosts-above pattern). */
export const TUBE_BAND_RESERVE = 100;
/** Room above a host band for its tube (hosts-below pattern). */
export const TUBE_ABOVE_RESERVE = 100;
const BETWEEN = 48;

export interface Zone { x: number; y: number; w: number; h: number; label: string; }
export interface Layout { W: number; H: number; zones: Zone[]; }

function placeHostsLR(hosts: Device[], left: number, y0: number): number {
  if (!hosts.length) return RACK_MIN_W;
  hosts.forEach((d, i) => {
    d.w = d.w ?? SIZE.host[0];
    d.h = d.h ?? SIZE.host[1];
    d.x = left + HOST_SLOT / 2 + i * HOST_SLOT;
    d.y = y0 + (i % 2 === 0 ? 0 : HOST_STAGGER);
  });
  return Math.max(RACK_MIN_W, hosts.length * HOST_SLOT);
}

function sizeDevices(m: NetModel): void {
  for (const d of m.devices) [d.w, d.h] = SIZE[d.tier] ?? SIZE.host;
}

function contentWidth(m: NetModel): number {
  let maxRight = LEFT;
  for (const d of m.devices) {
    if (d.x != null && d.w != null) maxRight = Math.max(maxRight, d.x + d.w / 2);
  }
  return Math.max(maxRight + RIGHT, 560);
}

function makeZones(m: NetModel): Zone[] {
  const pad = { l: 38, r: 38, t: 20, b: 28 };
  const bbox = (ds: Device[]) => {
    const x1 = Math.min(...ds.map((d) => d.x! - d.w! / 2));
    const x2 = Math.max(...ds.map((d) => d.x! + d.w! / 2));
    const y1 = Math.min(...ds.map((d) => d.y! - d.h! / 2));
    const y2 = Math.max(...ds.map((d) => d.y! + d.h! / 2));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  const zones: Zone[] = [];
  const cores = m.devices.filter((d) => d.tier === "core");
  if (cores.length >= 2) {
    const b = bbox(cores);
    zones.push({ x: b.x - pad.l, y: b.y - pad.t, w: b.w + pad.l + pad.r, h: b.h + pad.t + pad.b, label: "CORE" });
  }
  for (const r of m.racks) {
    const ds = m.devices.filter((d) => d.rack === r.id);
    if (!ds.length) continue;
    const b = bbox(ds);
    zones.push({
      x: b.x - pad.l, y: b.y - pad.t,
      w: b.w + pad.l + pad.r, h: b.h + pad.t + pad.b,
      label: r.role.toUpperCase(),
    });
  }
  return zones;
}

function uniqueMembers(m: NetModel, seg: Segment): Device[] {
  const seen = new Set<string>();
  const out: Device[] = [];
  for (const mem of seg.members) {
    if (seen.has(mem.device)) continue;
    const d = m.devices.find((x) => x.id === mem.device);
    if (!d) continue;
    seen.add(mem.device);
    out.push(d);
  }
  return out;
}

/**
 * Segment bus bands:
 *   seg0 hosts → [tube0] → [tube1] → seg1 hosts → …
 * First segment: hosts above tube. Later segments: tube above hosts.
 */
function layoutBusBands(m: NetModel, segs: Segment[]): Layout {
  sizeDevices(m);
  let yCursor = 100;
  let maxW = 560;
  const rowSpan = SIZE.host[1] + HOST_STAGGER;

  segs.forEach((seg, si) => {
    const hosts = uniqueMembers(m, seg);
    if (!hosts.length) return;

    if (si === 0) {
      // Hosts first, tube reserve below
      const w = placeHostsLR(hosts, LEFT, yCursor + SIZE.host[1] / 2);
      maxW = Math.max(maxW, LEFT + w + RIGHT);
      yCursor += rowSpan + TUBE_BAND_RESERVE + BETWEEN;
    } else {
      // Tube reserve first, then hosts below (lines run down from tube)
      yCursor += TUBE_ABOVE_RESERVE;
      const w = placeHostsLR(hosts, LEFT, yCursor + SIZE.host[1] / 2);
      maxW = Math.max(maxW, LEFT + w + RIGHT);
      yCursor += rowSpan + BETWEEN;
    }
  });

  const maxY = Math.max(
    yCursor,
    ...m.devices.map((d) => (d.y ?? 0) + (d.h ?? 0) / 2),
  );
  return { W: maxW, H: maxY + 80, zones: makeZones(m) };
}

function hasFabric(m: NetModel): boolean {
  return m.devices.some((d) => d.tier === "wan" || d.tier === "edge" || d.tier === "core");
}

export function layoutModel(m: NetModel): Layout {
  if (m.segments?.length && !hasFabric(m)) {
    return layoutBusBands(m, m.segments);
  }

  sizeDevices(m);
  const n = m.racks.length;
  const rackless = m.devices.filter((d) => !d.rack && (d.tier === "tor" || d.tier === "host"));
  const cores = m.devices.filter((d) => d.tier === "core");
  const edges = m.devices.filter((d) => d.tier === "edge");
  const wans = m.devices.filter((d) => d.tier === "wan");

  let cursor = LEFT;
  for (const r of m.racks) {
    const hosts = m.devices.filter((d) => d.tier === "host" && d.rack === r.id);
    const tor = m.devices.find((d) => d.tier === "tor" && d.rack === r.id);
    const w = placeHostsLR(hosts, cursor, Y.host0);
    if (tor) {
      tor.x = cursor + w / 2;
      tor.y = Y.tor;
    }
    cursor += w + GAP;
  }

  if (rackless.length) {
    const hosts = rackless.filter((d) => d.tier === "host");
    const tors = rackless.filter((d) => d.tier === "tor");
    const left = n ? cursor : LEFT;
    const looseW = placeHostsLR(hosts, left, Y.host0);
    tors.forEach((d, i) => {
      d.x = left + looseW / 2 + (i - (tors.length - 1) / 2) * 160;
      d.y = Y.tor;
    });
  }

  const W = contentWidth(m);
  const cx0 = W / 2;
  wans.forEach((d) => { d.x = cx0; d.y = Y.wan; });
  edges.forEach((d) => { d.x = cx0; d.y = Y.edge; });
  const cgap = 240;
  cores.forEach((d, i) => {
    d.x = cx0 - ((cores.length - 1) * cgap) / 2 + i * cgap;
    d.y = Y.core;
  });

  const maxY = Math.max(
    Y.host0 + HOST_STAGGER + 48,
    ...m.devices.map((d) => (d.y ?? 0) + (d.h ?? 0) / 2),
  );
  return { W, H: maxY + 110, zones: makeZones(m) };
}
