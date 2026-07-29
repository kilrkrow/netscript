# NetScript — use cases

Captured so they survive between sessions.

## Visio-style Ethernet tube + port callouts

**Status: implemented** (issue #2) — `segment` blocks, `layoutTubes` / `drawTubesSvg`, example `examples/ethernet-tube.net`.

**Source:** operator practice (kilrkrow) — how subnet membership used to be drawn in Visio.

### What it looks like

1. **Ethernet tube** — a thick horizontal (or vertical) “bus” representing an L2 segment / subnet, labelled with the **class** (CIDR), e.g. `192.168.86.0/24`.
2. **Device drop** — each host attached to that segment has a short line from the device toward the tube.
3. **Callout at the junction** — where the drop meets the tube (or where it meets the device edge), a Visio-style callout elbow:

   ```
        device
          |
          |          eth0
          +----[     .1
                     ]
   ```

   More precisely: a line that ends in a **bracket / flag** (`----[`) carrying:

   - **physical port** name (e.g. `eth0`, `g1/0/1`)
   - **host address on that segment** (e.g. `.1` or full `192.168.86.1`)

### Why NetScript doesn’t do this yet

- Physical view: devices + point-to-point links + optional port chips; **no first-class “segment bus” glyph**.
- Logical view: VLANs/subnets colour and membership, but members hang off **switch ports**, not a shared tube with per-host IP callouts.
- Port callouts today sit near cable landings with port *name*; they don’t systematically show **address-on-segment** in the Visio flag style.

### Intended model shape (sketch)

- A **segment** (or reuse `vlan` with `subnet`) can render as a **tube** when the view mode is “as-built L2” / hybrid.
- Each **member** is a device (or device.port) with optional **host address** on that subnet.
- Renderer draws: tube + class label; stub from device to tube; callout chip at intersection with `port` + address.

### Acceptance sketch

- Author can declare something equivalent to: “these hosts are on `192.168.86.0/24`; host A is `.1` on `eth0`.”
- SVG shows a tube labelled `192.168.86.0/24` and callouts like:

  ```
  eth0
  .1
  ```

  at the touch point between drop and object (or drop and tube — pick one convention and stick to it; Visio often put the flag on the device side of the drop).

### Authoring

```
segment home "Home LAN" subnet 192.168.86.0/24 {
  member pc.eth0 addr .10
  member nas.eth0 addr .20
}
```

Also: `member <device>.<port> [tagged] [addr <addr>]` on VLANs. When no `segment` blocks exist, hybrid/logical views derive tubes from VLANs that declare a `subnet`.

### Convention chosen (Visio samples)

Critical rule: the callout **intersects the object→tube drop at the object**
(where the line leaves the device). A short diagonal arm then carries
`eth3` / `.1`. Not mid-span, not at the bus, not a second L1 port chip on the
same port. Drops are pure verticals; paper grows under the topology.
