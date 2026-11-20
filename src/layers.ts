// Layer model: which shapes go into which printed part, at what height.
import { parseColor } from './core/color.js';
import { matches, parseSelector } from './core/css.js';
import { ownersOf } from './core/svg.js';
import type { Shape } from './core/types.js';

/** One part of the print, as written in a config file. Heights in mm. */
export interface LayerConfig {
  name: string;
  /** CSS selector. A shape belongs to the layer if its element, an ancestor or a <use> it came through matches. */
  select?: string;
  /** CSS selector. Shapes whose element, an ancestor or a <use> it came through matches are left out. */
  exclude?: string;
  /** Only shapes painted in this colour (or one of these colours). */
  color?: string | string[];
  /** Bottom of the layer. Default 0. */
  z?: number;
  /** Thickness. Required unless op is "subtract". */
  height?: number;
  /** "subtract" cuts the selected shapes out of other layers instead of printing them. */
  op?: 'add' | 'subtract';
  /** For op "subtract": the layers to cut. Default: all of them. */
  from?: string[];
  /** Intersect the layer with this other layer's final footprint. */
  clip?: string;
  /** Colour of the part in output files. Default: the colour of its first shape. */
  displayColor?: string;
}

export interface ResolvedLayer {
  name: string;
  z: number;
  height: number;
  /** "erase" takes part in painter's order but prints nothing (shapes in the base colour, in relief mode). */
  op: 'add' | 'subtract' | 'erase';
  match: (shape: Shape) => boolean;
  from?: string[];
  clip?: string;
  displayColor?: string;
}

export interface ColorModeOptions {
  /** Flat mode: thickness of every part. Default 1. */
  thickness?: number;
  /** Relief mode: thickness of the base plate (the first shape's colour). */
  base?: number;
  /** Relief mode: thickness of the other colours on top of the base. Default 0.6. */
  relief?: number;
  /** Merge similar colours until at most this many remain (one filament each). Default: no limit. */
  colors?: number;
}

const NAMES: Record<string, string> = {
  '#000000': 'black', '#ffffff': 'white', '#ff0000': 'red', '#00ff00': 'lime', '#0000ff': 'blue', '#ffff00': 'yellow',
  '#00ffff': 'cyan', '#ff00ff': 'magenta', '#808080': 'gray', '#ffa500': 'orange', '#800080': 'purple', '#008000': 'green',
};
const colorName = (hex: string) => NAMES[hex] ?? hex.slice(1);

