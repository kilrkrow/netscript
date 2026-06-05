# NetScript

**Diagram-as-code for physical network & infrastructure topology.** Describe your devices, ports, and links in a declarative model; get clean, Visio-grade SVG — in any theme. No drag-and-drop, no hand-placed coordinates.

> **Status: early (v0.1).** Physical layer only, one bundled example, two themes. The text DSL, importers, and logical overlays are on the roadmap below. The renderer and router are real and working today.

---

## Why

Network diagrams rot. You draw them once in Visio/draw.io, the lab changes, and the picture lies within a month. NetScript treats the **diagram as a projection of a model** — so the same source can render as a clean doc, a dark NOC view, or a blueprint schematic, and (eventually) be regenerated automatically from what your gear actually reports.

## Preview

Same model, two themes — a three-rack leaf-spine (WAN edge → redundant core pair → top-of-rack switches → servers/storage, with dual-homed uplinks and LAG bonds):

**Blueprint**

![Three-rack leaf-spine, blueprint theme](examples/three-rack-blueprint.svg)

**Clean**

![Three-rack leaf-spine, clean theme](examples/three-rack-clean.svg)

## Quickstart

Requires **Node 24+** (runs the TypeScript sources directly via type-stripping).

```bash
git clone https://github.com/kilrkrow/netscript.git
cd netscript

# render the bundled example
node src/cli.ts --example three-rack --theme blueprint -o diagram.svg
node src/cli.ts --example three-rack --theme clean     -o diagram.svg
```

Or from code:

```ts
import { renderModel, threeRack } from "@kilrkrow/netscript";

const svg = renderModel(threeRack, "blueprint");
```

## The model

A `NetModel` is layout-free — you describe *what connects to what*, and NetScript places and routes it:

```ts
import type { NetModel } from "@kilrkrow/netscript";

const model: NetModel = {
  title: "Home Lab",
  racks: [{ id: "A", label: "Rack A", role: "Compute" }],
  devices: [
    { id: "edge",  kind: "firewall", label: "Edge / FW", tier: "edge", ip: "10.0.0.1" },
    { id: "core1", kind: "switch",   label: "core-1",    tier: "core", ip: "10.0.0.2" },
    { id: "a-tor", kind: "switch",   label: "tor-a",     tier: "tor",  rack: "A" },
    { id: "a-s1",  kind: "server",   label: "esxi-a1",   tier: "host", rack: "A" },
  ],
  links: [
    { a: "edge",  b: "core1", speed: "10G" },
    { a: "a-tor", b: "core1", speed: "25G" },               // uplink
    { a: "a-tor", b: "a-s1",  speed: "10G", bond: true },   // LAG / dual-home
  ],
};
```

`tier` (`wan` · `edge` · `core` · `tor` · `host`) drives layout and lets the router infer each link's class (uplink, peer, intra-rack, …). `bond: true` draws a link as an offset parallel pair with a `LAG` tag.

## How it works

```
model → layout → router → render
```

- **layout** — deterministic tiered/rack placement: edge on top, a centered core pair, then rack columns with a top-of-rack switch over staggered hosts. Zone boxes are derived from device bounds.
- **router** — orthogonal cabling with **per-tier lane allocation** (so parallel runs never overlap), **uplink risers** with core-side port fan-out (so dual-home uplinks don't converge on one point), per-rack local lanes, and **line-jumps only where a crossing is genuinely unavoidable**.
- **render** — a pure view: positioned model + theme → SVG. Swapping themes never touches the model.

This is the load-bearing idea: **the model is the source of truth; every rendering is a view over it.**

## Themes

| Theme | Use |
|-------|-----|
| `clean` | White, Visio-like — the neutral documentation default. |
| `blueprint` | Schematic blue, per-device IPs, title block — high-density "as-built". |

More (dark NOC, monochrome, icon-rich) are straightforward to add — a theme is just a token set.

## Roadmap

- [x] Physical-layer model · layout · rebuilt router · `clean` + `blueprint` themes · CLI → SVG
- [ ] `.net` text DSL + parser (hand-authoring)
- [ ] More themes (dark NOC, monochrome, icon-rich) + rack-elevation view
- [ ] Logical layer: VLANs, subnets, bond semantics (L2/L3 overlays on the same model)
- [ ] **Importers / discovery** — populate the model from real gear: UniFi → Proxmox → Portainer (the diagram that stays current)
- [ ] SysML v2 export/import as an edge adapter (model interchange, not text parsing)
- [ ] REST `/render`, MCP server, and a browser editor (harness, mirrored from FlowScript)

## Design notes

- **v0.1 is physical only.** Logical (VLAN/subnet/bond meaning) is a layer over the same model, not a rewrite.
- **Importers are adapters at the edges.** A UniFi/Proxmox/SysML adapter maps into the `NetModel`; the core never learns those formats. The model can drift from reality, so auto-population (discovery) is what ultimately keeps a diagram honest.
- **SysML v2 is a future interchange target**, consumed/produced via its JSON/abstract-syntax (the standard API), never by parsing the textual notation.

## Lineage

NetScript forks the spirit (and the render-engine + harness patterns) of [FlowScript](https://github.com/kilrkrow/flowscript). The **layout and router are new**: network topology is a non-hierarchical multigraph with first-class ports, not a flow DAG, so it needed its own engine rather than FlowScript's grid/dagre flow router.

## License

MIT © kilrkrow
