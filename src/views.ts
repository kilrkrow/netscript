/**
 * NetScript view selection — two INDEPENDENT axes.
 *
 *   view        WHAT is drawn   · topology (devices + cabling) | traffic (L4 flows)
 *   projection  HOW it's drawn  · flat (2D) | iso (isometric)
 *
 * These are deliberately orthogonal: isometric is a projection of a scene, not
 * a kind of scene, so every combination is valid and supported. Layer choice
 * *within* the topology view (physical vs logical vs hybrid) is a third,
 * separate thing carried by the theme's `mode` — see themes.ts.
 *
 *     topology + flat   the documentation default
 *     topology + iso    the same layout, projected
 *     traffic  + flat   service-coloured flows, initiator → listener
 *     traffic  + iso    the same flows, projected
 */
import type { NetModel } from "./model.ts";
import type { Theme } from "./themes.ts";
import { renderModel } from "./render.ts";
import { renderModelIso, renderTrafficIso } from "./iso.ts";
import { renderModelTraffic } from "./traffic.ts";

export type View = "topology" | "traffic";
export type Projection = "flat" | "iso";

export const VIEWS: View[] = ["topology", "traffic"];
export const PROJECTIONS: Projection[] = ["flat", "iso"];

const TABLE: Record<View, Record<Projection, (m: NetModel, t: string | Theme) => string>> = {
  topology: { flat: renderModel, iso: renderModelIso },
  traffic: { flat: renderModelTraffic, iso: renderTrafficIso },
};

export interface RenderOptions {
  theme?: string | Theme;
  view?: View;
  projection?: Projection;
}

/** Render a model through the chosen view × projection. Throws on bad input. */
export function renderView(m: NetModel, opts: RenderOptions = {}): string {
  const view = opts.view ?? "topology";
  const projection = opts.projection ?? "flat";
  if (!VIEWS.includes(view)) throw new Error(`unknown view "${view}" (have: ${VIEWS.join(", ")})`);
  if (!PROJECTIONS.includes(projection)) throw new Error(`unknown projection "${projection}" (have: ${PROJECTIONS.join(", ")})`);
  if (view === "traffic" && !m.flows?.length)
    throw new Error('view "traffic" needs at least one flow; the model declares none');
  return TABLE[view][projection](m, opts.theme ?? m.theme ?? "clean");
}