/** sRGB "#rrggbb" → CIE Lab (D65). */
function lab(hex: string): [number, number, number] {
  const lin = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [x, y, z] = [
    (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047,
    0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2],
    (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883,
  ].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Rough painted area of a shape (outline area, or length × width for strokes), for weighting colours. */
function roughArea(s: Shape): number {
  if (s.kind === 'stroke') {
    let len = 0;
    for (const { points } of s.paths) for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    return len * s.width;
  }
  let a = 0;
  for (const c of s.contours) {
    let t = 0;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) t += (c[j][0] + c[i][0]) * (c[j][1] - c[i][1]);
    a += t / 2; // holes wind the other way and subtract
  }
  return Math.abs(a);
}

/**
 * Merges the two closest colours (distance in Lab, which follows what the eye sees) until at most `max` remain.
 * The colour covering more area survives. Returns the shapes with their colours replaced.
 */
export function mergeColors(shapes: Shape[], max: number): Shape[] {
  const area = new Map<string, number>();
  for (const s of shapes) area.set(s.color, (area.get(s.color) ?? 0) + roughArea(s));
  const groups = [...area].map(([color, n]) => ({ color, n, lab: lab(color), members: [color], alive: true, near: -1, d: Infinity }));
  const dist = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // each group remembers its nearest neighbour; a merge keeps the survivor's colour, so only groups whose
  // nearest neighbour disappeared need to look again (about k² work instead of k³ for k colours)
  const findNear = (g: (typeof groups)[number]) => {
    g.near = -1; g.d = Infinity;
    groups.forEach((o, j) => {
      if (o === g || !o.alive) return;
      const d = dist(g.lab, o.lab);
      if (d < g.d) { g.d = d; g.near = j; }
    });
  };
  groups.forEach(findNear);
  for (let alive = groups.length; alive > Math.max(1, max); alive--) {
    const a = groups.reduce((best, g) => (g.alive && g.d < best.d ? g : best), { d: Infinity } as (typeof groups)[number]);
    const b = groups[a.near];
    const [keep, drop] = a.n >= b.n ? [a, b] : [b, a];
    keep.n += drop.n;
    keep.members.push(...drop.members);
    drop.alive = false;
    const dropped = groups.indexOf(drop);
    for (const g of groups) if (g.alive && g.near === dropped) findNear(g);
  }
  const to = new Map(groups.filter((g) => g.alive).flatMap((g) => g.members.map((m) => [m, g.color] as const)));
  return shapes.map((s) => (to.get(s.color) === s.color ? s : { ...s, color: to.get(s.color)! }));
}

/** By-colour mode: one part per distinct colour, flat (side by side) or as relief on a base plate. */
export function colorLayers(shapes: Shape[], { thickness = 1, base, relief = 0.6 }: ColorModeOptions = {}): ResolvedLayer[] {
  const colors = [...new Set(shapes.map((s) => s.color))];
  if (!colors.length) return [];
  if (base == null) {
    return colors.map((c, i) => ({ name: `${i + 1}-${colorName(c)}`, z: 0, height: thickness, op: 'add', match: (s) => s.color === c, displayColor: c }));
  }
  const baseColor = shapes[0].color;
  return [
    { name: `1-base-${colorName(baseColor)}`, z: 0, height: base, op: 'add', match: () => true, displayColor: baseColor },
    ...colors.filter((c) => c !== baseColor).map((c, i): ResolvedLayer => (
      { name: `${i + 2}-${colorName(c)}`, z: base, height: relief, op: 'add', match: (s) => s.color === c, displayColor: c })),
    // shapes in the base colour cover the relief beneath them, as they do in the drawing
    { name: 'erase', z: base, height: relief, op: 'erase', match: (s) => s.color === baseColor },
  ];
}

/** Config mode: layers from selectors and colours. */
export function configLayers(configs: LayerConfig[]): ResolvedLayer[] {
  const names = new Set<string>();
  return configs.map((c, i) => {
    if (!c.name) throw new Error(`Layer ${i + 1} has no name`);
    if (names.has(c.name)) throw new Error(`Layer name "${c.name}" is used twice`);
    names.add(c.name);
    const op = c.op ?? 'add';
    if (op === 'add' && !(c.height! > 0)) throw new Error(`Layer "${c.name}" needs a height > 0`);
    const selectors = c.select ? parseSelector(c.select) : null;
    if (c.select && !selectors) throw new Error(`Layer "${c.name}": selector "${c.select}" is not supported`);
    const excluded = c.exclude ? parseSelector(c.exclude) : null;
    if (c.exclude && !excluded) throw new Error(`Layer "${c.name}": selector "${c.exclude}" is not supported`);
    const colors = c.color == null ? null : (Array.isArray(c.color) ? c.color : [c.color]).map((v) => {
      const p = parseColor(v);
      if (!p) throw new Error(`Layer "${c.name}": colour "${v}" not understood`);
      return p.hex;
    });
    const match = (s: Shape) => {
      if (colors && !colors.includes(s.color)) return false;
      if (!selectors && !excluded) return true;
      const owners = ownersOf(s);
      return (!selectors || owners.some((el) => matches(el, selectors))) && (!excluded || !owners.some((el) => matches(el, excluded)));
    };
    return { name: c.name, z: c.z ?? 0, height: c.height ?? 0, op, match, from: c.from, clip: c.clip, displayColor: c.displayColor && parseColor(c.displayColor)?.hex };
  }).map((l, _, all) => {
    for (const ref of [...(l.from ?? []), ...(l.clip ? [l.clip] : [])]) {
      if (!all.some((o) => o.name === ref)) throw new Error(`Layer "${l.name}" refers to unknown layer "${ref}"`);
    }
    return l;
  });
}

export const overlapsZ = (a: { z: number; height: number }, b: { z: number; height: number }): boolean =>
  a.z < b.z + b.height - 1e-9 && b.z < a.z + a.height - 1e-9;
