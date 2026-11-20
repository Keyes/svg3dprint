/** Top view as plain path data (mm, y down, even-odd fill): no WASM objects, so it can outlive build(). */
export interface PreviewData {
  viewBox: [number, number, number, number];
  /** Bottom to top. */
  layers: { color: string; d: string }[];
  issues: { thin: string; gaps: string; floating: string }[];
}

/** Top view SVG with issues highlighted (thin: red, gaps: amber, floating: purple). */
export function previewSvg(preview: PreviewData, { issues = true } = {}): string {
  const [x, y, w, h] = preview.viewBox;
  const m = Math.max(w, h) * 0.02;
  const paths = preview.layers.map((l) => `  <path d="${l.d}" fill="${l.color}" fill-rule="evenodd"/>`);
  if (issues) {
    for (const is of preview.issues) {
      if (is.thin) paths.push(`  <path d="${is.thin}" fill="#ff2d55" fill-rule="evenodd"/>`);
      if (is.gaps) paths.push(`  <path d="${is.gaps}" fill="#ffb800" fill-rule="evenodd"/>`);
      if (is.floating) paths.push(`  <path d="${is.floating}" fill="#a020f0" fill-opacity="0.7" fill-rule="evenodd"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x - m} ${y - m} ${w + 2 * m} ${h + 2 * m}" width="${(w + 2 * m).toFixed(2)}mm" height="${(h + 2 * m).toFixed(2)}mm">\n${paths.join('\n')}\n</svg>\n`;
}
