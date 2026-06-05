/** NetScript renderer — positioned model + theme → SVG string. */
import type { NetModel, Link, Speed } from "./model.ts";
import { escapeXml as esc, top, bottom } from "./model.ts";
import type { Theme } from "./themes.ts";
import { resolveTheme } from "./themes.ts";
import { GLYPH, KIND_COLOR } from "./glyphs.ts";
import { layoutModel } from "./layout.ts";
import { buildRoutes, segments, offsetPts, pathD } from "./router.ts";

const SPEED_ORDER: Speed[] = ["1G", "10G", "25G", "40G", "100G", "LAG"];

export function renderModel(m: NetModel, themeName: string | Theme = "clean"): string {
  const S = typeof themeName === "string" ? resolveTheme(themeName) : themeName;
  const { W, H, zones } = layoutModel(m);
  const id = new Map(m.devices.map((d) => [d.id, d]));
  const routes = buildRoutes(m);
  const allSegs = routes.map((p) => segments(p));
  const out: string[] = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="${S.font}">`];

  if (S.shadow)
    out.push('<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.2" flood-color="#0f172a" flood-opacity="0.16"/></filter></defs>');
  out.push(`<rect width="${W}" height="${H}" fill="${S.bg}"/>`);
  if (S.grid)
    out.push(`<defs><pattern id="grd" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="${S.grid}" stroke-width="1"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#grd)"/>`);

  // zones
  for (const z of zones) {
    out.push(`<rect x="${z.x.toFixed(1)}" y="${z.y.toFixed(1)}" width="${z.w.toFixed(1)}" height="${z.h.toFixed(1)}" rx="13" fill="${S.zoneFill}" stroke="${S.zoneStroke}" stroke-width="1.2"/>`);
    out.push(`<text x="${(z.x + 6).toFixed(1)}" y="${(z.y - 7).toFixed(1)}" font-size="11.5" fill="${S.zoneText}" font-weight="700" letter-spacing="1.8" font-family="${S.mono}">${esc(z.label)}</text>`);
  }

  // links
  m.links.forEach((l, i) => {
    const col = S.speedColor[l.speed] ?? S.link;
    const lw = S.linkW * (l.speed === "100G" ? 1.7 : 1);
    if (l.bond) {
      for (const off of [-2.4, 2.4])
        out.push(`<path d="${pathD(offsetPts(routes[i], off), i, allSegs, S.jumps)}" fill="none" stroke="${col}" stroke-width="${S.linkW}" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else {
      out.push(`<path d="${pathD(routes[i], i, allSegs, S.jumps)}" fill="none" stroke="${col}" stroke-width="${lw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    if (S.endDots) for (const e of [routes[i][0], routes[i][routes[i].length - 1]])
      out.push(`<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="2.3" fill="${col}"/>`);
  });

  // speed pills (trunk links + LAG tags) — intra-rack speed is carried by colour + legend
  const pill = (mx: number, my: number, label: string, col: string) => {
    const tw = 7.0 * label.length + 12;
    if (S.pill) out.push(`<rect x="${(mx - tw / 2).toFixed(1)}" y="${(my - 9).toFixed(1)}" width="${tw.toFixed(1)}" height="16" rx="8" fill="${S.pillFill}" stroke="${S.pillStroke}" stroke-width="1"/>`);
    out.push(`<text x="${mx.toFixed(1)}" y="${(my + 2).toFixed(1)}" font-size="10" text-anchor="middle" fill="${S.speedText || col}" font-weight="600" font-family="${S.mono}">${esc(label)}</text>`);
  };
  m.links.forEach((l, i) => {
    const col = S.speedColor[l.speed] ?? S.link, pts = routes[i];
    if (l.klass === "e2c") { const p = pts[pts.length - 2], q = pts[pts.length - 1]; pill(q.x, (p.y + q.y) / 2, l.speed, col); }
    else if (l.klass === "peer") { const p = pts[0], q = pts[1]; pill((p.x + q.x) / 2, p.y, "100G", col); }
    else if (l.klass === "wan") { const p = pts[0], q = pts[1]; pill((p.x + q.x) / 2, (p.y + q.y) / 2, "WAN", col); }
    if (l.bond) { const p = pts[pts.length - 2], q = pts[pts.length - 1]; pill(q.x, (p.y + q.y) / 2 + 14, "LAG", S.speedColor.LAG); }
  });

  // nodes
  for (const d of m.devices) {
    const cx = d.x!, cy = d.y!, w = d.w!, h = d.h!, kc = KIND_COLOR[d.kind];
    const filt = S.shadow ? ' filter="url(#sh)"' : "";
    out.push(`<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="${S.radius}" fill="${S.cardFill}" stroke="${S.cardStroke}" stroke-width="${S.cardStrokeW}"${filt}/>`);
    const gx = cx - w / 2 + 19;
    const hasMgmt = S.showMgmt && !!d.mgmt;   // only managed gear carries one
    out.push(GLYPH[d.kind](gx, cy - (hasMgmt ? 6 : 0), 15, S.chipStroke ?? kc, "none", 1.4));
    const ty = hasMgmt ? cy - 4 : cy + 1;
    out.push(`<text x="${(gx + 15).toFixed(1)}" y="${ty.toFixed(1)}" font-size="11.5" fill="${S.text}" font-weight="600" dominant-baseline="middle">${esc(d.label)}</text>`);
    if (hasMgmt) out.push(`<text x="${(gx + 15).toFixed(1)}" y="${(cy + 10).toFixed(1)}" font-size="9" fill="${S.sub}" font-family="${S.mono}">${esc(d.mgmt!)}</text>`);
  }

  // legend (speeds actually present)
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

  if (S.titleBlock) {
    const nodes = m.devices.length, links = m.links.length;
    out.push(`<rect x="${W - 252}" y="${H - 70}" width="236" height="54" fill="none" stroke="${S.cardStroke}" stroke-width="1.1"/>`);
    out.push(`<line x1="${W - 252}" y1="${H - 50}" x2="${W - 16}" y2="${H - 50}" stroke="${S.cardStroke}" stroke-width="1.1"/>`);
    out.push(`<text x="${W - 244}" y="${H - 55}" font-size="9.5" fill="${S.sub}" font-family="${S.mono}" letter-spacing="1">${esc(m.title.toUpperCase())} · PHYSICAL L1</text>`);
    out.push(`<text x="${W - 244}" y="${H - 34}" font-size="9" fill="${S.sub}" font-family="${S.mono}">${nodes} NODES · ${links} LINKS · REV A · NTS</text>`);
  }

  out.push("</svg>");
  return out.join("\n");
}
