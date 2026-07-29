# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Commands

```bash
# render the bundled example (Node 24+ runs TypeScript directly)
node src/cli.ts --example three-rack --theme blueprint -o out.svg
node src/cli.ts --example three-rack --theme clean    -o out.svg
node src/cli.ts --example three-rack --theme blueprint --projection iso -o out.svg  # isometric
node src/cli.ts examples/sql-traffic.net --view traffic --projection iso -o out.svg # L4 flows, isometric

npm run render:examples   # regenerate examples/*.svg
npm run typecheck         # tsc --noEmit
npm run build             # esbuild bundle -> dist/
npm run build:mcp         # esbuild bundle src/mcp-server.ts -> dist/

node src/cli.ts mcp        # MCP server over stdio (compile_net, render_net)
```

Rendering itself is pure string SVG with no runtime dependencies. The one
exception is `src/mcp-server.ts`, which depends on `@modelcontextprotocol/sdk`
— `cli.ts` dynamically imports it only when invoked as `netscript mcp`, so the
SDK never loads on the plain render path. Node 24+ runs the `.ts` sources
directly via type-stripping; the build uses esbuild (a bundler, so `.ts`
import specifiers are fine).

## Architecture

**Pipeline:** `model → layout → router → render`

```
src/model.ts        NetModel types (Device/Link/Rack/Port/Vlan/Bond/Flow) + geometry helpers
src/examples.ts      bundled sample models (three-rack leaf-spine, homelab logical)
src/layout.ts        deterministic tiered/rack placement; assigns x/y/w/h + zones
src/router.ts         orthogonal router: lane allocation, uplink risers, jumps
src/render.ts          topology, flat: positioned model + theme -> SVG
src/traffic.ts         L4 flow layer: layoutTraffic() geometry + flat renderer
src/iso.ts               isometric PROJECTION of either scene (topology or traffic)
src/views.ts            view x projection dispatcher — renderView()
src/logical.ts        VLAN/bond/port projection helpers consumed by render.ts
src/themes.ts          palette/typography tokens (clean, blueprint, *-logical, *-hybrid)
src/glyphs.ts           vendor-neutral device glyphs + per-kind colours
src/parser.ts            `.net` text DSL -> NetModel (mode-stack based block parser)
src/serialize.ts        NetModel -> `.net` text (inverse of parser.ts)
src/mcp-server.ts     MCP server (compile_net, render_net) over stdio
src/cli.ts                CLI entry (render, and `mcp` subcommand)
src/index.ts              public API
```

**Core principle:** the model is the source of truth; renderers are pure views.
Importers and exporters (UniFi / Proxmox / SysML v2) attach at the edges as
adapters — they never leak into the core.

### Three layers, two axes

Layers in the model: **physical** (devices/ports/cabling), **logical**
(VLANs/subnets/bonds), **flow** (L4 traffic). All three are first-class in the
model, the `.net` DSL, and the renderers.

Rendering has two INDEPENDENT axes, dispatched by `renderView()` in
`views.ts` — keep them independent:

- `view` — WHAT: `topology` | `traffic`
- `projection` — HOW: `flat` | `iso`

Isometric is a *projection of a scene*, not a kind of scene. Any scene reduced
to "positioned devices + polylines in flat space" can be projected, which is
why `iso.ts` consumes `layoutModel`/`buildRoutes` and `layoutTraffic` through
one shared set of primitives. If you add a new scene, add a layout that
produces that shape and it gets isometric for free. Physical-vs-logical-vs-
hybrid is a *third*, separate selector carried by the theme's `mode`.

### Traffic view notes

- Placement is derived from the flow graph (longest-path layering over inbound
  edges), NOT from `tier`: pure initiators sink to the bottom, pure listeners
  rise to the top. Cycle-guarded.
- Service colour is keyed on `proto/port` in **declaration order**, so the
  author's first-written flow gets the lead colour. Deliberately not sorted —
  see the comment on `serviceIndex`.
- Inbound/outbound is never stored; it's read off arrow geometry, because it's
  a point of view rather than a property of a flow.

### Router notes (the part most likely to bite)

- **Lane allocation** (`allocLanes`) is greedy interval colouring: parallel
  trunk runs get distinct y-slots so they never overlap. It avoids overlaps but
  does **not** minimise crossings (no node/lane reordering yet).
- **Uplink risers**: each ToR's dual-home pair rises on distinct ports; the
  core-side port is fanned by rack order so uplinks don't converge on one point.
- **Line-jumps** are added only where a horizontal segment is crossed by a
  *foreign* vertical. Keep this sparse — jump-noise was the failure mode of the
  original prototype.
- Bonds draw as an offset parallel pair (`offsetPts`) plus a `LAG` tag.
- Tier baselines are looked up defensively (`bottomOf`) — a model may have no
  `core`/`tor`/`edge` at all, and `layoutModel` sweeps rackless tor/host
  devices into a fallback row. Don't reintroduce `find(...)!` here; it used to
  crash with a bare TypeError on any rackless or flow-only model.

## Lineage

Forked in spirit from FlowScript (kilrkrow/flowscript): the render engine,
theme system, and product-harness patterns carry over; the **layout + router**
are new, because topology is a non-hierarchical multigraph, not a flow DAG.

## Behavioral guidelines

Simplicity first; surgical changes; state assumptions before non-trivial work.
Regenerate `examples/*.svg` after any layout/router change and eyeball them —
geometry bugs don't show up in types.
