/**
 * NetScript traffic view — the FLOW layer (L4).
 *
 * Where the physical view answers "what is cabled to what" and the logical
 * view answers "what segment is this on", this one answers **"what talks to
 * what, on which service, and in which direction"** — the question a firewall
 * rule set or a security review is actually made of.
 *
 * Two ideas carry the whole drawing:
 *
 *  1. **Colour encodes the service** (`tcp/1433`, `tcp/443`, …), not the
 *     speed and not the segment. Every line of one colour is the same service
 *     wherever it appears on the page.
 *  2. **Direction encodes intent.** An arrow runs initiator → listener, and
 *     lands in a labelled SOCKET on the listener's edge. So a server exposing
 *     tcp/1433 shows one socket with every client converging into it — the
 *     picture of "inbound" — while the same server's own outbound calls leave
 *     from its opposite edge. Inbound vs outbound is read off the geometry
 *     rather than stored on the data, because it is a point of view, not a
 *     property of the flow.
 *
 * Placement is derived from the flow graph itself, not from `tier`: a device
 * that initiates but never listens sinks to the bottom, a device that only
 * listens rises to the top, and anything doing both lands in between. This is
 * longest-path layering over inbound edges.
 *
 * "Infinite paper": the canvas is sized to the content with generous gaps
 * rather than squeezed to fit a page — flows get room for their labels.
 *
 * Structured as `layoutTraffic` (pure geometry — positions, sockets, routed
 * polylines, service colours) plus a flat renderer over it, mirroring the
 * model → layout → router → render split the rest of the pipeline uses. The
 * isometric traffic view in `iso.ts` consumes the same layout, so both
 * projections stay honest about being views of one computed scene.
 *
 * NOT crossing-minimising: devices keep author order within a level, and lane
 * banks are allocated per listener level (a flow spanning several levels can
 * therefore pass near an intermediate card). Same honest limitation as the
 * physical router — see README.
 */
import type { NetModel, Device, Flow, Pt } from "./model.ts";
import { escapeXml as esc, serviceKey } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveTheme } from "./themes.ts";
import { GLYPH, KIND_COLOR } from "./glyphs.ts";
import { allocLanes } from "./router.ts";

// Infinite-paper geometry: generous, not page-constrained.
const DEV_W = 188, DEV_H = 64;
const LEVEL_GAP = 250;      // vertical distance between flow levels
const COL_GAP = 74;         // horizontal gap between cards in a level
const MARGIN = 92;
const LANE_GAP = 17;

// Socket geometry, measured down from the listener's card edge: a short stub,
// then the port chip. Flows terminate at the chip's far edge with the
// arrowhead pointing back INTO it.
const STUB = 7, CHIP_H = 16;
const SOCKET_DROP = STUB + CHIP_H;   // card edge → chip far edge (arrow tip)
const ARROW = 9;

/** Longest-path layering over INBOUND flow edges: pure initiators → level 0. */
function flowLevels(m: NetModel): Map<string, number> {
  const sources = new Map<string, string[]>(m.devices.map((d) => [d.id, []]));
  for (const f of m.flows ?? []) sources.get(f.to)?.push(f.from);

  const memo = new Map<string, number>();
  const busy = new Set<string>();
  const lvl = (id: string): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    if (busy.has(id)) return 0;            // cycle guard: back-edge contributes nothing
    busy.add(id);
    const src = sources.get(id) ?? [];
    const v = src.length ? 1 + Math.max(...src.map(lvl)) : 0;
    busy.delete(id);
    memo.set(id, v);
    return v;
  };
  return new Map(m.devices.map((d) => [d.id, lvl(d.id)]));
}

/**
 * Service → palette-index map, in order of FIRST DECLARATION.
 *
 * Deliberately not sorted by port: the author writes the flow they care about
 * first, and that flow should get the strongest colour in the palette. Sorting
 * by port number would instead hand the lead colour to whichever service
 * happens to sit lowest numerically — emphasis by accident. Declaration order
 * is just as deterministic and puts the emphasis where the author put it.
 * (Contrast `vlanColorIndex`, which sorts: a VLAN id IS a meaningful ordinal
 * to browse a legend by; a port number is not.)
 */
