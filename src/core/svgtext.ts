// <text> → painted shapes: collects tspans into chunks, resolves fonts, and lays them out with text.ts.
import { parseWeight } from './css.js';
import { attr, nameOf } from './dom.js';
import type { FontLibrary } from './fonts.js';
import { TOLERANCE, apply, cleanPoints, scaleOf } from './path.js';
import { lengthPx, type Ctx, type Style, type Warn } from './svg.js';
import { layoutText, missingGlyphs, type Run } from './text.js';
import type { FillRule, FillShape, Point, Shape, Subpath } from './types.js';

/** What renderText shares with renderShapes. */
export interface TextEnv {
  fonts: FontLibrary;
  styleOf: (el: Element, parent: Style) => Style;
  warn: Warn;
  push: (target: Shape[], shape: FillShape, el: Element, ctx: Ctx, color: string) => void;
  fillAndStroke: (target: Shape[], el: Element, style: Style, ctx: Ctx, contours: Point[][], fillRule: FillRule | null, paths: Subpath[]) => boolean;
}

const firstLength = (v: string | null) => (v == null ? null : v.trim().split(/[\s,]+/)[0]);

export function renderText({ fonts, styleOf, warn, push, fillAndStroke }: TextEnv, textEl: Element, ctx: Ctx, target: Shape[], clipMode: boolean): void {
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
      fillAndStroke(target, el, style, rctx, contours, 'NonZero', contours.map((points) => ({ points, closed: true })));
    });
  }
}
