#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { build, inspect, type Options } from './index.js';

const HELP = `svg3dprint: turn an SVG into a multicolour 3D print

Usage:
  svg3dprint build <file.svg> [-o out.3mf] [options]    write 3MF and/or STL, then report printability
  svg3dprint check <file.svg> [options]                 only the printability report (exit 1 on problems)
  svg3dprint inspect <file.svg>                         size, colours, fonts, variables, warnings

Layers (default: one part per colour, side by side):
  --thickness <mm>      thickness of every part (default 1)
  --base <mm>           relief mode: the first shape's colour becomes a base plate this thick ...
  --relief <mm>         ... and the other colours sit on top, this thick (default 0.6)
  -c, --config <json>   layers from a config file (see README)

Size:
  --scale <factor>      scale the size the SVG declares
  --width <mm>          scale so the drawing is this wide
  --height <mm>         scale so the drawing is this tall
  --no-clip             keep what lies outside the SVG viewport (default: cut it off)

Output:
  -o, --out <path>      file.3mf, file.stl (one file per layer: file.<layer>.stl) or a directory
  -f, --format <list>   3mf, stl or 3mf,stl (default: from --out, else 3mf)
  --report <file>       write the check as .svg (top view, issues marked) or .json
  --var <key=value>     value for a {{variable}} in the SVG (repeatable)

Check:
  --min-feature <mm>    lines and gaps narrower than this are reported (default 0.35)
  --min-dot <mm>        grow dots smaller than this so they print (default 0 = off)
  --strict              warnings and printability problems make the command fail
  --json                print the report as JSON
`;

function fail(msg: string): never {
  process.stderr.write(`svg3dprint: ${msg}\n`);
  process.exit(2);
}

const num = (v: string | undefined, flag: string) => {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`--${flag} needs a positive number, got "${v}"`);
  return n;
};

