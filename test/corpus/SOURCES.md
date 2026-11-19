# Test corpus

Real-world and single-feature SVGs for checking what svg3dprint does with files it did not see before.
They are test data only. Each file keeps its own license (below); the MIT license of svg3dprint does not apply to them.
CC BY / CC BY-SA files: attribution is given here, and changes to them must be shared under the same license.

| File | Tests | License | Author | Source |
|---|---|---|---|---|
| `resvg/css-rule-specificity.svg` | CSS specificity | MIT | the resvg authors (linebender/resvg) | [link](https://raw.githubusercontent.com/linebender/resvg/main/crates/resvg/tests/tests/structure/style/rule-specificity.svg) |
| `resvg/css-important.svg` | !important in <style> | MIT | the resvg authors (linebender/resvg) | [link](https://raw.githubusercontent.com/linebender/resvg/main/crates/resvg/tests/tests/structure/style/important.svg) |
| `resvg/use-style-order.svg` | style inheritance through <use> | MIT | the resvg authors (linebender/resvg) | [link](https://raw.githubusercontent.com/linebender/resvg/main/crates/resvg/tests/tests/structure/use/complex-style-resolving-order.svg) |
| `resvg/symbol-use-size.svg` | <symbol> scaled by <use> width/height | MIT | the resvg authors (linebender/resvg) | [link](https://raw.githubusercontent.com/linebender/resvg/main/crates/resvg/tests/tests/structure/symbol/with-custom-use-size.svg) |
| `resvg/clip-transform.svg` | transformed clip-path | MIT | the resvg authors (linebender/resvg) | [link](https://raw.githubusercontent.com/linebender/resvg/main/crates/resvg/tests/tests/masking/clipPath/clip-path-with-transform.svg) |
| `resvg/stroke-miter-clip.svg` | miter joins and limit | MIT | the resvg authors (linebender/resvg) | [link](https://raw.githubusercontent.com/linebender/resvg/main/crates/resvg/tests/tests/painting/stroke-linejoin/miter-clip.svg) |
| `resvg/path-arc-flags.svg` | compact arc flags "a1 1 0 01" | MIT | the resvg authors (linebender/resvg) | [link](https://raw.githubusercontent.com/linebender/resvg/main/crates/resvg/tests/tests/shapes/path/no-commawsp-between-arc-flags.svg) |
| `resvg/transform-origin.svg` | transform-origin (not supported yet) | MIT | the resvg authors (linebender/resvg) | [link](https://raw.githubusercontent.com/linebender/resvg/main/crates/resvg/tests/tests/structure/transform-origin/center.svg) |
| `emoji/twemoji-pizza.svg` | flat multicolour, small paths | CC-BY 4.0 | Twitter, Inc. and other contributors (jdecked/twemoji) | [link](https://raw.githubusercontent.com/jdecked/twemoji/main/assets/svg/1f355.svg) |
| `emoji/twemoji-lion.svg` | flat multicolour, many overlaps | CC-BY 4.0 | Twitter, Inc. and other contributors (jdecked/twemoji) | [link](https://raw.githubusercontent.com/jdecked/twemoji/main/assets/svg/1f981.svg) |
| `emoji/twemoji-globe.svg` | flat multicolour, organic shapes | CC-BY 4.0 | Twitter, Inc. and other contributors (jdecked/twemoji) | [link](https://raw.githubusercontent.com/jdecked/twemoji/main/assets/svg/1f30d.svg) |
| `emoji/openmoji-rocket.svg` | fills + round-joined outline strokes | CC BY-SA 4.0 | OpenMoji, HfG Schwäbisch Gmünd | [link](https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/1F680.svg) |
| `emoji/openmoji-coffee.svg` | fills + strokes, thin details | CC BY-SA 4.0 | OpenMoji, HfG Schwäbisch Gmünd | [link](https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/2615.svg) |
| `emoji/openmoji-fox.svg` | fills + strokes, nested groups | CC BY-SA 4.0 | OpenMoji, HfG Schwäbisch Gmünd | [link](https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/color/svg/1F98A.svg) |
| `flags/flag-usa.svg` | 50 stars via <use> | Public domain | Dbenbenn and Commons contributors | [link](https://commons.wikimedia.org/wiki/File:Flag_of_the_United_States.svg) |
| `flags/flag-brazil.svg` | curved band, tiny stars, lettering | Public domain | Raimundo Teixeira Mendes (design) | [link](https://commons.wikimedia.org/wiki/File:Flag_of_Brazil.svg) |
| `flags/flag-south-korea.svg` | arcs, rotated groups | Public domain | Government of the Republic of Korea (design) | [link](https://commons.wikimedia.org/wiki/File:Flag_of_South_Korea.svg) |
| `flags/flag-nepal.svg` | non-rectangular outline | Public domain | Pumbaa80, Achim1999 | [link](https://commons.wikimedia.org/wiki/File:Flag_of_Nepal.svg) |
| `flags/flag-mexico.svg` | very detailed emblem (stress) | Public domain | Omar Alejandro Covarrubias Neri | [link](https://commons.wikimedia.org/wiki/File:Flag_of_Mexico.svg) |
| `flags/coat-of-arms-germany.svg` | detailed 3-colour heraldry | Public domain | Karl-Tobias Schwab | [link](https://commons.wikimedia.org/wiki/File:Coat_of_arms_of_Germany.svg) |
| `flags/yin-yang.svg` | arcs only | Public domain | Klem | [link](https://commons.wikimedia.org/wiki/File:Yin_and_Yang_symbol.svg) |
| `editors/illustrator-font-specimen.svg` | Illustrator export with text | CC BY-SA 4.0 | see the file page (Wikimedia Commons) | [link](https://commons.wikimedia.org/wiki/File:Vercetti_Regular_font_specimen.svg) |
| `editors/illustrator-bookmark.svg` | Illustrator export | Public domain | see the file page (Wikimedia Commons) | [link](https://commons.wikimedia.org/wiki/File:Fairytale_bookmark_gold_x.svg) |
| `editors/figma-dnd-chart.svg` | Figma export, text and clip groups | CC0 | see the file page (Wikimedia Commons) | [link](https://commons.wikimedia.org/wiki/File:DND_Alignment_Chart.svg) |
| `icons/lucide-bike.svg` | stroke-only icon, currentColor | ISC | Lucide contributors | [link](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/bike.svg) |
| `icons/tabler-coffee.svg` | stroke-only icon, round caps | MIT | Paweł Kuna (Tabler Icons) | [link](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/coffee.svg) |
| `icons/tux.svg` | gradient-heavy illustration | Attribution (Larry Ewing et al.) | Larry Ewing, Simon Budig, Garrett LeSage | [link](https://commons.wikimedia.org/wiki/File:Tux.svg) |

Not downloaded yet (Wikimedia Commons rate-limited the download on 2026-11-19):

- `editors/figma-tldr.svg` (CC BY-SA 4.0): https://commons.wikimedia.org/wiki/File:TLDR_Visual_Aid.svg
- `editors/inkscape-coordinates.svg` (CC0): https://commons.wikimedia.org/wiki/File:Polar_and_Cartesian_coordinate_systems.svg
- `editors/inkscape-3d-space.svg` (CC0): https://commons.wikimedia.org/wiki/File:Oriented_three-dimensional_space.svg
