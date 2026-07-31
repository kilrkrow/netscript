/**
 * NetScript traffic view — the FLOW layer (L4).
 *
 * Where the physical view answers "what is cabled to what" and the logical
 * view answers "what segment is this on", this one answers **"what talks to
 * what, on which service, and in which direction"** — the question a firewall
 * rule set or a security review is actually made of.
 *
 * Three ideas carry the whole drawing:
 *
 *  1. **Colour encodes the service** (`tcp/1433`, `tcp/443`, …), not the
 *     speed and not the segment. Every line of one colour is the same service
 *     wherever it appears on the page.
 *  2. **Direction encodes intent.** An arrow runs initiator → listener. So a
 *     server exposing tcp/1433 shows every client converging on it — the
 *     picture of "inbound" — while the same server's own outbound calls leave
 *     from its opposite edge. Inbound vs outbound is read off the geometry
 *     rather than stored on the data, because it is a point of view, not a
 *     property of the flow.
 *  3. **A service lives ON a host.** A host that declares services renders as
 *     a CONTAINER with one row per service, and flows land on the row. A
 *     vendor port table routinely puts a dozen services on one machine; giving
 *     each its own node would claim a dozen machines where there is one, which
 *     for a firewall reader is an actively harmful lie. Hosts without declared
 *     services keep the simpler socket chip on their bottom edge.
 *
 * Placement is derived from the flow graph itself, not from `tier`: a device
 * that initiates but never listens sinks to the bottom, a device that only
 * listens rises to the top, and anything doing both lands in between. Cycles
 * are broken first (DFS back-edge removal) so a stray reverse ping can't
 * invert the whole picture.
 *
 * "Infinite paper": the canvas is sized to the content with generous gaps
 * rather than squeezed to fit a page — flows get room for their labels.
 *
 * Structured as `layoutTraffic` (pure geometry) plus a flat renderer over it,
 * mirroring the model → layout → router → render split the rest of the
 * pipeline uses. The isometric traffic view in `iso.ts` consumes the same
 * layout, so both projections stay honest about being views of one scene.
 *
 * NOT crossing-minimising between levels: devices keep author order within a
 * level. Approach lanes into a container ARE ordered to avoid self-crossing.
 */
import type { NetModel, Device, Flow, Pt, ResolvedFlow } from "./model.ts";
import { escapeXml as esc, serviceKey, resolveFlow } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveTheme } from "./themes.ts";
import { GLYPH, KIND_COLOR } from "./glyphs.ts";
import { allocLanes } from "./router.ts";

// Infinite-paper geometry: generous, not page-constrained.
const BASE_W = 196, BASE_H = 64;
const HEADER_H = 36;        // host name band on a container card
const ROW_H = 21;           // one service row
const LEVEL_GAP = 132;      // clearance between the deepest card of a level and the next
const COL_GAP = 76;
const MARGIN = 92;
const LANE_GAP = 17;

// Socket geometry (hosts with no declared services), down from the card edge.
const STUB = 7, CHIP_H = 16;
const SOCKET_DROP = STUB + CHIP_H;
// Terminal heads need weight on multi-service / tall cards (a 9px head reads as
// decoration on something like a federated app host). Mid-line chevrons stay smaller.
const ARROW = 12;
const ARROW_MID = 6;
// Corner radius on the drawn polyline (see path()). The final orthogonal run into
// a card must stay longer than radius+head, or the stroke is still mid-curve when
// the arrowhead fires — reads as a diagonal stab instead of a right-angle entry.
const PATH_CORNER_R = 8;
const ENTRY_STUB = ARROW + PATH_CORNER_R * 2 + 10; // ~38px clear ortho before tip

// Approach corridor beside a container card, for flows landing on rows.
// Innermost lane must leave room for ENTRY_STUB of horizontal into the edge.
const APPROACH_BASE = ENTRY_STUB, APPROACH_STEP = 12;

/**
 * Break cycles, then layer by longest path over inbound edges.
 *
 * Cycle removal matters more than it looks: a single documented reverse ping
 * (server -> client ICMP heartbeat) forms a 2-cycle with the client's own
 * traffic, and a naive guard would resolve it by putting the *client* on top —
 * inverting the entire diagram over one incidental edge.
 */
