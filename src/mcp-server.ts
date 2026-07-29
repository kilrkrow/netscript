#!/usr/bin/env node
/**
 * NetScript MCP Server
 *
 * Exposes two tools over the Model Context Protocol (stdio transport):
 *
 *   compile_net  — structured JSON network model → .net source + SVG
 *   render_net   — .net source text → SVG
 *
 * Usage (Claude Desktop / any MCP-capable agent):
 *   npx netscript mcp
 *
 * The caller's LLM handles topology understanding (what connects to what);
 * this server handles NetScript syntax, layout, routing and rendering. No LLM
 * inside, no token burn.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { NetModel, Device, Link, Vlan, Bond, Flow } from "./model.ts";
import { parseNet, validateModel, inferTier } from "./parser.ts";
import { serializeNet } from "./serialize.ts";
import { renderView, type View, type Projection } from "./views.ts";

/** compile_net's input — a NetModel with `tier` optional (inferred if omitted) and no rack `label`. */
interface CompileInput {
  title?: string;
  theme?: string;
  view?: View;
  projection?: Projection;
  racks?: { id: string; role: string }[];
  devices: (Omit<Device, "tier" | "x" | "y" | "w" | "h"> & { tier?: Device["tier"] })[];
  links: Link[];
  vlans?: Vlan[];
  bonds?: Bond[];
  flows?: Flow[];
}

// ─── Tool schemas ────────────────────────────────────────────────────────────

const PORT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Port id, unique within the device (e.g. \"g1\", \"eth0\")" },
    name: { type: "string", description: "Display label (e.g. \"g1/0/1\")" },
    speed: { type: "string", enum: ["WAN", "1G", "10G", "25G", "40G", "100G", "LAG"] },
    media: { type: "string", description: "e.g. \"SFP+\", \"RJ45\", \"QSFP28\"" },
    addr: { type: "string", description: "L3 address configured directly on this interface" },
  },
  required: ["id", "name"],
} as const;

const SERVICE_SCHEMA = {
  type: "object",
  description: "A listening service hosted ON this device. Declare each listener once here; flows then reference it and inherit its port. Do NOT model services as separate devices — a dozen services on one machine is one firewall destination with a dozen open ports, not a dozen machines.",
  properties: {
    id: { type: "string", description: "Service id, unique within the device (e.g. \"gis\")" },
    name: { type: "string", description: "Display label / use case, e.g. \"GIS Service\"" },
    proto: { type: "string", enum: ["tcp", "udp", "icmp", "any"] },
    port: { type: "number", description: "Listening port, e.g. 9005" },
    exe: { type: "string", description: "Owning executable, e.g. \"ipscserver.exe\"" },
  },
  required: ["id", "name", "proto", "port"],
} as const;

const DEVICE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Unique device id" },
    kind: { type: "string", enum: ["cloud", "router", "firewall", "switch", "server", "storage", "ap", "desktop", "camera"] },
    label: { type: "string", description: "Display label" },
    tier: {
      type: "string", enum: ["wan", "edge", "core", "tor", "host"],
      description: "Drives layout + link-class inference. Omit to infer from kind/nesting.",
    },
    mgmt: { type: "string", description: "Management address on managed gear only (not a CIDR)" },
    rack: { type: "string", description: "Rack id this device belongs to (must match a rack in `racks`)" },
    ports: { type: "array", items: PORT_SCHEMA },
    services: { type: "array", items: SERVICE_SCHEMA },
  },
  required: ["id", "kind", "label"],
} as const;

const LINK_SCHEMA = {
  type: "object",
  properties: {
    a: { type: "string", description: "Device id (either end)" },
    b: { type: "string", description: "Device id (either end)" },
    speed: { type: "string", enum: ["WAN", "1G", "10G", "25G", "40G", "100G", "LAG"] },
    bond: { type: "boolean", description: "Dual-homed / LAG member — draws as an offset parallel pair" },
    aPort: { type: "string", description: "Port id on device `a` the cable terminates on" },
    bPort: { type: "string", description: "Port id on device `b` the cable terminates on" },
  },
  required: ["a", "b", "speed"],
} as const;

const VLAN_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "number", description: "802.1Q VLAN id" },
    name: { type: "string" },
    subnet: { type: "string", description: "Optional CIDR, e.g. \"10.20.0.0/24\"" },
    members: {
      type: "array",
      items: {
        type: "object",
        properties: {
          device: { type: "string" },
          port: { type: "string" },
          tagged: { type: "boolean" },
        },
        required: ["device", "port"],
      },
    },
  },
  required: ["id", "name", "members"],
} as const;

const BOND_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Logical interface name, e.g. \"lag1\"" },
    device: { type: "string", description: "Owning device id" },
    memberPorts: { type: "array", items: { type: "string" } },
    mode: { type: "string", description: "e.g. \"lacp\", \"active-backup\"" },
  },
  required: ["id", "device", "memberPorts"],
} as const;

