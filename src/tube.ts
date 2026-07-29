/**
 * NetScript Ethernet tubes — Visio-style L2 segment buses.
 *
 * A tube is a thick horizontal bus labelled with the subnet class
 * (e.g. 192.168.86.0/24). Each member host drops a vertical stub to the
 * tube; on the *device side* of that drop sits a bracket callout with
 * physical port + host address:
 *
 *        device
 *          |
 *          +----[  eth0
 *                  .10
 *         ════════ tube 192.168.86.0/24 ════════
 *
 * Pure geometry + SVG helpers. layoutModel still owns device placement;
 * this module only places buses under the members that already have x/y.
 */
import type { NetModel, Pt, Segment } from "./model.ts";
import { escapeXml as esc } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveSegments, portOf } from "./logical.ts";

const TUBE_H = 14;          // visual height of the bus body
const TUBE_GAP = 52;        // vertical pitch between stacked tubes
const DROP_PAD = 28;        // clearance from device bottom to first tube
const SIDE_PAD = 36;        // tube extends past outermost members
const CALLOUT_DX = 16;      // horizontal flag length
const CALLOUT_FROM_TOP = 12; // callout sits this far down the drop (device side)

export interface TubeDrop {
  device: string;
  port?: string;
  /** Display port name (from Port.name when known). */
  portLabel?: string;
  addr?: string;
  x: number;
  yTop: number;   // device bottom (start of drop)
  yBot: number;   // tube top (end of drop)
}

export interface TubeLayout {
  id: string;
  name: string;
  subnet?: string;
  color: string;
  y: number;      // vertical centre of the bus
  x1: number;
  x2: number;
  drops: TubeDrop[];
}

export interface TubesResult {
  tubes: TubeLayout[];
  /** Lowest y the tubes reach (for viewBox expansion). */
  bottom: number;
}

/**
 * Place tubes under their member devices. Devices without positions are
 * skipped. Returns empty when there is nothing to draw.
 */