function layerFlows(m: NetModel): { level: Map<string, number>; isBack: Set<Flow> } {
  const flows = m.flows ?? [];
  const outOf = new Map<string, Flow[]>(m.devices.map((d) => [d.id, []]));
  for (const f of flows) outOf.get(f.from)?.push(f);

  // DFS: an edge into a node currently on the stack is a back-edge.
  const state = new Map<string, 0 | 1 | 2>();
  const isBack = new Set<Flow>();
  const dfs = (id: string): void => {
    state.set(id, 1);
    for (const f of outOf.get(id) ?? []) {
      const s = state.get(f.to) ?? 0;
      if (s === 1) isBack.add(f);
      else if (s === 0) dfs(f.to);
    }
    state.set(id, 2);
  };
  for (const d of m.devices) if ((state.get(d.id) ?? 0) === 0) dfs(d.id);

  const sources = new Map<string, string[]>(m.devices.map((d) => [d.id, []]));
  for (const f of flows) if (!isBack.has(f)) sources.get(f.to)?.push(f.from);

  const memo = new Map<string, number>();
  const busy = new Set<string>();
  const lvl = (id: string): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    if (busy.has(id)) return 0;
    busy.add(id);
    const src = sources.get(id) ?? [];
    const v = src.length ? 1 + Math.max(...src.map(lvl)) : 0;
    busy.delete(id);
    memo.set(id, v);
    return v;
  };
  return { level: new Map(m.devices.map((d) => [d.id, lvl(d.id)])), isBack };
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
function serviceIndex(m: NetModel, res: Map<Flow, ResolvedFlow>): Map<string, number> {
  const keys = [...new Set((m.flows ?? []).map((f) => serviceKey(res.get(f)!)))];
  return new Map(keys.map((k, i) => [k, i]));
}

const textW = (s: string, px: number) => px * 0.58 * s.length;

/** A socket = one service a host exposes, on a host that declares no services. */
export interface Socket { device: string; svc: string; at: Pt; color: string; }

/** A service row inside a container card. Flows land on its edge. */
export interface ServiceRow {
  device: string; svcId: string; name: string; svcKey: string; exe?: string;
  x: number; y: number; w: number;      // row rect (x = left edge, y = centre)
  color: string;
}

export interface TrafficLayout {
  W: number; H: number;
  flows: Flow[];
  resolved: Map<Flow, ResolvedFlow>;
  routes: Pt[][];
  sockets: Socket[];
  rows: ServiceRow[];
  color: (f: Flow) => string;
  /** SVG stroke-dasharray for a flow, or "" — the second channel past palette wrap */
  dash: (f: Flow) => string;
  legend: { svc: string; label?: string; color: string; dash: string }[];
}

/**
 * Once there are more services than palette entries, colour alone stops being
 * an identity — it silently aliases, and a legend listing 19 services against
 * 8 swatches looks authoritative while being unable to distinguish them. Past
 * the wrap we add a dash pattern as a second channel, so colour × dash stays
 * unique for twice the palette, and the legend shows the pattern too.
 */
const DASHES = ["", "7 4", "2 3", "10 3 2 3"];
const dashFor = (i: number, palLen: number) => DASHES[Math.floor(i / palLen) % DASHES.length];

