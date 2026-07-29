/** Vendor-neutral device glyphs. Each returns an SVG fragment string. */
import type { Kind } from "./model.ts";

type GlyphFn = (cx: number, cy: number, s: number, st: string, fill: string, sw: number) => string;

const router: GlyphFn = (cx, cy, s, st, fill, sw) => {
  const r = s * 0.5;
  let out = `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
  const a = s * 0.3;
  for (const [tx, ty, dxn, dyn] of [[-a,0,1,0],[a,0,-1,0],[0,-a,0,1],[0,a,0,-1]] as const) {
    const x = cx + tx, y = cy + ty, hb = s * 0.12;
    out += `<line x1="${(cx+tx*0.2).toFixed(1)}" y1="${(cy+ty*0.2).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
    out += `<path d="M ${x.toFixed(1)},${y.toFixed(1)} l ${(-dxn*hb - dyn*hb*0.7).toFixed(1)},${(-dyn*hb - dxn*hb*0.7).toFixed(1)} M ${x.toFixed(1)},${y.toFixed(1)} l ${(-dxn*hb + dyn*hb*0.7).toFixed(1)},${(-dyn*hb + dxn*hb*0.7).toFixed(1)}" stroke="${st}" stroke-width="${sw}" fill="none"/>`;
  }
  return out;
};

const sw_switch: GlyphFn = (cx, cy, s, st, fill, sw) => {
  const w = s * 1.25, h = s * 0.62;
  let out = `<rect x="${(cx-w/2).toFixed(1)}" y="${(cy-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
  for (const [yy, dirn] of [[-h*0.22,1],[h*0.22,-1]] as const) {
    const y = cy + yy;
    out += `<line x1="${(cx-w*0.32).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(cx+w*0.32).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
    const tipx = cx + dirn * w * 0.32;
    out += `<path d="M ${tipx.toFixed(1)},${y.toFixed(1)} l ${(-dirn*s*0.13).toFixed(1)},${(-s*0.09).toFixed(1)} M ${tipx.toFixed(1)},${y.toFixed(1)} l ${(-dirn*s*0.13).toFixed(1)},${(s*0.09).toFixed(1)}" stroke="${st}" stroke-width="${sw}" fill="none"/>`;
  }
  return out;
};

const server: GlyphFn = (cx, cy, s, st, fill, sw) => {
  const w = s * 0.78, h = s * 1.05;
  let out = `<rect x="${(cx-w/2).toFixed(1)}" y="${(cy-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
  for (const k of [-1,0,1]) {
    const y = cy + k * h * 0.26;
    out += `<line x1="${(cx-w*0.32).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(cx+w*0.18).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
    out += `<circle cx="${(cx+w*0.30).toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(1.2,sw).toFixed(1)}" fill="${st}"/>`;
  }
  return out;
};

