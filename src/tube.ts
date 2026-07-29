/**
 * NetScript Ethernet tubes — Visio-style L2 buses (see operator sample).
 *
 * Geometry matches classic Visio as-builts:
 *
 *        [ object ]
 *             |
 *             +----[  eth3     ← callout spur INTERSECTS the drop
 *                    .1           (not at the tube, not a free-floating label)
 *             |
 *        ════●════════════════  192.168.86.0/24
 *
 * Rules:
 *  1. Tube sits in a clear band under topology (infinite paper — grow canvas).
 *  2. Drop is a simple ortho path object → tube (no side-riser detours).
 *  3. Callout is a short spur off the drop near the object, with a bracket
 *     holding port + address — the spur's root is ON the drop line.
 *  4. Unique attachment columns so multi-host buses don't stack.
 */
import type { NetModel, Pt } from "./model.ts";
import { escapeXml as esc } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveSegments, portOf } from "./logical.ts";

const TUBE_H = 18;
const BAND_GAP = 72;          // air under lowest card before tube band
const TUBE_PITCH = 100;       // vertical budget per additional tube
const SIDE_PAD = 48;
const COL_GAP = 96;           // min centre-to-centre on the bus
const CALLOUT_ALONG = 0.28;   // fraction down the first vertical where spur roots
const CALLOUT_MIN = 16;       // never closer than this to the object
const CALLOUT_ARM = 28;       // horizontal length of the spur
const BRACKET = 10;           // half-height of “[”

export interface TubeDrop {
  device: string;
  port?: string;
  portLabel?: string;
  addr?: string;
  /** Ortho path from object to tube. */
  path: Pt[];
  /** Where the callout spur roots — ON the drop (Visio intersection). */
  spurRoot: Pt;
  /** Spur opens left or right into free air. */
  spurRight: boolean;
}

export interface TubeLayout {
  id: string;
  name: string;
  subnet?: string;
  color: string;
  y: number;
  x1: number;
  x2: number;
  drops: TubeDrop[];
}

export interface TubesResult {
  tubes: TubeLayout[];
  bottom: number;
  padL: number;
  padR: number;
}

function topologyBounds(m: NetModel): { minX: number; maxX: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of m.devices) {
    if (d.x == null || d.y == null || d.w == null || d.h == null) continue;
    minX = Math.min(minX, d.x - d.w / 2);
    maxX = Math.max(maxX, d.x + d.w / 2);
    maxY = Math.max(maxY, d.y + d.h / 2);
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 400, maxY: 400 };
  return { minX, maxX, maxY };
}

