import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { build, inspect } from '../dist/index.js';
import { matches, parseColor, parsePathData, parseSelector, parseSvg } from '../dist/core/index.js';

const fixture = (name) => fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const total = (r) => r.layers.reduce((v, l) => v + l.volume, 0);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('path data: arcs, relative commands, implicit lineto', () => {
  const [sp] = parsePathData('M0 0 h10 v10 h-10 z');
  assert.equal(sp.closed, true);
  assert.deepEqual(sp.points.at(-1), [0, 10]);
  const [arc] = parsePathData('M0 0 A5 5 0 0 1 10 0', 0.01);
  assert.ok(arc.points.length > 10);
  assert.ok(arc.points.every(([x, y]) => Math.abs(Math.hypot(x - 5, y) - 5) < 0.02));
  assert.equal(parsePathData('M0 0 10 0 10 10')[0].points.length, 3);
});

test('colours', () => {
  assert.deepEqual(parseColor('#abc'), { hex: '#aabbcc', alpha: 1 });
  assert.equal(parseColor('rebeccapurple').hex, '#663399');
  assert.equal(parseColor('rgb(255, 0, 0)').hex, '#ff0000');
  assert.equal(parseColor('hsl(120, 100%, 50%)').hex, '#00ff00');
  assert.equal(parseColor('none'), null);
});

test('selectors', () => {
  const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g id="a" class="x y"><rect class="r"/></g></svg>');
  const rect = svg.root.getElementsByTagName('rect')[0];
  assert.ok(matches(rect, parseSelector('g.x > .r')));
  assert.ok(matches(rect, parseSelector('#a rect')));
  assert.ok(!matches(rect, parseSelector('rect:not(.r)')));
  assert.ok(parseSelector('a, #b .c[d="e"]'));
  assert.equal(parseSelector('a + b'), null);
});

test('physical size from width/height units', () => {
  const s = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="50.8mm" viewBox="0 0 100 100"/>');
  near(s.widthMm, 50.8, 1e-9);
  near(s.heightMm, 50.8, 1e-9);
});

test('flat by-colour mode partitions the drawing (painter\'s order) and flags thin lines', async () => {
  const r = await build(fixture('flat-logo.svg'));
  assert.equal(r.layers.length, 3);
  // rounded rect 60 × 40, r = 4: everything else is painted on top of it, so the parts fill exactly its area
  near(total(r), 60 * 40 - (4 - Math.PI) * 16, 0.5, 'volume');
  const white = r.layers.find((l) => l.color === '#ffffff');
  assert.equal(white.issues.thin, 1);
  assert.equal(r.ok, false);
});

test('Illustrator-style SVG: CSS classes, clip-path, <use> of a <symbol>, gradients', async () => {
  const r = await build(fixture('illustrator.svg'));
  assert.deepEqual(r.layers.map((l) => l.color), ['#e11d48', '#ffffff', '#10b981', '#ffd700', '#0f172a', '#6366f1']);
  assert.ok(r.warnings.some((w) => w.code === 'gradient'));
  // the white circle is clipped to a 60 × 40 rect (user units are px: 0.2646 mm)
  const white = r.layers.find((l) => l.color === '#ffffff');
  const mm = 25.4 / 96;
  near(white.volume, 60 * 40 * mm * mm, 0.5, 'clipped circle');
});

test('embedded WOFF2 font with a coloured tspan', async () => {
  const r = await build(fixture('text-woff2.svg'));
  assert.deepEqual(r.layers.map((l) => l.color), ['#000000', '#ffffff', '#f97316']);
  near(total(r), 80 * 20, 0.5, 'volume');
  assert.ok(r.layers[2].volume > 20);
});

test('missing fonts are an error naming the font', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><text font-family="Nope">x</text></svg>';
  await assert.rejects(build(svg), /Font "Nope" is not embedded/);
  assert.match((await inspect(svg)).error, /Nope/);
});

test('relief mode: base plate plus colours on top', async () => {
  const r = await build(fixture('flat-logo.svg'), { base: 1.2, relief: 0.6, width: 90 });
  assert.equal(r.layers[0].z, 0);
  assert.equal(r.layers[0].height, 1.2);
  assert.ok(r.layers.slice(1).every((l) => l.z === 1.2 && l.height === 0.6));
  near(r.size[0], 90, 1e-6);
  near(r.size[2], 1.8, 1e-9);
  assert.ok(r.layers.every((l) => l.issues.floating === 0));
});

