/**
 * 12-hue muted palette for treemap tiles.
 * Dark mode: ~18% lightness. Light mode: ~92% lightness.
 * Rank-0 always gets the red-family hue (Lois accent).
 */

const HUES = [
  350, // red (rank-0 — Lois accent)
  25, // burnt orange
  45, // amber
  80, // olive
  140, // forest
  170, // teal
  200, // steel blue
  225, // slate
  260, // indigo
  290, // purple
  320, // magenta
  195, // cyan
];

export function tileColor(index: number, isDark: boolean): string {
  const hue = HUES[index % HUES.length];
  if (isDark) {
    return `hsl(${hue} 40% 18%)`;
  }
  return `hsl(${hue} 30% 92%)`;
}

export function tileBorderColor(index: number, isDark: boolean): string {
  const hue = HUES[index % HUES.length];
  if (isDark) {
    return `hsl(${hue} 50% 28%)`;
  }
  return `hsl(${hue} 35% 82%)`;
}

export function childTileColor(index: number, isDark: boolean): string {
  const hue = HUES[index % HUES.length];
  if (isDark) {
    return `hsl(${hue} 35% 14%)`;
  }
  return `hsl(${hue} 25% 95%)`;
}

export function childBorderColor(index: number, isDark: boolean): string {
  const hue = HUES[index % HUES.length];
  if (isDark) {
    return `hsl(${hue} 40% 22%)`;
  }
  return `hsl(${hue} 30% 87%)`;
}

export function tileTextColor(isDark: boolean): string {
  return isDark ? "#f0f0f0" : "#1a1a1a";
}

// ── Gradient variants ──

export function tileGradient(index: number, isDark: boolean): string {
  const hue = HUES[index % HUES.length];
  if (isDark) {
    return `linear-gradient(135deg, hsl(${hue} 45% 20%), hsl(${hue} 35% 13%))`;
  }
  return `linear-gradient(135deg, hsl(${hue} 35% 94%), hsl(${hue} 25% 89%))`;
}

export function childTileGradient(index: number, isDark: boolean): string {
  const hue = HUES[index % HUES.length];
  if (isDark) {
    return `linear-gradient(135deg, hsl(${hue} 38% 16%), hsl(${hue} 30% 11%))`;
  }
  return `linear-gradient(135deg, hsl(${hue} 28% 96%), hsl(${hue} 20% 92%))`;
}

export function tabTileGradient(index: number, isDark: boolean): string {
  const hue = HUES[index % HUES.length];
  if (isDark) {
    return `linear-gradient(160deg, hsl(${hue} 42% 19%), hsl(${hue} 35% 14%))`;
  }
  return `linear-gradient(160deg, hsl(${hue} 32% 93%), hsl(${hue} 24% 88%))`;
}
