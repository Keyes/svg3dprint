// svg3dprint: SVG → multicolour 3D print. Works in Node and in the browser.
import Module from 'manifold-3d';
import type { CrossSection } from 'manifold-3d';
import { FontLibrary, loadFontFaces, parseFontCached, type FontLoader } from './core/fonts.js';
import { parseSvg, renderShapes, warningCollector, type ParseOptions } from './core/svg.js';
import { mergeColors } from './core/color.js';
import type { Point, Shape, Warning } from './core/types.js';
import { boundsOf, checkLayers, composeLayers, extrudeLayer, rect, scope, toPathData, type LayerIssueCounts, type Mesh, type Wasm } from './geometry.js';
import { colorLayers, configLayers, type ColorModeOptions, type LayerConfig } from './layers.js';
import { previewSvg, type PreviewData } from './writers/preview.js';
import { toSTL } from './writers/stl.js';
import { to3MF } from './writers/threemf.js';
import { toBambu3MF, type BambuOptions } from './writers/bambu.js';

export type { LayerConfig, ColorModeOptions, LayerIssueCounts, Mesh, Warning, CrossSection };
export { toSTL, to3MF, toBambu3MF };
export { projectInfo, plateLayout, plateCapacity, type BambuPart, type BambuObject, type BambuPlate, type BambuOptions, type ProjectInfo } from './writers/bambu.js';

export const DEFAULT_MIN_FEATURE = 0.35;

export interface CheckOptions {
  /** Lines and gaps narrower than this (mm) are reported. Default 0.35. */
  minFeature?: number;
  /** Grow islands smaller than this (mm), e.g. full stops, so slicers don't drop them. Default 0 (off). */
  minDot?: number;
}

export interface Options extends ColorModeOptions {
  /** Config mode: explicit layers. Without it, every colour becomes a part (by-colour mode). */
  layers?: LayerConfig[];
  /** Scale factor on top of the size the SVG declares. */
  scale?: number;
  /** Scale so the drawing is this wide (mm). Overrides `scale`. */
  width?: number;
  /** Scale so the drawing is this tall (mm). Overrides `scale`; ignored if `width` is set. */
  height?: number;
  /** Cut everything to the SVG's viewport (artboard), as a browser shows it. Default true. */
  clip?: boolean;
  check?: CheckOptions;
  /** Values for {{variables}} in the SVG. */
  vars?: Record<string, string>;
  /** Extra fonts, in addition to those embedded with @font-face. */
  fonts?: { family: string; data: Uint8Array; weight?: number; style?: string }[];
  /** Reads @font-face fonts that point at a file or URL instead of a data: URI. Without it, only embedded fonts load. */
  loadFont?: FontLoader;
  DOMParser?: ParseOptions['DOMParser'];
}

export interface LayerResult {
  name: string;
  /** Display colour, "#rrggbb". */
  color: string;
  z: number;
  height: number;
  mesh: Mesh;
  /** Top view as SVG path data, in mm in the SVG's coordinates (y down), even-odd fill. */
  outline: string;
  /** mm³ */
  volume: number;
  issues: LayerIssueCounts;
}

export interface Report {
  ok: boolean;
  /** Overall size [x, y, z] in mm. */
  size: [number, number, number];
  minFeature: number;
  layers: Omit<LayerResult, 'mesh' | 'outline'>[];
  warnings: Warning[];
}

export interface BuildResult {
  layers: LayerResult[];
  size: [number, number, number];
  warnings: Warning[];
  /** No printability issues found. */
  ok: boolean;
  report(): Report;
  /** Top view of the print geometry with issues highlighted (thin: red, gaps: amber, floating: purple). */
  previewSvg(options?: { issues?: boolean }): string;
  to3MF(name?: string): Promise<Uint8Array>;
  /**
   * Bambu Studio project: the model on one plate of a copy of `project` (a .3mf saved from Bambu Studio), one
   * filament slot per colour. For several objects or plates, use toBambu3MF() directly.
   */
  toBambu3MF(project: Uint8Array, options?: BambuOptions & { name?: string }): Promise<Uint8Array>;
  /** One STL per layer (STL has no colours). */
  toSTL(): { name: string; data: Uint8Array }[];
}