test('config mode: select, exclude, subtract and clip', async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20">
    <rect id="plate" width="40" height="20" fill="{{color}}"/>
    <g id="holes"><circle cx="5" cy="10" r="2"/></g>
    <rect x="10" y="5" width="40" height="10" fill="#fff"/>
  </svg>`;
  const r = await build(svg, {
    vars: { color: '#336699' },
    layers: [
      { name: 'plate', select: '#plate', height: 1 },
      { name: 'top', exclude: '#plate, #holes', z: 1, height: 0.4, clip: 'plate' },
      { name: 'holes', select: '#holes', op: 'subtract' },
    ],
  });
  const [plate, top] = r.layers;
  assert.equal(plate.color, '#336699');
  near(plate.volume, 40 * 20 - Math.PI * 4, 0.15, 'plate');
  near(top.volume, 30 * 10 * 0.4, 0.01, 'top clipped to the plate');
  assert.equal(r.warnings.length, 0);
});

test('3MF and STL output', async () => {
  const r = await build(fixture('flat-logo.svg'));
  const zip = await r.to3MF('logo');
  assert.equal(String.fromCharCode(zip[0], zip[1]), 'PK');
  const stl = r.toSTL();
  assert.equal(stl.length, 3);
  const n = new DataView(stl[0].data.buffer).getUint32(80, true);
  assert.equal(stl[0].data.length, 84 + 50 * n);
  assert.match(r.previewSvg(), /<svg[^>]+viewBox/);
});

test('fonts referenced by URL load through loadFont, and are parsed once', async () => {
  const woff2 = fs.readFileSync(new URL('../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2', import.meta.url));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="10mm" viewBox="0 0 40 10">
    <style>@font-face { font-family: Inter; font-weight: 700; src: url("fonts/inter.woff2"); }</style>
    <text x="1" y="8" font-family="Inter" font-weight="700" font-size="8">Hi</text></svg>`;
  await assert.rejects(build(svg), /Font "Inter" is not embedded/);
  const requested = [];
  const loadFont = async (url) => { requested.push(url); return woff2; };
  const a = await build(svg, { loadFont });
  const b = await build(svg, { loadFont });
  assert.deepEqual(requested, ['fonts/inter.woff2']);
  assert.ok(a.layers[0].volume > 5);
  assert.equal(a.layers[0].volume, b.layers[0].volume);
  assert.match(a.layers[0].outline, /^M/);
});

test('Bambu project: filament per colour, prime tower only when colours share a layer, layout', async () => {
  const { zip, unzip } = await import('../dist/writers/index.js');
  const { plateLayout } = await import('../dist/index.js');
  const settings = {
    filament_colour: ['#000000', '#000000'], filament_multi_colour: ['#000000', '#000000'],
    printable_area: ['0x0', '256x0', '256x256', '0x256'], enable_prime_tower: '1', wall_generator: 'classic',
    wipe_tower_x: ['165'], wipe_tower_y: ['217'], different_settings_to_system: ['', '', '', ''],
  };
  const project = await zip([
    { name: 'Metadata/project_settings.config', data: JSON.stringify(settings) },
    { name: '3D/3dmodel.model', data: '<?xml version="1.0"?>\n<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">BambuStudio</metadata><resources/></model>' },
  ]);
  const read = async (bytes) => {
    const files = await unzip(bytes);
    const text = (n) => new TextDecoder().decode(files.get(n));
    return { files, settings: JSON.parse(text('Metadata/project_settings.config')), model: text('Metadata/model_settings.config') };
  };

  const flat = await build(fixture('text-woff2.svg'));
  await assert.rejects(flat.toBambu3MF(project), /needs 3 filaments but the Bambu project has 2/);

  const two = `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20">
    <rect width="40" height="20" fill="#0b3d91"/><circle cx="20" cy="10" r="6" fill="#ffd400"/></svg>`;
  const f = await read(await (await build(two)).toBambu3MF(project));
  assert.deepEqual(f.settings.filament_colour, ['#0B3D91', '#FFD400']);
  assert.equal(f.settings.enable_prime_tower, '1'); // flat: both colours on every layer
  assert.equal(f.settings.wall_generator, 'arachne');
  assert.deepEqual([...f.model.matchAll(/<part[\s\S]*?key="extruder" value="(\d)"/g)].map((m) => m[1]), ['1', '2']);

  const r = await read(await (await build(two, { base: 1.2 })).toBambu3MF(project));
  assert.equal(r.settings.enable_prime_tower, '0'); // relief: one change, no tower
  assert.match(r.settings.different_settings_to_system[0], /enable_prime_tower/);
  assert.ok(r.files.has('3D/Objects/object_1.model'));

  const grid = plateLayout(6, [70, 105], [256, 256]);
  assert.equal(grid.capacity, 6);
  assert.deepEqual(plateLayout(1, [70, 105], [256, 256]).slots, [[128, 128]]);
  assert.equal(plateLayout(6, [70, 105], [256, 256], true).capacity, 5);
});
