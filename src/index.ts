/**
 * NetScript — public API.
 *
 *   import { renderModel } from "@kilrkrow/netscript";
 *   const svg = renderModel(model, "blueprint");
 *
 * Pipeline: model → layout → router → render. Renderers are pure views over a
 * positioned model, so the same source can be drawn in any theme.
 */
export type { NetModel, Device, Link, Rack, Kind, Tier, Speed, Pt } from "./model.ts";
export type { Theme } from "./themes.ts";
export { THEMES, resolveTheme, clean, blueprint } from "./themes.ts";
export { layoutModel } from "./layout.ts";
export { buildRoutes } from "./router.ts";
export { renderModel } from "./render.ts";
export { threeRack } from "./examples.ts";