export function layoutTubes(m: NetModel, colorAt: (i: number) => string): TubesResult {
  const segs = resolveSegments(m);
  const byId = new Map(m.devices.map((d) => [d.id, d]));
  const tubes: TubeLayout[] = [];
  let stackY = 0; // running floor under previous tubes

  segs.forEach((seg, si) => {
    const placed = seg.members
      .map((mem) => {
        const d = byId.get(mem.device);
        if (!d?.x || !d?.y || !d.w || !d.h) return null;
        const portObj = portOf(m, mem.device, mem.port);
        return {
          device: mem.device,
          port: mem.port,
          portLabel: portObj?.name ?? mem.port,
          addr: mem.addr,
          x: d.x,
          yTop: d.y + d.h / 2,
          left: d.x - d.w / 2,
          right: d.x + d.w / 2,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (!placed.length) return;

    // Prefer a single horizontal row of drops: tube under the lowest member.
    const maxBottom = Math.max(...placed.map((p) => p.yTop));
    const yTop = Math.max(maxBottom + DROP_PAD, stackY + (si === 0 ? 0 : 8));
    const y = yTop + TUBE_H / 2;
    const x1 = Math.min(...placed.map((p) => p.left)) - SIDE_PAD;
    const x2 = Math.max(...placed.map((p) => p.right)) + SIDE_PAD;

    // Spread drops that share the same x so parallel ports on one host fan out.
    const byDev = new Map<string, typeof placed>();
    for (const p of placed) {
      const arr = byDev.get(p.device) ?? [];
      arr.push(p);
      byDev.set(p.device, arr);
    }
    const drops: TubeDrop[] = [];
    for (const group of byDev.values()) {
      group.forEach((p, i) => {
        const fan = (i - (group.length - 1) / 2) * 10;
        drops.push({
          device: p.device,
          port: p.port,
          portLabel: p.portLabel,
          addr: p.addr,
          x: p.x + fan,
          yTop: p.yTop,
          yBot: y - TUBE_H / 2,
        });
      });
    }

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
    stackY = y + TUBE_H / 2 + TUBE_GAP * 0.35;
  });

  const bottom = tubes.length
    ? Math.max(...tubes.map((t) => t.y + TUBE_H / 2 + 28))
    : 0;
  return { tubes, bottom };
}

/** True when the model will produce at least one tube after resolve. */
export const hasTubes = (m: NetModel): boolean => resolveSegments(m).length > 0;

/**
 * SVG fragments for tubes + drops + Visio-style bracket callouts.
 * Drawn under device cards when called before them, or over cabling — caller chooses z-order.
 */
export function drawTubesSvg(tubes: TubeLayout[], S: Theme): string[] {
  const out: string[] = [];
  for (const t of tubes) {
    const col = t.color;
    const y = t.y;
    const half = TUBE_H / 2;

    // Soft body + hard edges = “tube” rather than a single fat stroke.
    out.push(
      `<rect x="${t.x1.toFixed(1)}" y="${(y - half).toFixed(1)}" width="${(t.x2 - t.x1).toFixed(1)}" ` +
      `height="${TUBE_H}" rx="${half}" fill="${col}" fill-opacity="0.14" stroke="${col}" stroke-width="2.2"/>`,
    );
    out.push(
      `<line x1="${(t.x1 + 10).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(t.x2 - 10).toFixed(1)}" y2="${y.toFixed(1)}" ` +
      `stroke="${col}" stroke-width="1.1" stroke-opacity="0.55"/>`,
    );

    // Class label on the bus (subnet preferred; fall back to name).
    const classLbl = t.subnet ?? t.name;
    const sub = t.subnet && t.name ? t.name : undefined;
    const midX = (t.x1 + t.x2) / 2;
    out.push(
      `<text x="${midX.toFixed(1)}" y="${(y - half - 6).toFixed(1)}" font-size="11" text-anchor="middle" ` +
      `fill="${col}" font-weight="700" font-family="${S.mono}" ` +
      `paint-order="stroke" stroke="${S.bg}" stroke-width="3" stroke-linejoin="round">${esc(classLbl)}</text>`,
    );
    if (sub) {
      out.push(
        `<text x="${midX.toFixed(1)}" y="${(y + half + 12).toFixed(1)}" font-size="9" text-anchor="middle" ` +
        `fill="${S.sub}" font-family="${S.mono}">${esc(sub)}</text>`,
      );
    }

    for (const d of t.drops) {
      // Drop from device bottom to tube top.
      out.push(
        `<line x1="${d.x.toFixed(1)}" y1="${d.yTop.toFixed(1)}" x2="${d.x.toFixed(1)}" y2="${d.yBot.toFixed(1)}" ` +
        `stroke="${col}" stroke-width="1.6" stroke-linecap="round"/>`,
      );
      // Junction dots.
      out.push(`<circle cx="${d.x.toFixed(1)}" cy="${d.yTop.toFixed(1)}" r="2.2" fill="${col}"/>`);
      out.push(`<circle cx="${d.x.toFixed(1)}" cy="${d.yBot.toFixed(1)}" r="2.2" fill="${col}"/>`);

      // Visio-style callout on the *device side* of the drop.
      if (d.portLabel || d.addr) {
        const cy = Math.min(d.yTop + CALLOUT_FROM_TOP, (d.yTop + d.yBot) / 2);
        const fx = d.x + CALLOUT_DX; // flag sits to the right of the drop
        // Elbow: from drop across to bracket.
        out.push(
          `<line x1="${d.x.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${fx.toFixed(1)}" y2="${cy.toFixed(1)}" ` +
          `stroke="${col}" stroke-width="1.3" stroke-linecap="round"/>`,
        );
        // Bracket “[”
        out.push(
          `<path d="M ${fx.toFixed(1)},${(cy - 9).toFixed(1)} L ${(fx + 3).toFixed(1)},${(cy - 9).toFixed(1)} ` +
          `M ${fx.toFixed(1)},${(cy - 9).toFixed(1)} L ${fx.toFixed(1)},${(cy + 9).toFixed(1)} ` +
          `M ${fx.toFixed(1)},${(cy + 9).toFixed(1)} L ${(fx + 3).toFixed(1)},${(cy + 9).toFixed(1)}" ` +
          `fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="square"/>`,
        );
        const tx = fx + 7;
        if (d.portLabel) {
          out.push(
            `<text x="${tx.toFixed(1)}" y="${(cy - 1).toFixed(1)}" font-size="9.5" fill="${S.text}" ` +
            `font-weight="700" font-family="${S.mono}" dominant-baseline="auto">${esc(d.portLabel)}</text>`,
          );
        }
        if (d.addr) {
          out.push(
            `<text x="${tx.toFixed(1)}" y="${(cy + 11).toFixed(1)}" font-size="9.5" fill="${col}" ` +
            `font-weight="600" font-family="${S.mono}">${esc(d.addr)}</text>`,
          );
        }
      }
    }
  }
  return out;
}

/** Expand a layout height so tubes fit under the canvas. */
export function expandHeightForTubes(baseH: number, tubes: TubesResult): number {
  if (!tubes.tubes.length) return baseH;
  return Math.max(baseH, tubes.bottom + 48);
}

// re-export for tests / MCP
export type { Segment, Pt };
