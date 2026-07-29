/**
 * NetScript Ethernet tubes — Visio-style L2 buses.
 *
 * Multi-segment geometry (with layoutBusBands):
 *
 *     [Default hosts]     spur root on host bottom, drop down
 *            |
 *     ══ Default 192.168.86.0/24 ══
 *
 *     ══ iot 192.168.86.0/24 ══
 *            |
 *     [iot hosts]         spur root on host top, drop down from tube
 *
 * Callout = last octet only (class C is on the tube). Flag bar "|".
 */
import type { NetModel, Pt } from "./model.ts";
import { escapeXml as esc } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveSegments, portOf } from "./logical.ts";

const TUBE_H = 20;
const BAND_GAP = 52;
const SIDE_PAD = 56;
const ARM_DX = 64;
const ARM_DY = 28;
const FLAG_HALF = 11;

export interface TubeDrop {
  device: string;
  port?: string;
  portLabel?: string;
  addr?: string;
  path: Pt[];
  spurRoot: Pt;
  spurRight: boolean;
  /** Hosts above tube (drop down) vs hosts below (drop down from tube). */
  hostsAbove: boolean;
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

/** Class C on tube → callout last octet only. */
export function hostOctet(addr?: string): string | undefined {
  if (!addr) return undefined;
  const s = addr.trim();
  if (!s) return undefined;
  if (s.startsWith(".")) return s;
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return `.${m[4]}`;
  if (/^\d{1,3}$/.test(s)) return `.${s}`;
  return s;
}

function shouldDrop(m: NetModel, deviceId: string, segmentHasHost: boolean): boolean {
  const d = m.devices.find((x) => x.id === deviceId);
  if (!d) return false;
  if (d.tier === "host") return true;
  if (d.tier === "edge" || d.kind === "firewall" || d.kind === "router") return true;
  if (!segmentHasHost) return true;
  return false;
}

export function layoutTubes(m: NetModel, colorAt: (i: number) => string): TubesResult {
  const segs = resolveSegments(m);
  const byId = new Map(m.devices.map((d) => [d.id, d]));
  const tubes: TubeLayout[] = [];
  let padL = 48, padR = 100;
  let globalMinX = Infinity, globalMaxX = -Infinity;

  for (const d of m.devices) {
    if (d.x == null || d.w == null) continue;
    globalMinX = Math.min(globalMinX, d.x - d.w / 2);
    globalMaxX = Math.max(globalMaxX, d.x + d.w / 2);
  }
  if (!Number.isFinite(globalMinX)) { globalMinX = 0; globalMaxX = 400; }

  // Track the bottom of the previous tube so later tubes stack cleanly
  // when host bands leave a shared gap.
  let prevTubeBottom = -Infinity;

  segs.forEach((seg, si) => {
    type PM = {
      device: string; port?: string; portLabel?: string; addr?: string;
      dx: number; yTop: number; yBottom: number;
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
        addr: hostOctet(mem.addr),
        dx: d.x,
        yTop: d.y - d.h / 2,
        yBottom: d.y + d.h / 2,
      });
    }
    const hasHost = raw.some((p) => byId.get(p.device)?.tier === "host");
    const placed = raw.filter((p) => shouldDrop(m, p.device, hasHost));
    if (!placed.length) return;

    placed.sort((a, b) => a.dx - b.dx || a.yBottom - b.yBottom || (a.port ?? "").localeCompare(b.port ?? ""));

    const maxBottom = Math.max(...placed.map((p) => p.yBottom));
    const minTop = Math.min(...placed.map((p) => p.yTop));

    // First segment (or hosts above mid): tube under hosts.
    // Later segments with hosts below previous content: tube above those hosts.
    const hostsAbove = si === 0 || maxBottom < prevTubeBottom + 200;
    // More reliable: if host centres sit above where we'd place a stacked tube
    // after prevTubeBottom, treat as hosts-above; else hosts-below.
    const midY = placed.reduce((s, p) => s + (p.yTop + p.yBottom) / 2, 0) / placed.length;
    const hostsAreAbove = si === 0 || midY < (prevTubeBottom > 0 ? prevTubeBottom + 80 : Infinity);

    let tubeTop: number;
    let tubeBottom: number;
    if (hostsAreAbove) {
      tubeTop = Math.max(maxBottom + BAND_GAP, prevTubeBottom + BAND_GAP);
      tubeBottom = tubeTop + TUBE_H;
    } else {
      // Tube sits above this segment's hosts; drops run down to clients.
      tubeBottom = minTop - BAND_GAP;
      tubeTop = tubeBottom - TUBE_H;
      // Keep stacked under previous tube
      if (tubeTop < prevTubeBottom + 24) {
        const shift = prevTubeBottom + 24 - tubeTop;
        tubeTop += shift;
        tubeBottom += shift;
      }
    }
    const y = (tubeTop + tubeBottom) / 2;
    prevTubeBottom = tubeBottom;

    const totals = new Map<string, number>();
    for (const p of placed) totals.set(p.device, (totals.get(p.device) ?? 0) + 1);
    const seen = new Map<string, number>();

    const drops: TubeDrop[] = [];
    placed.forEach((p, i) => {
      const nth = seen.get(p.device) ?? 0;
      seen.set(p.device, nth + 1);
      const total = totals.get(p.device) ?? 1;
      const fan = total > 1 ? (nth - (total - 1) / 2) * 12 : 0;
      const x = p.dx + fan;

      // Spur root always on the device where the drop attaches.
      const iface: Pt = hostsAreAbove
        ? { x, y: p.yBottom }
        : { x, y: p.yTop };
      const tubeAttach: Pt = hostsAreAbove
        ? { x, y: tubeTop }
        : { x, y: tubeBottom };
      // Path: device → tube (renderer doesn't care about direction for stroke)
      const path: Pt[] = [iface, tubeAttach];

      drops.push({
        device: p.device,
        port: p.port,
        portLabel: p.portLabel,
        addr: p.addr,
        path,
        spurRoot: iface,
        spurRight: i % 2 === 0,
        hostsAbove: hostsAreAbove,
      });
    });

    tubes.push({
      id: seg.id,
      name: seg.name,
      subnet: seg.subnet,
      color: colorAt(si),
      y,
      x1: globalMinX - SIDE_PAD,
      x2: globalMaxX + SIDE_PAD,
      drops,
    });
  });

  tubes.sort((a, b) => a.y - b.y);

  if (tubes.length) {
    for (const t of tubes) {
      for (const d of t.drops) {
        const armEnd = d.spurRoot.x + (d.spurRight ? ARM_DX : -ARM_DX);
        padL = Math.max(padL, globalMinX - Math.min(d.spurRoot.x, armEnd) + 80);
        padR = Math.max(padR, Math.max(d.spurRoot.x, armEnd) - globalMaxX + 80);
      }
    }
  }

  const bottom = tubes.length
    ? Math.max(...tubes.map((t) => t.y + TUBE_H / 2 + 40), ...m.devices.map((d) => (d.y ?? 0) + (d.h ?? 0) / 2 + 40))
    : 0;
  return { tubes, bottom, padL, padR };
}

export const hasTubes = (m: NetModel): boolean => resolveSegments(m).length > 0;

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
      out.push(
        `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ` +
        `stroke="${col}" stroke-width="1.7" stroke-linecap="round"/>`,
      );
      out.push(`<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="2.5" fill="${col}"/>`);
      out.push(
        `<circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="2.8" fill="${S.bg}" stroke="${col}" stroke-width="1.6"/>`,
      );

      const lines = [d.portLabel, d.addr].filter(Boolean) as string[];
      if (!lines.length) continue;

      const root = d.spurRoot;
      const dir = d.spurRight ? 1 : -1;
      const barX = root.x + dir * ARM_DX;
      // Flag opens into free air: below host when hosts above tube, above host when below.
      const barMidY = root.y + (d.hostsAbove ? ARM_DY : -ARM_DY);
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
