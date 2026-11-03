// Uses the library the way a consumer would: the built package, bundled by Vite with no extra config.
import { build, init } from '../dist/index.js';

const $ = (id) => document.getElementById(id);
const FIXTURES = ['flat-logo.svg', 'illustrator.svg', 'text-woff2.svg'];
let source = null, name = 'drawing', result = null;

window.svg3dprint = { state: () => ({ source: !!source, result }) }; // for automated checks

function download(data, filename, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function run() {
  if (!source) return;
  $('status').textContent = 'Building…';
  $('build').disabled = true;
  const t0 = performance.now();
  try {
    const width = parseFloat($('width').value);
    result = await build(source, {
      ...($('mode').value === 'relief' && { base: 1.2 }),
      ...(width > 0 && { width }),
      check: { minFeature: parseFloat($('minFeature').value) || 0.35 },
    });
    const ms = performance.now() - t0;
    $('preview').innerHTML = result.previewSvg();
    const [x, y, z] = result.size;
    $('layers').innerHTML = '<tr><th>Part</th><th>z (mm)</th><th>Volume</th><th>Check</th></tr>' + result.layers.map((l) => {
      const { thin, gaps, floating } = l.issues;
      const problems = [thin && `${thin} too thin`, gaps && `${gaps} gaps`, floating && `${floating} floating`].filter(Boolean).join(', ');
      return `<tr><td><span class="swatch" style="background:${l.color}"></span> ${l.name}</td><td>${l.z}–${(l.z + l.height).toFixed(2)}</td><td>${l.volume.toFixed(0)} mm³</td><td class="${problems ? 'bad' : 'ok'}">${problems || 'ok'}</td></tr>`;
    }).join('');
    $('warnings').innerHTML = result.warnings.map((w) => `<li>${w.message}</li>`).join('');
    $('status').textContent = `${name}: ${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(2)} mm, built in ${ms.toFixed(0)} ms`;
    $('dl3mf').disabled = $('dlstl').disabled = false;
  } catch (e) {
    result = null;
    $('status').textContent = `Error: ${e.message}`;
    console.error(e);
  } finally {
    $('build').disabled = false;
  }
}

async function load(text, filename) {
  source = text;
  name = filename.replace(/\.svg$/i, '');
  await run();
}

for (const f of FIXTURES) {
  const b = Object.assign(document.createElement('button'), { textContent: f.replace('.svg', '') });
  b.onclick = async () => load(await (await fetch(`/test/fixtures/${f}`)).text(), f);
  $('fixtures').append(b);
}
$('file').onchange = async (e) => { const f = e.target.files[0]; if (f) await load(await f.text(), f.name); };
$('build').onclick = run;
$('dl3mf').onclick = async () => download(await result.to3MF(name), `${name}.3mf`, 'model/3mf');
$('dlstl').onclick = () => { for (const f of result.toSTL()) download(f.data, `${name}.${f.name}.stl`, 'model/stl'); };

const t0 = performance.now();
init().then(() => {
  $('status').textContent = `Geometry kernel ready (${(performance.now() - t0).toFixed(0)} ms). Pick an SVG.`;
  $('build').disabled = false;
}, (e) => {
  $('status').textContent = `Geometry kernel failed to load: ${e.message}`;
  console.error(e);
});