const storage: GlyphFn = (cx, cy, s, st, fill, sw) => {
  const w = s * 1.0, rh = s * 0.26; let out = "";
  for (const k of [-1,0,1]) {
    const y = cy + k * (rh + 2);
    out += `<rect x="${(cx-w/2).toFixed(1)}" y="${(y-rh/2).toFixed(1)}" width="${w.toFixed(1)}" height="${rh.toFixed(1)}" rx="3" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
    out += `<circle cx="${(cx+w*0.34).toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(1.2,sw).toFixed(1)}" fill="${st}"/>`;
  }
  return out;
};

const firewall: GlyphFn = (cx, cy, s, st, fill, sw) => {
  const w = s * 1.2, h = s * 0.9;
  let out = `<rect x="${(cx-w/2).toFixed(1)}" y="${(cy-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
  // brick courses
  out += `<line x1="${(cx-w/2).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx+w/2).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
  out += `<line x1="${cx.toFixed(1)}" y1="${(cy-h/2).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
  out += `<line x1="${(cx-w*0.25).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx-w*0.25).toFixed(1)}" y2="${(cy+h/2).toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
  out += `<line x1="${(cx+w*0.25).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx+w*0.25).toFixed(1)}" y2="${(cy+h/2).toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
  return out;
};

const ap: GlyphFn = (cx, cy, s, st, fill, sw) => {
  const bw = s * 0.9, bh = s * 0.4, by = cy + s * 0.45;
  let out = `<rect x="${(cx-bw/2).toFixed(1)}" y="${(by-bh/2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
  for (const i of [1,2,3]) {
    const rr = s * 0.22 * i;
    out += `<path d="M ${(cx-rr).toFixed(1)},${(by-bh*0.6).toFixed(1)} A ${rr.toFixed(1)},${rr.toFixed(1)} 0 0 1 ${(cx+rr).toFixed(1)},${(by-bh*0.6).toFixed(1)}" fill="none" stroke="${st}" stroke-width="${sw}"/>`;
  }
  return out;
};

const desktop: GlyphFn = (cx, cy, s, st, fill, sw) => {
  const w = s * 1.15, h = s * 0.78;
  let out = `<rect x="${(cx-w/2).toFixed(1)}" y="${(cy-h/2-s*0.1).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
  out += `<line x1="${cx.toFixed(1)}" y1="${(cy+h/2-s*0.1).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy+h/2+s*0.12).toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
  out += `<line x1="${(cx-w*0.25).toFixed(1)}" y1="${(cy+h/2+s*0.12).toFixed(1)}" x2="${(cx+w*0.25).toFixed(1)}" y2="${(cy+h/2+s*0.12).toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
  return out;
};

/** Fixed-lens box camera on a wall mount — the physical-security endpoint. */
const camera: GlyphFn = (cx, cy, s, st, fill, sw) => {
  const bw = s * 1.05, bh = s * 0.6, bx = cx - bw * 0.42, by = cy - bh / 2;
  let out = `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
  // lens barrel on the front face
  out += `<rect x="${(bx + bw).toFixed(1)}" y="${(cy - bh * 0.28).toFixed(1)}" width="${(s * 0.2).toFixed(1)}" height="${(bh * 0.56).toFixed(1)}" rx="1" fill="${fill}" stroke="${st}" stroke-width="${sw}"/>`;
  // mount arm + ceiling plate
  out += `<line x1="${(bx + bw * 0.3).toFixed(1)}" y1="${by.toFixed(1)}" x2="${(bx + bw * 0.3).toFixed(1)}" y2="${(by - s * 0.26).toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
  out += `<line x1="${(bx + bw * 0.05).toFixed(1)}" y1="${(by - s * 0.26).toFixed(1)}" x2="${(bx + bw * 0.55).toFixed(1)}" y2="${(by - s * 0.26).toFixed(1)}" stroke="${st}" stroke-width="${sw}"/>`;
  return out;
};

const CLOUD = "M54,40 H14 C6.3,40 0,33.7 0,26 0,18.8 5.4,12.9 12.4,12.1 14.7,5.1 21.3,0 29,0 c8,0 14.7,5.5 16.6,12.9 C53.4,13.6 64,18.3 64,26 64,33.7 60.6,40 54,40 Z";
const cloud: GlyphFn = (cx, cy, s, st, fill, sw) => {
  const scale = (s * 1.6) / 64, tx = cx - 32 * scale, ty = cy - 20 * scale;
  return `<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${scale.toFixed(3)})"><path d="${CLOUD}" fill="${fill}" stroke="${st}" stroke-width="${(sw/scale).toFixed(2)}"/></g>`;
};

export const GLYPH: Record<Kind, GlyphFn> = {
  cloud, router, firewall, switch: sw_switch, server, storage, ap, desktop, camera,
};

export const KIND_COLOR: Record<Kind, string> = {
  cloud: "#64748b", router: "#2563eb", firewall: "#b91c1c", switch: "#0d9488",
  server: "#4f46e5", storage: "#7c3aed", ap: "#ea580c", desktop: "#475569",
  camera: "#0891b2",
};
