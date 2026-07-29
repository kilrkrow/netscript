/** NetScript renderer — positioned model + theme → SVG string. */
import type { NetModel, Speed, Pt } from "./model.ts";
import { escapeXml as esc } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveTheme } from "./themes.ts";
import { GLYPH, KIND_COLOR } from "./glyphs.ts";
import { layoutModel } from "./layout.ts";
import { buildRoutes, segments, offsetPts, pathD } from "./router.ts";
import {
  vlanColorIndex, vlansOnLink, bondKey, portOf, bondForPort,
} from "./logical.ts";
import { layoutTubes, drawTubesSvg, expandHeightForTubes, hasTubes, segmentAnnotatedPorts } from "./tube.ts";

const SPEED_ORDER: Speed[] = ["1G", "10G", "25G", "40G", "100G", "LAG"];

/** Unit direction of the segment that leaves an endpoint (toward the device). */
function endDir(pts: Pt[], which: "a" | "b"): Pt {
  const [p, q] = which === "a" ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]];
  const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export function renderModel(m: NetModel, themeName: string | Theme = "clean"): string {
  const S = typeof themeName === "string" ? resolveTheme(themeName) : themeName;
  const mode = S.mode ?? "physical";
  const logical = mode === "logical" || mode === "hybrid";
  const showCables = mode !== "logical"; // logical hides raw cabling; hybrid keeps it
  const laid = layoutModel(m);
  let { W, H, zones } = laid;
  const id = new Map(m.devices.map((d) => [d.id, d]));
  const routes = buildRoutes(m);
  const allSegs = routes.map((p) => segments(p));

  // logical projection (only computed when needed)
  const vlanIdx = logical ? vlanColorIndex(m) : new Map<number, number>();
  const vpal = S.vlanPalette ?? ["#2563eb"];
  const vlanColor = (vid: number) => vpal[(vlanIdx.get(vid) ?? 0) % vpal.length];

  // Ethernet tubes: explicit segments, or derived from VLANs-with-subnet in
  // logical/hybrid. Physical-only models still draw tubes if authored.
  const drawTubeLayer = hasTubes(m) && (logical || !!m.segments?.length);
  const tubeColor = (i: number) => vpal[i % vpal.length];
  const tubePack = drawTubeLayer
    ? layoutTubes(m, tubeColor)
    : { tubes: [] as ReturnType<typeof layoutTubes>["tubes"], bottom: 0, padL: 0, padR: 0 };
  const shiftX = tubePack.padL ?? 0;
  if (tubePack.tubes.length) {
    H = expandHeightForTubes(H, tubePack);
    const minX = Math.min(...tubePack.tubes.map((t) => t.x1));
    const maxX = Math.max(...tubePack.tubes.map((t) => t.x2));
    // Infinite paper: grow for side risers, tube extent, and callout text.
    W = Math.max(W, maxX + 24) - Math.min(0, minX - 24);
    W += shiftX + (tubePack.padR ?? 0);
  }

  const out: string[] = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="${S.font}">`];

  if (S.shadow)
    out.push('<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.2" flood-color="#0f172a" flood-opacity="0.16"/></filter></defs>');
  out.push(`<rect width="${W}" height="${H}" fill="${S.bg}"/>`);
  if (S.grid)
    out.push(`<defs><pattern id="grd" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="${S.grid}" stroke-width="1"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#grd)"/>`);

  // Shift content when left risers need margin (topology coords stay layout-native).
  if (shiftX) out.push(`<g transform="translate(${shiftX},0)">`);

  // zones
  for (const z of zones) {
    out.push(`<rect x="${z.x.toFixed(1)}" y="${z.y.toFixed(1)}" width="${z.w.toFixed(1)}" height="${z.h.toFixed(1)}" rx="13" fill="${S.zoneFill}" stroke="${S.zoneStroke}" stroke-width="1.2"/>`);
    out.push(`<text x="${(z.x + 6).toFixed(1)}" y="${(z.y - 7).toFixed(1)}" font-size="11.5" fill="${S.zoneText}" font-weight="700" letter-spacing="1.8" font-family="${S.mono}">${esc(z.label)}</text>`);
  }

  // ---- links ----
  // In logical/hybrid we colour by VLAN and collapse bonded member pairs into a
  // single logical link; in physical we keep the v0.1 speed-coloured cabling.
  const drawnBond = new Set<string>();
  m.links.forEach((l, i) => {
    const vlans = logical ? vlansOnLink(m, l) : [];
    const bk = logical ? bondKey(m, l) : null;

    if (logical && bk) {
      if (drawnBond.has(bk)) return;       // collapse: draw the bond once
      drawnBond.add(bk);
    }

    // colour: physical → speed; logical → first VLAN (else fall back to speed)
    const col = logical && vlans.length ? vlanColor(vlans[0].id) : (S.speedColor[l.speed] ?? S.link);
    const isBond = l.bond || (logical && !!bk);
    const lw = S.linkW * (l.speed === "100G" ? 1.7 : 1) * (logical && isBond ? 1.5 : 1);

    if (!showCables && !logical) return;

    if (isBond && !logical) {
      // physical bond: offset parallel pair
      for (const off of [-2.4, 2.4])
        out.push(`<path d="${pathD(offsetPts(routes[i], off), i, allSegs, S.jumps)}" fill="none" stroke="${col}" stroke-width="${S.linkW}" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else if (logical && bk) {
      // logical: single thicker link for the whole bond
      out.push(`<path d="${pathD(routes[i], i, allSegs, S.jumps)}" fill="none" stroke="${col}" stroke-width="${lw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${mode === "hybrid" ? 0.92 : 1}"/>`);
    } else {
      out.push(`<path d="${pathD(routes[i], i, allSegs, S.jumps)}" fill="none" stroke="${col}" stroke-width="${lw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${mode === "hybrid" && vlans.length ? 0.92 : 1}"/>`);
    }
    if (S.endDots && showCables) for (const e of [routes[i][0], routes[i][routes[i].length - 1]])
      out.push(`<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="2.3" fill="${col}"/>`);
  });

  // ---- speed / tag pills (physical + hybrid keep trunk speeds) ----
  const pill = (mx: number, my: number, label: string, col: string, fill = S.pillFill, stroke = S.pillStroke, txtCol = S.speedText || col) => {
    const tw = 7.0 * label.length + 12;
    if (S.pill || fill !== S.pillFill) out.push(`<rect x="${(mx - tw / 2).toFixed(1)}" y="${(my - 9).toFixed(1)}" width="${tw.toFixed(1)}" height="16" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`);
    out.push(`<text x="${mx.toFixed(1)}" y="${(my + 2).toFixed(1)}" font-size="10" text-anchor="middle" fill="${txtCol}" font-weight="600" font-family="${S.mono}">${esc(label)}</text>`);
  };
  if (mode !== "logical") {
    m.links.forEach((l, i) => {
      const col = S.speedColor[l.speed] ?? S.link, pts = routes[i];
      if (l.klass === "e2c") { const p = pts[pts.length - 2], q = pts[pts.length - 1]; pill(q.x, (p.y + q.y) / 2, l.speed, col); }
      else if (l.klass === "peer") { const p = pts[0], q = pts[1]; pill((p.x + q.x) / 2, p.y, "100G", col); }
      else if (l.klass === "wan") { const p = pts[0], q = pts[1]; pill((p.x + q.x) / 2, (p.y + q.y) / 2, "WAN", col); }
      if (l.bond) { const p = pts[pts.length - 2], q = pts[pts.length - 1]; pill(q.x, (p.y + q.y) / 2 + 14, "LAG", S.speedColor.LAG); }
    });
  }

  // ---- port callouts (PHYSICAL documentation; on whenever portCallouts) ----
  // A small chip with the port name sits just outside the device where the
  // cable lands. Skipped in pure-logical (cabling is hidden there).
  // Visio rule: if this port already has a segment/tube callout (eth3 / .1 on
  // the object→bus drop), do NOT also chip it on the L1 cable — one fact, one mark.
  if (S.portCallouts && mode !== "logical") {
    const segPorts = tubePack.tubes.length ? segmentAnnotatedPorts(m) : new Set<string>();
    const calloutChip = (anchor: Pt, dir: Pt, name: string, accent: string, sub?: string) => {
      const cx = anchor.x - dir.x * 14, cy = anchor.y - dir.y * 14;
      const tw = Math.max(18, 6.2 * name.length + 8);
      out.push(`<rect x="${(cx - tw / 2).toFixed(1)}" y="${(cy - 7).toFixed(1)}" width="${tw.toFixed(1)}" height="13" rx="3" fill="${S.bg}" stroke="${accent}" stroke-width="1"/>`);
      out.push(`<text x="${cx.toFixed(1)}" y="${(cy + 2.5).toFixed(1)}" font-size="8" text-anchor="middle" fill="${accent}" font-weight="700" font-family="${S.mono}">${esc(name)}</text>`);
      if (sub) out.push(`<text x="${cx.toFixed(1)}" y="${(cy + 13).toFixed(1)}" font-size="7.5" text-anchor="middle" fill="${S.sub}" font-family="${S.mono}">${esc(sub)}</text>`);
    };
    m.links.forEach((l, i) => {
      const pts = routes[i];
      for (const which of ["a", "b"] as const) {
        const devId = which === "a" ? l.a : l.b;
        const portId = which === "a" ? l.aPort : l.bPort;
        const p = portOf(m, devId, portId);
        if (!p) continue;
        if (portId && segPorts.has(`${devId}.${portId}`)) continue;
        const anchor = which === "a" ? pts[0] : pts[pts.length - 1];
        const dir = endDir(pts, which);
        const bond = logical ? bondForPort(m, devId, portId) : undefined;
        const accent = bond ? (S.speedColor.LAG) : (S.chipStroke ?? S.sub);
        const sub = logical ? (p.addr ?? (bond ? bond.id : undefined)) : undefined;
        calloutChip(anchor, dir, p.name, accent, sub);
      }
    });
  }

  // ---- Ethernet tubes (under cards so drops tuck under device bottoms) ----
  if (tubePack.tubes.length) out.push(...drawTubesSvg(tubePack.tubes, S));

  // ---- nodes ----
  // Label must fit inside the card: size comes from layout; still ellipsize as a belt.
  const fitInBox = (label: string, maxW: number, px = 11.5): string => {
    const charW = px * 0.58;
    const maxChars = Math.max(1, Math.floor(maxW / charW));
    if (label.length <= maxChars) return label;
    if (maxChars <= 1) return "…";
    return label.slice(0, maxChars - 1) + "…";
  };
  for (const d of m.devices) {
    const cx = d.x!, cy = d.y!, w = d.w!, h = d.h!, kc = KIND_COLOR[d.kind];
    const filt = S.shadow ? ' filter="url(#sh)"' : "";
    const x0 = cx - w / 2, y0 = cy - h / 2;
    const clipId = `c_${d.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    out.push(`<clipPath id="${clipId}"><rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${w}" height="${h}" rx="${S.radius}"/></clipPath>`);
    out.push(`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${w}" height="${h}" rx="${S.radius}" fill="${S.cardFill}" stroke="${S.cardStroke}" stroke-width="${S.cardStrokeW}"${filt}/>`);
    const gx = x0 + 19;
    const hasMgmt = S.showMgmt && !!d.mgmt;   // only managed gear carries one
    const textMax = w - 38; // chrome: glyph + right pad
    const label = fitInBox(d.label, textMax);
    out.push(`<g clip-path="url(#${clipId})">`);
    out.push(GLYPH[d.kind](gx, cy - (hasMgmt ? 6 : 0), 15, S.chipStroke ?? kc, "none", 1.4));
    const ty = hasMgmt ? cy - 4 : cy + 1;
    out.push(`<text x="${(gx + 15).toFixed(1)}" y="${ty.toFixed(1)}" font-size="11.5" fill="${S.text}" font-weight="600" dominant-baseline="middle">${esc(label)}</text>`);
    if (hasMgmt) {
      const mgmt = fitInBox(d.mgmt!, textMax, 9);
      out.push(`<text x="${(gx + 15).toFixed(1)}" y="${(cy + 10).toFixed(1)}" font-size="9" fill="${S.sub}" font-family="${S.mono}">${esc(mgmt)}</text>`);
    }
    out.push(`</g>`);
  }

  // ---- logical overlay: bond brackets (+ optional VLAN badges when no tubes) ----
  if (logical) {
    // Bond bracket + logical interface name at the owning device.
    for (const bnd of m.bonds ?? []) {
      const dev = id.get(bnd.device);
      if (!dev) continue;
      const bx = dev.x! - dev.w! / 2 - 8, by = dev.y!;
      out.push(`<path d="M ${bx.toFixed(1)},${(by - 12).toFixed(1)} q -5,0 -5,5 v 14 q 0,5 5,5" fill="none" stroke="${S.speedColor.LAG}" stroke-width="1.4"/>`);
      const lbl = bnd.mode ? `${bnd.id} · ${bnd.mode}` : bnd.id;
      const tw = 6.6 * lbl.length + 10;
      out.push(`<rect x="${(bx - 10 - tw).toFixed(1)}" y="${(by - 7).toFixed(1)}" width="${tw.toFixed(1)}" height="15" rx="7" fill="${S.bg}" stroke="${S.speedColor.LAG}" stroke-width="1"/>`);
      out.push(`<text x="${(bx - 10 - tw / 2).toFixed(1)}" y="${(by + 3.5).toFixed(1)}" font-size="9" text-anchor="middle" fill="${S.speedColor.LAG}" font-weight="700" font-family="${S.mono}">${esc(lbl)}</text>`);
    }

    // When tubes are drawn, the bus *is* the subnet badge — skip floating
    // VLAN pills so we don't double-label the same segment.
    if (!tubePack.tubes.length) {
      for (const v of m.vlans ?? []) {
        const col = vlanColor(v.id);
        const pts: Pt[] = [];
        for (const mem of v.members) {
          const dev = id.get(mem.device);
          if (dev) pts.push({ x: dev.x!, y: dev.y! });
        }
        if (!pts.length) continue;
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const lbl = v.subnet ? `VLAN ${v.id} · ${v.subnet}` : `VLAN ${v.id} · ${v.name}`;
        const tw = 6.4 * lbl.length + 16;
        out.push(`<rect x="${(cx - tw / 2).toFixed(1)}" y="${(cy - 9).toFixed(1)}" width="${tw.toFixed(1)}" height="18" rx="9" fill="${S.bg}" stroke="${col}" stroke-width="1.3" fill-opacity="0.96"/>`);
        out.push(`<circle cx="${(cx - tw / 2 + 11).toFixed(1)}" cy="${cy.toFixed(1)}" r="3.4" fill="${col}"/>`);
        out.push(`<text x="${(cx + 6).toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="${S.text}" font-weight="600" font-family="${S.mono}">${esc(lbl)}</text>`);
      }
    }
  }

  // ---- legend ----
  if (logical && (m.vlans?.length ?? 0)) {
    // VLAN legend
    let lx = 110; const ly = H - 35;
    out.push(`<text x="${lx}" y="${ly}" font-size="11" fill="${S.sub}" font-weight="700" font-family="${S.mono}">VLANS</text>`);
    let x = lx + 64;
    for (const v of [...(m.vlans ?? [])].sort((a, b) => a.id - b.id)) {
      const c = vlanColor(v.id);
      const t = `${v.id} ${v.name}`;
      out.push(`<line x1="${x}" y1="${ly - 3}" x2="${x + 22}" y2="${ly - 3}" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/>`);
      out.push(`<text x="${x + 28}" y="${ly}" font-size="10" fill="${S.sub}" font-family="${S.mono}">${esc(t)}</text>`);
      x += 34 + 6.4 * t.length;
    }
  } else {
    // physical speed legend
    const present = SPEED_ORDER.filter((s) => m.links.some((l) => l.speed === s) || (s === "LAG" && m.links.some((l) => l.bond)));
    let lx = 110; const ly = H - 35;
    out.push(`<text x="${lx}" y="${ly}" font-size="11" fill="${S.sub}" font-weight="700" font-family="${S.mono}">LINK SPEED</text>`);
    let x = lx + 92;
    for (const sp of present) {
      const c = S.speedColor[sp];
      out.push(`<line x1="${x}" y1="${ly - 3}" x2="${x + 24}" y2="${ly - 3}" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>`);
      out.push(`<text x="${x + 30}" y="${ly}" font-size="10.5" fill="${S.sub}" font-family="${S.mono}">${sp}</text>`);
      x += 92;
    }
  }

  if (S.titleBlock) {
    const nodes = m.devices.length, links = m.links.length;
    const tubesN = tubePack.tubes.length;
    const layerTag = mode === "logical" ? "LOGICAL L2/L3" : mode === "hybrid" ? "HYBRID L1+L2/L3" : "PHYSICAL L1";
    const tubeTag = tubesN ? ` · ${tubesN} TUBE${tubesN === 1 ? "" : "S"}` : "";
    // Title block is in content space (inside the shift group when present).
    const tbX = W - shiftX - 252;
    out.push(`<rect x="${tbX}" y="${H - 70}" width="236" height="54" fill="none" stroke="${S.cardStroke}" stroke-width="1.1"/>`);
    out.push(`<line x1="${tbX}" y1="${H - 50}" x2="${W - shiftX - 16}" y2="${H - 50}" stroke="${S.cardStroke}" stroke-width="1.1"/>`);
    out.push(`<text x="${tbX + 8}" y="${H - 55}" font-size="9.5" fill="${S.sub}" font-family="${S.mono}" letter-spacing="1">${esc(m.title.toUpperCase())} · ${layerTag}</text>`);
    out.push(`<text x="${tbX + 8}" y="${H - 34}" font-size="9" fill="${S.sub}" font-family="${S.mono}">${nodes} NODES · ${links} LINKS${tubeTag} · REV A · NTS</text>`);
  }

  if (shiftX) out.push("</g>");
  out.push("</svg>");
  return out.join("\n");
}
