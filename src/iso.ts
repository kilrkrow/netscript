/**
 * NetScript isometric renderer — a PROJECTION, not a layer.
 *
 * Isometric is orthogonal to what you're drawing: any scene that has been
 * reduced to "positioned devices + polylines in flat space" can be projected.
 * So this module renders two scenes today —
 *
 *   renderModelIso        the physical topology (layout.ts + router.ts)
 *   renderTrafficIso      the L4 flow view      (traffic.ts layoutTraffic)
 *
 * — through one shared set of primitives, and neither layout pass knows or
 * cares that an isometric view exists. Orthogonal runs in flat space become
 * the classic two-diagonal isometric cable look for free.
 *
 * Devices are drawn as small extruded blocks (top + two visible side faces);
 * the kind glyph is billboarded flat/un-skewed on the top face (the same trick
 * isometric game/dashboard art uses to keep icons legible). Racks become
 * shallow platforms under their member devices.
 */
import type { NetModel, Device, Pt } from "./model.ts";
import { escapeXml as esc } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveTheme } from "./themes.ts";
import { GLYPH, KIND_COLOR } from "./glyphs.ts";
import { layoutModel, type Zone } from "./layout.ts";
import { buildRoutes } from "./router.ts";
import { layoutTraffic } from "./traffic.ts";

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const BLOCK_H = 26;   // device extrusion height
const ZONE_H = 12;    // rack platform extrusion height
const PAD = 40;

const proj = (x: number, y: number, z = 0): Pt => ({ x: (x - y) * COS30, y: (x + y) * SIN30 - z });
const poly = (pts: Pt[]): string => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

