/**
 * NetScript model — the source of truth.
 *
 * A NetModel is a declarative, layout-free description of devices, the ports
 * between them, and the links that connect them. Positions are assigned later
 * by the layout pass; renderers are pure views over the positioned model.
 *
 * v0.1 is physical-layer only (devices · ports · cabling). Logical overlays
 * (VLAN / subnet / bond semantics) and importers (UniFi / Proxmox / SysML v2)
 * are post-0.1 — see README roadmap.
 */

export type Kind =
  | "cloud" | "router" | "firewall" | "switch"
  | "server" | "storage" | "ap" | "desktop";

/** Vertical tier — drives layout and link-class inference. */
export type Tier = "wan" | "edge" | "core" | "tor" | "host";

export type Speed = "WAN" | "1G" | "10G" | "25G" | "40G" | "100G" | "LAG";

export interface Device {
  id: string;
  kind: Kind;
  label: string;
  tier: Tier;
  ip?: string;
  rack?: string;            // rack id (for tor/host devices)
  /** assigned by layout */
  x?: number; y?: number; w?: number; h?: number;
}

export interface Link {
  a: string;                // device id (the lower / leaf end, by convention)
  b: string;                // device id (the upper / spine end)
  speed: Speed;
  bond?: boolean;           // dual-homed / LAG — drawn as an offset pair
  /** assigned by router */
  klass?: "wan" | "e2c" | "peer" | "uplink" | "intra";
}

export interface Rack { id: string; label: string; role: string; }

export interface NetModel {
  title: string;
  devices: Device[];
  links: Link[];
  racks: Rack[];
}

export type Pt = { x: number; y: number };

export const byId = (m: NetModel): Map<string, Device> =>
  new Map(m.devices.map((d) => [d.id, d]));

// boundary anchors on a positioned device
export const top    = (d: Device): Pt => ({ x: d.x!, y: d.y! - d.h! / 2 });
export const bottom = (d: Device): Pt => ({ x: d.x!, y: d.y! + d.h! / 2 });
export const leftP  = (d: Device): Pt => ({ x: d.x! - d.w! / 2, y: d.y! });
export const rightP = (d: Device): Pt => ({ x: d.x! + d.w! / 2, y: d.y! });

export const escapeXml = (s: string): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
           .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
