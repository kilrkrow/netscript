# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Commands

```bash
# render the bundled example (Node 24+ runs TypeScript directly)
node src/cli.ts --example three-rack --theme blueprint -o out.svg
node src/cli.ts --example three-rack --theme clean    -o out.svg

npm run render:examples   # regenerate examples/*.svg
npm run typecheck         # tsc --noEmit
npm run build             # esbuild bundle -> dist/
```

No runtime dependencies — rendering is pure string SVG. Node 24+ runs the
`.ts` sources directly via type-stripping; the build uses esbuild (a bundler,
so `.ts` import specifiers are fine).

## Architecture

**Pipeline:** `model → layout → router → render`

```
src/model.ts     NetModel types (Device/Link/Rack) + geometry helpers
src/examples.ts  bundled sample model (three-rack leaf-spine)
src/layout.ts    deterministic tiered/rack placement; assigns x/y/w/h + zones
src/router.ts    orthogonal router: lane allocation, uplink risers, jumps
src/render.ts    positioned model + theme -> SVG string
src/themes.ts    palette/typography tokens (clean, blueprint)
src/glyphs.ts    vendor-neutral device glyphs + per-kind colours
src/cli.ts       CLI entry
src/index.ts     public API
```

**Core principle:** the model is the source of truth; renderers are pure views.
The same `NetModel` renders in any theme. Importers and exporters (UniFi /
Proxmox / SysML v2) attach at the edges as adapters — they never leak into the
core. v0.1 is physical-layer only.

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

## Lineage

Forked in spirit from FlowScript (kilrkrow/flowscript): the render engine,
theme system, and product-harness patterns carry over; the **layout + router**
are new, because topology is a non-hierarchical multigraph, not a flow DAG.

## Behavioral guidelines

Simplicity first; surgical changes; state assumptions before non-trivial work.
Regenerate `examples/*.svg` after any layout/router change and eyeball them —
geometry bugs don't show up in types.