let wasmPromise: Promise<Wasm> | null = null;

/** Loads the geometry kernel (WASM). Called automatically; call it yourself to pass `locateFile` in a browser bundle. */
export function init(options?: { locateFile?: () => string }): Promise<Wasm> {
  wasmPromise ??= Module(options as { locateFile: () => string }).then((m) => { m.setup(); return m; });
  return wasmPromise;
}

async function prepare(svgText: string, options: Options, warn: (c: string, m: string) => void) {
  const svg = parseSvg(svgText, { vars: options.vars, scale: options.scale, DOMParser: options.DOMParser }, warn);
  const fonts = new FontLibrary();
  await loadFontFaces(svg.stylesheet.fontFaces, fonts, warn, options.loadFont);
  for (const f of options.fonts ?? []) fonts.add(f.family, await parseFontCached(f.data), { weight: f.weight, style: f.style });
  return { svg, fonts };
}

type Warn = (code: string, message: string) => void;
type Sections = Map<string, CrossSection>;

/** By-colour mode: merges similar colours down to `options.colors`, or warns if there are many. */
function mergeStep(shapes: Shape[], options: Options, warn: Warn): Shape[] {
  if (options.layers?.length) {
    if (options.colors) warn('colors-ignored', '--colors only applies in colour mode; with a layer config, the layers decide the parts');
    return shapes;
  }
  const colors = new Set(shapes.map((s) => s.color)).size;
  if (options.colors && colors > options.colors) return mergeColors(shapes, options.colors);
  if (!options.colors && colors > 4) warn('many-colors', `${colors} colours become ${colors} parts, one filament each. To merge similar colours, use --colors 4 (or the number of filaments you have)`);
  return shapes;
}

function clipToViewport(wasm: Wasm, sections: Sections, w: number, h: number, k: ReturnType<typeof scope>, warn: Warn): Sections {
  const b = boundsOf(sections.values());
  if (!(b && (b.min[0] < -1e-6 || b.min[1] < -1e-6 || b.max[0] > w + 1e-6 || b.max[1] > h + 1e-6))) return sections;
  warn('outside-viewport', 'Parts of the drawing lie outside the SVG viewport and were cut off (use --no-clip to keep them)');
  const view = k(rect(wasm, 0, 0, w, h));
  return new Map([...sections].map(([n, cs]) => [n, k(cs.intersect(view))]));
}

/** Scales to `options.width`/`height`. Frees `k` and throws if nothing is left to print. */
function fitToSize(sections: Sections, options: Options, k: ReturnType<typeof scope>) {
  const bounds = boundsOf(sections.values());
  if (!bounds) { k.free(); throw new Error('Every layer is empty'); }
  const fitTo = options.width ? options.width / (bounds.max[0] - bounds.min[0]) : options.height ? options.height / (bounds.max[1] - bounds.min[1]) : null;
  if (!fitTo || Math.abs(fitTo - 1) <= 1e-9) return { sections, bounds };
  const scaled = new Map([...sections].map(([n, cs]) => [n, k(cs.scale(fitTo))]));
  return { sections: scaled, bounds: boundsOf(scaled.values())! };
}