export function layoutTraffic(m: NetModel, S: Theme): TrafficLayout {
  const flows = m.flows ?? [];
  const pal = S.servicePalette ?? S.vlanPalette ?? ["#2563eb"];
  const resolved = new Map<Flow, ResolvedFlow>(flows.map((f) => [f, resolveFlow(m, f)]));
  const svcIdx = serviceIndex(m, resolved);
  const colorOf = (k: string) => pal[(svcIdx.get(k) ?? 0) % pal.length];
  const dashOf = (k: string) => dashFor(svcIdx.get(k) ?? 0, pal.length);
  const svcColor = (f: Flow) => colorOf(serviceKey(resolved.get(f)!));
  const svcDash = (f: Flow) => dashOf(serviceKey(resolved.get(f)!));

  // ---- card sizing: a host with services becomes a container ----
  for (const d of m.devices) {
    const svcs = d.services ?? [];
    if (svcs.length) {
      const widest = Math.max(...svcs.map((s) => textW(s.name, 10.5) + textW(`${s.proto}/${s.port}`, 9.5) + 44));
      d.w = Math.max(BASE_W, Math.min(360, widest));
      d.h = HEADER_H + svcs.length * ROW_H + 8;
    } else {
      d.w = BASE_W; d.h = BASE_H;
    }
  }

  // ---- placement ----
  // Ordering matters and is not obvious: horizontal placement depends only on
  // level membership and card widths, while VERTICAL placement depends on how
  // many horizontal lanes each level needs — and lane count can only be
  // computed once x is known. So x is assigned first, lanes are allocated
  // against it, and only then is each level's vertical gap sized to hold its
  // own lane bank. Doing it in the obvious order instead leaves the lane band
  // overflowing into the level below, which routes flows backwards through the
  // very card they departed from.
  const { level } = layerFlows(m);
  const maxLevel = Math.max(0, ...level.values());
  const byLevel: Device[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const d of m.devices) byLevel[level.get(d.id)!].push(d);

  // A container receiving flows on its rows needs a clear approach corridor
  // beside it. Reserve it as part of the card's slot so nothing is placed in
  // it — otherwise the corridor's vertical runs spear the neighbouring card.
  // The corridor is always on the LEFT, which keeps it independent of the x
  // positions it would otherwise have to be computed from.
  const landing = new Map<string, number>();
  for (const f of flows) {
    const r = resolved.get(f)!;
    if (r.svcId) landing.set(f.to, (landing.get(f.to) ?? 0) + 1);
  }
  const corridorOf = (d: Device) => {
    const n = landing.get(d.id) ?? 0;
    return n ? APPROACH_BASE + n * APPROACH_STEP : 0;
  };

  const slotW = (d: Device) => corridorOf(d) + d.w!;
  const rowW = (row: Device[]) => row.reduce((s, d) => s + slotW(d), 0) + Math.max(0, row.length - 1) * COL_GAP;
  const W = Math.max(...byLevel.map(rowW), 460) + MARGIN * 2;

  for (const row of byLevel) {
    let x = (W - rowW(row)) / 2;
    for (const d of row) {
      d.x = x + corridorOf(d) + d.w! / 2;
      x += slotW(d) + COL_GAP;
    }
  }

  const id = new Map(m.devices.map((d) => [d.id, d]));

  // ---- sockets (hosts that declare no services): ordering is x-independent
  const socketsOf = new Map<string, string[]>();
  for (const f of flows) {
    const r = resolved.get(f)!;
    if (r.svcId) continue;                       // lands on a row instead
    const arr = socketsOf.get(f.to) ?? [];
    const k = serviceKey(r);
    if (!arr.includes(k)) arr.push(k);
    socketsOf.set(f.to, arr);
  }
  for (const arr of socketsOf.values()) arr.sort();
  const socketX = (devId: string, svc: string): number => {
    const d = id.get(devId)!;
    const arr = socketsOf.get(devId) ?? [];
    const i = Math.max(0, arr.indexOf(svc));
    return d.x! - d.w! / 2 + (d.w! * (i + 1)) / (arr.length + 1);
  };

  // ---- approach lanes into a container (x only) ----
  // Flows landing on HIGHER rows get lanes further from the card, so a flow's
  // horizontal entry run always clears the vertical runs of the flows landing
  // below it — no self-crossing. Row *order* is known without needing y.
  const svcOrder = (f: Flow) => id.get(f.to)!.services!.findIndex((s) => s.id === resolved.get(f)!.svcId);
  const approachX = new Map<Flow, number>();
  const landingFlows = new Map<string, Flow[]>();
  for (const f of flows) {
    if (!resolved.get(f)!.svcId) continue;
    landingFlows.set(f.to, [...(landingFlows.get(f.to) ?? []), f]);
  }
  for (const [devId, fs] of landingFlows) {
    const d = id.get(devId)!;
    const edge = d.x! - d.w! / 2;
    [...fs].sort((p, q) => svcOrder(p) - svcOrder(q))
      .forEach((f, i, arr) => approachX.set(f, edge - (APPROACH_BASE + (arr.length - 1 - i) * APPROACH_STEP)));
  }

  // ---- lane banks: allocate against x, THEN size each level's gap to hold them
  const laneIdx = new Map<Flow, number>();
  const laneCount: number[] = Array(maxLevel + 1).fill(0);
  for (let L = 1; L <= maxLevel; L++) {
    const arriving = flows.filter((f) => level.get(f.to) === L);
    if (!arriving.length) continue;
    const bank = allocLanes(
      arriving.map((f, i) => {
        const r = resolved.get(f)!;
        return { key: String(i), x1: id.get(f.from)!.x!, x2: r.svcId ? approachX.get(f)! : socketX(f.to, serviceKey(r)) };
      }),
      0, 1, 14,   // unit spacing: the return value is the lane INDEX
    );
    arriving.forEach((f, i) => laneIdx.set(f, bank[String(i)]));
    laneCount[L] = Math.max(...arriving.map((f) => laneIdx.get(f)!)) + 1;
  }

  // ---- vertical placement, now that lane demand is known ----
  const LANE_CLEAR = SOCKET_DROP + ARROW + 20;
  const levelTop: number[] = [];
  let cursor = MARGIN;
  for (let L = maxLevel; L >= 0; L--) {
    levelTop[L] = cursor;
    const tallest = Math.max(...byLevel[L].map((d) => d.h ?? BASE_H), BASE_H);
    const laneBand = laneCount[L] ? LANE_CLEAR + laneCount[L] * LANE_GAP + 22 : 0;
    cursor += tallest + Math.max(LEVEL_GAP, laneBand);
  }
  for (const row of byLevel) for (const d of row) d.y = levelTop[level.get(d.id)!] + d.h! / 2;
  const cardsBottom = Math.max(...m.devices.map((d) => d.y! + d.h! / 2), MARGIN);

  // ---- y-dependent anchors ----
  const rows: ServiceRow[] = [];
  const rowOf = new Map<string, ServiceRow>();
  for (const d of m.devices) {
    (d.services ?? []).forEach((s, i) => {
      const k = serviceKey(s);
      const r: ServiceRow = {
        device: d.id, svcId: s.id, name: s.name, svcKey: k, exe: s.exe,
        x: d.x! - d.w! / 2 + 8,
        y: d.y! - d.h! / 2 + HEADER_H + i * ROW_H + ROW_H / 2,
        w: d.w! - 16,
        color: colorOf(k),
      };
      rows.push(r);
      rowOf.set(`${d.id}.${s.id}`, r);
    });
  }
  const socketPt = (devId: string, svc: string): Pt =>
    ({ x: socketX(devId, svc), y: id.get(devId)!.y! + id.get(devId)!.h! / 2 });
  const sockets: Socket[] = [];
  for (const [devId, svcs] of socketsOf)
    for (const svc of svcs) sockets.push({ device: devId, svc, at: socketPt(devId, svc), color: colorOf(svc) });

  const flowLane = new Map<Flow, number>();
  for (let L = 1; L <= maxLevel; L++) {
    if (!laneCount[L]) continue;
    const deepest = Math.max(...byLevel[L].map((d) => d.y! + d.h! / 2));
    for (const f of flows) if (level.get(f.to) === L) flowLane.set(f, deepest + LANE_CLEAR + laneIdx.get(f)! * LANE_GAP);
  }

  // ---- routing ----
  const outTotal = new Map<string, number>();
  for (const f of flows) outTotal.set(f.from, (outTotal.get(f.from) ?? 0) + 1);
  const outIdx = new Map<string, number>();

  // Lane banks sit BELOW the level they serve, so a flow is only safe to route
  // straight up when its target is exactly one level above: anything else has
  // to drive a long vertical run past whatever card sits between the endpoints.
  // That covers level-skippers AND every downward flow (a back-edge such as
  // etcd peer replication, whose riser would otherwise spear its own target).
  // Those detour to a channel beyond every card, on whichever side is nearer;
  // the detour's horizontal legs sit in inter-level gaps, so they stay clear.
  const leftMost = Math.min(...m.devices.map((d) => d.x! - d.w! / 2));
  const rightMost = Math.max(...m.devices.map((d) => d.x! + d.w! / 2));
  const skipFlows = flows.filter((f) => level.get(f.to)! - level.get(f.from)! !== 1);
  const channelX = new Map<Flow, number>();
  skipFlows.forEach((f, i) => {
    const a = id.get(f.from)!;
    const toLeft = a.x! - leftMost <= rightMost - a.x!;
    channelX.set(f, toLeft ? leftMost - 40 - i * 16 : rightMost + 40 + i * 16);
  });

  /** Append a point; drop near-zero runs; force one orthogonal bend if both axes change. */
  const pushPt = (pts: Pt[], x: number, y: number): void => {
    const L = pts[pts.length - 1];
    if (!L) { pts.push({ x, y }); return; }
    if (Math.hypot(x - L.x, y - L.y) < 1) return;
    if (Math.abs(x - L.x) >= 1 && Math.abs(y - L.y) >= 1) {
      // Horizontal then vertical so every corner is a true right angle (never a diagonal).
      pts.push({ x, y: L.y });
      if (Math.abs(y - L.y) >= 1) pts.push({ x, y });
      return;
    }
    pts.push({ x, y });
  };

  /** Drop collinear midpoints so path() doesn't invent corners on a straight run. */
  const simplifyOrtho = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const out: Pt[] = [pts[0]!];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1]!, b = pts[i]!, c = pts[i + 1]!;
      const abH = Math.abs(a.y - b.y) < 0.5, abV = Math.abs(a.x - b.x) < 0.5;
      const bcH = Math.abs(b.y - c.y) < 0.5, bcV = Math.abs(b.x - c.x) < 0.5;
      if ((abH && bcH) || (abV && bcV)) continue; // collinear — skip b
      out.push(b);
    }
    out.push(pts[pts.length - 1]!);
    return out;
  };

  const routeOf = (f: Flow): Pt[] => {
    const a = id.get(f.from)!, b = id.get(f.to)!;
    const r = resolved.get(f)!;
    const n = outTotal.get(f.from) ?? 1;
    const i = outIdx.get(f.from) ?? 0;
    outIdx.set(f.from, i + 1);
    const ax = a.x! - a.w! / 2 + (a.w! * (i + 1)) / (n + 1);
    // leave whichever edge of the initiator faces the listener
    const upward = b.y! < a.y!;
    const ay = upward ? a.y! - a.h! / 2 : a.y! + a.h! / 2;

    // level-skipping flows detour via an outer channel before climbing
    const chan = channelX.get(f);
    const pts: Pt[] = [{ x: ax, y: ay }];
    if (chan !== undefined) {
      // Step AWAY from whichever edge we left. Hardcoding "up" here sent every
      // downward flow back through its own card before turning.
      const off = upward ? -26 : 26;
      pushPt(pts, ax, ay + off);
      pushPt(pts, chan, ay + off);
    }
    const climbX = chan ?? ax;

    if (r.svcId) {
      const row = rowOf.get(`${f.to}.${r.svcId}`)!;
      const edgeX = b.x! - b.w! / 2;
      // Final horizontal into the left edge must clear corner radius + arrowhead.
      let apx = approachX.get(f)!;
      if (edgeX - apx < ENTRY_STUB) apx = edgeX - ENTRY_STUB;
      const ly = flowLane.get(f) ?? (ay + row.y) / 2;
      // Collapse short lane jogs (climbX ≈ apx): a 10–25px horizontal between two
      // long verticals reads as a wiggle, not a deliberate bend.
      if (Math.abs(climbX - apx) < ENTRY_STUB * 0.85) {
        // Collapsing the jog leaves a stub a few px wide at the card edge, which
        // parks the origin ring off-axis from the riser it supposedly starts.
        // Snap the exit onto the riser instead so the two are concentric.
        if (chan === undefined) pts[0] = { x: apx, y: ay };
        pushPt(pts, apx, ly);
      } else {
        pushPt(pts, climbX, ly);
        pushPt(pts, apx, ly);
      }
      // Vertical approach to the service row, then guaranteed ortho entry stub.
      pushPt(pts, apx, row.y);
      pushPt(pts, edgeX, row.y);
      return simplifyOrtho(pts);
    }
    const sock = socketPt(f.to, serviceKey(r));
    const tipY = sock.y + SOCKET_DROP;
    let ly = flowLane.get(f) ?? (ay + tipY) / 2;
    // Guaranteed vertical stub into the socket (same idea as ENTRY_STUB on rows).
    if (Math.abs(tipY - ly) < ENTRY_STUB) {
      ly = tipY + (tipY >= ay ? ENTRY_STUB : -ENTRY_STUB);
    }
    if (Math.abs(climbX - sock.x) < ENTRY_STUB * 0.85) {
      if (chan === undefined) pts[0] = { x: sock.x, y: ay };
      pushPt(pts, sock.x, ly);
    } else {
      pushPt(pts, climbX, ly);
      pushPt(pts, sock.x, ly);
    }
    pushPt(pts, sock.x, tipY);
    return simplifyOrtho(pts);
  };
  const routes = flows.map(routeOf);

  const H = cardsBottom + 132;
  const legend = [...svcIdx].sort((a, b) => a[1] - b[1]).map(([svc, i]) => ({
    svc,
    label: flows.map((f) => resolved.get(f)!).find((x) => serviceKey(x) === svc && x.name)?.name,
    color: pal[i % pal.length],
    dash: dashFor(i, pal.length),
  }));

  return { W, H, flows, resolved, routes, sockets, rows, color: svcColor, dash: svcDash, legend };
}

