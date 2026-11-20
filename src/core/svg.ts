// SVG document → flat list of painted shapes in millimetres (y down), in document (paint) order.
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { parseColor } from './color.js';
import { matches, parseDeclarations, parseStylesheet, parseWeight, type Rule, type Stylesheet } from './css.js';
import { FontLibrary } from './fonts.js';
import { IDENTITY, TOLERANCE, apply, cleanPoints, ellipsePath, multiply, parsePathData, parseTransform, rectPath, scale, scaleOf, translate } from './path.js';
import { layoutText, missingGlyphs, type Run } from './text.js';
import type { FillRule, FillShape, StrokeShape, LineCap, LineJoin, Matrix, Point, Shape, Subpath, Warning } from './types.js';

export type Warn = (code: string, message: string) => void;

export interface SvgDocument {
  root: Element;
  /** Size of the SVG viewport in mm (after `scale`). */
  widthMm: number;
  heightMm: number;
  /** User units of the root element → mm. */
  rootTransform: Matrix;
  /** Width and height of the root viewport in user units (what percentages refer to). */
  viewport: [number, number];
  stylesheet: Stylesheet;
  ids: Map<string, Element>;
  /** {{variables}} used in the source. */
  variables: string[];
}

export interface ParseOptions {
  /** Values for {{variables}}. */
  vars?: Record<string, string>;
  /** Extra uniform scale factor on top of the size the SVG declares. */
  scale?: number;
  /** A DOMParser implementation (defaults to @xmldom/xmldom, which works everywhere). */
  DOMParser?: { new(): { parseFromString(s: string, type: string): Document } };
}

/** Collects warnings once per distinct message. */
export function warningCollector(): { warn: Warn; list: Warning[] } {
  const list: Warning[] = [];
  const seen = new Set<string>();
  return {
    list,
    warn: (code, message) => {
      if (seen.has(code + message)) return;
      seen.add(code + message);
      list.push({ code, message });
    },
  };
}

// ---------- variables ----------

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function findVariables(svgText: string): string[] {
  return [...new Set([...svgText.matchAll(VAR_RE)].map((m) => m[1]))];
}

export function substitute(svgText: string, vars: Record<string, string>): string {
  return svgText.replace(VAR_RE, (all, name: string) => (vars[name] != null ? xmlEscape(String(vars[name])) : all));
}

// ---------- DOM helpers ----------

const nameOf = (el: Element) => el.localName || el.nodeName;
const attr = (el: Element, name: string): string | null => (el.hasAttribute?.(name) ? el.getAttribute(name) : null);
const children = (el: Node) => Array.from(el.childNodes || []).filter((n): n is Element => n.nodeType === 1);
const XLINK = 'http://www.w3.org/1999/xlink';
const hrefOf = (el: Element) => attr(el, 'href') ?? el.getAttributeNS?.(XLINK, 'href') ?? attr(el, 'xlink:href');

// ---------- lengths ----------

const PX_PER: Record<string, number> = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16, q: 96 / 101.6 };
const MM_PER_PX = 25.4 / 96;

/** CSS length → user units (px). `em` and `%` resolve against `rel`. Returns null for missing or invalid values. */
export function lengthPx(v: string | null | undefined, rel = 16): number | null {
  if (v == null) return null;
  const m = /^\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)\s*(px|mm|cm|in|pt|pc|q|em|ex|rem|%)?\s*$/i.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'px').toLowerCase();
  if (unit === 'em' || unit === 'rem') return n * rel;
  if (unit === 'ex') return n * rel * 0.5;
  if (unit === '%') return (n / 100) * rel;
  return n * PX_PER[unit];
}

const firstLength = (v: string | null) => (v == null ? null : v.trim().split(/[\s,]+/)[0]);