function clamp255(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }
function mix(hexA: string, hexB: string, t: number): string {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = clamp255(ar + (br - ar) * t), g = clamp255(ag + (bg - ag) * t), bl = clamp255(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

interface IsoBox { P00: Pt; P10: Pt; P11: Pt; P01: Pt; Q00: Pt; Q10: Pt; Q11: Pt; Q01: Pt; }
function isoBox(cx: number, cy: number, w: number, h: number, H: number): IsoBox {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return {
    P00: proj(x0, y0), P10: proj(x1, y0), P11: proj(x1, y1), P01: proj(x0, y1),
    Q00: proj(x0, y0, H), Q10: proj(x1, y0, H), Q11: proj(x1, y1, H), Q01: proj(x0, y1, H),
  };
}
const corners = (b: IsoBox): Pt[] => [b.P00, b.P10, b.P11, b.P01, b.Q00, b.Q10, b.Q11, b.Q01];
const centroid = (pts: Pt[]): Pt => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/** Extruded box as three faces (top, right, left), painter-order back→front. */
function boxFaces(b: IsoBox, top: string, right: string, left: string, stroke: string): string {
  const face = (d: string, fill: string) => `<polygon points="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
  return face(poly([b.P01, b.P11, b.Q11, b.Q01]), left)
       + face(poly([b.P10, b.P11, b.Q11, b.Q10]), right)
       + face(poly([b.Q00, b.Q10, b.Q11, b.Q01]), top);
}

/**
 * Fit the projected scene to a canvas: everything is projected around an
 * arbitrary origin, so translate it into positive space and size the viewBox
 * to the content ("infinite paper" — the drawing is never squeezed to a page).
 */
interface Canvas { W: number; H: number; shift: (p: Pt) => Pt; shiftBox: (b: IsoBox) => IsoBox; }
function fit(allPts: Pt[], footer: number): Canvas {
  const minX = Math.min(...allPts.map((p) => p.x)), maxX = Math.max(...allPts.map((p) => p.x));
  const minY = Math.min(...allPts.map((p) => p.y)), maxY = Math.max(...allPts.map((p) => p.y));
  const ox = -minX + PAD, oy = -minY + PAD;
  const shift = (p: Pt): Pt => ({ x: p.x + ox, y: p.y + oy });
  return {
    W: maxX - minX + PAD * 2,
    H: maxY - minY + PAD * 2 + footer,
    shift,
    shiftBox: (b) => ({
      P00: shift(b.P00), P10: shift(b.P10), P11: shift(b.P11), P01: shift(b.P01),
      Q00: shift(b.Q00), Q10: shift(b.Q10), Q11: shift(b.Q11), Q01: shift(b.Q01),
    }),
  };
}

/** Device blocks, painted back→front so nearer blocks occlude correctly. */
function drawBlocks(devices: Device[], boxes: Map<string, IsoBox>, C: Canvas, S: Theme): string[] {
  const out: string[] = [];
  const depth = (d: Device) => d.x! + d.y!;
  for (const d of [...devices].sort((a, b) => depth(a) - depth(b))) {
    const b = C.shiftBox(boxes.get(d.id)!);
    const kc = KIND_COLOR[d.kind];
    out.push(boxFaces(b, mix(kc, "#ffffff", 0.78), mix(kc, "#000000", 0.18), mix(kc, "#000000", 0.34), S.cardStroke));
    const top = centroid([b.Q00, b.Q10, b.Q11, b.Q01]);
    out.push(GLYPH[d.kind](top.x, top.y, 13, S.chipStroke ?? kc, "none", 1.3));
    const lblY = b.P11.y + 15;
    out.push(`<text x="${b.P11.x.toFixed(1)}" y="${lblY.toFixed(1)}" font-size="10" text-anchor="middle" fill="${S.text}" font-weight="600">${esc(d.label)}</text>`);
    if (S.showMgmt && d.mgmt) out.push(`<text x="${b.P11.x.toFixed(1)}" y="${(lblY + 11).toFixed(1)}" font-size="8.5" text-anchor="middle" fill="${S.sub}" font-family="${S.mono}">${esc(d.mgmt)}</text>`);
  }
  return out;
}

/** Triangle at `tip`, oriented along the direction of travel from `from`. */
function arrowHead(tip: Pt, from: Pt, col: string, size = 9): string {
  const dx = tip.x - from.x, dy = tip.y - from.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const bx = tip.x - ux * size, by = tip.y - uy * size, hw = size * 0.52;
  return `<path d="M ${tip.x.toFixed(1)},${tip.y.toFixed(1)} L ${(bx + px * hw).toFixed(1)},${(by + py * hw).toFixed(1)} L ${(bx - px * hw).toFixed(1)},${(by - py * hw).toFixed(1)} Z" fill="${col}"/>`;
}

function header(S: Theme, title: string, tag: string): string[] {
  return [
    `<text x="18" y="24" font-size="12.5" fill="${S.text}" font-weight="700" letter-spacing="0.4">${esc(title)}</text>`,
    `<text x="18" y="39" font-size="9.5" fill="${S.sub}" font-family="${S.mono}" letter-spacing="1">${esc(tag)}</text>`,
  ];
}

// ─── physical topology, isometric ────────────────────────────────────────────

export function renderModelIso(m: NetModel, themeName: string | Theme = "clean"): string {
  const S = typeof themeName === "string" ? resolveTheme(themeName) : themeName;
  const { zones } = layoutModel(m);
  const routes = buildRoutes(m);

  const allPts: Pt[] = [];
  const devBox = new Map<string, IsoBox>();
  for (const d of m.devices) {
    const b = isoBox(d.x!, d.y!, d.w!, d.h!, BLOCK_H);
    devBox.set(d.id, b);
    allPts.push(...corners(b));
  }
  const zoneBox = new Map<Zone, IsoBox>();
  for (const z of zones) {
    const b = isoBox(z.x + z.w / 2, z.y + z.h / 2, z.w, z.h, ZONE_H);
    zoneBox.set(z, b);
    allPts.push(...corners(b));
  }
  const projRoutes = routes.map((pts) => pts.map((p) => proj(p.x, p.y)));
  for (const pts of projRoutes) allPts.push(...pts);

  const C = fit(allPts, 0);   // stats live in the header; no footer band needed
  const out: string[] = [`<svg viewBox="0 0 ${C.W.toFixed(0)} ${C.H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" font-family="${S.font}">`];
  out.push(`<rect width="${C.W.toFixed(0)}" height="${C.H.toFixed(0)}" fill="${S.bg}"/>`);

  // zone platforms (back→front)
  const zoneDepth = (z: Zone) => z.x + z.w / 2 + z.y + z.h / 2;
  for (const z of [...zones].sort((a, b) => zoneDepth(a) - zoneDepth(b))) {
    const b = C.shiftBox(zoneBox.get(z)!);
    out.push(boxFaces(b, S.zoneFill, mix(S.zoneFill, "#000000", 0.12), mix(S.zoneFill, "#000000", 0.24), S.zoneStroke));
    const lbl = C.shift(zoneBox.get(z)!.Q01);
    out.push(`<text x="${(lbl.x - 4).toFixed(1)}" y="${(lbl.y - 6).toFixed(1)}" font-size="10.5" fill="${S.zoneText}" font-weight="700" letter-spacing="1.4" font-family="${S.mono}">${esc(z.label)}</text>`);
  }

  // cabling at floor level, under the blocks
  const SPEED_W: Record<string, number> = { WAN: 1.4, "1G": 1.4, "10G": 1.6, "25G": 1.8, "40G": 2, "100G": 2.4, LAG: 1.6 };
  m.links.forEach((l, i) => {
    const pts = projRoutes[i].map(C.shift);
    const col = S.speedColor[l.speed] ?? S.link;
    const lw = SPEED_W[l.speed] ?? S.linkW;
    if (l.bond) {
      for (const off of [{ x: 1.6, y: -1.6 }, { x: -1.6, y: 1.6 }])
        out.push(`<polyline points="${poly(pts.map((p) => ({ x: p.x + off.x, y: p.y + off.y })))}" fill="none" stroke="${col}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else {
      out.push(`<polyline points="${poly(pts)}" fill="none" stroke="${col}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  });

  out.push(...drawBlocks(m.devices, devBox, C, S));
  out.push(...header(S, m.title, `${m.devices.length} NODES · ${m.links.length} LINKS · ISOMETRIC`));
  out.push("</svg>");
  return out.join("\n");
}

// ─── traffic (L4 flows), isometric ───────────────────────────────────────────

export function renderTrafficIso(m: NetModel, themeName: string | Theme = "clean"): string {
  const S = typeof themeName === "string" ? resolveTheme(themeName) : themeName;
  const T = layoutTraffic(m, S);

  const allPts: Pt[] = [];
  const devBox = new Map<string, IsoBox>();
  for (const d of m.devices) {
    const b = isoBox(d.x!, d.y!, d.w!, d.h!, BLOCK_H);
    devBox.set(d.id, b);
    allPts.push(...corners(b));
  }
  const projRoutes = T.routes.map((pts) => pts.map((p) => proj(p.x, p.y)));
  for (const pts of projRoutes) allPts.push(...pts);
  const projSockets = T.sockets.map((s) => ({ ...s, at: proj(s.at.x, s.at.y) }));
  allPts.push(...projSockets.map((s) => s.at));

  const C = fit(allPts, 86);   // footer room for the service legend
  const out: string[] = [`<svg viewBox="0 0 ${C.W.toFixed(0)} ${C.H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" font-family="${S.font}">`];
  out.push(`<rect width="${C.W.toFixed(0)}" height="${C.H.toFixed(0)}" fill="${S.bg}"/>`);

  // flow lines at floor level, under the blocks
  T.flows.forEach((f, i) => {
    const pts = projRoutes[i].map(C.shift);
    const col = T.color(f);
    out.push(`<polyline points="${poly(pts)}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
    out.push(`<circle cx="${pts[0].x.toFixed(1)}" cy="${pts[0].y.toFixed(1)}" r="2.8" fill="${col}"/>`);
  });

  out.push(...drawBlocks(m.devices, devBox, C, S));

  // Arrowheads and socket chips ride ON TOP of the blocks — in a projected
  // scene the terminal end of a flow can otherwise fall behind whatever block
  // sits in front of it, and the socket is the whole point of the drawing.
  T.flows.forEach((f, i) => {
    const pts = projRoutes[i].map(C.shift);
    out.push(arrowHead(pts[pts.length - 1], pts[pts.length - 2], T.color(f)));
  });
  for (const s of projSockets) {
    const p = C.shift(s.at);
    const tw = 6.4 * s.svc.length + 14;
    out.push(`<rect x="${(p.x - tw / 2).toFixed(1)}" y="${(p.y + 6).toFixed(1)}" width="${tw.toFixed(1)}" height="16" rx="8" fill="${S.bg}" stroke="${s.color}" stroke-width="1.5"/>`);
    out.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + 17.5).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="${s.color}" font-weight="700" font-family="${S.mono}">${esc(s.svc)}</text>`);
  }

  // service legend
  const ly = C.H - 44;
  out.push(`<text x="18" y="${ly.toFixed(1)}" font-size="11" fill="${S.sub}" font-weight="700" font-family="${S.mono}" letter-spacing="1">SERVICES</text>`);
  let lx = 106;
  for (const { svc, label, color } of T.legend) {
    const t = label ? `${svc} · ${label}` : svc;
    out.push(`<line x1="${lx.toFixed(1)}" y1="${(ly - 3.5).toFixed(1)}" x2="${(lx + 24).toFixed(1)}" y2="${(ly - 3.5).toFixed(1)}" stroke="${color}" stroke-width="3.4" stroke-linecap="round"/>`);
    out.push(`<text x="${(lx + 31).toFixed(1)}" y="${ly.toFixed(1)}" font-size="10.5" fill="${S.sub}" font-family="${S.mono}">${esc(t)}</text>`);
    lx += 46 + 6.6 * t.length;
  }
  out.push(`<text x="18" y="${(ly + 21).toFixed(1)}" font-size="10" fill="${S.sub}" font-family="${S.mono}">ARROW POINTS INITIATOR → LISTENER · A SOCKET IS AN EXPOSED PORT (INBOUND) · FLOWS LEAVING A BLOCK ARE ITS OUTBOUND</text>`);

  out.push(...header(S, m.title, `TRAFFIC · L4 FLOWS · ${T.flows.length} FLOWS · ${T.legend.length} SERVICES · ISOMETRIC`));
  out.push("</svg>");
  return out.join("\n");
}