/** The longest segment of a polyline — kept for callers that want pure max length. */
export function longestSegment(pts: Pt[]): [Pt, Pt] {
  let best = 0, bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  return [pts[best], pts[best + 1]];
}

/**
 * Segment best suited to carry a flow label.
 *
 * Pure "longest segment" orphans labels onto long horizontal buses far from the
 * path's centre of mass. Prefer the segment that contains ~55% of the path
 * length (slightly toward the listener), and only fall back to a longer nearby
 * run if that segment is too short to hold text.
 */
export function labelSegment(pts: Pt[], minLen = 28): [Pt, Pt] {
  if (pts.length < 2) return [pts[0] ?? { x: 0, y: 0 }, pts[0] ?? { x: 0, y: 0 }];
  type Seg = { i: number; len: number; cum0: number; cum1: number };
  const segs: Seg[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push({ i, len, cum0: total, cum1: total + len });
    total += len;
  }
  if (total <= 0) return [pts[0], pts[1]];
  const target = total * 0.55;
  let pick = segs[0]!;
  for (const s of segs) {
    if (target >= s.cum0 && target <= s.cum1) { pick = s; break; }
    if (s.cum1 <= target) pick = s;
  }
  if (pick.len < minLen) {
    let best = pick;
    for (const s of segs) {
      const mid = (s.cum0 + s.cum1) / 2;
      const dist = Math.abs(mid - target);
      const bestMid = (best.cum0 + best.cum1) / 2;
      const bestDist = Math.abs(bestMid - target);
      // Prefer a longer run still near the path mid; ignore distant trunks.
      if (dist > total * 0.4) continue;
      if (s.len > best.len + 4 || (s.len >= minLen && dist < bestDist - 2)) best = s;
    }
    pick = best;
  }
  return [pts[pick.i], pts[pick.i + 1]];
}

