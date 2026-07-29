/**
 * NetScript Ethernet tubes — Visio-style L2 segment buses on infinite paper.
 *
 * Design rules (learned the hard way):
 *  1. Tubes live in a dedicated band *below* all topology — never through cards.
 *  2. Drops leave the device, immediately take a *side riser* outside the rack,
 *     then enter the tube band and land on a unique attachment column.
 *  3. Port/IP callouts live in the tube band at the attachment (clear air), not
 *     under the device where they collide with port chips and each other.
 *  4. Paper grows for risers, columns, and callout text — no squeezing.
 *
 *        device
 *          |
 *          +————→  (side riser, outside topology)
 *                       |
 *                       |   eth0
 *                       +——[ .10
 *          ══════════════●══════════  192.168.86.0/24
 */
import type { NetModel, Pt } from "./model.ts";
import { escapeXml as esc } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveSegments, portOf } from "./logical.ts";

const TUBE_H = 16;
const BAND_GAP = 100;         // air between lowest card and tube band
const TUBE_PITCH = 140;       // vertical budget per tube (callouts + bus + labels)
const SIDE_PAD = 56;
const COL_GAP = 100;          // min centre-to-centre on the bus
const EXIT_STUB = 18;
const CALLOUT_DX = 14;
const CALLOUT_H = 36;         // vertical room reserved above bus per callout
const RISER_GAP = 26;
const CHANNEL_PAD = 64;

