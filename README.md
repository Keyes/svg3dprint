# svg3Dprint

[![CI](https://github.com/Keyes/svg3dprint/actions/workflows/ci.yml/badge.svg)](https://github.com/Keyes/svg3dprint/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/svg3dprint)](https://www.npmjs.com/package/svg3dprint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Turn SVGs into multicolour 3D prints. Every colour becomes its own part, so your slicer can give each part its own filament. Before you print, a check shows you lines and gaps too thin to print.

Runs as a CLI, as a Node library and in the browser.

```bash
npx svg3dprint build logo.svg                    # logo.3mf, one part per colour, 1 mm thick
npx svg3dprint build logo.svg --base 1.2         # relief: base plate + colours 0.6 mm on top
npx svg3dprint build logo.svg --width 80 -f stl  # 80 mm wide, one STL per colour
npx svg3dprint check logo.svg --report issues.svg
npx svg3dprint build logo.svg -p my-printer.3mf   # Bambu Studio project, one filament slot per colour
```

## Commands and options

| Command | What it does |
|---|---|
| `build <file.svg>` | Writes 3MF and/or STL (or a Bambu Studio project), then prints the printability report |
| `check <file.svg>` | Only the printability report; exits with 1 if it finds problems |
| `inspect <file.svg>` | Size, colours, fonts, variables and warnings of the SVG |

| Option | Default | Config key | Description |
|---|---|---|---|
| **Layers** | | | |
| `--thickness <mm>` | `1` | `thickness` | Thickness of every part (flat mode) |
| `--base <mm>` | off | `base` | Relief mode: the first shape's colour becomes a base plate this thick |
| `--relief <mm>` | `0.6` | `relief` | Relief mode: thickness of the colours on top of the base plate |
| `--colors <n>` | off (all colours) | `colors` | Merge similar colours until at most n remain, one filament each |
| `-c`, `--config <file>` | – | – | Read layers and options from a JSON file (see [Layer modes](#layer-modes)) |
| **Size** | | | |
| `--scale <factor>` | `1` | `scale` | Scale the size the SVG declares |
| `--width <mm>` | from the SVG | `width` | Scale so the drawing is exactly this wide |
| `--height <mm>` | from the SVG | `height` | Scale so the drawing is exactly this tall |
| `--no-clip` | clip on | `clip: false` | Keep what lies outside the SVG viewport instead of cutting it off |
| **Output** | | | |
| `-o`, `--out <path>` | `<file>.3mf` | – | `file.3mf`, `file.stl` (one `file.<part>.stl` per part) or a directory |
| `-f`, `--format <list>` | from `--out`, else `3mf` | – | `3mf`, `stl` or `3mf,stl` |
| `-p`, `--project <3mf>` | – | `project` | Write a Bambu Studio project based on this one: its presets, one filament slot per colour |
| `--prime-tower` | auto | – | Bambu project: prime tower on (auto = only when two colours share a layer) |
| `--no-prime-tower` | auto | – | Bambu project: prime tower off |
| `--report <file>` | – | – | Write the check as `.svg` (top view, problems marked) or `.json` |
| `--var <key=value>` | – | `vars` | Value for a `{{variable}}` in the SVG; repeat for several |
| **Check** | | | |
| `--min-feature <mm>` | `0.35` | `check.minFeature` | Lines and gaps narrower than this are reported |
| `--min-dot <mm>` | `0` (off) | `check.minDot` | Grow dots smaller than this so the slicer doesn't drop them |
| `--strict` | off | `strict` | Warnings and printability problems make the command fail (no output is written) |
| `--json` | off | – | Print the report (or `inspect` result) as JSON |
| **Other** | | | |
| `-h`, `--help` | | | Show the help |
| `-v`, `--version` | | | Show the version |

Options on the command line override the config file.

## What you get

- **3MF** (default): one object with one part per colour, each carrying its colour. Bambu Studio, OrcaSlicer, PrusaSlicer and Cura open it as a single multi-part object; you assign a filament to each part.
- **Bambu Studio project**, with `-p my-printer.3mf`: the model is placed in a copy of a project you saved from Bambu Studio, so printer, process and filament presets come from there. Each colour gets its own filament slot, and the slot colours are set to match. The prime tower switches on only when two colours share a layer (flat mode); stacked colours (relief) need just one filament change and don't get one. `--prime-tower` / `--no-prime-tower` override that. Walls are set to Arachne, which prints fine detail better. The project needs at least as many filaments as the model has colours. Add them in Bambu Studio and save before using it.
- **STL**: one file per part (`logo.<part>.stl`). STL can't store colours.
- **Report**: after every build, a list of each part with its height, volume and printability problems. `--report issues.svg` draws a top view with problems marked: red = too thin, amber = gap too narrow (it will close up), purple = floating (a raised part with nothing beneath it). `--report issues.json` gives the same as data.

## Layer modes

**By colour** (default). Every fill and stroke colour becomes a part. Painter's order applies: a shape drawn later covers whatever is underneath it, as it does on screen. The parts therefore fit together without overlaps.

- *Flat* (default): all parts side by side, `--thickness` thick (default 1 mm).
- *Fewer colours*, `--colors <n>`: merges the closest colours until at most n remain, for example to match the filaments in your AMS. The colour that covers more area wins. Drawings with gradients or many shades need this; without it, more than 4 colours give a warning.
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

The options with a config key in [Commands and options](#commands-and-options) can also go in the config file. Flags given on the command line take precedence.

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

TTF, OTF, WOFF and WOFF2 all work. A font that isn't embedded is an error, and so is a character the font has no glyph for. The alternative is to convert the text to paths in your editor.

Library users have two more options: pass font files directly with the `fonts` option, or pass a `loadFont(url)` function that reads `@font-face` fonts referenced by URL (for example with `fetch` relative to the page, or from disk). Parsed fonts are cached, so building the same SVG again doesn't parse them again.

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
- paths and basic shapes, transforms (including `transform-origin`), nested `<svg>`
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
result.layers;           // [{ name, color, z, height, mesh: { vertices, triangles }, outline, volume, issues }]
                         // outline: top view as SVG path data (mm); issues: { thin, gaps, floating, largest (mm²) }
result.ok;               // no printability problems
result.warnings;         // [{ code, message }]
await result.to3MF();    // Uint8Array
result.toSTL();          // [{ name, data: Uint8Array }]
result.previewSvg();     // top view with problems marked
```

Bambu projects with several objects or plates (batches, copies):

```ts
import { toBambu3MF, plateLayout, projectInfo } from 'svg3dprint';

const { bed } = await projectInfo(projectBytes);
const { capacity } = plateLayout(Infinity, [70, 105], bed);   // how many 70 × 105 mm objects fit on a plate
const file = await toBambu3MF(projectBytes, [
  { name: 'Plate 1', objects: [{ name: 'Badge 1', parts: [{ name: 'base', color: '#000aad', mesh, filament: 1 }, ...] }] },
], { primeTower: false });
```

Parts of the same colour share a filament slot unless `filament` sets one. A plate can carry a `thumbnail` PNG. `plateLayout()` returns the same slot positions the writer uses, so you can draw matching thumbnails.

`svg3dprint/core` parses SVGs without the geometry kernel. `svg3dprint/writers` has the STL and 3MF writers on their own.

### In the browser

The same API runs in the browser. With Vite (tested with Vite 8, in both the dev server and a production build) it needs no configuration. The bundler emits `manifold.wasm` as an asset, and the WOFF2 decoder is a separate chunk that only loads when a file embeds a WOFF2 font. In the bundle that's about 130 kB gzipped JS plus 208 kB gzipped WASM.

Other bundlers: if `manifold.wasm` isn't found, import its URL yourself and call `init()` before the first `build()`:

```ts
import { init } from 'svg3dprint';
import wasmUrl from 'manifold-3d/manifold.wasm?url'; // syntax depends on your bundler
await init({ locateFile: () => wasmUrl });
```

## Development

```bash
npm install
npm test             # builds, then runs the tests in test/
npm run demo         # browser demo at http://127.0.0.1:5179/demo/
npm run demo:build   # production build of the demo into out/demo-dist
```

## Project

- [CHANGELOG.md](CHANGELOG.md): what changed in each release
- [CONTRIBUTING.md](CONTRIBUTING.md): reporting bugs, development setup, pull requests, releases
- [SECURITY.md](SECURITY.md): how to report a security problem privately
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): how we treat each other in this project

## License

[MIT](LICENSE) © Julian Kern.

Dependencies installed with the package keep their own licenses: manifold-3d (Apache-2.0),
opentype.js, @xmldom/xmldom and woff2-encoder (MIT).

Test files are not part of the npm package and keep their own licenses: `test/fixtures/text-woff2.svg`
embeds Inter (SIL Open Font License), and the files in `test/corpus/` are listed with license and author
in [test/corpus/SOURCES.md](test/corpus/SOURCES.md).