/**
 * Text laid ALONG a segment, rotated to match it and offset just clear of the
 * line. Always rendered upright — past ±90° the angle is flipped rather than
 * letting the label read upside-down, which is the whole reason to rotate to
 * the segment's axis rather than its direction of travel.
 *
 * The background-coloured stroke under the fill (`paint-order`) punches a halo
 * so the label stays readable where it crosses other flows. Keep `off` small
 * (~4): a large standoff makes the caption look free-floating.
 */
export function labelAlong(p: Pt, q: Pt, text: string, col: string, S: Theme, size = 8.5, off = 4): string {
  let ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  else if (ang < -90) ang += 180;
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  return `<text transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})" x="${mx.toFixed(1)}" y="${(my - off).toFixed(1)}"`
    + ` font-size="${size}" text-anchor="middle" fill="${col}" font-weight="600" font-family="${S.mono}"`
    + ` paint-order="stroke" stroke="${S.bg}" stroke-width="2.2" stroke-linejoin="round">${esc(text)}</text>`;
}

/**
 * Point at least `back` along the polyline behind the tip — used so arrowheads
 * orient on the final orthogonal stub even when the previous vertex is a bend.
 */
export function approachRef(pts: Pt[], back = ARROW + PATH_CORNER_R): Pt {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  let remain = back;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i], b = pts[i - 1];
    const len = Math.hypot(a.x - b.x, a.y - b.y);
    if (len < 1e-6) continue;
    if (len >= remain) {
      const t = remain / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remain -= len;
  }
  return pts[0]!;
}

