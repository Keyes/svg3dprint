# svg3Dprint

Turn SVGs into multicolour 3D prints. Every colour becomes its own part, so your slicer can give each part its own filament. Before you print, a check shows you lines and gaps too thin to print.

Runs as a CLI, as a Node library and in the browser.

```bash
npx svg3dprint build logo.svg                    # logo.3mf, one part per colour, 1 mm thick
npx svg3dprint build logo.svg --base 1.2         # relief: base plate + colours 0.6 mm on top
npx svg3dprint build logo.svg --width 80 -f stl  # 80 mm wide, one STL per colour
npx svg3dprint check logo.svg --report issues.svg
```

## What you get

- **3MF** (default): one object with one part per colour, each carrying its colour. Bambu Studio, OrcaSlicer, PrusaSlicer and Cura open it as a single multi-part object; you assign a filament to each part.
- **STL**: one file per part (`logo.<part>.stl`). STL can't store colours.
- **Report**: after every build, a list of each part with its height, volume and printability problems. `--report issues.svg` draws a top view with problems marked: red = too thin, amber = gap too narrow (it will close up), purple = floating (a raised part with nothing beneath it). `--report issues.json` gives the same as data.

## Layer modes

**By colour** (default). Every fill and stroke colour becomes a part. Painter's order applies: a shape drawn later covers whatever is underneath it, as it does on screen. The parts therefore fit together without overlaps.

- *Flat* (default): all parts side by side, `--thickness` thick (default 1 mm).
- *Relief*, `--base <mm>`: the colour of the first shape (usually the background) becomes a base plate under the whole drawing. The other colours sit on top, `--relief` thick (default 0.6 mm). Shapes drawn later in the base colour cut into the relief, as they do on screen.

**Config file**, `-c layers.json`. You define each part yourself:

```json
{
  "check": { "minFeature": 0.35, "minDot": 0.9 },
  "layers": [
    { "name": "backdrop", "select": "#backdrop", "height": 1 },
    { "name": "white", "exclude": "#backdrop, #holes", "z": 1, "height": 0.6, "clip": "backdrop" },
    { "name": "holes", "select": "#holes", "op": "subtract" }
  ]
}
```

| Field | Meaning |
|---|---|
| `name` | Part name, used in the 3MF and in STL file names |
| `select` | CSS selector. A shape belongs to the layer if its element, an ancestor or a `<use>` it was placed through matches. Without `select`: every shape |
| `exclude` | CSS selector. Shapes matched this way (same rules) are left out |
| `color` | Only shapes in this colour, or in one of a list of colours |
| `z`, `height` | Bottom and thickness in mm |
| `op` | `"subtract"` cuts the selected shapes out of the other layers (or out of the `from` list) instead of printing them |
| `clip` | Trim the layer to another layer's outline |
| `displayColor` | Part colour in the output (default: the colour of its first shape) |

Every CLI flag can also go in the config file (`thickness`, `base`, `relief`, `scale`, `width`, `height`, `clip`, `vars`, `strict`, `check`). Flags given on the command line take precedence.

Selectors support type, `*`, `#id`, `.class`, `[attr]`, `[attr=value]` (and `~=`, `^=`, `$=`, `*=`), `:not()`, `:first-child`, `:last-child`, and the descendant and `>` combinators, in comma-separated lists.

## Size

The size comes from the SVG's `width` and `height` (`mm`, `cm`, `in`, `pt`, `px` at 96 per inch). Without units the values count as px, and you get a warning. To change it:

- `--scale 2` doubles that size.
- `--width 80` or `--height 50` scales the drawing to exactly that size.

Everything outside the SVG's viewport (artboard) is cut off, as a browser would show it. `--no-clip` keeps it.

The model is centred on the origin, with y and z pointing up.

## Fonts

Text needs its fonts embedded in the SVG:

```css
@font-face { font-family: "Inter"; font-weight: 700; src: url(data:font/woff2;base64,...) format("woff2"); }
```

TTF, OTF, WOFF and WOFF2 all work. A font that isn't embedded is an error, and so is a character the font has no glyph for. The alternative is to convert the text to paths in your editor. Library users can pass extra fonts with the `fonts` option.

## Printability check

The check runs on every build. It reports:

- **too thin**: lines narrower than `--min-feature` (default 0.35 mm, about what a 0.4 mm nozzle can still print)
- **gaps too narrow**: spaces between areas of one part that are narrower than that. They would close up.
- **floating**: raised parts with nothing beneath them

Sharp corners and pointed tips are ignored: the slicer rounds them off anyway. A spot counts as a problem only if printing it wrong changes the shape. For example, a gap that would merge two letters or fill in a counter, or a line whose loss would split a shape. Large thin areas are always reported.

`--min-dot 0.9` enlarges full stops and i-dots smaller than 0.9 mm, so the slicer doesn't drop them.

`build` writes its output even when problems are found. `--strict` turns warnings and problems into a failure. `check` exits with 1 if it finds problems, which is useful in CI.

## Variables

`{{name}}` anywhere in the SVG (text or attributes) is replaced with `--var name=value`. `svg3dprint inspect file.svg` lists the variables a file uses.

## Supported SVG

Supported:
- paths and basic shapes, transforms, nested `<svg>`
- `<use>` and `<symbol>`, `clip-path` (user-space units)
- `<style>` rules, presentation attributes and inline styles, `currentColor`, opacity
- strokes with joins, caps and the miter limit
- text with `<tspan>` (including Inkscape's one-tspan-per-line), `text-anchor`, `letter-spacing`, `text-transform`

Approximated, with a warning:
- gradients (printed in their first colour)
- dashed strokes (printed solid)

Not supported, with a warning:
- masks, filters, markers, patterns, images
- `<textPath>`, and dx / dy / rotate on text

The badge-template extras also work: `data-max-width`, `data-max-lines`, `data-line-height`, `data-valign`, `data-case` and `data-grow` on text (see the GJ badge generator).

## Library

```ts
import { build, inspect } from 'svg3dprint';

const result = await build(svgText, { base: 1.2, width: 80, check: { minFeature: 0.4 } });
result.layers;           // [{ name, color, z, height, mesh: { vertices, triangles }, volume, issues }]
result.ok;               // no printability problems
result.warnings;         // [{ code, message }]
await result.to3MF();    // Uint8Array
result.toSTL();          // [{ name, data: Uint8Array }]
result.previewSvg();     // top view with problems marked
```

`svg3dprint/core` parses SVGs without the geometry kernel. `svg3dprint/writers` has the STL and 3MF writers on their own.

In a browser, call `init({ locateFile: () => manifoldWasmUrl })` first if your bundler doesn't serve `manifold.wasm` next to the script.

## Development

```bash
npm install
npm test        # builds, then runs the tests in test/
```

## License

MIT. The test fixture `text-woff2.svg` embeds Inter (SIL Open Font License).
