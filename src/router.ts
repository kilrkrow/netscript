/**
 * NetScript router — orthogonal cabling with:
 *   - per-tier horizontal LANE allocation (greedy interval colouring),
 *   - vertical uplink RISERS with core-side port fan-out,
 *   - per-rack local lanes for intra-rack links,
 *   - line-jumps only on genuinely unavoidable crossings.
 *
 * This is the workable skeleton of NetScript's eventual layered, port-aware
 * router. It is NOT yet crossing-minimising (no node/lane reordering) — see
 * README roadmap.
 */
import type { NetModel, Device, Link, Pt } from "./model.ts";
import { top, bottom, leftP, rightP } from "./model.ts";

export type Seg = { x1: number; y1: number; x2: number; y2: number; o: "h" | "v" };

export function allocLanes(
  runs: { key: string; x1: number; x2: number }[], y0: number, gap: number, margin = 12,
): Record<string, number> {
  const slots: [number, number][][] = [];
  const ys: Record<string, number> = {};
  for (const r of [...runs].sort((a, b) => Math.abs(b.x2 - b.x1) - Math.abs(a.x2 - a.x1))) {
    const xlo = Math.min(r.x1, r.x2), xhi = Math.max(r.x1, r.x2);
    let placed = false;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].every(([a, b]) => xhi + margin < a || xlo - margin > b)) {
        slots[i].push([xlo, xhi]); ys[r.key] = y0 + i * gap; placed = true; break;
      }
    }
    if (!placed) { ys[r.key] = y0 + slots.length * gap; slots.push([[xlo, xhi]]); }
  }
  return ys;
}

export function classify(m: NetModel): void {
  const id = new Map(m.devices.map((d) => [d.id, d]));
  for (const l of m.links) {
    const ta = id.get(l.a)!.tier, tb = id.get(l.b)!.tier;
    const s = new Set([ta, tb]);
    if (s.has("wan")) l.klass = "wan";
    else if (s.has("edge") && s.has("core")) l.klass = "e2c";
    else if (ta === "core" && tb === "core") l.klass = "peer";
    else if (s.has("tor") && s.has("core")) l.klass = "uplink";
    else l.klass = "intra";
  }
}

export function buildRoutes(m: NetModel): Pt[][] {
  classify(m);
  const id = new Map(m.devices.map((d) => [d.id, d]));
  const D = (x: string) => id.get(x)!;
  const cores = m.devices.filter((d) => d.tier === "core").sort((p, q) => p.x! - q.x!);
  const core = cores[0], tor = m.devices.find((d) => d.tier === "tor")!, edge = m.devices.find((d) => d.tier === "edge")!;
  const coreBottom = core.y! + core.h! / 2, torBottom = tor.y! + tor.h! / 2, edgeBottom = edge.y! + edge.h! / 2;
  const rackOrder = m.racks.map((r) => r.id);

  const e2c = m.links.filter((l) => l.klass === "e2c");
  const e2cLanes = allocLanes(e2c.map((l, i) => ({ key: String(i), x1: D(l.a).x!, x2: D(l.b).x! })), edgeBottom + 23, 13);

  const ups = m.links.filter((l) => l.klass === "uplink");
  const torOf = (l: Link) => (D(l.a).tier === "tor" ? D(l.a) : D(l.b));
  const coreOf = (l: Link) => (D(l.a).tier === "core" ? D(l.a) : D(l.b));
  const upLanes = allocLanes(
    ups.map((l, i) => ({ key: String(i), x1: torOf(l).x!, x2: coreOf(l).x! + (rackOrder.indexOf(torOf(l).rack!) - 1) * 42 })),
    coreBottom + 18, 12,
  );

  const routes: Pt[][] = [];
  m.links.forEach((l, idx) => {
    const a = D(l.a), b = D(l.b);
    if (l.klass === "wan") {
      const lo = a.tier === "wan" ? b : a, hi = a.tier === "wan" ? a : b;
      routes[idx] = [top(lo), bottom(hi)];
    } else if (l.klass === "peer") {
      const lft = a.x! < b.x! ? a : b, rgt = a.x! < b.x! ? b : a;
      routes[idx] = [rightP(lft), leftP(rgt)];
    } else if (l.klass === "e2c") {
      const lo = a.tier === "edge" ? a : b, hi = a.tier === "edge" ? b : a;
      const A = bottom(lo), B = top(hi), ly = e2cLanes[String(e2c.indexOf(l))];
      routes[idx] = [A, { x: A.x, y: ly }, { x: B.x, y: ly }, B];
    } else if (l.klass === "uplink") {
      const t = torOf(l), c = coreOf(l), ci = cores.indexOf(c);
      const A = top(t), ax = A.x + (ci === 0 ? -7 : 7);
      const bx = c.x! + (rackOrder.indexOf(t.rack!) - 1) * 42, by = bottom(c).y;
      const ly = upLanes[String(ups.indexOf(l))];
      routes[idx] = [{ x: ax, y: A.y }, { x: ax, y: ly }, { x: bx, y: ly }, { x: bx, y: by }];
    } else { // intra
      const t = a.tier === "tor" ? a : b, h = a.tier === "tor" ? b : a;
      const A = bottom(t), B = top(h);
      const hosts = m.devices.filter((d) => d.rack === t.rack && d.tier === "host");
      const lanes = allocLanes(hosts.map((hh) => ({ key: hh.id, x1: t.x!, x2: hh.x! })), torBottom + 23, 11);
      const ly = lanes[h.id];
      const ax = A.x + Math.max(-55, Math.min(55, (B.x - A.x) * 0.5));
      routes[idx] = [{ x: ax, y: A.y }, { x: ax, y: ly }, { x: B.x, y: ly }, B];
    }
  });
  return routes;
}

