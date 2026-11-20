// CSS colour values → "#rrggbb", and colour maths (Lab distance, merging similar colours).
import type { Shape } from './types.js';

const NAMED = Object.fromEntries(
  ('aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,' +
  'blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,' +
  'chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,' +
  'darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,' +
  'darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,' +
  'darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,' +
  'darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,' +
  'firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,' +
  'goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,' +
  'indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,' +
  'lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,' +
  'lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,' +
  'lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,' +
  'linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,' +
  'mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,' +
  'mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,' +
  'navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,' +
  'palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,' +
  'peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,' +
  'royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,' +
  'silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,' +
  'steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,' +
  'white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32')
    .split(',').map((p) => p.split(':')),
);

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

const alphaOf = (s: string | undefined) => (s == null ? 1 : s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s));

export interface Color { hex: string; alpha: number }

/** Parses a CSS colour. Returns null for "none", "transparent", url(...) and anything unparseable. */
export function parseColor(value: string | null | undefined): Color | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return null;
  if (NAMED[v]) return { hex: '#' + NAMED[v], alpha: 1 };
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/.exec(v))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { hex: '#' + h.slice(0, 6), alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  if ((m = /^rgba?\(([^)]*)\)$/.exec(v))) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (s: string) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s));
    return { hex: '#' + hex2(ch(parts[0])) + hex2(ch(parts[1])) + hex2(ch(parts[2])), alpha: alphaOf(parts[3]) };
  }
  if ((m = /^hsla?\(([^)]*)\)$/.exec(v))) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const h = ((parseFloat(parts[0]) % 360) + 360) % 360, s = parseFloat(parts[1]) / 100, l = parseFloat(parts[2]) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return { hex: '#' + hex2(f(0)) + hex2(f(8)) + hex2(f(4)), alpha: alphaOf(parts[3]) };
  }
  return null;
}

/** Shoelace area of a polygon; positive for outlines, negative for holes (y down). Here so core needs no geometry. */
export const signedArea = (poly: readonly (readonly number[])[]) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return -a / 2;
};

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
  for (const c of s.contours) a += signedArea(c); // holes wind the other way and subtract
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
