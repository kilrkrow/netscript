/** Bundled example models — physical stress test + a logical/hybrid sample. */
import type { NetModel } from "./model.ts";

// Physical layer only: managed gear (FW / switches) carries a single management
// address; hosts (servers / storage) carry none. CIDRs/subnets are a logical-
// layer concern (v2), so the WAN edge has no network attached here.
export const threeRack: NetModel = {
  title: "3-Rack Leaf-Spine",
  racks: [
    { id: "A", label: "Rack A", role: "Compute" },
    { id: "B", label: "Rack B", role: "Mixed" },
    { id: "C", label: "Rack C", role: "Storage" },
  ],
  devices: [
    { id: "wan",  kind: "cloud",    label: "Internet",  tier: "wan" },
    { id: "edge", kind: "firewall", label: "Edge / FW", tier: "edge", mgmt: "10.10.0.1" },
    { id: "core1", kind: "switch", label: "core-1", tier: "core", mgmt: "10.10.0.2" },
    { id: "core2", kind: "switch", label: "core-2", tier: "core", mgmt: "10.10.0.3" },
    // Rack A — compute
    { id: "a-tor", kind: "switch",  label: "tor-a",   tier: "tor",  rack: "A", mgmt: "10.10.10.2" },
    { id: "a-s1",  kind: "server",  label: "esxi-a1", tier: "host", rack: "A" },
    { id: "a-s2",  kind: "server",  label: "esxi-a2", tier: "host", rack: "A" },
    { id: "a-s3",  kind: "server",  label: "esxi-a3", tier: "host", rack: "A" },
    { id: "a-s4",  kind: "server",  label: "esxi-a4", tier: "host", rack: "A" },
    // Rack B — mixed
    { id: "b-tor", kind: "switch",  label: "tor-b",   tier: "tor",  rack: "B", mgmt: "10.10.20.2" },
    { id: "b-s1",  kind: "server",  label: "k8s-b1",  tier: "host", rack: "B" },
    { id: "b-s2",  kind: "server",  label: "k8s-b2",  tier: "host", rack: "B" },
    { id: "b-s3",  kind: "server",  label: "k8s-b3",  tier: "host", rack: "B" },
    { id: "b-st",  kind: "storage", label: "ceph-b1", tier: "host", rack: "B" },
    // Rack C — storage
    { id: "c-tor", kind: "switch",  label: "tor-c",  tier: "tor",  rack: "C", mgmt: "10.10.30.2" },
    { id: "c-st1", kind: "storage", label: "san-c1", tier: "host", rack: "C" },
    { id: "c-st2", kind: "storage", label: "san-c2", tier: "host", rack: "C" },
    { id: "c-s1",  kind: "server",  label: "bkp-c1", tier: "host", rack: "C" },
    { id: "c-s2",  kind: "server",  label: "bkp-c2", tier: "host", rack: "C" },
  ],
  links: [
    { a: "edge", b: "wan",   speed: "WAN" },
    { a: "edge", b: "core1", speed: "10G" },
    { a: "edge", b: "core2", speed: "10G" },
    { a: "core1", b: "core2", speed: "100G" },
    // dual-homed uplinks
    { a: "a-tor", b: "core1", speed: "25G" }, { a: "a-tor", b: "core2", speed: "25G" },
    { a: "b-tor", b: "core1", speed: "25G" }, { a: "b-tor", b: "core2", speed: "25G" },
    { a: "c-tor", b: "core1", speed: "25G" }, { a: "c-tor", b: "core2", speed: "25G" },
    // intra-rack (a few bonded)
    { a: "a-tor", b: "a-s1", speed: "10G", bond: true },
    { a: "a-tor", b: "a-s2", speed: "10G" },
    { a: "a-tor", b: "a-s3", speed: "10G" },
    { a: "a-tor", b: "a-s4", speed: "10G" },
    { a: "b-tor", b: "b-s1", speed: "10G" },
    { a: "b-tor", b: "b-s2", speed: "10G" },
    { a: "b-tor", b: "b-s3", speed: "10G" },
    { a: "b-tor", b: "b-st", speed: "10G", bond: true },
    { a: "c-tor", b: "c-st1", speed: "10G", bond: true },
    { a: "c-tor", b: "c-st2", speed: "10G" },
    { a: "c-tor", b: "c-s1", speed: "10G" },
    { a: "c-tor", b: "c-s2", speed: "10G" },
  ],
};