function serviceIndex(m: NetModel): Map<string, number> {
  const keys = [...new Set((m.flows ?? []).map(serviceKey))];
  return new Map(keys.map((k, i) => [k, i]));
}

/** A socket = one service a device exposes, anchored on its listening edge. */
export interface Socket { device: string; svc: string; at: Pt; color: string; }

/** Everything geometric about a traffic scene — no SVG, no projection. */
export interface TrafficLayout {
  W: number; H: number;
  cardsBottom: number;
  flows: Flow[];
  routes: Pt[][];               // one polyline per flow, in flat space
  sockets: Socket[];
  color: (f: Flow) => string;
  /** service key → palette colour, in legend order */
  legend: { svc: string; label?: string; color: string }[];
}

export function layoutTraffic(m: NetModel, S: Theme): TrafficLayout {
  const flows = m.flows ?? [];
  const pal = S.servicePalette ?? S.vlanPalette ?? ["#2563eb"];
  const svcIdx = serviceIndex(m);
  const svcColor = (f: Flow) => pal[(svcIdx.get(serviceKey(f)) ?? 0) % pal.length];

  // ---- placement ----
  const level = flowLevels(m);
  const maxLevel = Math.max(0, ...level.values());
  const byLevel: Device[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const d of m.devices) byLevel[level.get(d.id)!].push(d);

  const levelW = (row: Device[]) => row.length * DEV_W + (row.length - 1) * COL_GAP;
  const W = Math.max(...byLevel.map(levelW), 460) + MARGIN * 2;

  for (let L = 0; L <= maxLevel; L++) {
    const row = byLevel[L];
    const x0 = (W - levelW(row)) / 2;
    row.forEach((d, i) => {
      d.w = DEV_W; d.h = DEV_H;
      d.x = x0 + i * (DEV_W + COL_GAP) + DEV_W / 2;
      d.y = MARGIN + (maxLevel - L) * LEVEL_GAP + DEV_H / 2;
    });
  }

  // ---- sockets: the distinct services each listener EXPOSES ----
  // All flows for one service converge into a single socket, which is exactly
  // the "one exposed port, many clients" story we want the eye to get.
  const socketsOf = new Map<string, string[]>();   // device id → service keys, sorted
  for (const f of flows) {
    const arr = socketsOf.get(f.to) ?? [];
    const k = serviceKey(f);
    if (!arr.includes(k)) arr.push(k);
    socketsOf.set(f.to, arr);
  }
  for (const arr of socketsOf.values()) arr.sort();

  const id = new Map(m.devices.map((d) => [d.id, d]));
  const socketPt = (devId: string, svc: string): Pt => {
    const d = id.get(devId)!;
    const arr = socketsOf.get(devId) ?? [];
    const i = Math.max(0, arr.indexOf(svc));
    return { x: d.x! - d.w! / 2 + (d.w! * (i + 1)) / (arr.length + 1), y: d.y! + d.h! / 2 };
  };

  // ---- flow routing ----
  // Leave the initiator's top edge (fanned so parallel calls don't stack),
  // rise into a lane bank sitting below the listener, run across, then drop
  // into the socket.
  const outIdx = new Map<string, number>();       // fan counter per initiator
  const outTotal = new Map<string, number>();
  for (const f of flows) outTotal.set(f.from, (outTotal.get(f.from) ?? 0) + 1);

  // Lane banks, one per listener level, sitting clear of that level's socket
  // chips and arrowheads. Resolved per-flow up front so routing stays O(n).
  const flowLane = new Map<Flow, number>();
  for (let L = 1; L <= maxLevel; L++) {
    const arriving = flows.filter((f) => level.get(f.to) === L);
    if (!arriving.length) continue;
    const y0 = MARGIN + (maxLevel - L) * LEVEL_GAP + DEV_H + SOCKET_DROP + ARROW + 20;
    const bank = allocLanes(
      arriving.map((f, i) => ({ key: String(i), x1: id.get(f.from)!.x!, x2: socketPt(f.to, serviceKey(f)).x })),
      y0, LANE_GAP, 14,
    );
    arriving.forEach((f, i) => flowLane.set(f, bank[String(i)]));
  }

  const routeOf = (f: Flow): Pt[] => {
    const a = id.get(f.from)!;
    const n = outTotal.get(f.from) ?? 1;
    const i = outIdx.get(f.from) ?? 0;
    outIdx.set(f.from, i + 1);
    const ax = a.x! - a.w! / 2 + (a.w! * (i + 1)) / (n + 1);
    const ay = a.y! - a.h! / 2;                       // exit the TOP edge (toward the listener)
    const sock = socketPt(f.to, serviceKey(f));
    const sy = sock.y + SOCKET_DROP;                  // arrow tip, at the chip's far edge
    const ly = flowLane.get(f) ?? (ay + sy) / 2;
    return [{ x: ax, y: ay }, { x: ax, y: ly }, { x: sock.x, y: ly }, { x: sock.x, y: sy }];
  };
  const routes = flows.map(routeOf);

  const cardsBottom = MARGIN + maxLevel * LEVEL_GAP + DEV_H;
  const H = cardsBottom + 116;                        // footer room for the legend

  const sockets: Socket[] = [];
  for (const [devId, svcs] of socketsOf)
    for (const svc of svcs)
      sockets.push({ device: devId, svc, at: socketPt(devId, svc), color: pal[(svcIdx.get(svc) ?? 0) % pal.length] });

  const legend = [...svcIdx].sort((a, b) => a[1] - b[1]).map(([svc, i]) => ({
    svc,
    label: flows.find((f) => serviceKey(f) === svc && f.label)?.label,
    color: pal[i % pal.length],
  }));

  return { W, H, cardsBottom, flows, routes, sockets, color: svcColor, legend };
}