/** Triangle at `tip`, oriented along the direction of travel from `from`. */
export function arrowHead(tip: Pt, from: Pt, col: string, size = ARROW): string {
  const dx = tip.x - from.x, dy = tip.y - from.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const bx = tip.x - ux * size, by = tip.y - uy * size, hw = size * 0.58;
  return `<path d="M ${tip.x.toFixed(1)},${tip.y.toFixed(1)} L ${(bx + px * hw).toFixed(1)},${(by + py * hw).toFixed(1)} L ${(bx - px * hw).toFixed(1)},${(by - py * hw).toFixed(1)} Z" fill="${col}"/>`;
}

export { ARROW, ARROW_MID, ENTRY_STUB, PATH_CORNER_R };

/** A vertical run of some other flow — what a horizontal run has to hop over. */
export interface VRun { x: number; y1: number; y2: number; }

/** Vertical runs of each route, indexed alongside `routes`. */
export function verticalRuns(routes: Pt[][]): VRun[][] {
  return routes.map((pts) => {
    const out: VRun[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) > 0.5)
        out.push({ x: p.x, y1: Math.min(p.y, q.y), y2: Math.max(p.y, q.y) });
    }
    return out;
  });
}

const JUMP_R = 5;

/**
 * Rounded orthogonal polyline. Cap radius so the final stub stays mostly
 * straight, and hop foreign verticals with a small arc.
 *
 * The jumps are not decoration. Colour identifies the SERVICE, so two flows of
 * one service are the same colour by design — at a plain crossing there is then
 * nothing to say which line continues where, and the diagram stops being
 * traceable exactly where a reader is trying to follow a rule. Keep them sparse
 * (horizontals hop verticals, never the reverse) — jump noise was the failure
 * mode of the original router.
 */