const FLOW_SCHEMA = {
  type: "object",
  description: "One direction of intent: `from` initiates a connection to `to` on a listening service. Return traffic is implied — do not add a reverse flow for it.",
  properties: {
    from: { type: "string", description: "Initiator device id (the client end)" },
    to: { type: "string", description: "Listener device id (the end exposing the port)" },
    toService: { type: "string", description: "Service id on `to`. Preferred: proto/port are taken from that service, so the port is declared once where it lives. Omit proto/port when using this." },
    proto: { type: "string", enum: ["tcp", "udp", "icmp", "any"], description: "Only when `toService` is absent (e.g. an ICMP ping with no declared service)." },
    port: { type: "number", description: "Listening port, e.g. 1433. Omit for icmp/any." },
    label: { type: "string", description: "Service name shown in the legend, e.g. \"SQL\", \"LDAPS\"" },
  },
  required: ["from", "to"],
} as const;

// `view` and `projection` are independent axes — every combination is valid.
const VIEW_PROP = {
  type: "string", enum: ["topology", "traffic"],
  description: "WHAT to draw: \"topology\" (default — devices and cabling) or \"traffic\" (the L4 flow view; requires `flows`).",
} as const;

const PROJECTION_PROP = {
  type: "string", enum: ["flat", "iso"],
  description: "HOW to draw it: \"flat\" (default 2D) or \"iso\" (isometric). Independent of `view` — traffic can be isometric too.",
} as const;

const COMPILE_NET_SCHEMA = {
  type: "object",
  description: "Network topology to compile into a NetScript diagram.",
  properties: {
    title: { type: "string", description: "Diagram title" },
    theme: { type: "string", enum: ["clean", "blueprint", "clean-logical", "clean-hybrid", "blueprint-logical", "blueprint-hybrid"] },
    view: VIEW_PROP,
    projection: PROJECTION_PROP,
    racks: {
      type: "array",
      description: "Rack groups. A device joins a rack by setting its `rack` field to one of these ids.",
      items: {
        type: "object",
        properties: { id: { type: "string" }, role: { type: "string", description: "Shown as the rack's zone label" } },
        required: ["id", "role"],
      },
    },
    devices: { type: "array", items: DEVICE_SCHEMA, minItems: 1 },
    links: { type: "array", items: LINK_SCHEMA },
    vlans: { type: "array", items: VLAN_SCHEMA, description: "Optional logical layer: VLANs/subnets" },
    bonds: { type: "array", items: BOND_SCHEMA, description: "Optional logical layer: LAG/bond interfaces" },
    flows: {
      type: "array", items: FLOW_SCHEMA,
      description: "Optional flow layer (L4): what talks to what, on which service. Required when view is \"traffic\". Colour is keyed on proto/port and direction runs initiator → listener, so a server's exposed ports read as inbound and its own calls read as outbound.",
    },
  },
  required: ["devices", "links"],
} as const;

const RENDER_NET_SCHEMA = {
  type: "object",
  properties: {
    source: { type: "string", description: "Valid NetScript (.net) source text to render" },
    theme: { type: "string", enum: ["clean", "blueprint", "clean-logical", "clean-hybrid", "blueprint-logical", "blueprint-hybrid"], description: "Theme override — if omitted, the frontmatter `theme:` (or \"clean\") applies" },
    view: VIEW_PROP,
    projection: PROJECTION_PROP,
  },
  required: ["source"],
} as const;

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "netscript", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "compile_net",
      description:
        "Compile a network topology (devices, links, racks, and optionally VLANs/bonds/ports) into a " +
        "NetScript diagram. Extract the topology from the source material (network diagram, config, " +
        "description), then pass it as structured JSON — you do not need to know NetScript's .net text " +
        "syntax. Returns { net, svg } where `net` is human-readable/editable source and `svg` is the " +
        "rendered diagram.",
      inputSchema: COMPILE_NET_SCHEMA,
    },
    {
      name: "render_net",
      description:
        "Render NetScript (.net) source text to SVG. Use this when you already have .net source " +
        "(e.g. from compile_net, or hand-authored). Returns the SVG string.",
      inputSchema: RENDER_NET_SCHEMA,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "compile_net") {
    const input = args as unknown as CompileInput;
    try {
      const racks = input.racks ?? [];
      const rackIds = new Set(racks.map((r) => r.id));
      const devices = (input.devices ?? []).map((d) => ({
        ...d,
        tier: d.tier ?? inferTier(d.kind, !!d.rack && rackIds.has(d.rack)),
      }));
      const model: NetModel = {
        title: input.title ?? "Untitled",
        theme: input.theme,
        racks: racks.map((r) => ({ id: r.id, label: `Rack ${r.id}`, role: r.role })),
        devices,
        links: input.links ?? [],
        vlans: input.vlans,
        bonds: input.bonds,
        flows: input.flows,
      };
      validateModel(model);
      const net = serializeNet(model);
      const svg = renderView(model, { theme: input.theme ?? "clean", view: input.view, projection: input.projection });
      return { content: [{ type: "text" as const, text: JSON.stringify({ net, svg }) }] };
    } catch (err) {
      throw new McpError(ErrorCode.InvalidParams, `compile_net failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (name === "render_net") {
    const { source, theme, view, projection } = args as { source: string; theme?: string; view?: View; projection?: Projection };
    try {
      const model = parseNet(source);
      const svg = renderView(model, { theme: theme ?? model.theme ?? "clean", view, projection });
      return { content: [{ type: "text" as const, text: svg }] };
    } catch (err) {
      throw new McpError(ErrorCode.InvalidParams, `render_net failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

// ─── Entry point ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
