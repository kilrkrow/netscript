/** NetScript themes — palette/typography tokens. Same model, swappable view. */
import type { Speed } from "./model.ts";

export interface Theme {
  name: string;
  font: string;
  mono: string;
  bg: string;
  grid: string | null;
  // device cards
  cardFill: string;
  cardStroke: string;
  cardStrokeW: number;
  radius: number;
  shadow: boolean;
  chipStroke: string | null;   // null => use per-kind accent
  text: string;
  sub: string;
  showIp: boolean;
  // links
  link: string;
  linkW: number;
  jumps: boolean;
  endDots: boolean;
  speedColor: Record<Speed, string>;
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

export const clean: Theme = {
  name: "clean", font: SANS, mono: MONO, bg: "#ffffff", grid: null,
  cardFill: "#ffffff", cardStroke: "#d7dbe2", cardStrokeW: 1.2, radius: 8, shadow: true,
  chipStroke: null, text: "#1f2430", sub: "#6b7280", showIp: false,
  link: "#7c8696", linkW: 1.5, jumps: true, endDots: true,
  speedColor: { WAN: "#64748b", "1G": "#94a3b8", "10G": "#3b82f6", "25G": "#ef6c2f", "40G": "#d97706", "100G": "#db2777", LAG: "#7c3aed" },
  pill: true, pillFill: "#ffffff", pillStroke: "#e5e7eb", speedText: "#475569",
  zoneFill: "#f8fafc", zoneStroke: "#e2e8f0", zoneText: "#64748b", titleBlock: false,
};

export const blueprint: Theme = {
  name: "blueprint", font: MONO, mono: MONO, bg: "#0c356a", grid: "#1c4a8a",
  cardFill: "none", cardStroke: "#bcd6ff", cardStrokeW: 1.2, radius: 4, shadow: false,
  chipStroke: "#bcd6ff", text: "#eaf2ff", sub: "#9dc0f0", showIp: true,
  link: "#cfe0ff", linkW: 1.3, jumps: true, endDots: true,
  speedColor: { WAN: "#cfe0ff", "1G": "#9dc0f0", "10G": "#7fd1ff", "25G": "#ffd27f", "40G": "#ffc04d", "100G": "#ff9ed6", LAG: "#a7f3d0" },
  pill: false, pillFill: "none", pillStroke: "none", speedText: "#dbe9ff",
  zoneFill: "#0e3f7d", zoneStroke: "#2f63a8", zoneText: "#bcd6ff", titleBlock: true,
};

export const THEMES: Record<string, Theme> = { clean, blueprint };
export const resolveTheme = (name: string): Theme => THEMES[name] ?? clean;