function path(pts: Pt[], r = PATH_CORNER_R, foreignV: VRun[] = []): string {
  let cur = pts[0];
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  const lineTo = (to: Pt): void => {
    if (Math.abs(to.y - cur.y) < 0.5 && Math.abs(to.x - cur.x) > 1 && foreignV.length) {
      const y = cur.y, l2r = to.x > cur.x;
      const lo = Math.min(cur.x, to.x), hi = Math.max(cur.x, to.x);
      const xs = [...new Set(
        foreignV.filter((v) => v.x > lo + JUMP_R && v.x < hi - JUMP_R && v.y1 + 1 < y && y < v.y2 - 1)
                .map((v) => v.x),
      )].sort((a, b) => (l2r ? a - b : b - a));
      for (const x of xs) {
        const back = l2r ? -JUMP_R : JUMP_R;
        d += ` L ${(x + back).toFixed(1)},${y.toFixed(1)}`;
        d += ` A ${JUMP_R},${JUMP_R} 0 0 ${l2r ? 1 : 0} ${(x - back).toFixed(1)},${y.toFixed(1)}`;
      }
    }
    d += ` L ${to.x.toFixed(1)},${to.y.toFixed(1)}`;
    cur = to;
  };
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], prev = pts[i - 1], next = pts[i + 1];
    const inD = { x: Math.sign(p.x - prev.x), y: Math.sign(p.y - prev.y) };
    const outD = { x: Math.sign(next.x - p.x), y: Math.sign(next.y - p.y) };
    // On the last corner, leave at least ARROW of straight run after the curve.
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const isLastCorner = i === pts.length - 2;
    const maxOutR = isLastCorner ? Math.max(0, (outLen - ARROW) / 2) : outLen / 2;
    const rr = Math.min(r, inLen / 2, maxOutR);
    lineTo({ x: p.x - inD.x * rr, y: p.y - inD.y * rr });
    d += ` Q ${p.x.toFixed(1)},${p.y.toFixed(1)} ${(p.x + outD.x * rr).toFixed(1)},${(p.y + outD.y * rr).toFixed(1)}`;
    cur = { x: p.x + outD.x * rr, y: p.y + outD.y * rr };
  }
  lineTo(pts[pts.length - 1]);
  return d;
}

