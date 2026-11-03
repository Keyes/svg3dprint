// Minimal typings for the parts of opentype.js 2.x used here.
declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z';
    x: number; y: number;
    x1: number; y1: number;
    x2: number; y2: number;
  }
  export interface Path { commands: PathCommand[] }
  export interface Glyph {
    advanceWidth: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }
  export interface Font {
    unitsPerEm: number;
    names: Record<string, Record<string, string> | undefined>;
    tables: Record<string, any>;
    stringToGlyphs(text: string): Glyph[];
    getKerningValue(left: Glyph, right: Glyph): number;
    charToGlyphIndex(char: string): number;
    charToGlyph(char: string): Glyph;
  }
  export function parse(buffer: ArrayBuffer, opts?: object): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