function simplifyOrtho(pts: Pt[]): Pt[] {
  if (pts.length < 2) return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!, L = out[out.length - 1]!;
    if (Math.hypot(p.x - L.x, p.y - L.y) < 1) continue;
    if (out.length >= 2) {
      const A = out[out.length - 2]!;
      const abH = Math.abs(A.y - L.y) < 0.5, abV = Math.abs(A.x - L.x) < 0.5;
      const bcH = Math.abs(L.y - p.y) < 0.5, bcV = Math.abs(L.x - p.x) < 0.5;
      if ((abH && bcH) || (abV && bcV)) { out[out.length - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

/** Point a fraction of the way along the first vertical run of a path. */
function spurOnDrop(path: Pt[], along = CALLOUT_ALONG): Pt {
  // Prefer the first vertical segment (object leaving downward).
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!;
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.y - a.y) > 4) {
      const len = b.y - a.y;
      const t = Math.max(CALLOUT_MIN / Math.abs(len), Math.min(0.45, along));
      return { x: a.x, y: a.y + len * t };
    }
  }
  // Fallback: midpoint of whole path.
  const a = path[0]!, b = path[path.length - 1]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function layoutTubes(m: NetModel, colorAt: (i: number) => string): TubesResult {
  const segs = resolveSegments(m);
  const byId = new Map(m.devices.map((d) => [d.id, d]));
  const bounds = topologyBounds(m);
  const tubes: TubeLayout[] = [];
  let padL = 40, padR = 80; // room for callout text on either side
  let bandY = bounds.maxY + BAND_GAP;

  segs.forEach((seg, si) => {
    type PM = {
      device: string; port?: string; portLabel?: string; addr?: string;
      dx: number; yBottom: number; left: number; right: number;
    };
    const placed: PM[] = [];
    for (const mem of seg.members) {
      const d = byId.get(mem.device);
      if (d?.x == null || d.y == null || d.w == null || d.h == null) continue;
      const portObj = portOf(m, mem.device, mem.port);
      placed.push({
        device: mem.device,
        port: mem.port,
        portLabel: portObj?.name ?? mem.port,
        addr: mem.addr,
        dx: d.x,
        yBottom: d.y + d.h / 2,
        left: d.x - d.w / 2,
        right: d.x + d.w / 2,
      });
    }
    if (!placed.length) return;

    // Left-to-right on the bus; keep multi-port hosts ordered.
    placed.sort((a, b) => a.dx - b.dx || a.yBottom - b.yBottom || (a.port ?? "").localeCompare(b.port ?? ""));

    const n = placed.length;
    // Unique columns — never stack, even when devices share an x.
    const colSpan = Math.max(
      Math.max(...placed.map((p) => p.right)) - Math.min(...placed.map((p) => p.left)),
      (n - 1) * COL_GAP,
      COL_GAP,
    );
    const mid = (Math.min(...placed.map((p) => p.left)) + Math.max(...placed.map((p) => p.right))) / 2;
    const col0 = mid - colSpan / 2;
    const attachX = (i: number) =>
      n === 1 ? placed[0]!.dx : col0 + (i * colSpan) / Math.max(1, n - 1);

    // Class label above the tube; drops land on the top of the bus.
    const labelH = 22;
    const tubeTop = bandY + labelH;
    const y = tubeTop + TUBE_H / 2;
    const xs = placed.map((_, i) => attachX(i));
    const x1 = Math.min(...xs) - SIDE_PAD;
    const x2 = Math.max(...xs) + SIDE_PAD;

    // Fan multi-port exits on the same device so first verticals don't coincide.
    const exitCount = new Map<string, number>();
    const drops: TubeDrop[] = [];

    placed.forEach((p, i) => {
      const ax = attachX(i);
      const k = p.device;
      const nth = exitCount.get(k) ?? 0;
      exitCount.set(k, nth + 1);
      // Slight fan under multi-port devices (Visio still reads as one host).
      const exitX = p.dx + (nth - 0.5 * ((exitCount.get(k) ?? 1) - 1)) * 12;
      // Use running count after increment for fan — recompute below.
      void exitX;
    });

    // Second pass with final multi-port counts for symmetric fan.
    const totals = new Map<string, number>();
    for (const p of placed) totals.set(p.device, (totals.get(p.device) ?? 0) + 1);
    const seen = new Map<string, number>();

    placed.forEach((p, i) => {
      const ax = attachX(i);
      const nth = seen.get(p.device) ?? 0;
      seen.set(p.device, nth + 1);
      const total = totals.get(p.device) ?? 1;
      const fan = (nth - (total - 1) / 2) * 14;
      const leaveX = p.dx + fan;

      // Sample-faithful path: leave object, optional dogleg to column, down to tube.
      // Prefer pure vertical when leaveX ≈ ax (single host above its column).
      const path = simplifyOrtho(
        Math.abs(leaveX - ax) < 2
          ? [{ x: leaveX, y: p.yBottom }, { x: leaveX, y: tubeTop }]
          : [
              { x: leaveX, y: p.yBottom },
              { x: leaveX, y: p.yBottom + 20 },
              { x: ax, y: p.yBottom + 20 },
              { x: ax, y: tubeTop },
            ],
      );

      // Spur opens away from the rack centre so text sits in open air.
      const spurRight = leaveX <= mid;

      drops.push({
        device: p.device,
        port: p.port,
        portLabel: p.portLabel,
        addr: p.addr,
        path,
        spurRoot: spurOnDrop(path),
        spurRight,
      });
    });

    tubes.push({
      id: seg.id,
      name: seg.name,
      subnet: seg.subnet,
      color: colorAt(si),
      y,
      x1,
      x2,
      drops,
    });
    bandY = y + TUBE_H / 2 + TUBE_PITCH * 0.55;
  });

  // Callout arms need margin past the outermost drop.
  if (tubes.length) {
    const minX = Math.min(...tubes.flatMap((t) => t.drops.map((d) => d.spurRoot.x - (d.spurRight ? 0 : CALLOUT_ARM + 60))));
    const maxX = Math.max(...tubes.flatMap((t) => t.drops.map((d) => d.spurRoot.x + (d.spurRight ? CALLOUT_ARM + 60 : 0))));
    padL = Math.max(padL, bounds.minX - minX + 16);
    padR = Math.max(padR, maxX - bounds.maxX + 16);
  }

  const bottom = tubes.length
    ? Math.max(...tubes.map((t) => t.y + TUBE_H / 2 + 36))
    : 0;
  return { tubes, bottom, padL, padR };
}

export const hasTubes = (m: NetModel): boolean => resolveSegments(m).length > 0;

function pathD(pts: Pt[], r = 5): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!, prev = pts[i - 1]!, next = pts[i + 1]!;
    const inD = { x: Math.sign(p.x - prev.x), y: Math.sign(p.y - prev.y) };
    const outD = { x: Math.sign(next.x - p.x), y: Math.sign(next.y - p.y) };
    const rr = Math.min(r, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    d += ` L ${(p.x - inD.x * rr).toFixed(1)},${(p.y - inD.y * rr).toFixed(1)}`;
    d += ` Q ${p.x.toFixed(1)},${p.y.toFixed(1)} ${(p.x + outD.x * rr).toFixed(1)},${(p.y + outD.y * rr).toFixed(1)}`;
  }
  const last = pts[pts.length - 1]!;
  return d + ` L ${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

/**
 * Cylinder-ish tube (Visio “ethernet” bus): capsule body + end caps.
 */
function drawTubeBody(t: TubeLayout, col: string, S: Theme): string[] {
  const out: string[] = [];
  const half = TUBE_H / 2;
  const y = t.y;
  // Soft fill + outline
  out.push(
    `<rect x="${t.x1.toFixed(1)}" y="${(y - half).toFixed(1)}" width="${(t.x2 - t.x1).toFixed(1)}" ` +
    `height="${TUBE_H}" rx="${half}" fill="${col}" fill-opacity="0.10" stroke="${col}" stroke-width="1.8"/>`,
  );
  // End “circles” (orthographic cylinder caps)
  out.push(
    `<ellipse cx="${t.x1.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(half * 0.55).toFixed(1)}" ry="${half.toFixed(1)}" ` +
    `fill="${S.bg}" stroke="${col}" stroke-width="1.6"/>`,
  );
  out.push(
    `<ellipse cx="${t.x2.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(half * 0.55).toFixed(1)}" ry="${half.toFixed(1)}" ` +
    `fill="none" stroke="${col}" stroke-width="1.6"/>`,
  );
  // Class label ON the tube (sample puts CIDR in the cylinder)
  const classLbl = t.subnet ?? t.name;
  out.push(
    `<text x="${((t.x1 + t.x2) / 2).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="11.5" text-anchor="middle" ` +
    `fill="${col}" font-weight="700" font-family="${S.mono}" ` +
    `paint-order="stroke" stroke="${S.bg}" stroke-width="3.5" stroke-linejoin="round">${esc(classLbl)}</text>`,
  );
  if (t.subnet && t.name) {
    out.push(
      `<text x="${((t.x1 + t.x2) / 2).toFixed(1)}" y="${(y + half + 14).toFixed(1)}" font-size="9.5" text-anchor="middle" ` +
      `fill="${S.sub}" font-family="${S.mono}">${esc(t.name)}</text>`,
    );
  }
  return out;
}

