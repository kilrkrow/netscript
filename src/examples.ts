/** Bundled example model — the three-rack leaf-spine stress test. */
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