export async function build(svgText: string, options: Options = {}): Promise<BuildResult> {
  const wasm = await init();
  const { list: warnings, warn } = warningCollector();
  const { svg, fonts } = await prepare(svgText, options, warn);
  const rendered = renderShapes(svg, fonts, warn);
  if (!rendered.length) throw new Error('The SVG has nothing to print (no filled or stroked shapes)');
  const shapes = mergeStep(rendered, options, warn);
  const layers = options.layers?.length ? configLayers(options.layers) : colorLayers(shapes, options);
  const minFeature = options.check?.minFeature ?? DEFAULT_MIN_FEATURE;

  const k = scope();
  const composed = composeLayers(wasm, shapes, layers, { minDot: options.check?.minDot ?? 0 });
  composed.forEach((cs) => k(cs));
  const printed = layers.filter((l) => composed.has(l.name));
  for (const l of printed) if (composed.get(l.name)!.isEmpty()) warn('empty-layer', `Layer "${l.name}" is empty (covered by shapes drawn on top of it, or cut away) and was left out`);
  const unmatched = shapes.filter((s) => !layers.some((l) => l.match(s))).length;
  if (unmatched) warn('unmatched', `${unmatched} shape${unmatched > 1 ? 's' : ''} matched no layer and ${unmatched > 1 ? 'were' : 'was'} left out`);
  const clipped = options.clip === false ? composed : clipToViewport(wasm, composed, svg.widthMm, svg.heightMm, k, warn);
  const { sections, bounds } = fitToSize(clipped, options, k);

  const issues = checkLayers(wasm, layers, sections, minFeature);
  const center: Point = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
  const results: LayerResult[] = printed.filter((l) => !sections.get(l.name)!.isEmpty()).map((l) => {
    const cs = sections.get(l.name)!;
    const { mesh, volume } = extrudeLayer(wasm, cs, center, l.z, l.height);
    const { areas: _a, ...counts } = issues.get(l.name)!;
    return {
      name: l.name,
      color: l.displayColor ?? shapes.find((s) => l.match(s))?.color ?? '#808080',
      z: l.z, height: l.height, mesh, volume,
      outline: toPathData(cs),
      issues: counts,
    };
  });

  // keep the preview as path data so no WASM memory outlives this call
  const preview: PreviewData = {
    viewBox: [bounds.min[0], bounds.min[1], bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]],
    layers: [...results].sort((a, b) => a.z - b.z).map((r) => ({ color: r.color, d: r.outline })),
    issues: [...issues.values()].map(({ areas: a }) => ({ thin: toPathData(a.thin), gaps: toPathData(a.gaps), floating: toPathData(a.floating) })),
  };
  for (const { areas: a } of issues.values()) { a.thin.delete(); a.gaps.delete(); a.floating.delete(); }
  k.free();

  const size: [number, number, number] = [preview.viewBox[2], preview.viewBox[3], Math.max(...results.map((r) => r.z + r.height))];
  const ok = results.every((r) => !r.issues.thin && !r.issues.gaps && !r.issues.floating);

  return {
    layers: results,
    size,
    warnings,
    ok,
    report: () => ({
      ok, size, minFeature,
      layers: results.map(({ mesh: _m, outline: _o, ...r }) => ({ ...r, volume: Math.round(r.volume * 100) / 100 })),
      warnings,
    }),
    previewSvg: (opts) => previewSvg(preview, opts),
    to3MF: (name) => to3MF(results.map((r) => ({ name: r.name, color: r.color, mesh: r.mesh })), { name }),
    toBambu3MF: (project, { name = 'svg3dprint', ...opts } = {}) =>
      toBambu3MF(project, [{ name, objects: [{ name, parts: results.map((r) => ({ name: r.name, color: r.color, mesh: r.mesh })) }] }], opts),
    toSTL: () => results.map((r) => ({ name: r.name, data: toSTL(r.mesh, r.name) })),
  };
}

export interface Inspection {
  /** Viewport size in mm, as declared by the SVG (after `scale`). */
  size: [number, number];
  colors: { color: string; shapes: number }[];
  /** Fonts embedded with @font-face. */
  fonts: string[];
  variables: string[];
  shapes: number;
  warnings: Warning[];
  /** Set if the SVG can't be rendered (e.g. a font is missing). */
  error?: string;
}

/** What's in an SVG: size, colours, fonts, variables, and anything that won't print as drawn. */
export async function inspect(svgText: string, options: Options = {}): Promise<Inspection> {
  const { list: warnings, warn } = warningCollector();
  const { svg, fonts } = await prepare(svgText, options, warn);
  const result: Inspection = { size: [svg.widthMm, svg.heightMm], colors: [], fonts: fonts.families, variables: svg.variables, shapes: 0, warnings };
  try {
    const shapes = renderShapes(svg, fonts, warn);
    result.shapes = shapes.length;
    const counts = new Map<string, number>();
    for (const s of shapes) counts.set(s.color, (counts.get(s.color) ?? 0) + 1);
    result.colors = [...counts].map(([color, n]) => ({ color, shapes: n }));
  } catch (e) {
    result.error = (e as Error).message;
  }
  return result;
}

