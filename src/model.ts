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
  | "server" | "storage" | "ap" | "desktop" | "camera";

/** Vertical tier — drives layout and link-class inference. */
export type Tier = "wan" | "edge" | "core" | "tor" | "host";

export type Speed = "WAN" | "1G" | "10G" | "25G" | "40G" | "100G" | "LAG";

/**
 * A first-class PHYSICAL PORT on a device. Ports are a physical-layer concept:
 * a jack on the chassis with a name (wan0 / eth1 / g1) and, optionally, a
 * speed and media. Labeling them is physical documentation — closing the gap
 * left by today's device→device links, which skip the port callouts.
 *
 * `addr` is the one place the physical and logical layers touch on a port: an
 * L3 address configured directly on the interface (the untagged / native case,
 * or a routed port). VLAN/SVI addressing lives on the logical layer instead.
 */
export interface Port {
  id: string;               // unique WITHIN the owning device
  name: string;             // display label, e.g. "wan0", "eth1", "g1/0/1"
  speed?: Speed;            // optional per-port speed (overrides link speed in callout)
  media?: string;           // optional, e.g. "SFP+", "RJ45", "QSFP28"
  addr?: string;            // optional L3 address on the interface (logical touch-point)
}

export interface Device {
  id: string;
  kind: Kind;
  label: string;
  tier: Tier;
  /**
   * Optional MANAGEMENT address — a single host IP for managed gear
   * (firewall / switch / router / AP). This is deliberately NOT a CIDR and
   * NOT a per-NIC service address: full L3 addressing (interfaces, subnets,
   * VLANs) is a logical-layer concern and lands in v2. Hosts omit this.
   */
  mgmt?: string;
  /** Optional first-class physical ports (completes the physical layer). */
  ports?: Port[];
  /** Optional listening services (the flow layer) — see Service. */
  services?: Service[];
  rack?: string;            // rack id (for tor/host devices)
  /** assigned by layout */
  x?: number; y?: number; w?: number; h?: number;
}

export interface Link {
  a: string;                // device id (the lower / leaf end, by convention)
  b: string;                // device id (the upper / spine end)
  speed: Speed;
  bond?: boolean;           // dual-homed / LAG — drawn as an offset pair
  /**
   * Optional PORT attachment. When given, the cable terminates on a specific
   * named port of each device and the renderer draws a port callout there.
   * Omitting them keeps the v0.1 device→device behaviour (fully back-compat).
   */
  aPort?: string;           // port id on device `a`
  bPort?: string;           // port id on device `b`
  /** assigned by router */
  klass?: "wan" | "e2c" | "peer" | "uplink" | "intra";
}

export interface Rack { id: string; label: string; role: string; }

/**
 * LOGICAL-layer additions (additive; absent on pure physical models).
 *
 * A VLAN is an L2 segment that may carry an L3 subnet (CIDR). Its members
 * reference physical ports by `{ device, port }` and record tagged/untagged
 * (trunk vs. access). A Bond/LAG is a LOGICAL INTERFACE built from physical
 * member ports on one device — the bridge between the two layers.
 */
export interface VlanMember { device: string; port: string; tagged?: boolean; }
export interface Vlan {
  id: number;               // 802.1Q VLAN id
  name: string;
  subnet?: string;          // optional CIDR, e.g. "10.20.0.0/24"
  members: VlanMember[];
}
export interface Bond {
  id: string;               // logical interface name, e.g. "lag1", "bond0"
  device: string;           // owning device id
  memberPorts: string[];    // physical port ids on `device`
  mode?: string;            // optional, e.g. "lacp", "active-backup"
}

/**
 * FLOW-layer (L4) additions — traffic, not topology.
 *
 * A Flow is one direction of intent: `from` INITIATES a connection to `to` on
 * a listening service (`proto`/`port`). This is deliberately asymmetric — it
 * is the thing a firewall rule, a security review, or a "what talks to what"
 * question actually cares about. Return traffic is implied and never drawn.
 *
 * "Inbound" and "outbound" are therefore not properties of a flow; they are
 * relative to whichever device you're looking at. A flow arriving at `to` is
 * that device's inbound; the same flow is `from`'s outbound. The traffic view
 * gets this for free from the arrow direction.
 */
export type Proto = "tcp" | "udp" | "icmp" | "any";

/**
 * A SERVICE — a named listening endpoint that lives ON a host.
 *
 * Deliberately not a device. A vendor's port table routinely puts a dozen
 * services on one machine, and modelling each as its own node would claim a
 * dozen machines where there is one — which for the firewall audience these
 * tables are written for is an actively harmful lie: it implies a dozen
 * destination addresses needing a dozen rule sets, when it is one address with
 * a dozen open ports. A service belongs to its host the way a port does.
 *
 * `exe` is the binary that owns the listener, because that is what a vendor
 * port table keys on and what an admin greps the process list for.
 */
export interface Service {
  id: string;               // unique WITHIN the owning device
  name: string;             // display label, e.g. "GIS Service"
  proto: Proto;
  port: number;
  exe?: string;             // owning executable, e.g. "ipscserver.exe"
}

export interface Flow {
  from: string;             // initiator device id (the client end)
  to: string;               // listener device id (the end exposing the port)
  /**
   * Service id on `to`. When set, proto/port are taken FROM that service
   * rather than restated here — the port is declared once, where it lives.
   */
  toService?: string;
  proto?: Proto;            // required only when `toService` is absent
  port?: number;            // listening port; omitted for icmp / any
  label?: string;           // optional service name, e.g. "SQL", "LDAPS"
}

/** What a flow actually targets, after resolving any `toService` reference. */
export interface ResolvedFlow { proto: Proto; port?: number; name?: string; exe?: string; svcId?: string; }

export function resolveFlow(m: NetModel, f: Flow): ResolvedFlow {
  if (f.toService) {
    const s = m.devices.find((d) => d.id === f.to)?.services?.find((x) => x.id === f.toService);
    if (s) return { proto: s.proto, port: s.port, name: s.name, exe: s.exe, svcId: s.id };
  }
  return { proto: f.proto ?? "any", port: f.port, name: f.label };
}

/** Canonical service identity — the thing colour is keyed on. */
export const serviceKey = (r: { proto: Proto; port?: number }): string =>
  r.port === undefined ? r.proto : `${r.proto}/${r.port}`;

export interface NetModel {
  title: string;
  devices: Device[];
  links: Link[];
  racks: Rack[];
  theme?: string;           // optional default theme from `.net` frontmatter
  /** logical-layer overlays (additive; physical models omit these) */
  vlans?: Vlan[];
  bonds?: Bond[];
  /** flow-layer overlay (additive; topology-only models omit this) */
  flows?: Flow[];
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
