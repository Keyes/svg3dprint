// SVG parsing without the geometry kernel: no WASM needed.
export * from './types.js';
export { parseSvg, renderShapes, findVariables, substitute, lengthPx, warningCollector, ownersOf, type SvgDocument, type ParseOptions } from './svg.js';
export { parseStylesheet, parseSelector, matches } from './css.js';
export { parseColor } from './color.js';
export { FontLibrary, loadFontFaces, parseFont, parseFontCached, type FontLoader } from './fonts.js';
export { parsePathData, parseTransform } from './path.js';
export { layoutText } from './text.js';