export interface TubeDrop {
  device: string;
  hostLabel: string;
  port?: string;
  portLabel?: string;
  addr?: string;
  path: Pt[];
  /** Attachment point on the tube (callout anchors near here). */
  attach: Pt;
  calloutRight: boolean;
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

export function layoutTubes(m: NetModel, colorAt: (i: number) => string): TubesResult {
  const segs = resolveSegments(m);
  const byId = new Map(m.devices.map((d) => [d.id, d]));
  const bounds = topologyBounds(m);
  const tubes: TubeLayout[] = [];

  let padL = 0, padR = 0;
  let leftRiserN = 0, rightRiserN = 0;
  // Collector decks sit fully under topology — a horizontal runway per tube so
  // multiple segments don't braid on one y.
  let bandY = bounds.maxY + BAND_GAP * 0.55;

  segs.forEach((seg, si) => {
    const collectorY = bounds.maxY + BAND_GAP * 0.35 + si * 18;
    type PM = {
      device: string; hostLabel: string; port?: string; portLabel?: string; addr?: string;
      dx: number; yBottom: number;
    };
    const placed: PM[] = [];
    for (const mem of seg.members) {
      const d = byId.get(mem.device);
      if (d?.x == null || d.y == null || d.w == null || d.h == null) continue;
      const portObj = portOf(m, mem.device, mem.port);
      placed.push({
        device: mem.device,
        hostLabel: d.label,
        port: mem.port,
        portLabel: portObj?.name ?? mem.port,
        addr: mem.addr,
        dx: d.x,
        yBottom: d.y + d.h / 2,
      });
    }
    if (!placed.length) return;

    placed.sort((a, b) => a.dx - b.dx || a.yBottom - b.yBottom || (a.port ?? "").localeCompare(b.port ?? ""));

    const n = placed.length;
    // Unique columns — never stack attachments, even when devices share an x.
    const colSpan = Math.max(bounds.maxX - bounds.minX, (n - 1) * COL_GAP, COL_GAP);
    const col0 = (bounds.minX + bounds.maxX) / 2 - colSpan / 2;
    const attachX = (i: number) =>
      n === 1 ? (bounds.minX + bounds.maxX) / 2 : col0 + (i * colSpan) / Math.max(1, n - 1);

    // Callout shelf sits above the bus; class label above that.
    const calloutShelf = bandY + 8;
    const tubeTop = calloutShelf + CALLOUT_H;
    const y = tubeTop + TUBE_H / 2;
    const xs = placed.map((_, i) => attachX(i));
    const x1 = Math.min(...xs, bounds.minX) - SIDE_PAD;
    const x2 = Math.max(...xs, bounds.maxX) + SIDE_PAD;

    const drops: TubeDrop[] = [];
    placed.forEach((p, i) => {
      const ax = attachX(i);
      const toLeft = p.dx - bounds.minX <= bounds.maxX - p.dx;
      const riserIdx = toLeft ? leftRiserN++ : rightRiserN++;
      const riserX = toLeft
        ? bounds.minX - CHANNEL_PAD - riserIdx * RISER_GAP
        : bounds.maxX + CHANNEL_PAD + riserIdx * RISER_GAP;
      if (toLeft) padL = Math.max(padL, bounds.minX - riserX + 48);
      else padR = Math.max(padR, riserX - bounds.maxX + 48);

      const exitY = p.yBottom + EXIT_STUB;
      // Path: device → short exit → side riser → collector deck → column → tube.
      // All long runs stay outside or below the topology bounding box.
      const path = simplifyOrtho([
        { x: p.dx, y: p.yBottom },
        { x: p.dx, y: exitY },
        { x: riserX, y: exitY },
        { x: riserX, y: collectorY },
        { x: ax, y: collectorY },
        { x: ax, y: tubeTop },
      ]);

      drops.push({
        device: p.device,
        hostLabel: p.hostLabel,
        port: p.port,
        portLabel: p.portLabel,
        addr: p.addr,
        path,
        attach: { x: ax, y: tubeTop },
        // Alternate sides so neighbouring callouts don't kiss.
        calloutRight: i % 2 === 0,
      });
    });

    // Expand padR for callout text width (~6.5px per char, up to ~12 chars).
    padR = Math.max(padR, 72);
    padL = Math.max(padL, 24);

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
    bandY = y + TUBE_H / 2 + TUBE_PITCH * 0.4;
  });

  const bottom = tubes.length
    ? Math.max(...tubes.map((t) => t.y + TUBE_H / 2 + 40))
    : 0;
  return { tubes, bottom, padL, padR };
}

export const hasTubes = (m: NetModel): boolean => resolveSegments(m).length > 0;

function pathD(pts: Pt[], r = 7): string {
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

export function drawTubesSvg(tubes: TubeLayout[], S: Theme): string[] {
  const out: string[] = [];
  for (const t of tubes) {
    const col = t.color;
    const half = TUBE_H / 2;
    const midX = (t.x1 + t.x2) / 2;

    // Class label above the callout shelf.
    const classLbl = t.subnet ?? t.name;
    out.push(
      `<text x="${midX.toFixed(1)}" y="${(t.y - half - CALLOUT_H - 14).toFixed(1)}" font-size="12" text-anchor="middle" ` +
      `fill="${col}" font-weight="700" font-family="${S.mono}" ` +
      `paint-order="stroke" stroke="${S.bg}" stroke-width="3.5" stroke-linejoin="round">${esc(classLbl)}</text>`,
    );
    if (t.subnet && t.name) {
      out.push(
        `<text x="${midX.toFixed(1)}" y="${(t.y + half + 16).toFixed(1)}" font-size="10" text-anchor="middle" ` +
        `fill="${S.sub}" font-family="${S.mono}">${esc(t.name)}</text>`,
      );
    }

    // Tube body.
    out.push(
      `<rect x="${t.x1.toFixed(1)}" y="${(t.y - half).toFixed(1)}" width="${(t.x2 - t.x1).toFixed(1)}" ` +
      `height="${TUBE_H}" rx="${half}" fill="${col}" fill-opacity="0.16" stroke="${col}" stroke-width="2.2"/>`,
    );
    out.push(
      `<line x1="${(t.x1 + 12).toFixed(1)}" y1="${t.y.toFixed(1)}" x2="${(t.x2 - 12).toFixed(1)}" y2="${t.y.toFixed(1)}" ` +
      `stroke="${col}" stroke-width="1.2" stroke-opacity="0.5"/>`,
    );

    for (const d of t.drops) {
      out.push(
        `<path d="${pathD(d.path)}" fill="none" stroke="${col}" stroke-width="1.7" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      const start = d.path[0]!, end = d.path[d.path.length - 1]!;
      out.push(`<circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="2.4" fill="${col}"/>`);
      out.push(`<circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="2.8" fill="${col}"/>`);

      // Callout in the clear shelf above the bus, beside the attachment column.
      if (d.portLabel || d.addr || d.hostLabel) {
        const dir = d.calloutRight ? 1 : -1;
        const cx = d.attach.x;
        const cy = d.attach.y - 16; // mid-shelf
        const fx = cx + dir * CALLOUT_DX;
        out.push(
          `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${fx.toFixed(1)}" y2="${cy.toFixed(1)}" ` +
          `stroke="${col}" stroke-width="1.3" stroke-linecap="round"/>`,
        );
        const tip = d.calloutRight ? 3 : -3;
        out.push(
          `<path d="M ${fx.toFixed(1)},${(cy - 11).toFixed(1)} L ${(fx + tip).toFixed(1)},${(cy - 11).toFixed(1)} ` +
          `M ${fx.toFixed(1)},${(cy - 11).toFixed(1)} L ${fx.toFixed(1)},${(cy + 11).toFixed(1)} ` +
          `M ${fx.toFixed(1)},${(cy + 11).toFixed(1)} L ${(fx + tip).toFixed(1)},${(cy + 11).toFixed(1)}" ` +
          `fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="square"/>`,
        );
        const tx = fx + dir * 8;
        const anchor = d.calloutRight ? "start" : "end";
        const halo = `paint-order="stroke" stroke="${S.bg}" stroke-width="3.5" stroke-linejoin="round"`;
        // port on first line, addr on second; host as quiet third when useful
        let lineY = cy - 4;
        if (d.portLabel) {
          out.push(
            `<text x="${tx.toFixed(1)}" y="${lineY.toFixed(1)}" font-size="10" text-anchor="${anchor}" ` +
            `fill="${S.text}" font-weight="700" font-family="${S.mono}" ${halo}>${esc(d.portLabel)}</text>`,
          );
          lineY += 12;
        }
        if (d.addr) {
          out.push(
            `<text x="${tx.toFixed(1)}" y="${lineY.toFixed(1)}" font-size="10" text-anchor="${anchor}" ` +
            `fill="${col}" font-weight="600" font-family="${S.mono}" ${halo}>${esc(d.addr)}</text>`,
          );
          lineY += 11;
        }
      }
    }
  }
  return out;
}

export function expandHeightForTubes(baseH: number, tubes: TubesResult): number {
  if (!tubes.tubes.length) return baseH;
  return Math.max(baseH, tubes.bottom + 64);
}