export function drawTubesSvg(tubes: TubeLayout[], S: Theme): string[] {
  const out: string[] = [];
  for (const t of tubes) {
    const col = t.color;
    out.push(...drawTubeBody(t, col, S));

    for (const d of t.drops) {
      // Drop: object → tube
      out.push(
        `<path d="${pathD(d.path)}" fill="none" stroke="${col}" stroke-width="1.6" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      const start = d.path[0]!, end = d.path[d.path.length - 1]!;
      out.push(`<circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="2.2" fill="${col}"/>`);
      out.push(`<circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="2.4" fill="${col}"/>`);

      if (!d.portLabel && !d.addr) continue;

      // Callout spur: roots ON the drop (the Visio intersection), short arm to a bracket.
      const root = d.spurRoot;
      const dir = d.spurRight ? 1 : -1;
      const tipX = root.x + dir * CALLOUT_ARM;
      out.push(
        `<line x1="${root.x.toFixed(1)}" y1="${root.y.toFixed(1)}" x2="${tipX.toFixed(1)}" y2="${root.y.toFixed(1)}" ` +
        `stroke="${col}" stroke-width="1.25" stroke-linecap="round"/>`,
      );
      // Junction tick on the drop (makes the intersection obvious)
      out.push(
        `<circle cx="${root.x.toFixed(1)}" cy="${root.y.toFixed(1)}" r="2" fill="${S.bg}" stroke="${col}" stroke-width="1.3"/>`,
      );
      // Bracket “[” / “]”
      const bx = tipX;
      const tip = dir * 3.5;
      out.push(
        `<path d="M ${bx.toFixed(1)},${(root.y - BRACKET).toFixed(1)} L ${(bx + tip).toFixed(1)},${(root.y - BRACKET).toFixed(1)} ` +
        `M ${bx.toFixed(1)},${(root.y - BRACKET).toFixed(1)} L ${bx.toFixed(1)},${(root.y + BRACKET).toFixed(1)} ` +
        `M ${bx.toFixed(1)},${(root.y + BRACKET).toFixed(1)} L ${(bx + tip).toFixed(1)},${(root.y + BRACKET).toFixed(1)}" ` +
        `fill="none" stroke="${col}" stroke-width="1.45" stroke-linecap="square"/>`,
      );
      const tx = tipX + dir * 7;
      const anchor = d.spurRight ? "start" : "end";
      const halo = `paint-order="stroke" stroke="${S.bg}" stroke-width="3.2" stroke-linejoin="round"`;
      // Sample stacks port then address inside the flag.
      if (d.portLabel) {
        out.push(
          `<text x="${tx.toFixed(1)}" y="${(root.y - 2).toFixed(1)}" font-size="10" text-anchor="${anchor}" ` +
          `fill="${S.text}" font-weight="700" font-family="${S.mono}" ${halo}>${esc(d.portLabel)}</text>`,
        );
      }
      if (d.addr) {
        out.push(
          `<text x="${tx.toFixed(1)}" y="${(root.y + 11).toFixed(1)}" font-size="10" text-anchor="${anchor}" ` +
          `fill="${col}" font-weight="600" font-family="${S.mono}" ${halo}>${esc(d.addr)}</text>`,
        );
      }
    }
  }
  return out;
}

export function expandHeightForTubes(baseH: number, tubes: TubesResult): number {
  if (!tubes.tubes.length) return baseH;
  return Math.max(baseH, tubes.bottom + 56);
}
