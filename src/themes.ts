/** NetScript themes — palette/typography tokens. Same model, swappable view. */
import type { Speed } from "./model.ts";

/**
 * View MODE selects which layer(s) the renderer projects:
 *   physical — devices · ports · cabling · speeds (the v0.1 default)
 *   logical  — VLAN-coloured links, subnet/CIDR badges, interface addresses,
 *              bonded members collapsed to one logical link
 *   hybrid   — physical cabling AND logical annotations together (as-built)
 */
export type ViewMode = "physical" | "logical" | "hybrid";

export interface Theme {
  name: string;
  font: string;
  mono: string;
  bg: string;
  grid: string | null;
  /** which layer(s) to render — defaults to "physical" when omitted */
  mode?: ViewMode;
  /** draw port callouts where a cable meets a device (physical documentation) */
  portCallouts?: boolean;
  // device cards
  cardFill: string;
  cardStroke: string;
  cardStrokeW: number;
  radius: number;
  shadow: boolean;
  chipStroke: string | null;   // null => use per-kind accent
  text: string;
  sub: string;
  showMgmt: boolean;           // render management address on managed gear
  // links
  link: string;
  linkW: number;
  jumps: boolean;
  endDots: boolean;
  speedColor: Record<Speed, string>;
  /** cyclic VLAN colour palette for the logical overlay */
  vlanPalette?: string[];
  // pills
  pill: boolean;
  pillFill: string;
  pillStroke: string;
  speedText: string;
  // zones
  zoneFill: string;
  zoneStroke: string;
  zoneText: string;
  titleBlock: boolean;
}

const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Qualitative VLAN palettes (high-contrast, colour-blind-aware-ish). Cyclic.
const VLAN_LIGHT = ["#2563eb", "#16a34a", "#db2777", "#d97706", "#0891b2", "#7c3aed", "#dc2626", "#0d9488"];
const VLAN_DARK = ["#7fd1ff", "#86efac", "#ff9ed6", "#ffd27f", "#67e8f9", "#c4b5fd", "#fca5a5", "#5eead4"];

export const clean: Theme = {
  name: "clean", font: SANS, mono: MONO, bg: "#ffffff", grid: null,
  mode: "physical", portCallouts: true,
  cardFill: "#ffffff", cardStroke: "#d7dbe2", cardStrokeW: 1.2, radius: 8, shadow: true,
  chipStroke: null, text: "#1f2430", sub: "#6b7280", showMgmt: false,
  link: "#7c8696", linkW: 1.5, jumps: true, endDots: true,
  speedColor: { WAN: "#64748b", "1G": "#94a3b8", "10G": "#3b82f6", "25G": "#ef6c2f", "40G": "#d97706", "100G": "#db2777", LAG: "#7c3aed" },
  vlanPalette: VLAN_LIGHT,
  pill: true, pillFill: "#ffffff", pillStroke: "#e5e7eb", speedText: "#475569",
  zoneFill: "#f8fafc", zoneStroke: "#e2e8f0", zoneText: "#64748b", titleBlock: false,
};

export const blueprint: Theme = {
  name: "blueprint", font: MONO, mono: MONO, bg: "#0c356a", grid: "#1c4a8a",
  mode: "physical", portCallouts: true,
  cardFill: "none", cardStroke: "#bcd6ff", cardStrokeW: 1.2, radius: 4, shadow: false,
  chipStroke: "#bcd6ff", text: "#eaf2ff", sub: "#9dc0f0", showMgmt: true,
  link: "#cfe0ff", linkW: 1.3, jumps: true, endDots: true,
  speedColor: { WAN: "#cfe0ff", "1G": "#9dc0f0", "10G": "#7fd1ff", "25G": "#ffd27f", "40G": "#ffc04d", "100G": "#ff9ed6", LAG: "#a7f3d0" },
  vlanPalette: VLAN_DARK,
  pill: false, pillFill: "none", pillStroke: "none", speedText: "#dbe9ff",
  zoneFill: "#0e3f7d", zoneStroke: "#2f63a8", zoneText: "#bcd6ff", titleBlock: true,
};

// Logical / hybrid variants — same palettes, different MODE. The default
// physical output is untouched; these are opt-in views over the same model.
export const cleanLogical: Theme = { ...clean, name: "clean-logical", mode: "logical" };
export const cleanHybrid: Theme = { ...clean, name: "clean-hybrid", mode: "hybrid" };
export const blueprintLogical: Theme = { ...blueprint, name: "blueprint-logical", mode: "logical" };
export const blueprintHybrid: Theme = { ...blueprint, name: "blueprint-hybrid", mode: "hybrid" };

export const THEMES: Record<string, Theme> = {
  clean, blueprint,
  "clean-logical": cleanLogical, "clean-hybrid": cleanHybrid,
  "blueprint-logical": blueprintLogical, "blueprint-hybrid": blueprintHybrid,
};
export const resolveTheme = (name: string): Theme => THEMES[name] ?? clean;
