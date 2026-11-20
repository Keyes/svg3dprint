// svg3dprint: SVG → multicolour 3D print. Works in Node and in the browser.
import Module from 'manifold-3d';
import type { CrossSection } from 'manifold-3d';
import { FontLibrary, loadFontFaces, parseFontCached, type FontLoader } from './core/fonts.js';
import { parseSvg, renderShapes, warningCollector, type ParseOptions } from './core/svg.js';
import type { Point, Shape, Warning } from './core/types.js';
import { boundsOf, checkLayers, composeLayers, extrudeLayer, scope, toPathData, type Mesh, type Wasm } from './geometry.js';
import { colorLayers, configLayers, mergeColors, type ColorModeOptions, type LayerConfig, type ResolvedLayer } from './layers.js';
import { toSTL } from './writers/stl.js';
import { to3MF } from './writers/threemf.js';
import { toBambu3MF, type BambuOptions } from './writers/bambu.js';

export type { LayerConfig, ColorModeOptions, Mesh, Warning };
export { toSTL, to3MF, toBambu3MF };
export { projectInfo, plateLayout, type BambuPart, type BambuObject, type BambuPlate, type BambuOptions, type ProjectInfo } from './writers/bambu.js';

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

export interface LayerIssueCounts {
  thin: number;
  gaps: number;
  floating: number;
  /** Area of the largest problem spot, mm² (0 if none). */
  largest: number;
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
  layers: { name: string; color: string; z: number; height: number; volume: number; issues: LayerIssueCounts }[];
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

function resolveLayers(shapes: Shape[], options: Options): ResolvedLayer[] {
  return options.layers?.length ? configLayers(options.layers) : colorLayers(shapes, options);
}

export async function build(svgText: string, options: Options = {}): Promise<BuildResult> {
  const wasm = await init();
  const { list: warnings, warn } = warningCollector();
  const { svg, fonts } = await prepare(svgText, options, warn);
  let shapes = renderShapes(svg, fonts, warn);
  if (!shapes.length) throw new Error('The SVG has nothing to print (no filled or stroked shapes)');
  if (options.colors && options.layers?.length) warn('colors-ignored', '--colors only applies in colour mode; with a layer config, the layers decide the parts');
  if (!options.layers?.length) {
    const colors = new Set(shapes.map((s) => s.color)).size;
    if (options.colors && colors > options.colors) shapes = mergeColors(shapes, options.colors);
    else if (!options.colors && colors > 4) warn('many-colors', `${colors} colours become ${colors} parts, one filament each. To merge similar colours, use --colors 4 (or the number of filaments you have)`);
  }
  const layers = resolveLayers(shapes, options);
  const minFeature = options.check?.minFeature ?? DEFAULT_MIN_FEATURE;

  const k = scope();
  let sections = composeLayers(wasm, shapes, layers, { minDot: options.check?.minDot ?? 0 });
  sections.forEach((cs) => k(cs));
  const printed = layers.filter((l) => sections.has(l.name));
  for (const l of printed) if (sections.get(l.name)!.isEmpty()) warn('empty-layer', `Layer "${l.name}" is empty (covered by shapes drawn on top of it, or cut away) and was left out`);
  const unmatched = shapes.filter((s) => !layers.some((l) => l.match(s))).length;
  if (unmatched) warn('unmatched', `${unmatched} shape${unmatched > 1 ? 's' : ''} matched no layer and ${unmatched > 1 ? 'were' : 'was'} left out`);

  if (options.clip !== false) {
    const before = boundsOf(sections.values());
    const [w, h] = [svg.widthMm, svg.heightMm];
    if (before && (before.min[0] < -1e-6 || before.min[1] < -1e-6 || before.max[0] > w + 1e-6 || before.max[1] > h + 1e-6)) {
      warn('outside-viewport', 'Parts of the drawing lie outside the SVG viewport and were cut off (use --no-clip to keep them)');
      const view = k(new wasm.CrossSection([[[0, 0], [w, 0], [w, h], [0, h]]]));
      sections = new Map([...sections].map(([n, cs]) => [n, k(cs.intersect(view))]));
    }
  }
  let bounds = boundsOf(sections.values());
  if (!bounds) { k.free(); throw new Error('Every layer is empty'); }
  const fitTo = options.width ? options.width / (bounds.max[0] - bounds.min[0]) : options.height ? options.height / (bounds.max[1] - bounds.min[1]) : null;
  if (fitTo && Math.abs(fitTo - 1) > 1e-9) {
    sections = new Map([...sections].map(([n, cs]) => [n, k(cs.scale(fitTo))]));
    bounds = boundsOf(sections.values())!;
  }

  const issues = checkLayers(wasm, layers, sections, minFeature);
  const center: Point = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
  const results: LayerResult[] = printed.filter((l) => !sections.get(l.name)!.isEmpty()).map((l) => {
    const cs = sections.get(l.name)!;
    const { mesh, volume } = extrudeLayer(wasm, cs, center, l.z, l.height);
    const is = issues.get(l.name)!;
    return {
      name: l.name,
      color: l.displayColor ?? shapes.find((s) => l.match(s))?.color ?? '#808080',
      z: l.z, height: l.height, mesh, volume,
      outline: toPathData(cs),
      issues: { thin: is.thinCount, gaps: is.gapCount, floating: is.floatingCount, largest: is.largest },
    };
  });

  // keep the preview as path data so no WASM memory outlives this call
  const preview = {
    viewBox: [bounds.min[0], bounds.min[1], bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]],
    layers: [...results].sort((a, b) => a.z - b.z).map((r) => ({ color: r.color, d: r.outline })),
    issues: [...issues.values()].map((is) => ({ thin: toPathData(is.thin), gaps: toPathData(is.gaps), floating: toPathData(is.floating) })),
  };
  for (const is of issues.values()) { is.thin.delete(); is.gaps.delete(); is.floating.delete(); }
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
    previewSvg: ({ issues: showIssues = true } = {}) => {
      const [x, y, w, h] = preview.viewBox;
      const m = Math.max(w, h) * 0.02;
      const paths = preview.layers.map((l) => `  <path d="${l.d}" fill="${l.color}" fill-rule="evenodd"/>`);
      if (showIssues) {
        for (const is of preview.issues) {
          if (is.thin) paths.push(`  <path d="${is.thin}" fill="#ff2d55" fill-rule="evenodd"/>`);
          if (is.gaps) paths.push(`  <path d="${is.gaps}" fill="#ffb800" fill-rule="evenodd"/>`);
          if (is.floating) paths.push(`  <path d="${is.floating}" fill="#a020f0" fill-opacity="0.7" fill-rule="evenodd"/>`);
        }
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x - m} ${y - m} ${w + 2 * m} ${h + 2 * m}" width="${(w + 2 * m).toFixed(2)}mm" height="${(h + 2 * m).toFixed(2)}mm">\n${paths.join('\n')}\n</svg>\n`;
    },
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

export type { CrossSection };