export const segments = (pts: Pt[]): Seg[] => {
  const out: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    out.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, o: Math.abs(p.y - q.y) < 0.5 ? "h" : "v" });
  }
  return out;
};

export function offsetPts(pts: Pt[], d: number): Pt[] {
  const segs = segments(pts).map((s) => s.o === "v"
    ? { ...s, x1: s.x1 + d, x2: s.x2 + d }
    : { ...s, y1: s.y1 + d, y2: s.y2 + d });
  const out: Pt[] = [{ x: segs[0].x1, y: segs[0].y1 }];
  for (const s of segs) out.push({ x: s.x2, y: s.y2 });
  return out;
}

function jumpsOnH(h: Seg, foreignV: Seg[], r: number): number[] {
  const y = h.y1, lo = Math.min(h.x1, h.x2), hi = Math.max(h.x1, h.x2), xs: number[] = [];
  for (const v of foreignV) {
    const vx = v.x1, vlo = Math.min(v.y1, v.y2), vhi = Math.max(v.y1, v.y2);
    if (lo + 4 < vx && vx < hi - 4 && vlo + 1 < y && y < vhi - 1) xs.push(vx);
  }
  return [...new Set(xs)].sort((a, b) => a - b);
}

export function pathD(pts: Pt[], myIdx: number, allSegs: Seg[][], jumps = true, r = 5): string {
  const segs = segments(pts);
  let foreignV: Seg[] = [];
  if (jumps) allSegs.forEach((ss, j) => { if (j !== myIdx) foreignV = foreignV.concat(ss.filter((s) => s.o === "v")); });
  let d = `M ${segs[0].x1.toFixed(1)},${segs[0].y1.toFixed(1)} `;
  for (const s of segs) {
    if (s.o === "v" || !jumps) { d += `L ${s.x2.toFixed(1)},${s.y2.toFixed(1)} `; continue; }
    const y = s.y1, l2r = s.x2 >= s.x1;
    let jx = jumpsOnH(s, foreignV, r); if (!l2r) jx = jx.reverse();
    for (const x of jx) {
      const sweep = l2r ? 1 : 0;
      d += `L ${(x - r).toFixed(1)},${y.toFixed(1)} A ${r},${r} 0 0 ${sweep} ${(x + r).toFixed(1)},${y.toFixed(1)} `;
    }
    d += `L ${s.x2.toFixed(1)},${s.y2.toFixed(1)} `;
  }
  return d.trim();
}
