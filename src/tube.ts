/**
 * NetScript Ethernet tubes — Visio-style L2 buses.
 *
 * Critical design rule (from operator Visio samples):
 *
 *   The callout documents an INTERFACE on a device. The spur root is the
 *   exact attachment point where the object↔ethernet drop meets the device
 *   (the interface itself) — not offset below the box, not mid-span, not at
 *   the tube. A short arm from that point carries port + address.
 *
 *        [ DR7 ]
 *            *\______ eth3     ← spur root = interface point on DR7
 *            |        .1         (where the drop touches the object)
 *            |
 *       ═════●════════  192.168.86.0/24
 *
 * Drops are pure verticals from that interface point to the bus. Paper grows
 * under topology so the bus never competes for space.
 */
import type { NetModel, Pt } from "./model.ts";
import { escapeXml as esc } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveSegments, portOf } from "./logical.ts";

const TUBE_H = 20;
const BAND_GAP = 80;
const TUBE_PITCH = 96;
const SIDE_PAD = 52;
const COL_GAP = 100;
/** Leader reaches this far sideways from the interface to the flag bar. */
const ARM_DX = 40;
/** Flag bar half-height (text sits beside this vertical tick — not a "[" ). */
const FLAG_HALF = 11;

export interface TubeDrop {
  device: string;
  port?: string;
  portLabel?: string;
  addr?: string;
  /** Pure vertical (or tiny fan) from object to tube. */
  path: Pt[];
  /**
   * Interface attachment point: where the drop meets the device.
   * The callout spur roots here — that point *is* the interface.
   */
  spurRoot: Pt;
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

/**
 * Which members get a visible drop?
 * Hosts always. Edge/firewall gateways always. Core/ToR fabric only when the
 * segment has no hosts — otherwise long drops spear the rack (anti-Visio).
 */
function shouldDrop(m: NetModel, deviceId: string, segmentHasHost: boolean): boolean {
  const d = m.devices.find((x) => x.id === deviceId);
  if (!d) return false;
  if (d.tier === "host") return true;
  if (d.tier === "edge" || d.kind === "firewall" || d.kind === "router") return true;
  if (!segmentHasHost) return true; // isolated segment of switches only
  return false;
}

export function layoutTubes(m: NetModel, colorAt: (i: number) => string): TubesResult {
  const segs = resolveSegments(m);
  const byId = new Map(m.devices.map((d) => [d.id, d]));
  const bounds = topologyBounds(m);
  const tubes: TubeLayout[] = [];
  let padL = 48, padR = 100;
  let bandY = bounds.maxY + BAND_GAP;

  segs.forEach((seg, si) => {
    type PM = {
      device: string; port?: string; portLabel?: string; addr?: string;
      dx: number; yBottom: number;
    };
    const raw: PM[] = [];
    for (const mem of seg.members) {
      const d = byId.get(mem.device);
      if (d?.x == null || d.y == null || d.w == null || d.h == null) continue;
      const portObj = portOf(m, mem.device, mem.port);
      raw.push({
        device: mem.device,
        port: mem.port,
        portLabel: portObj?.name ?? mem.port,
        addr: mem.addr,
        dx: d.x,
        yBottom: d.y + d.h / 2,
      });
    }
    const hasHost = raw.some((p) => byId.get(p.device)?.tier === "host");
    const placed = raw.filter((p) => shouldDrop(m, p.device, hasHost));
    if (!placed.length) return;

    placed.sort((a, b) => a.dx - b.dx || a.yBottom - b.yBottom || (a.port ?? "").localeCompare(b.port ?? ""));

    // One column per drop; prefer the device's own x so the drop is a pure vertical.
    // When two devices share an x (stacked tiers we still drop), fan slightly.
    const colX: number[] = [];
    const xUsed: { x: number; n: number }[] = [];
    for (const p of placed) {
      let x = p.dx;
      const hit = xUsed.find((u) => Math.abs(u.x - p.dx) < 8);
      if (hit) {
        hit.n++;
        x = p.dx + (hit.n % 2 === 0 ? -1 : 1) * Math.ceil(hit.n / 2) * 16;
      } else {
        xUsed.push({ x: p.dx, n: 0 });
      }
      // Enforce min gap from previous column
      if (colX.length) {
        const prev = colX[colX.length - 1]!;
        if (x - prev < COL_GAP * 0.55) x = prev + COL_GAP * 0.55;
      }
      colX.push(x);
    }

    const n = placed.length;
    const tubeTop = bandY + 8;
    const y = tubeTop + TUBE_H / 2;
    const x1 = Math.min(...colX) - SIDE_PAD;
    const x2 = Math.max(...colX) + SIDE_PAD;

    // Multi-port fan under the same device
    const totals = new Map<string, number>();
    for (const p of placed) totals.set(p.device, (totals.get(p.device) ?? 0) + 1);
    const seen = new Map<string, number>();

    const drops: TubeDrop[] = [];
    placed.forEach((p, i) => {
      const nth = seen.get(p.device) ?? 0;
      seen.set(p.device, nth + 1);
      const total = totals.get(p.device) ?? 1;
      const fan = total > 1 ? (nth - (total - 1) / 2) * 14 : 0;
      // Pure vertical at column x (column already near device.x).
      // Path start = interface point on the device (where drop meets object).
      const x = colX[i]! + fan;
      const iface: Pt = { x, y: p.yBottom };
      const path: Pt[] = [iface, { x, y: tubeTop }];
      // Spur roots at the interface itself — that is what we're documenting.
      const spurRight = x <= (bounds.minX + bounds.maxX) / 2;

      drops.push({
        device: p.device,
        port: p.port,
        portLabel: p.portLabel,
        addr: p.addr,
        path,
        spurRoot: iface,
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
    bandY = y + TUBE_H / 2 + TUBE_PITCH * 0.5;
    void n; void si;
  });

  if (tubes.length) {
    for (const t of tubes) {
      for (const d of t.drops) {
        const armEnd = d.spurRoot.x + (d.spurRight ? ARM_DX : -ARM_DX);
        padL = Math.max(padL, bounds.minX - Math.min(d.spurRoot.x, armEnd) + 70);
        padR = Math.max(padR, Math.max(d.spurRoot.x, armEnd) - bounds.maxX + 70);
      }
    }
  }

  const bottom = tubes.length
    ? Math.max(...tubes.map((t) => t.y + TUBE_H / 2 + 40))
    : 0;
  return { tubes, bottom, padL, padR };
}

export const hasTubes = (m: NetModel): boolean => resolveSegments(m).length > 0;

/**
 * Ports that already have a segment callout — L1 chips for these should be
 * suppressed so we don't double-label (Visio shows eth3/.1 once, on the drop).
 */
export function segmentAnnotatedPorts(m: NetModel): Set<string> {
  const out = new Set<string>();
  for (const s of resolveSegments(m)) {
    for (const mem of s.members) {
      if (mem.port) out.add(`${mem.device}.${mem.port}`);
    }
  }
  return out;
}

function drawTubeBody(t: TubeLayout, col: string, S: Theme): string[] {
  const out: string[] = [];
  const half = TUBE_H / 2;
  const y = t.y;
  out.push(
    `<rect x="${t.x1.toFixed(1)}" y="${(y - half).toFixed(1)}" width="${(t.x2 - t.x1).toFixed(1)}" ` +
    `height="${TUBE_H}" rx="${half}" fill="${S.bg}" stroke="${col}" stroke-width="1.9"/>`,
  );
  out.push(
    `<ellipse cx="${t.x1.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(half * 0.5).toFixed(1)}" ry="${half.toFixed(1)}" ` +
    `fill="${S.bg}" stroke="${col}" stroke-width="1.6"/>`,
  );
  out.push(
    `<ellipse cx="${t.x2.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(half * 0.5).toFixed(1)}" ry="${half.toFixed(1)}" ` +
    `fill="none" stroke="${col}" stroke-width="1.6"/>`,
  );
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
      const a = d.path[0]!, b = d.path[d.path.length - 1]!;
      // Pure vertical drop: interface point on device → tube
      out.push(
        `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ` +
        `stroke="${col}" stroke-width="1.7" stroke-linecap="round"/>`,
      );
      // Tube end
      out.push(`<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="2.5" fill="${col}"/>`);
      // Interface point on the device (drop + spur share this exact point)
      out.push(
        `<circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="2.8" fill="${S.bg}" stroke="${col}" stroke-width="1.6"/>`,
      );

      if (!d.portLabel && !d.addr) continue;

      // Visio callout (samples 1 & 2):
      //   leader from INTERFACE POINT → vertical FLAG BAR
      //   text stacked beside the bar (port, then addr)
      // The terminator is a short vertical tick "|", not a square bracket "[".
      const root = d.spurRoot; // interface point on the device
      const dir = d.spurRight ? 1 : -1;
      const lines = [d.portLabel, d.addr].filter(Boolean) as string[];
      const barX = root.x + dir * ARM_DX;
      // Leader meets the flag bar at its vertical centre (sample2 diagonal).
      const barMidY = root.y + 10;
      out.push(
        `<line x1="${root.x.toFixed(1)}" y1="${root.y.toFixed(1)}" ` +
        `x2="${barX.toFixed(1)}" y2="${barMidY.toFixed(1)}" ` +
        `stroke="${col}" stroke-width="1.35" stroke-linecap="round"/>`,
      );
      out.push(
        `<line x1="${barX.toFixed(1)}" y1="${(barMidY - FLAG_HALF).toFixed(1)}" ` +
        `x2="${barX.toFixed(1)}" y2="${(barMidY + FLAG_HALF).toFixed(1)}" ` +
        `stroke="${col}" stroke-width="1.5" stroke-linecap="square"/>`,
      );
      const tx = barX + dir * 7;
      const anchor = d.spurRight ? "start" : "end";
      const halo = `paint-order="stroke" stroke="${S.bg}" stroke-width="3.2" stroke-linejoin="round"`;
      // Two lines → centre on bar; one line → mid bar.
      const lineH = 12;
      const textTop = barMidY - ((lines.length - 1) * lineH) / 2;
      lines.forEach((line, li) => {
        const ty = textTop + li * lineH + 3.5;
        out.push(
          `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="10.5" text-anchor="${anchor}" ` +
          `fill="${col}" font-weight="${li === 0 ? 700 : 600}" font-family="${S.mono}" ${halo}>${esc(line)}</text>`,
        );
      });
    }
  }
  return out;
}

export function expandHeightForTubes(baseH: number, tubes: TubesResult): number {
  if (!tubes.tubes.length) return baseH;
  return Math.max(baseH, tubes.bottom + 56);
}