function viewBoxTransform(vb: number[] | null, w: number, h: number, par: string | null): Matrix {
  if (!vb || vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return IDENTITY;
  let sx = w / vb[2], sy = h / vb[3];
  const [align = 'xMidYMid', meetOrSlice = 'meet'] = (par || '').trim().split(/\s+/).filter(Boolean);
  let tx = 0, ty = 0;
  if (align !== 'none') {
    const s = meetOrSlice === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
    const fx = align.includes('xMid') ? 0.5 : align.includes('xMax') ? 1 : 0;
    const fy = align.includes('YMid') ? 0.5 : align.includes('YMax') ? 1 : 0;
    tx = (w - vb[2] * s) * fx;
    ty = (h - vb[3] * s) * fy;
  }
  return multiply(multiply(translate(tx, ty), scale(sx, sy)), translate(-vb[0], -vb[1]));
}

const parseViewBox = (el: Element) => {
  const vb = (attr(el, 'viewBox') || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  return vb.length === 4 && vb.every(Number.isFinite) ? vb : null;
};

// ---------- styles ----------

type Style = Record<string, string>;

const INHERITED = ['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap',
  'stroke-miterlimit', 'stroke-opacity', 'stroke-dasharray', 'clip-rule', 'color', 'font-family', 'font-size',
  'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'text-transform', 'visibility'];
const NOT_INHERITED = ['display', 'opacity', 'clip-path', 'mask', 'filter', 'stop-color', 'stop-opacity', 'transform-origin',
  'marker-start', 'marker-mid', 'marker-end', 'marker'];
const PROPS = new Set([...INHERITED, ...NOT_INHERITED]);

const ROOT_STYLE: Style = {
  fill: 'black', 'fill-rule': 'nonzero', 'fill-opacity': '1', stroke: 'none', 'stroke-width': '1',
  'stroke-linejoin': 'miter', 'stroke-linecap': 'butt', 'stroke-miterlimit': '4', 'stroke-opacity': '1',
  'stroke-dasharray': 'none', 'clip-rule': 'nonzero', color: 'black', 'font-family': '', 'font-size': '16',
  'font-weight': '400', 'font-style': 'normal', 'letter-spacing': 'normal', 'text-anchor': 'start',
  'text-transform': 'none', visibility: 'visible',
};

function makeStyler(rules: Rule[]) {
  return (el: Element, parent: Style): Style => {
    const style: Style = {};
    for (const p of INHERITED) style[p] = parent[p];
    // presentation attributes < stylesheet rules (by specificity, then order) < style attribute
    const own: Style = {};
    for (const p of PROPS) {
      const v = attr(el, p);
      if (v != null) own[p] = v;
    }
    const hits: { spec: number; order: number; decls: Style }[] = [];
    for (const r of rules) {
      for (const s of r.selectors) if (matches(el, [s])) { hits.push({ spec: s.specificity, order: r.order, decls: r.decls }); break; }
    }
    hits.sort((a, b) => a.spec - b.spec || a.order - b.order);
    for (const h of hits) Object.assign(own, h.decls);
    const inline = attr(el, 'style');
    if (inline) Object.assign(own, parseDeclarations(inline));
    for (const [k, v] of Object.entries(own)) style[k] = v === 'inherit' ? parent[k] : v;
    // resolve font-size to px now, so em values on children refer to the parent's computed size
    const parentSize = parseFloat(parent['font-size']) || 16;
    style['font-size'] = String(lengthPx(style['font-size'], parentSize) ?? parentSize);
    return style;
  };
}

// ---------- document ----------

export function parseSvg(svgText: string, options: ParseOptions = {}, warn: Warn = () => {}): SvgDocument {
  const variables = findVariables(svgText);
  const text = options.vars ? substitute(svgText, options.vars) : svgText;
  const Parser = options.DOMParser ?? (XmlDomParser as unknown as NonNullable<ParseOptions['DOMParser']>);
  const doc = new Parser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || nameOf(root) !== 'svg') throw new Error('Not an SVG file (no <svg> root element)');

  const ids = new Map<string, Element>();
  const css: string[] = [];
  const index = (el: Element) => {
    const id = attr(el, 'id');
    if (id && !ids.has(id)) ids.set(id, el);
    if (nameOf(el) === 'style') css.push(el.textContent || '');
    children(el).forEach(index);
  };
  index(root);
  const stylesheet = parseStylesheet(css.join('\n'), warn);

  const vb = parseViewBox(root);
  const isPercent = (v: string | null) => v != null && v.trim().endsWith('%');
  const wAttr = attr(root, 'width'), hAttr = attr(root, 'height');
  let wPx = isPercent(wAttr) ? null : lengthPx(wAttr);
  let hPx = isPercent(hAttr) ? null : lengthPx(hAttr);
  if (wPx == null && hPx == null && !vb) warn('no-size', 'The SVG has no width, height or viewBox; assuming 300 × 150 px');
  if (wPx == null && hPx == null) { wPx = vb ? vb[2] : 300; hPx = vb ? vb[3] : 150; }
  else if (wPx == null) wPx = vb ? (hPx! * vb[2]) / vb[3] : hPx!;
  else if (hPx == null) hPx = vb ? (wPx * vb[3]) / vb[2] : wPx;
  if (wAttr && !/[a-z%]\s*$/i.test(wAttr)) warn('unitless-size', `width="${wAttr}" has no unit; read as px (96 per inch). Use --scale or --width to change the size`);

  const k = MM_PER_PX * (options.scale ?? 1);
  const rootTransform = multiply(scale(k), viewBoxTransform(vb, wPx!, hPx!, attr(root, 'preserveAspectRatio')));
  const viewport: [number, number] = vb ? [vb[2], vb[3]] : [wPx!, hPx!];
  return { root, widthMm: wPx! * k, heightMm: hPx! * k, rootTransform, viewport, stylesheet, ids, variables };
}

// ---------- rendering ----------

interface Ctx {
  T: Matrix;
  style: Style;
  clips: Shape[][];
  grow: number; // data-grow in user units of the element that set it, already scaled to mm
  refs: Element[]; // <use> elements the current subtree was instanced through
  depth: number;
}

const SKIP = new Set(['defs', 'symbol', 'clipPath', 'mask', 'style', 'script', 'metadata', 'title', 'desc',
  'linearGradient', 'radialGradient', 'pattern', 'filter', 'marker', 'namedview', 'font', 'font-face']);
const CONTAINERS = new Set(['g', 'a', 'svg', 'switch']);
const GEOMETRY = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const UNSUPPORTED = new Set(['image', 'foreignObject', 'video', 'audio', 'canvas', 'iframe']);

/** Renders all painted shapes, in paint order. Throws for missing fonts or glyphs. */
export function renderShapes(svg: SvgDocument, fonts: FontLibrary, warn: Warn = () => {}): Shape[] {
  const styleOf = makeStyler(svg.stylesheet.rules);
  const out: Shape[] = [];

  const paint = (style: Style, which: 'fill' | 'stroke', el: Element): string | null => {
    let value = (style[which] || '').trim();
    if (value === 'currentColor') value = style.color;
    const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/.exec(value);
    if (url) {
      const ref = svg.ids.get(url[1]);
      const tag = ref && nameOf(ref);
      if (tag === 'linearGradient' || tag === 'radialGradient') {
        const stop = gradientStop(ref!);
        warn('gradient', 'Gradients are printed in their first colour');
        value = stop ?? 'none';
      } else {
        warn('paint-server', `${tag ? `<${tag}>` : 'Missing'} paint #${url[1]} not supported${url[2] ? `; using fallback ${url[2]}` : ''}`);
        value = url[2] || 'none';
      }
    }
    const c = parseColor(value);
    if (!c && value && value !== 'none' && value !== 'transparent') warn('color', `Colour "${value}" not understood on <${nameOf(el)}>`);
    if (!c) return null;
    const alpha = c.alpha * parseFloat(style[`${which}-opacity`] ?? '1') * parseFloat(style.opacity ?? '1');
    if (!(alpha > 0)) return null;
    return c.hex;
  };

  const gradientStop = (g: Element, depth = 0): string | null => {
    const stops = children(g).filter((c) => nameOf(c) === 'stop');
    if (stops.length) {
      const st = styleOf(stops[0], ROOT_STYLE);
      return st['stop-color'] || 'black';
    }
    const href = hrefOf(g);
    const next = href && svg.ids.get(href.replace(/^#/, ''));
    return next && depth < 10 ? gradientStop(next, depth + 1) : null;
  };

  const clipFor = (style: Style, T: Matrix): Shape[] | null => {
    const m = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)$/.exec((style['clip-path'] || '').trim());
    if (!m) return null;
    const clipEl = svg.ids.get(m[1]);
    if (!clipEl || nameOf(clipEl) !== 'clipPath') { warn('clip-missing', `clip-path #${m[1]} not found; ignored`); return null; }
    if (attr(clipEl, 'clipPathUnits') === 'objectBoundingBox') { warn('clip-bbox', `clip-path #${m[1]} uses objectBoundingBox units; ignored`); return null; }
    const shapes: Shape[] = [];
    const Tc = multiply(T, parseTransform(attr(clipEl, 'transform')));
    const cstyle = styleOf(clipEl, ROOT_STYLE);
    for (const c of children(clipEl)) walk(c, { T: Tc, style: cstyle, clips: [], grow: 0, refs: [], depth: 0 }, shapes, true);
    return shapes;
  };

  const push = (target: Shape[], shape: FillShape | StrokeShape, el: Element, ctx: Ctx, color: string) => {
    target.push({ ...shape, color, element: el, clips: ctx.clips, grow: ctx.grow, ...(ctx.refs.length && { refs: ctx.refs }) } as Shape);
  };

  const walk = (el: Element, parent: Ctx, target: Shape[], clipMode: boolean): void => {
    const tag = nameOf(el);
    if (SKIP.has(tag) || el.namespaceURI && el.namespaceURI !== 'http://www.w3.org/2000/svg' && !clipMode && tag !== 'svg') return;
    const style = styleOf(el, parent.style);
    if (style.display === 'none') return;
    if (UNSUPPORTED.has(tag)) { warn('element', `<${tag}> is not supported and was skipped`); return; }
    if (!clipMode) {
      if (style.mask && style.mask !== 'none') warn('mask', 'Masks are not supported and were ignored');
      if (style.filter && style.filter !== 'none') warn('filter', 'Filters are not supported and were ignored');
      if (['marker', 'marker-start', 'marker-mid', 'marker-end'].some((p) => style[p] && style[p] !== 'none')) warn('marker', 'Markers are not supported and were ignored');
    }

    let T = multiply(parent.T, withOrigin(parseTransform(attr(el, 'transform')), style['transform-origin'], svg.viewport));
    if (tag === 'svg' && el !== svg.root) {
      const n = (k: string) => lengthPx(attr(el, k)) ?? 0;
      const vb = parseViewBox(el);
      const w = lengthPx(attr(el, 'width')) ?? (vb ? vb[2] : 0), h = lengthPx(attr(el, 'height')) ?? (vb ? vb[3] : 0);
      T = multiply(multiply(T, translate(n('x'), n('y'))), viewBoxTransform(vb, w, h, attr(el, 'preserveAspectRatio')));
    }
    let clips = parent.clips;
    if (!clipMode) {
      const clip = clipFor(style, T);
      if (clip) clips = [...clips, clip];
    }
    const growAttr = attr(el, 'data-grow');
    const ctx: Ctx = { T, style, clips, grow: growAttr != null ? (parseFloat(growAttr) || 0) * scaleOf(T) : parent.grow, refs: parent.refs, depth: parent.depth };
    const visible = style.visibility !== 'hidden' && style.visibility !== 'collapse';

    if (CONTAINERS.has(tag)) {
      const kids = children(el);
      for (const c of tag === 'switch' ? kids.slice(0, 1) : kids) walk(c, ctx, target, clipMode);
      return;
    }
    if (tag === 'use') {
      const href = hrefOf(el);
      const ref = href && svg.ids.get(href.replace(/^#/, ''));
      if (!ref) { warn('use-missing', `<use> target ${href ?? '(none)'} not found`); return; }
      if (ctx.depth > 20) { warn('use-depth', '<use> nesting too deep (circular reference?)'); return; }
      const n = (k: string) => lengthPx(attr(el, k)) ?? 0;
      let Tu = multiply(T, translate(n('x'), n('y')));
      const inner: Ctx = { ...ctx, T: Tu, refs: [...ctx.refs, el], depth: ctx.depth + 1 };
      if (nameOf(ref) === 'symbol') {
        const vb = parseViewBox(ref);
        const w = lengthPx(attr(el, 'width')) ?? (vb ? vb[2] : 0), h = lengthPx(attr(el, 'height')) ?? (vb ? vb[3] : 0);
        Tu = multiply(Tu, viewBoxTransform(vb, w, h, attr(ref, 'preserveAspectRatio')));
        const sstyle = styleOf(ref, style);
        for (const c of children(ref)) walk(c, { ...inner, T: Tu, style: sstyle }, target, clipMode);
      } else walk(ref, inner, target, clipMode);
      return;
    }
    if (tag === 'text') {
      if (visible || clipMode) renderText(el, ctx, target, clipMode);
      return;
    }
    if (!GEOMETRY.has(tag) || (!visible && !clipMode)) return;

    const s = scaleOf(T);
    const geom = geometryOf(el, TOLERANCE / s);
    if (!geom.length) return;
    const paths: Subpath[] = geom.map((sp) => ({ points: cleanPoints(sp.points.map((p) => apply(T, p)), sp.closed), closed: sp.closed }));
    const contours = paths.filter((p) => p.points.length > 2).map((p) => p.points);
    if (clipMode) {
      if (contours.length) push(target, { kind: 'fill', contours, fillRule: fillRuleOf(style['clip-rule']) }, el, ctx, '#000000');
      return;
    }
    const fill = tag === 'line' ? null : paint(style, 'fill', el);
    if (fill && contours.length) push(target, { kind: 'fill', contours, fillRule: fillRuleOf(style['fill-rule']) }, el, ctx, fill);
    const stroke = paint(style, 'stroke', el);
    const width = (lengthPx(style['stroke-width']) ?? 1) * s;
    if (stroke && width > 0) {
      if (style['stroke-dasharray'] && style['stroke-dasharray'] !== 'none') warn('dasharray', 'Dashed strokes are printed solid');
      push(target, strokeOf(paths, width, style), el, ctx, stroke);
    }
  };

  const renderText = (textEl: Element, ctx: Ctx, target: Shape[], clipMode: boolean) => {
    interface Piece { text: string; style: Style; el: Element; grow: number; textCase: string | null }
    interface Chunk { x: number; y: number; anchor: string; pieces: Piece[] }
    const startX = lengthPx(firstLength(attr(textEl, 'x'))) ?? 0, startY = lengthPx(firstLength(attr(textEl, 'y'))) ?? 0;
    const chunks: Chunk[] = [{ x: startX, y: startY, anchor: ctx.style['text-anchor'], pieces: [] }];
    const s = scaleOf(ctx.T);
    const collect = (node: Element, style: Style, grow: number, textCase: string | null) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3 || child.nodeType === 4) {
          chunks[chunks.length - 1].pieces.push({ text: child.nodeValue || '', style, el: node, grow, textCase });
        } else if (child.nodeType === 1) {
          const c = child as Element, tag = nameOf(c);
          if (tag === 'textPath') { warn('textpath', '<textPath> is not supported and was skipped'); continue; }
          if (tag !== 'tspan' && tag !== 'a') continue;
          const cs = styleOf(c, style);
          if (cs.display === 'none') continue;
          if (attr(c, 'dx') || attr(c, 'dy') || attr(c, 'rotate')) warn('text-offset', 'dx / dy / rotate on text are ignored');
          const x = lengthPx(firstLength(attr(c, 'x'))), y = lengthPx(firstLength(attr(c, 'y')));
          if (x != null || y != null) {
            const prev = chunks[chunks.length - 1];
            chunks.push({ x: x ?? prev.x, y: y ?? prev.y, anchor: cs['text-anchor'], pieces: [] });
          }
          const g = attr(c, 'data-grow');
          collect(c, cs, g != null ? (parseFloat(g) || 0) * s : grow, attr(c, 'data-case') ?? textCase);
        }
      }
    };
    collect(textEl, ctx.style, ctx.grow, attr(textEl, 'data-case'));
    for (const chunk of chunks) {
      // collapse whitespace across pieces, then trim the chunk
      const runs: (Run & { piece: Piece })[] = [];
      let prevSpace = true;
      for (const piece of chunk.pieces) {
        let t = piece.text.replace(/\s+/g, ' ');
        if (prevSpace) t = t.replace(/^ /, '');
        if (!t) continue;
        prevSpace = t.endsWith(' ');
        const st = piece.style;
        const tt = piece.textCase ?? st['text-transform'];
        if (tt === 'upper' || tt === 'uppercase') t = t.toUpperCase();
        if (tt === 'lower' || tt === 'lowercase') t = t.toLowerCase();
        const family = st['font-family'] || '';
        const font = fonts.find(family, parseWeight(st['font-weight']), st['font-style'] === 'italic' || st['font-style'] === 'oblique' ? 'italic' : 'normal');
        if (!font) {
          throw new Error(`Font "${family || '(none)'}" is not embedded in the SVG. Embed it with @font-face (data: URI) or convert the text to paths.` +
            (fonts.families.length ? ` Embedded fonts: ${fonts.families.join(', ')}` : ''));
        }
        const size = parseFloat(st['font-size']) || 16;
        runs.push({ text: t, font, size, spacing: st['letter-spacing'] === 'normal' ? 0 : lengthPx(st['letter-spacing'], size) ?? 0, piece });
      }
      if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ $/, '');
      const kept = runs.filter((r) => r.text.length);
      if (!kept.length) continue;
      for (const r of kept) {
        const missing = missingGlyphs(r.font, r.text);
        if (missing.length) throw new Error(`Font "${r.piece.style['font-family']}" has no glyph for ${missing.map((c) => `"${c}"`).join(' ')}`);
      }
      const num = (k: string) => (attr(textEl, k) != null ? parseFloat(attr(textEl, k)!) : undefined);
      const { byRun } = layoutText({
        runs: kept,
        x: chunk.x,
        y: chunk.y,
        anchor: (['start', 'middle', 'end'].includes(chunk.anchor) ? chunk.anchor : 'start') as 'start' | 'middle' | 'end',
        maxWidth: num('data-max-width'),
        maxLines: num('data-max-lines'),
        lineHeight: num('data-line-height'),
        valign: attr(textEl, 'data-valign') === 'bottom' ? 'bottom' : 'top',
      }, TOLERANCE / s);
      byRun.forEach((local, i) => {
        if (!local.length) return;
        const contours = local.map((c) => cleanPoints(c.map((p) => apply(ctx.T, p)), true));
        const { style, el, grow } = kept[i].piece;
        const rctx = { ...ctx, grow };
        if (clipMode) { push(target, { kind: 'fill', contours, fillRule: 'NonZero' }, el, rctx, '#000000'); return; }
        const fill = paint(style, 'fill', el);
        if (fill) push(target, { kind: 'fill', contours, fillRule: 'NonZero' }, el, rctx, fill);
        const stroke = paint(style, 'stroke', el);
        const width = (lengthPx(style['stroke-width']) ?? 1) * s;
        if (stroke && width > 0) push(target, strokeOf(contours.map((points) => ({ points, closed: true })), width, style), el, rctx, stroke);
      });
    }
  };

  walk(svg.root, { T: svg.rootTransform, style: ROOT_STYLE, clips: [], grow: 0, refs: [], depth: 0 }, out, false);
  return out;
}

const fillRuleOf = (v: string | undefined): FillRule => (v === 'evenodd' ? 'EvenOdd' : 'NonZero');

/**
 * Applies transform-origin to a transform: translate(origin) · T · translate(-origin).
 * Percentages and keywords refer to the root viewport (CSS transform-box: view-box, the SVG default).
 */
function withOrigin(T: Matrix, origin: string | undefined, [vw, vh]: [number, number]): Matrix {
  if (!origin || T === IDENTITY) return T;
  const v = origin.trim().split(/\s+/).slice(0, 2);
  if (v.length === 1) v.push('center'); // one value: the other axis is centred
  if (v[0] === 'top' || v[0] === 'bottom' || v[1] === 'left' || v[1] === 'right') v.reverse(); // "top left" → "left top"
  const pos = (t: string, size: number) =>
    t === 'left' || t === 'top' ? 0 : t === 'right' || t === 'bottom' ? size : t === 'center' ? size / 2 : lengthPx(t, size) ?? size / 2;
  const x = pos(v[0], vw), y = pos(v[1], vh);
  return multiply(multiply(translate(x, y), T), translate(-x, -y));
}

function strokeOf(paths: Subpath[], width: number, style: Style) {
  const join = (['miter', 'round', 'bevel'].includes(style['stroke-linejoin']) ? style['stroke-linejoin'] : 'miter') as LineJoin;
  const cap = (['butt', 'round', 'square'].includes(style['stroke-linecap']) ? style['stroke-linecap'] : 'butt') as LineCap;
  return { kind: 'stroke' as const, paths, width, join, cap, miterLimit: parseFloat(style['stroke-miterlimit']) || 4 };
}

function geometryOf(el: Element, tol: number): Subpath[] {
  const n = (k: string, d = 0) => lengthPx(attr(el, k)) ?? d;
  switch (nameOf(el)) {
    case 'path': return parsePathData(attr(el, 'd') || '', tol);
    case 'rect': {
      const w = n('width'), h = n('height');
      if (!(w > 0 && h > 0)) return [];
      const rx = attr(el, 'rx') != null && attr(el, 'rx') !== 'auto' ? n('rx') : undefined;
      const ry = attr(el, 'ry') != null && attr(el, 'ry') !== 'auto' ? n('ry') : undefined;
      return parsePathData(rectPath(n('x'), n('y'), w, h, rx, ry), tol);
    }
    case 'circle': return n('r') > 0 ? parsePathData(ellipsePath(n('cx'), n('cy'), n('r'), n('r')), tol) : [];
    case 'ellipse': return n('rx') > 0 && n('ry') > 0 ? parsePathData(ellipsePath(n('cx'), n('cy'), n('rx'), n('ry')), tol) : [];
    case 'line': return [{ points: [[n('x1'), n('y1')], [n('x2'), n('y2')]], closed: false }];
    case 'polyline':
    case 'polygon': {
      const v = (attr(el, 'points') || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
      const points: Point[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) points.push([v[i], v[i + 1]]);
      return [{ points, closed: nameOf(el) === 'polygon' }];
    }
  }
  return [];
}

/** Every element the shape belongs to: the painting element, its ancestors, and <use> elements it came through. */
export function ownersOf(shape: Shape): Element[] {
  const out: Element[] = [];
  const up = (el: Element | null) => {
    for (let e: Node | null = el; e && e.nodeType === 1; e = e.parentNode) out.push(e as Element);
  };
  up(shape.element);
  for (const r of shape.refs ?? []) up(r);
  return out;
}