export function renderModelTraffic(m: NetModel, themeName: string | Theme = "clean"): string {
  const S = typeof themeName === "string" ? resolveTheme(themeName) : themeName;
  const T = layoutTraffic(m, S);
  const { W, H, flows, routes, sockets, rows, color: svcColor, legend } = T;

  const out: string[] = [`<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" font-family="${S.font}">`];
  if (S.shadow)
    out.push('<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.2" flood-color="#0f172a" flood-opacity="0.16"/></filter></defs>');
  out.push(`<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="${S.bg}"/>`);
  if (S.grid)
    out.push(`<defs><pattern id="grd" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="${S.grid}" stroke-width="1"/></pattern></defs><rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="url(#grd)"/>`);

  // Each flow hops the OTHER flows' verticals, so a crossing always shows which
  // line is continuous — the only cue available when both are the same service.
  const allV = verticalRuns(routes);
  const foreignV = routes.map((_, i) => allV.flatMap((v, j) => (j === i ? [] : v)));

  // flows, under the cards
  flows.forEach((f, i) => {
    const col = svcColor(f), pts = routes[i], dash = T.dash(f);
    out.push(`<path d="${path(pts, PATH_CORNER_R, foreignV[i])}" fill="none" stroke="${col}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
    // OPEN ring = the end that opens the connection (see iso.ts for the rationale)
    out.push(`<circle cx="${pts[0].x.toFixed(1)}" cy="${pts[0].y.toFixed(1)}" r="4.5" fill="${S.bg}" stroke="${col}" stroke-width="2.25"/>`);
  });

  // socket chips (hosts with no declared services)
  for (const { svc, at: p, color: col } of sockets) {
    const tw = 6.4 * svc.length + 14;
    out.push(`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${(p.y + STUB).toFixed(1)}" stroke="${col}" stroke-width="2"/>`);
    out.push(`<rect x="${(p.x - tw / 2).toFixed(1)}" y="${(p.y + STUB).toFixed(1)}" width="${tw.toFixed(1)}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${S.bg}" stroke="${col}" stroke-width="1.5"/>`);
    out.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + STUB + 11.5).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="${col}" font-weight="700" font-family="${S.mono}">${esc(svc)}</text>`);
  }

  // host cards
  for (const d of m.devices) {
    const cx = d.x!, cy = d.y!, w = d.w!, h = d.h!, kc = KIND_COLOR[d.kind];
    const filt = S.shadow ? ' filter="url(#sh)"' : "";
    const x0 = cx - w / 2, y0 = cy - h / 2;
    const isContainer = !!d.services?.length;
    out.push(`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${w}" height="${h}" rx="${S.radius}" fill="${S.cardFill}" stroke="${S.cardStroke}" stroke-width="${S.cardStrokeW}"${filt}/>`);
    const gy = isContainer ? y0 + HEADER_H / 2 : cy;
    out.push(GLYPH[d.kind](x0 + 22, gy - (S.showMgmt && d.mgmt && !isContainer ? 7 : 0), 16, S.chipStroke ?? kc, "none", 1.4));
    out.push(`<text x="${(x0 + 42).toFixed(1)}" y="${gy.toFixed(1)}" font-size="12" fill="${S.text}" font-weight="700" dominant-baseline="middle">${esc(d.label)}</text>`);
    if (isContainer) {
      out.push(`<line x1="${x0.toFixed(1)}" y1="${(y0 + HEADER_H).toFixed(1)}" x2="${(x0 + w).toFixed(1)}" y2="${(y0 + HEADER_H).toFixed(1)}" stroke="${S.cardStroke}" stroke-width="1"/>`);
      out.push(`<text x="${(x0 + w - 10).toFixed(1)}" y="${gy.toFixed(1)}" font-size="8.5" text-anchor="end" fill="${S.sub}" font-family="${S.mono}" dominant-baseline="middle">${d.services!.length} SERVICES</text>`);
    } else if (S.showMgmt && d.mgmt) {
      out.push(`<text x="${(x0 + 42).toFixed(1)}" y="${(cy + 11).toFixed(1)}" font-size="9" fill="${S.sub}" font-family="${S.mono}">${esc(d.mgmt)}</text>`);
    }
  }

  // service rows, inside their container
  for (const r of rows) {
    out.push(`<rect x="${r.x.toFixed(1)}" y="${(r.y - ROW_H / 2 + 1).toFixed(1)}" width="${r.w.toFixed(1)}" height="${(ROW_H - 2).toFixed(1)}" rx="3" fill="${r.color}" fill-opacity="0.09"/>`);
    out.push(`<rect x="${r.x.toFixed(1)}" y="${(r.y - ROW_H / 2 + 1).toFixed(1)}" width="3" height="${(ROW_H - 2).toFixed(1)}" rx="1.5" fill="${r.color}"/>`);
    out.push(`<text x="${(r.x + 10).toFixed(1)}" y="${r.y.toFixed(1)}" font-size="10.5" fill="${S.text}" dominant-baseline="middle">${esc(r.name)}</text>`);
    out.push(`<text x="${(r.x + r.w - 6).toFixed(1)}" y="${r.y.toFixed(1)}" font-size="9.5" text-anchor="end" fill="${r.color}" font-weight="700" font-family="${S.mono}" dominant-baseline="middle">${esc(r.svcKey)}</text>`);
  }

  // arrowheads last, so they sit above the cards they point into.
  // Orient from a point walked back along the final stub (not just the previous
  // vertex), so a short post-bend segment still reads as a square approach.
  flows.forEach((f, i) => {
    const pts = routes[i];
    const tip = pts[pts.length - 1]!;
    out.push(arrowHead(tip, approachRef(pts), svcColor(f)));
  });

  // ---- legend ----
  const ly = H - 62;
  out.push(`<text x="${MARGIN}" y="${ly}" font-size="11" fill="${S.sub}" font-weight="700" font-family="${S.mono}" letter-spacing="1">SERVICES</text>`);
  let lx = MARGIN + 88, lrow = 0;
  for (const { svc, label, color: col, dash } of legend) {
    const t = label ? `${svc} · ${label}` : svc;
    const wNeeded = 40 + textW(t, 10.5);
    if (lx + wNeeded > W - MARGIN) { lx = MARGIN + 88; lrow++; }
    const y = ly + lrow * 15;
    out.push(`<line x1="${lx.toFixed(1)}" y1="${(y - 3.5).toFixed(1)}" x2="${(lx + 20).toFixed(1)}" y2="${(y - 3.5).toFixed(1)}" stroke="${col}" stroke-width="3.2" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
    out.push(`<text x="${(lx + 26).toFixed(1)}" y="${y.toFixed(1)}" font-size="10" fill="${S.sub}" font-family="${S.mono}">${esc(t)}</text>`);
    lx += wNeeded;
  }
  out.push(`<text x="${MARGIN}" y="${(ly + lrow * 15 + 24).toFixed(1)}" font-size="10" fill="${S.sub}" font-family="${S.mono}">○ OPENS THE CONNECTION · ARROWHEAD LANDS ON THE LISTENING ROW/PORT · SO INBOUND AND OUTBOUND ARE BOTH READABLE FROM ONE LINE</text>`);

  out.push(`<text x="${MARGIN}" y="${(MARGIN - 46).toFixed(1)}" font-size="14" fill="${S.text}" font-weight="700" letter-spacing="0.4">${esc(m.title)}</text>`);
  out.push(`<text x="${MARGIN}" y="${(MARGIN - 28).toFixed(1)}" font-size="10" fill="${S.sub}" font-family="${S.mono}" letter-spacing="1">TRAFFIC · L4 FLOWS · ${m.devices.length} HOSTS · ${flows.length} FLOWS · ${legend.length} SERVICES</text>`);

  out.push("</svg>");
  return out.join("\n");
}
