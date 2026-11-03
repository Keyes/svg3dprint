// Shapes → manifold cross sections → layers (painter's order) → printability check → meshes.
// All 2D work happens in millimetres with y down (SVG orientation); meshes are y up.
import type { CrossSection, ManifoldToplevel } from 'manifold-3d';
import type { Point, Shape, StrokeShape } from './core/types.js';
import { overlapsZ, type ResolvedLayer } from './layers.js';

export type Wasm = ManifoldToplevel;

/** Max deviation of round joins, caps and dots from the true circle, mm. */
const ARC_TOL = 0.01;

/** Tracks WASM objects so intermediate results can be freed in one go. */
export function scope() {
  const objs: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(o: T): T => { objs.push(o); return o; };
  const free = (...except: unknown[]) => {
    for (const o of objs) if (!except.includes(o)) o.delete();
    objs.length = 0;
  };
  return Object.assign(keep, { free });
}
type Keep = ReturnType<typeof scope>;

const segmentsFor = (r: number) => Math.max(8, Math.min(96, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - ARC_TOL / r)))));

const empty = (wasm: Wasm) => new wasm.CrossSection([[]]);

function strokeSection(wasm: Wasm, s: StrokeShape, k: Keep): CrossSection {
  const { CrossSection } = wasm;
  const r = s.width / 2;
  const polys: Point[][] = [];
  const circles: Point[] = [];
  for (const { points: raw, closed } of s.paths) {
    const pts = closed && raw.length > 2 ? [...raw, raw[0]] : raw;
    if (pts.length < 2) {
      if (pts.length === 1 && s.cap !== 'butt') circles.push(pts[0]);
      continue;
    }
    const dirs: Point[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      dirs.push([(x1 - x0) / len, (y1 - y0) / len]);
    }
    // segment bodies (square caps extend the first and last segment)
    for (let i = 0; i + 1 < pts.length; i++) {
      let [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const [dx, dy] = dirs[i];
      if (!closed && s.cap === 'square') {
        if (i === 0) { x0 -= dx * r; y0 -= dy * r; }
        if (i === pts.length - 2) { x1 += dx * r; y1 += dy * r; }
      }
      const nx = -dy * r, ny = dx * r;
      polys.push([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
    }
    // joins
    const joinAt = (p: Point, a: Point, b: Point) => {
      const cross = a[0] * b[1] - a[1] * b[0], dot = a[0] * b[0] + a[1] * b[1];
      const turn = Math.atan2(Math.abs(cross), dot);
      if (turn < 1e-6) return;
      const side = cross > 0 ? -1 : 1; // outer side of the turn
      const pa: Point = [p[0] - a[1] * r * side, p[1] + a[0] * r * side];
      const pb: Point = [p[0] - b[1] * r * side, p[1] + b[0] * r * side];
      const miterRatio = 1 / Math.cos(turn / 2); // miter length / stroke width
      if (s.join === 'round' && turn > 0.25) { circles.push(p); return; }
      if ((s.join === 'miter' || s.join === 'round') && miterRatio <= (s.join === 'round' ? Infinity : s.miterLimit)) {
        const mx = (pa[0] + pb[0]) / 2 - p[0], my = (pa[1] + pb[1]) / 2 - p[1];
        const ml = Math.hypot(mx, my) || 1, len = r * miterRatio;
        polys.push([p, pa, [p[0] + (mx / ml) * len, p[1] + (my / ml) * len], pb]);
      } else polys.push([p, pa, pb]);
    };
    for (let i = 1; i + 1 < pts.length; i++) joinAt(pts[i], dirs[i - 1], dirs[i]);
    if (closed && raw.length > 2) joinAt(pts[0], dirs[dirs.length - 1], dirs[0]);
    else if (s.cap === 'round') circles.push(pts[0], pts[pts.length - 1]);
  }
  const parts: CrossSection[] = polys.map((p) => k(new CrossSection([p], 'NonZero')));
  const n = segmentsFor(r);
  for (const c of circles) parts.push(k(k(CrossSection.circle(r, n)).translate(c)));
  return parts.length ? k(CrossSection.union(parts)) : k(empty(wasm));
}


function shapeSection(wasm: Wasm, s: Shape, k: Keep): CrossSection {
  let cs = s.kind === 'fill' ? k(new wasm.CrossSection(s.contours, s.fillRule)) : strokeSection(wasm, s, k);
  if (s.grow) cs = k(cs.offset(s.grow, 'Round', 2, segmentsFor(s.grow)));
  for (const clip of s.clips) {
    const region = clip.length ? k(wasm.CrossSection.union(clip.map((c) => shapeSection(wasm, c, k)))) : k(empty(wasm));
    cs = k(cs.intersect(region));
  }
  return cs;
}

const signedArea = (poly: readonly (readonly number[])[]) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return -a / 2;
};

function insidePolygon([x, y]: readonly number[], poly: readonly (readonly number[])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Splits a cross section into its connected pieces (an outline with its holes), skipping pieces whose outline
 * encloses less than `minArea`. Does the same as decompose(), but in JS: decompose() overflows the WASM stack on
 * sets of many thousands of slivers, which is exactly what an opening or closing of a large drawing produces.
 */
export function splitPieces(wasm: Wasm, cs: CrossSection, minArea = 0): CrossSection[] {
  const polys = cs.toPolygons().map((p) => ({ p, a: signedArea(p) }));
  const outers = polys.filter((x) => x.a > 0).map((x) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of x.p) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
    return { ...x, box: [x0, y0, x1, y1], holes: [] as (readonly (readonly number[])[])[] };
  });
  for (const hole of polys.filter((x) => x.a < 0)) {
    const [hx, hy] = hole.p[0];
    let best: (typeof outers)[number] | null = null;
    for (const o of outers) {
      if (hx < o.box[0] || hx > o.box[2] || hy < o.box[1] || hy > o.box[3] || o.a < -hole.a) continue;
      if ((!best || o.a < best.a) && insidePolygon(hole.p[0], o.p)) best = o;
    }
    best?.holes.push(hole.p);
  }
  return outers.filter((o) => o.a > minArea).map((o) => new wasm.CrossSection([o.p, ...o.holes] as [number, number][][], 'EvenOdd'));
}

/**
 * Grows islands smaller than `minSize` (full stops, i-dots) to that size, only into free space.
 * Slicers collapse a dot smaller than ~2 line widths to nothing.
 */
function growDots(wasm: Wasm, cs: CrossSection, minSize: number, k: Keep): CrossSection {
  const { CrossSection } = wasm;
  const pieces = splitPieces(wasm, cs).map((p) => k(p));
  const sizeOf = (p: CrossSection) => {
    const { min, max } = p.bounds();
    return Math.max(max[0] - min[0], max[1] - min[1]);
  };
  const dots = pieces.filter((p) => sizeOf(p) < minSize);
  if (!dots.length) return cs;
  // keep ~0.45 × minSize clear of everything else, so islands inside knocked-out lettering don't fill their surroundings
  const rest = pieces.filter((p) => !dots.includes(p));
  const keepOut = rest.length ? k(k(CrossSection.union(rest)).offset(minSize * 0.45, 'Round', 2, segmentsFor(minSize * 0.45))) : null;
  const grown = dots.map((p) => {
    const g = k(p.offset((minSize - sizeOf(p)) / 2, 'Round', 2, segmentsFor(minSize / 2)));
    return keepOut ? k(k(g.subtract(keepOut)).add(p)) : g;
  });
  return k(CrossSection.union([...rest, ...grown]));
}

export interface ComposeOptions {
  /** Grow islands smaller than this (mm) in every layer. 0 = off. */
  minDot?: number;
}

/**
 * Builds the final 2D footprint of every printed layer (op "add"), in layer order.
 * Painter's order: a later shape cuts earlier shapes of every other layer whose z range overlaps its own.
 * The caller owns the returned cross sections.
 */
export function composeLayers(wasm: Wasm, shapes: Shape[], layers: ResolvedLayer[], { minDot = 0 }: ComposeOptions = {}): Map<string, CrossSection> {
  const { CrossSection } = wasm;
  const k = scope();
  const painted = layers.map((l, i) => i).filter((i) => layers[i].op !== 'subtract');
  const overlapping = new Map(painted.map((i) => [i, painted.filter((j) => j !== i && overlapsZ(layers[i], layers[j]))]));

  // one cross section per shape; intermediates (strokes, clips) are freed right away
  const sections = new Map<number, CrossSection>();
  const sectionOf = (i: number) => {
    let cs = sections.get(i);
    if (!cs) {
      const local = scope();
      cs = shapeSection(wasm, shapes[i], local);
      local.free(cs);
      sections.set(i, k(cs));
    }
    return cs;
  };

  // A later shape j cuts shape i out of layer L if j paints a layer at L's height but not L itself.
  // Only shapes whose bounding boxes overlap can cut each other, which keeps large drawings fast.
  const membership = shapes.map((s) => painted.filter((i) => layers[i].match(s)));
  const live = shapes.map((_, i) => membership[i].length > 0 && !sectionOf(i).isEmpty());
  const boxes = shapes.map((_, i) => (live[i] ? sectionOf(i).bounds() : null));
  const touches = (a: number, b: number) => {
    const p = boxes[a]!, q = boxes[b]!;
    return p.min[0] < q.max[0] && q.min[0] < p.max[0] && p.min[1] < q.max[1] && q.min[1] < p.max[1];
  };
  const pieces = new Map<number, CrossSection[]>(painted.map((i) => [i, []]));
  for (let i = 0; i < shapes.length; i++) {
    if (!live[i]) continue;
    const byCutters = new Map<string, CrossSection>();
    for (const L of membership[i]) {
      const cutters: number[] = [];
      for (let j = i + 1; j < shapes.length; j++) {
        if (live[j] && !membership[j].includes(L) && membership[j].some((A) => overlapping.get(L)!.includes(A)) && touches(i, j)) cutters.push(j);
      }
      const key = cutters.join(',');
      let visible = byCutters.get(key);
      if (!visible) {
        visible = cutters.length ? k(sectionOf(i).subtract(k(CrossSection.union(cutters.map(sectionOf))))) : sectionOf(i);
        byCutters.set(key, visible);
      }
      pieces.get(L)!.push(visible);
    }
  }
  const acc = new Map<number, CrossSection>(painted.map((i) => [i, k(pieces.get(i)!.length ? CrossSection.union(pieces.get(i)!) : empty(wasm))]));

  if (minDot > 0) {
    for (const i of painted) {
      if (layers[i].op !== 'add') continue;
      const before = acc.get(i)!;
      const grown = growDots(wasm, before, minDot, k);
      if (grown === before) continue;
      const delta = k(grown.subtract(before));
      acc.set(i, grown);
      for (const j of overlapping.get(i)!) acc.set(j, k(acc.get(j)!.subtract(delta)));
    }
  }

  layers.forEach((l, li) => {
    if (l.op !== 'subtract') return;
    const sel = shapes.map((s, i) => i).filter((i) => l.match(shapes[i]));
    if (!sel.length) return;
    const cut = k(CrossSection.union(sel.map(sectionOf)));
    for (const i of painted) {
      if (layers[i].op === 'add' && (!l.from || l.from.includes(layers[i].name))) acc.set(i, k(acc.get(i)!.subtract(cut)));
    }
    void li;
  });

  for (const i of painted) {
    const clip = layers[i].clip;
    if (!clip) continue;
    const j = layers.findIndex((l) => l.name === clip);
    if (acc.has(j)) acc.set(i, k(acc.get(i)!.intersect(acc.get(j)!)));
  }

  const out = new Map<string, CrossSection>();
  for (const i of painted) if (layers[i].op === 'add') out.set(layers[i].name, acc.get(i)!);
  k.free(...out.values());
  return out;
}

/** Bounds of several cross sections together, or null if all are empty. */
export function boundsOf(sections: Iterable<CrossSection>): { min: Point; max: Point } | null {
  let min: Point = [Infinity, Infinity], max: Point = [-Infinity, -Infinity];
  for (const cs of sections) {
    if (cs.isEmpty()) continue;
    const b = cs.bounds();
    min = [Math.min(min[0], b.min[0]), Math.min(min[1], b.min[1])];
    max = [Math.max(max[0], b.max[0]), Math.max(max[1], b.max[1])];
  }
  return min[0] === Infinity ? null : { min, max };
}

// ---------- printability check ----------

export interface LayerIssues {
  /** Lines narrower than the minimum feature size. */
  thin: CrossSection;
  /** Gaps between areas of the layer narrower than the minimum feature size (they would close up). */
  gaps: CrossSection;
  /** Areas of a raised layer with nothing beneath them. */
  floating: CrossSection;
  thinCount: number;
  gapCount: number;
  floatingCount: number;
}

/** Contour count, ignoring hairline slivers that boolean round-off leaves where pieces rejoin. */
function topology(cs: CrossSection, minArea: number): number {
  return cs.toPolygons().filter((poly) => {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    return Math.abs(a / 2) > minArea;
  }).length;
}

/**
 * Finds features of every layer that won't print as drawn. `minFeature` in mm.
 * Sharp corners always produce wedges in an opening/closing (V-notches, pointed tips) that the slicer just rounds off,
 * so a piece only counts if printing it "wrong" changes the layer's topology (a gap that would merge two shapes or
 * fill a counter, a thin line whose loss splits a shape), or if it is large.
 */
export function checkLayers(wasm: Wasm, layers: ResolvedLayer[], sections: Map<string, CrossSection>, minFeature: number): Map<string, LayerIssues> {
  const { CrossSection } = wasm;
  const r = minFeature / 2;
  const bigArea = 40 * r * r;
  const result = new Map<string, LayerIssues>();
  const printed = layers.filter((l) => sections.has(l.name));

  // Topology is compared in a window around each piece, so the test stays local (and cheap) on large layers.
  // The margin is wide enough to hold a whole letter counter at text sizes that print. Windows are cut from
  // cached tiles of the layer rather than from the whole layer, which matters for drawings with thousands of shapes.
  const margin = Math.max(3, 10 * r);
  const TILE = 16, PAD = 2 * margin + 8;
  const rect = (x0: number, y0: number, x1: number, y1: number) => new CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
  const tilesOf = new Map<CrossSection, Map<string, CrossSection>>();
  const regionFor = (cs: CrossSection, x0: number, y0: number, x1: number, y1: number): CrossSection => {
    const tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
    if (x1 > (tx + 1) * TILE + PAD || y1 > (ty + 1) * TILE + PAD) return cs; // window too big for a tile
    let tiles = tilesOf.get(cs);
    if (!tiles) tilesOf.set(cs, (tiles = new Map()));
    let tile = tiles.get(`${tx},${ty}`);
    if (!tile) {
      const r0 = rect(tx * TILE, ty * TILE, (tx + 1) * TILE + PAD, (ty + 1) * TILE + PAD);
      tile = cs.intersect(r0);
      r0.delete();
      tiles.set(`${tx},${ty}`, tile);
    }
    return tile;
  };
  const changesTopology = (cs: CrossSection, piece: CrossSection, op: 'add' | 'subtract') => {
    const b = piece.bounds();
    const [x0, y0, x1, y1] = [b.min[0] - margin, b.min[1] - margin, b.max[0] + margin, b.max[1] + margin];
    const win = rect(x0, y0, x1, y1);
    const local = regionFor(cs, x0, y0, x1, y1).intersect(win);
    const changed = op === 'add' ? local.add(piece) : local.subtract(piece);
    const result = topology(local, r * r) !== topology(changed, r * r);
    win.delete(); local.delete(); changed.delete();
    return result;
  };

  const occupiedBy = new Map<string, CrossSection>();
  for (const layer of printed) {
    const k = scope();
    const cs = sections.get(layer.name)!;
    const significant = (piece: CrossSection, changesTopology: (p: CrossSection) => boolean) => {
      const pieces = splitPieces(wasm, piece, 2 * r * r).filter((p) => {
        const keep = p.area() > 2 * r * r && (p.area() > bigArea || changesTopology(p));
        if (!keep) p.delete();
        return keep;
      });
      const out = pieces.length ? CrossSection.compose(pieces) : empty(wasm);
      pieces.forEach((p) => p.delete());
      return { cs: out, count: pieces.length };
    };
    const opened = k(k(cs.offset(-r, 'Round', 2, segmentsFor(r))).offset(r, 'Round', 2, segmentsFor(r)));
    const thin = significant(k(cs.subtract(opened)), (p) => changesTopology(cs, p, 'subtract'));

    // what fills the space next to this layer: every printed layer at the same height
    const sameZ = printed.filter((o) => overlapsZ(o, layer));
    const key = sameZ.map((o) => o.name).join('\n');
    let occupied = occupiedBy.get(key);
    if (!occupied) occupiedBy.set(key, (occupied = CrossSection.union(sameZ.map((o) => sections.get(o.name)!))));
    // a raised layer only matters where something holds it up
    const below = printed.filter((o) => layer.z > 1e-9 && Math.abs(o.z + o.height - layer.z) < 1e-6).map((o) => sections.get(o.name)!);
    const support = below.length ? k(CrossSection.union(below)) : null;
    const closed = k(k(cs.offset(r, 'Round', 2, segmentsFor(r))).offset(-r, 'Round', 2, segmentsFor(r)));
    let gapArea = k(closed.subtract(occupied));
    if (support) gapArea = k(gapArea.intersect(support));
    const gaps = significant(gapArea, (p) => changesTopology(cs, p, 'add'));

    let floating = { cs: empty(wasm), count: 0 };
    if (layer.z > 1e-9) {
      floating.cs.delete();
      const unsupported = support ? k(cs.subtract(support)) : cs;
      floating = significant(unsupported, () => true);
    }
    k.free();
    result.set(layer.name, { thin: thin.cs, gaps: gaps.cs, floating: floating.cs, thinCount: thin.count, gapCount: gaps.count, floatingCount: floating.count });
  }
  for (const tiles of tilesOf.values()) for (const t of tiles.values()) t.delete();
  for (const o of occupiedBy.values()) o.delete();
  return result;
}

// ---------- meshes ----------

export interface Mesh {
  /** xyz per vertex, mm. */
  vertices: Float32Array;
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  triangles: Uint32Array;
}

/**
 * Extrudes a layer footprint (mm, y down) into a mesh: y flipped to point up, `center` moved to the origin,
 * bottom at z, `height` thick.
 */
export function extrudeLayer(wasm: Wasm, cs: CrossSection, center: Point, z: number, height: number): { mesh: Mesh; volume: number } {
  const k = scope();
  const placed = k(k(cs.translate([-center[0], -center[1]])).mirror([0, 1]));
  const solid = k(k(placed.extrude(height)).translate([0, 0, z]));
  const g = solid.getMesh();
  const n = g.numProp;
  const vertices = new Float32Array((g.vertProperties.length / n) * 3);
  for (let i = 0, j = 0; i < g.vertProperties.length; i += n, j += 3) {
    vertices[j] = g.vertProperties[i];
    vertices[j + 1] = g.vertProperties[i + 1];
    vertices[j + 2] = g.vertProperties[i + 2];
  }
  const result = { mesh: { vertices, triangles: new Uint32Array(g.triVerts) }, volume: solid.volume() };
  k.free();
  return result;
}

/** Polygons → SVG path data (same units as the cross section). */
export function toPathData(cs: CrossSection): string {
  return cs.toPolygons().map((poly) => 'M' + poly.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join('L') + 'Z').join('');
}