/**
 * Logical-layer sample — exercises first-class PORTS, port↔port cabling, two
 * VLANs (with subnets), and a LAG bond on the server. Renders meaningfully in
 * BOTH physical (ports + cabling) and logical/hybrid (VLAN colours, subnet
 * badges, bond collapsed to one logical link, interface addresses).
 *
 *   core1 ──(g1↔te1, te2)── tor1 ──(g1↔eth0 + g2↔eth1 = lag1)── srv1
 *   edge  ──(wan0/lan0)──── core1
 *
 * VLAN 10 (mgmt 10.0.10.0/24): tor1 access + srv1 native.
 * VLAN 20 (data 10.0.20.0/24): trunked core1↔tor1, tagged on the server bond.
 */
export const homelabLogical: NetModel = {
  title: "Homelab — Logical",
  racks: [{ id: "A", label: "Rack A", role: "Compute" }],
  devices: [
    { id: "wan",  kind: "cloud",    label: "Internet",  tier: "wan" },
    {
      id: "edge", kind: "firewall", label: "edge-fw", tier: "edge", mgmt: "10.0.0.1",
      ports: [
        { id: "wan0", name: "wan0", speed: "WAN", media: "RJ45", addr: "dhcp" },
        { id: "lan0", name: "lan0", speed: "10G", media: "SFP+", addr: "10.0.0.1/24" },
      ],
    },
    {
      id: "core1", kind: "switch", label: "core-sw", tier: "core", mgmt: "10.0.0.2",
      ports: [
        { id: "te1", name: "te1", speed: "10G", media: "SFP+" },
        { id: "te2", name: "te2", speed: "10G", media: "SFP+" },
        { id: "te3", name: "te3", speed: "10G", media: "SFP+" },
      ],
    },
    {
      id: "tor1", kind: "switch", label: "tor-sw", tier: "tor", rack: "A", mgmt: "10.0.10.2",
      ports: [
        { id: "g1", name: "g1", speed: "10G" },
        { id: "g2", name: "g2", speed: "10G" },
        { id: "g3", name: "g3", speed: "1G", addr: "10.0.10.2/24" },
      ],
    },
    {
      id: "srv1", kind: "server", label: "host-01", tier: "host", rack: "A",
      ports: [
        { id: "eth0", name: "eth0", speed: "10G", media: "SFP+" },
        { id: "eth1", name: "eth1", speed: "10G", media: "SFP+" },
        // bond0 carries the host's addresses (interface-level L3)
      ],
    },
  ],
  links: [
    { a: "edge", b: "wan",   speed: "WAN", aPort: "wan0" },
    { a: "edge", b: "core1", speed: "10G", aPort: "lan0", bPort: "te1" },
    // core↔tor trunk (carries the data VLAN)
    { a: "tor1", b: "core1", speed: "10G", aPort: "g1", bPort: "te2" },
    // server dual-homed bond: two physical members, one LAG
    { a: "tor1", b: "srv1", speed: "10G", bond: true, aPort: "g1", bPort: "eth0" },
    { a: "tor1", b: "srv1", speed: "10G", bond: true, aPort: "g2", bPort: "eth1" },
  ],
  vlans: [
    {
      id: 10, name: "mgmt", subnet: "10.0.10.0/24",
      members: [
        { device: "tor1", port: "g3", tagged: false },
        { device: "srv1", port: "eth0", tagged: false },
      ],
    },
    {
      id: 20, name: "data", subnet: "10.0.20.0/24",
      members: [
        { device: "core1", port: "te2", tagged: true },
        { device: "tor1", port: "g1", tagged: true },
        { device: "srv1", port: "eth0", tagged: true },
        { device: "srv1", port: "eth1", tagged: true },
      ],
    },
  ],
  bonds: [
    { id: "lag1", device: "srv1", memberPorts: ["eth0", "eth1"], mode: "lacp" },
  ],
};