export function renderModelTraffic(m: NetModel, themeName: string | Theme = "clean"): string {
  const S = typeof themeName === "string" ? resolveTheme(themeName) : themeName;
  const { W, H, flows, routes, sockets, color: svcColor, legend } = layoutTraffic(m, S);

  // ---- draw ----
  const out: string[] = [`<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" font-family="${S.font}">`];
  if (S.shadow)
    out.push('<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.2" flood-color="#0f172a" flood-opacity="0.16"/></filter></defs>');
  out.push(`<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="${S.bg}"/>`);
  if (S.grid)
    out.push(`<defs><pattern id="grd" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="${S.grid}" stroke-width="1"/></pattern></defs><rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="url(#grd)"/>`);

  const path = (pts: Pt[], r = 8): string => {
    // rounded orthogonal polyline
    let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], prev = pts[i - 1], next = pts[i + 1];
      const inD = { x: Math.sign(p.x - prev.x), y: Math.sign(p.y - prev.y) };
      const outD = { x: Math.sign(next.x - p.x), y: Math.sign(next.y - p.y) };
      const r1 = Math.min(r, Math.hypot(p.x - prev.x, p.y - prev.y) / 2);
      const r2 = Math.min(r, Math.hypot(next.x - p.x, next.y - p.y) / 2);
      const rr = Math.min(r1, r2);
      d += ` L ${(p.x - inD.x * rr).toFixed(1)},${(p.y - inD.y * rr).toFixed(1)}`;
      d += ` Q ${p.x.toFixed(1)},${p.y.toFixed(1)} ${(p.x + outD.x * rr).toFixed(1)},${(p.y + outD.y * rr).toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    return d + ` L ${last.x.toFixed(1)},${last.y.toFixed(1)}`;
  };

  // flows (under the cards)
  flows.forEach((f, i) => {
    const col = svcColor(f), pts = routes[i];
    out.push(`<path d="${path(pts)}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
    out.push(`<circle cx="${pts[0].x.toFixed(1)}" cy="${pts[0].y.toFixed(1)}" r="2.8" fill="${col}"/>`);
    // arrowhead pointing UP into the socket, tip on the chip's far edge
    const e = pts[pts.length - 1];
    out.push(`<path d="M ${e.x.toFixed(1)},${e.y.toFixed(1)} l -5,${ARROW} h 10 Z" fill="${col}"/>`);
  });

  // Socket chips on each listener's bottom edge — the exposed ports. Drawn
  // after the flows so the chip fill masks the lines converging behind it.
  for (const { svc, at: p, color: col } of sockets) {
    const tw = 6.4 * svc.length + 14;
    out.push(`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${(p.y + STUB).toFixed(1)}" stroke="${col}" stroke-width="2"/>`);
    out.push(`<rect x="${(p.x - tw / 2).toFixed(1)}" y="${(p.y + STUB).toFixed(1)}" width="${tw.toFixed(1)}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${S.bg}" stroke="${col}" stroke-width="1.5"/>`);
    out.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + STUB + 11.5).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="${col}" font-weight="700" font-family="${S.mono}">${esc(svc)}</text>`);
  }

  // device cards
  for (const d of m.devices) {
    const cx = d.x!, cy = d.y!, w = d.w!, h = d.h!, kc = KIND_COLOR[d.kind];
    const filt = S.shadow ? ' filter="url(#sh)"' : "";
    out.push(`<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="${S.radius}" fill="${S.cardFill}" stroke="${S.cardStroke}" stroke-width="${S.cardStrokeW}"${filt}/>`);
    const gx = cx - w / 2 + 24;
    const hasMgmt = S.showMgmt && !!d.mgmt;
    out.push(GLYPH[d.kind](gx, cy - (hasMgmt ? 7 : 0), 17, S.chipStroke ?? kc, "none", 1.4));
    out.push(`<text x="${(gx + 20).toFixed(1)}" y="${(hasMgmt ? cy - 4 : cy + 1).toFixed(1)}" font-size="12.5" fill="${S.text}" font-weight="600" dominant-baseline="middle">${esc(d.label)}</text>`);
    if (hasMgmt) out.push(`<text x="${(gx + 20).toFixed(1)}" y="${(cy + 11).toFixed(1)}" font-size="9" fill="${S.sub}" font-family="${S.mono}">${esc(d.mgmt!)}</text>`);
  }

  // ---- legend: colour → service, plus the direction convention ----
  const ly = H - 46;
  out.push(`<text x="${MARGIN}" y="${ly}" font-size="11" fill="${S.sub}" font-weight="700" font-family="${S.mono}" letter-spacing="1">SERVICES</text>`);
  let lx = MARGIN + 88;
  for (const { svc, label, color: col } of legend) {
    const t = label ? `${svc} · ${label}` : svc;
    out.push(`<line x1="${lx.toFixed(1)}" y1="${ly - 3.5}" x2="${(lx + 24).toFixed(1)}" y2="${ly - 3.5}" stroke="${col}" stroke-width="3.4" stroke-linecap="round"/>`);
    out.push(`<text x="${(lx + 31).toFixed(1)}" y="${ly}" font-size="10.5" fill="${S.sub}" font-family="${S.mono}">${esc(t)}</text>`);
    lx += 46 + 6.6 * t.length;
  }
  out.push(`<text x="${MARGIN}" y="${(ly + 21).toFixed(1)}" font-size="10" fill="${S.sub}" font-family="${S.mono}">ARROW POINTS INITIATOR → LISTENER · A SOCKET IS AN EXPOSED PORT (INBOUND) · FLOWS LEAVING A CARD ARE ITS OUTBOUND</text>`);

  out.push(`<text x="${MARGIN}" y="${(MARGIN - 44).toFixed(1)}" font-size="13.5" fill="${S.text}" font-weight="700" letter-spacing="0.4">${esc(m.title)}</text>`);
  out.push(`<text x="${MARGIN}" y="${(MARGIN - 27).toFixed(1)}" font-size="10" fill="${S.sub}" font-family="${S.mono}" letter-spacing="1">TRAFFIC · L4 FLOWS · ${flows.length} FLOWS · ${legend.length} SERVICES</text>`);

  out.push("</svg>");
  return out.join("\n");
}
