/**
 * NetScript layout — assigns x/y/w/h to a declarative model and derives zone
 * boxes.
 *
 * Hosts use infinite paper: laid **left → right** with a slight vertical
 * stagger so callout labels have air. No more 2-column vertical stacks that
 * force mile-long drops and orphaned spur roots.
 */
import type { NetModel, Device } from "./model.ts";

const SIZE: Record<string, [number, number]> = {
  wan: [120, 46], edge: [150, 54], core: [150, 52], tor: [150, 50], host: [104, 48],
};
const LEFT = 92, RIGHT = 92, GAP = 80;
const Y = { wan: 44, edge: 150, core: 278, tor: 400, host0: 520 };
/** Horizontal pitch between hosts — room for card + callout flag. */
const HOST_SLOT = 148;
/** Alternate hosts up/down so flags don't collide. */
const HOST_STAGGER = 40;
/** Minimum rack width when few hosts. */
const RACK_MIN_W = 280;
const SLOT = 148; // rackless host pitch

export interface Zone { x: number; y: number; w: number; h: number; label: string; }
export interface Layout { W: number; H: number; zones: Zone[]; }

/** Place hosts L→R with a mild vertical stagger. Returns rack content width. */
function placeHostsLR(hosts: Device[], left: number, y0: number): number {
  if (!hosts.length) return RACK_MIN_W;
  hosts.forEach((d, i) => {
    d.x = left + HOST_SLOT / 2 + i * HOST_SLOT;
    d.y = y0 + (i % 2 === 0 ? 0 : HOST_STAGGER);
  });
  return Math.max(RACK_MIN_W, hosts.length * HOST_SLOT);
}

export function layoutModel(m: NetModel): Layout {
  const n = m.racks.length;
  const rackless = m.devices.filter((d) => !d.rack && (d.tier === "tor" || d.tier === "host"));

  for (const d of m.devices) [d.w, d.h] = SIZE[d.tier] ?? SIZE.host;

  // ---- fabric (wan / edge / core) — centred later once W is known ----
  const cores = m.devices.filter((d) => d.tier === "core");
  const edges = m.devices.filter((d) => d.tier === "edge");
  const wans = m.devices.filter((d) => d.tier === "wan");

  // ---- racks: host count drives width (infinite paper L→R) ----
  const rackGeom: { id: string; left: number; w: number; hosts: Device[]; tor?: Device }[] = [];
  let cursor = LEFT;
  for (const r of m.racks) {
    const hosts = m.devices.filter((d) => d.tier === "host" && d.rack === r.id);
    const tor = m.devices.find((d) => d.tier === "tor" && d.rack === r.id);
    const w = placeHostsLR(hosts, cursor, Y.host0);
    if (tor) {
      tor.x = cursor + w / 2;
      tor.y = Y.tor;
    }
    rackGeom.push({ id: r.id, left: cursor, w, hosts, tor });
    cursor += w + GAP;
  }

  // ---- rackless hosts: one L→R row ----
  let looseW = 0;
  if (rackless.length) {
    const hosts = rackless.filter((d) => d.tier === "host");
    const tors = rackless.filter((d) => d.tier === "tor");
    const left = n ? cursor : LEFT;
    looseW = placeHostsLR(hosts, left, Y.host0);
    tors.forEach((d, i) => {
      d.x = left + looseW / 2 + (i - (tors.length - 1) / 2) * 160;
      d.y = Y.tor;
    });
    cursor = left + looseW + GAP;
  }

  // ---- total width from content ----
  let maxRight = LEFT;
  for (const d of m.devices) {
    if (d.x != null && d.w != null) maxRight = Math.max(maxRight, d.x + d.w / 2);
  }
  const W = Math.max(maxRight + RIGHT, 560);
  const cx0 = W / 2;

  // centre fabric over full page
  wans.forEach((d) => { d.x = cx0; d.y = Y.wan; });
  edges.forEach((d) => { d.x = cx0; d.y = Y.edge; });
  const cgap = 240;
  cores.forEach((d, i) => {
    d.x = cx0 - ((cores.length - 1) * cgap) / 2 + i * cgap;
    d.y = Y.core;
  });

  // ---- zones ----
  const pad = { l: 38, r: 38, t: 20, b: 28 };
  const bbox = (ds: Device[]) => {
    const x1 = Math.min(...ds.map((d) => d.x! - d.w! / 2));
    const x2 = Math.max(...ds.map((d) => d.x! + d.w! / 2));
    const y1 = Math.min(...ds.map((d) => d.y! - d.h! / 2));
    const y2 = Math.max(...ds.map((d) => d.y! + d.h! / 2));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  const zones: Zone[] = [];
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

  const maxY = Math.max(
    Y.host0 + HOST_STAGGER + 48,
    ...m.devices.map((d) => (d.y ?? 0) + (d.h ?? 0) / 2),
  );
  return { W, H: maxY + 110, zones };
}
