/**
 * NetScript layout — assigns x/y/w/h to a declarative model and derives zone
 * boxes. v0.1 is a deterministic tiered/rack layout (edge → core pair → rack
 * columns with a ToR over staggered hosts). A real crossing-minimising layered
 * placer is roadmap.
 */
import type { NetModel, Device } from "./model.ts";

const SIZE: Record<string, [number, number]> = {
  wan: [120, 46], edge: [150, 54], core: [150, 52], tor: [150, 50], host: [104, 48],
};
const LEFT = 92, RIGHT = 92, ZW = 356, GAP = 116;
const Y = { wan: 44, edge: 150, core: 278, tor: 430, host0: 560, hostStep: 118 };
const ROW_EVEN = [-114, 38], ROW_ODD = [-38, 114];   // staggered host x-offsets

export interface Zone { x: number; y: number; w: number; h: number; label: string; }
export interface Layout { W: number; H: number; zones: Zone[]; }

export function layoutModel(m: NetModel): Layout {
  const n = m.racks.length;
  const W = LEFT + n * ZW + (n - 1) * GAP + RIGHT;
  const cx0 = W / 2;
  const rackCenter: Record<string, number> = {};
  m.racks.forEach((r, i) => { rackCenter[r.id] = LEFT + ZW / 2 + i * (ZW + GAP); });

  for (const d of m.devices) [d.w, d.h] = SIZE[d.tier];

  for (const d of m.devices) {
    if (d.tier === "wan") { d.x = cx0; d.y = Y.wan; }
    else if (d.tier === "edge") { d.x = cx0; d.y = Y.edge; }
  }
  const cores = m.devices.filter((d) => d.tier === "core");
  const cgap = 240;
  cores.forEach((d, i) => { d.x = cx0 - (cores.length - 1) * cgap / 2 + i * cgap; d.y = Y.core; });

  for (const r of m.racks) {
    const cx = rackCenter[r.id];
    const tor = m.devices.find((d) => d.tier === "tor" && d.rack === r.id);
    if (tor) { tor.x = cx; tor.y = Y.tor; }
    const hosts = m.devices.filter((d) => d.tier === "host" && d.rack === r.id);
    hosts.forEach((d, i) => {
      const row = Math.floor(i / 2), col = i % 2;
      d.x = cx + (row % 2 === 0 ? ROW_EVEN : ROW_ODD)[col];
      d.y = Y.host0 + row * Y.hostStep;
    });
  }

  const pad = { l: 38, r: 38, t: 20, b: 24 };
  const bbox = (ds: Device[]) => {
    const x1 = Math.min(...ds.map((d) => d.x! - d.w! / 2)), x2 = Math.max(...ds.map((d) => d.x! + d.w! / 2));
    const y1 = Math.min(...ds.map((d) => d.y! - d.h! / 2)), y2 = Math.max(...ds.map((d) => d.y! + d.h! / 2));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  const zones: Zone[] = [];
  if (cores.length) { const b = bbox(cores); zones.push({ x: b.x - pad.l, y: b.y - pad.t, w: b.w + pad.l + pad.r, h: b.h + pad.t + pad.b, label: "CORE" }); }
  for (const r of m.racks) {
    const ds = m.devices.filter((d) => d.rack === r.id);
    if (!ds.length) continue;
    const b = bbox(ds);
    zones.push({ x: b.x - pad.l, y: b.y - pad.t, w: b.w + pad.l + pad.r, h: b.h + pad.t + pad.b, label: `${r.label} · ${r.role}`.toUpperCase() });
  }

  const maxY = Math.max(...m.devices.map((d) => d.y! + d.h! / 2));
  return { W, H: maxY + 110, zones };
}