async function main() {
  const { values: a, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' }, format: { type: 'string', short: 'f' }, config: { type: 'string', short: 'c' },
      thickness: { type: 'string' }, base: { type: 'string' }, relief: { type: 'string' },
      scale: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' },
      report: { type: 'string' }, var: { type: 'string', multiple: true },
      'min-feature': { type: 'string' }, 'min-dot': { type: 'string' },
      strict: { type: 'boolean' }, 'no-clip': { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    },
  });
  if (a.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    return;
  }
  const [command, input] = positionals;
  if (a.help || !command) { process.stdout.write(HELP); return; }
  if (!['build', 'check', 'inspect'].includes(command)) fail(`unknown command "${command}" (build, check, inspect)`);
  if (!input) fail(`${command} needs an SVG file`);
  const svgText = fs.readFileSync(input, 'utf8');

  // config file first, flags override
  let config: Options & { strict?: boolean } = {};
  if (a.config) {
    try { config = JSON.parse(fs.readFileSync(a.config, 'utf8')); } catch (e) { fail(`can't read ${a.config}: ${(e as Error).message}`); }
  }
  const vars = { ...config.vars };
  for (const kv of a.var ?? []) {
    const i = kv.indexOf('=');
    if (i < 1) fail(`--var needs key=value, got "${kv}"`);
    vars[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const options: Options = {
    ...config,
    vars,
    thickness: num(a.thickness, 'thickness') ?? config.thickness,
    base: num(a.base, 'base') ?? config.base,
    relief: num(a.relief, 'relief') ?? config.relief,
    scale: num(a.scale, 'scale') ?? config.scale,
    width: num(a.width, 'width') ?? config.width,
    height: num(a.height, 'height') ?? config.height,
    clip: a['no-clip'] ? false : config.clip,
    check: {
      ...config.check,
      minFeature: num(a['min-feature'], 'min-feature') ?? config.check?.minFeature,
      minDot: a['min-dot'] === '0' ? 0 : num(a['min-dot'], 'min-dot') ?? config.check?.minDot,
    },
  };
  const strict = a.strict ?? config.strict ?? false;

  if (command === 'inspect') {
    const info = await inspect(svgText, options);
    if (a.json) { console.log(JSON.stringify(info, null, 2)); return; }
    console.log(`${path.basename(input)}: ${info.size[0].toFixed(1)} × ${info.size[1].toFixed(1)} mm, ${info.shapes} shapes`);
    console.log(`colours:   ${info.colors.map((c) => `${c.color} (${c.shapes})`).join(', ') || '-'}`);
    console.log(`fonts:     ${info.fonts.join(', ') || '-'}`);
    console.log(`variables: ${info.variables.join(', ') || '-'}`);
    for (const w of info.warnings) console.log(`warning: ${w.message}`);
    if (info.error) { console.log(`error: ${info.error}`); process.exit(1); }
    return;
  }

  const result = await build(svgText, options);
  const report = result.report();
  if (a.json) console.log(JSON.stringify(report, null, 2));
  else {
    const [x, y, z] = result.size;
    console.log(`${path.basename(input)}: ${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(2)} mm, ${result.layers.length} part${result.layers.length === 1 ? '' : 's'}`);
    for (const l of result.layers) {
      const { thin, gaps, floating } = l.issues;
      const problems = [thin && `${thin} too thin`, gaps && `${gaps} gap${gaps > 1 ? 's' : ''} too narrow`, floating && `${floating} floating`].filter(Boolean).join(', ');
      console.log(`  ${l.name.padEnd(18)} ${l.color}  z ${l.z.toFixed(2)}–${(l.z + l.height).toFixed(2)}  ${l.volume.toFixed(0).padStart(6)} mm³  ${problems || 'ok'}`);
    }
    for (const w of result.warnings) console.log(`warning: ${w.message}`);
    if (!result.ok) console.log(`printability: problems below ${report.minFeature} mm found${a.report ? '' : ' (use --report issues.svg to see where)'}`);
  }

  if (a.report) {
    fs.mkdirSync(path.dirname(path.resolve(a.report)), { recursive: true });
    fs.writeFileSync(a.report, a.report.endsWith('.json') ? JSON.stringify(report, null, 2) : result.previewSvg());
    if (!a.json) console.log(`→ ${a.report}`);
  }

  const failed = strict && (!result.ok || result.warnings.length > 0);
  if (command === 'check') process.exit(result.ok && !failed ? 0 : 1);
  if (failed) { console.error('svg3dprint: --strict: not writing output'); process.exit(1); }

  // outputs
  const base = path.basename(input).replace(/\.svg$/i, '');
  let out = a.out ?? `${base}.3mf`;
  const formats = (a.format ?? (/\.stl$/i.test(out) ? 'stl' : /\.3mf$/i.test(out) ? '3mf' : '3mf')).split(',').map((f) => f.trim().toLowerCase());
  for (const f of formats) if (f !== '3mf' && f !== 'stl') fail(`unknown format "${f}"`);
  const isDir = out.endsWith('/') || (fs.existsSync(out) && fs.statSync(out).isDirectory()) || !/\.(3mf|stl)$/i.test(out);
  if (isDir) { fs.mkdirSync(out, { recursive: true }); out = path.join(out, base); }
  else { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); out = out.replace(/\.(3mf|stl)$/i, ''); }
  const written: string[] = [];
  if (formats.includes('3mf')) {
    fs.writeFileSync(`${out}.3mf`, await result.to3MF(base));
    written.push(`${out}.3mf`);
  }
  if (formats.includes('stl')) {
    const files = result.toSTL();
    for (const f of files) {
      const file = files.length === 1 ? `${out}.stl` : `${out}.${f.name.replace(/[^\w-]+/g, '_')}.stl`;
      fs.writeFileSync(file, f.data);
      written.push(file);
    }
  }
  if (!a.json) for (const f of written) console.log(`→ ${f}`);
}

main().catch((e) => fail((e as Error).message));
