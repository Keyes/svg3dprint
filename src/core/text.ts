// Text → outlines with opentype.js: runs (tspans), letter-spacing, wrapping and shrink-to-fit.
import type { Font, Glyph } from 'opentype.js';
import { TOLERANCE, flattenCubic, flattenQuad } from './path.js';
import type { Point } from './types.js';

/** A piece of text in one font. `spacing` is extra advance after each glyph, in text units. */
export interface Run {
  text: string;
  font: Font;
  size: number;
  spacing: number;
}

export interface TextBlock {
  runs: Run[];
  x: number;
  y: number;
  anchor?: 'start' | 'middle' | 'end';
  maxWidth?: number;
  maxLines?: number;
  lineHeight?: number;
  valign?: 'top' | 'bottom';
}

/** Glyphs with the font's substitutions (ligatures etc.), or plain character mapping if opentype.js can't apply them. */
function glyphsOf(font: Font, text: string): Glyph[] {
  try {
    return font.stringToGlyphs(text);
  } catch {
    return Array.from(text, (ch) => font.charToGlyph(ch));
  }
}

function runGlyphs(run: Run) {
  const { font, size } = run;
  const scale = size / font.unitsPerEm;
  const glyphs = glyphsOf(font, run.text);
  const placed: { glyph: Glyph; x: number }[] = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    placed.push({ glyph: g, x });
    x += g.advanceWidth * scale + run.spacing;
    const next = glyphs[i + 1];
    if (next) x += font.getKerningValue(g, next) * scale;
  });
  // trailing letter-spacing doesn't count towards the visual width
  return { placed, width: glyphs.length ? x - run.spacing : 0 };
}

export function measureLine(runs: Run[]): number {
  return runs.reduce((w, r, i) => w + runGlyphs(r).width + (i < runs.length - 1 ? r.spacing : 0), 0);
}

/** Characters of `text` that `font` has no glyph for. */
export function missingGlyphs(font: Font, text: string): string[] {
  const missing = new Set<string>();
  for (const ch of text) if (!/\s/.test(ch) && font.charToGlyphIndex(ch) === 0) missing.add(ch);
  return [...missing];
}

/** Converts a line of runs into closed polylines (one list per run) with the baseline origin at (x, y). */
function lineOutlines(runs: Run[], x: number, y: number, tol: number): Point[][][] {
  const byRun: Point[][][] = [];
  for (const run of runs) {
    const contours: Point[][] = [];
    byRun.push(contours);
    const { placed, width } = runGlyphs(run);
    for (const { glyph, x: gx } of placed) {
      const path = glyph.getPath(x + gx, y, run.size);
      let pts: Point[] = [], cur: Point = [0, 0], start: Point = [0, 0];
      for (const c of path.commands) {
        if (c.type === 'M') {
          if (pts.length > 2) contours.push(pts);
          cur = start = [c.x, c.y];
          pts = [cur];
        } else if (c.type === 'L') {
          cur = [c.x, c.y]; pts.push(cur);
        } else if (c.type === 'Q') {
          const e: Point = [c.x, c.y]; flattenQuad(pts, cur, [c.x1, c.y1], e, tol); cur = e;
        } else if (c.type === 'C') {
          const e: Point = [c.x, c.y]; flattenCubic(pts, cur, [c.x1, c.y1], [c.x2, c.y2], e, tol); cur = e;
        } else if (c.type === 'Z') {
          if (pts.length > 2) contours.push(pts);
          pts = []; cur = start;
        }
      }
      if (pts.length > 2) contours.push(pts);
    }
    x += width + run.spacing;
  }
  return byRun;
}

function greedyWrap(words: string[], fits: (s: string) => boolean): string[] {
  const lines: string[] = [];
  let line: string[] = [];
  for (const w of words) {
    const candidate = [...line, w];
    if (line.length && !fits(candidate.join(' '))) {
      lines.push(line.join(' '));
      line = [w];
    } else line = candidate;
  }
  if (line.length) lines.push(line.join(' '));
  return lines;
}

/**
 * Lays out a text block.
 * - A single run may wrap at spaces (or at "|" / newline for forced breaks) up to maxLines.
 * - The whole block shrinks uniformly until every line fits maxWidth.
 * - valign "bottom" keeps the last baseline at y and grows lines upwards.
 * Returns byRun[i]: the closed polylines (nonzero fill) of spec.runs[i], in text units.
 * `tol` is the flattening tolerance in text units.
 */
export function layoutText(spec: TextBlock, tol = TOLERANCE): { byRun: Point[][][]; scale: number; lines: number } {
  const { x, y, anchor = 'start', maxWidth = Infinity, maxLines = 1, valign = 'top' } = spec;
  const baseSize = spec.runs[0]?.size || 1;
  const lineHeight = spec.lineHeight ?? baseSize;

  const single = spec.runs.length === 1;
  const forced = single ? spec.runs[0].text.split(/\s*(?:\||\n)\s*/).filter((s) => s.length) : [];
  const wraps = maxWidth !== Infinity || maxLines > 1;

  const buildLines = (k: number): Run[][] => {
    const runs = spec.runs.map((r) => ({ ...r, size: r.size * k, spacing: r.spacing * k }));
    if (!single || !wraps) return [runs];
    const r = runs[0];
    const fits = (t: string) => measureLine([{ ...r, text: t }]) <= maxWidth;
    const texts = forced.length > 1 ? forced
      : maxLines > 1 ? greedyWrap(forced.join(' ').split(/\s+/).filter(Boolean), fits)
      : [forced.join(' ')];
    return texts.map((t) => [{ ...r, text: t }]);
  };

  // shrink uniformly until the block fits (forced line breaks may exceed maxLines)
  let k = 1, lines = buildLines(1);
  for (let iter = 0; iter < 200; iter++) {
    lines = buildLines(k);
    const lineCountOk = forced.length > 1 || lines.length <= Math.max(maxLines, 1);
    if (lineCountOk && lines.every((l) => measureLine(l) <= maxWidth)) break;
    k *= 0.98;
  }

  const lh = lineHeight * k;
  const byRun: Point[][][] = spec.runs.map(() => []);
  lines.forEach((line, i) => {
    const w = measureLine(line);
    const lx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    const ly = valign === 'bottom' ? y - (lines.length - 1 - i) * lh : y + i * lh;
    // wrapped lines all come from the single run 0; multi-run lines map 1:1
    lineOutlines(line, lx, ly, tol).forEach((cs, ri) => byRun[single ? 0 : ri].push(...cs));
  });
  return { byRun, scale: k, lines: lines.length };
}
