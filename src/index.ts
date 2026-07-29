/**
 * NetScript — public API.
 *
 *   import { renderModel } from "@kilrkrow/netscript";
 *   const svg = renderModel(model, "blueprint");
 *
 * Pipeline: model → layout → router → render. Renderers are pure views over a
 * positioned model, so the same source can be drawn in any theme.
 */
export type { NetModel, Device, Link, Rack, Vlan, Bond, Port, Flow, Proto, Kind, Tier, Speed, Pt, Segment, SegmentMember } from "./model.ts";
export { serviceKey } from "./model.ts";
export type { Theme } from "./themes.ts";
export { THEMES, resolveTheme, clean, blueprint } from "./themes.ts";
export { layoutModel } from "./layout.ts";
export { buildRoutes } from "./router.ts";
export { renderModel } from "./render.ts";
export { renderModelIso, renderTrafficIso } from "./iso.ts";
export { renderModelTraffic, layoutTraffic } from "./traffic.ts";
export type { TrafficLayout, Socket } from "./traffic.ts";
export { layoutTubes, drawTubesSvg, hasTubes } from "./tube.ts";
export type { TubeLayout, TubeDrop, TubesResult } from "./tube.ts";
export { resolveSegments } from "./logical.ts";
export { renderView, VIEWS, PROJECTIONS } from "./views.ts";
export type { View, Projection, RenderOptions } from "./views.ts";
export { parseNet, validateModel, inferTier } from "./parser.ts";
export { serializeNet } from "./serialize.ts";
export { threeRack, homelabLogical } from "./examples.ts";
