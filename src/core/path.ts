// SVG path + transform parsing with curve flattening.
// Output is always polylines in the path's own units: [{ points: [[x, y], ...], closed }]
import type { Matrix, Point, Subpath } from './types.js';

/** Default max flattening error, in the units of the coordinates being flattened. */
export const TOLERANCE = 0.01;

// ---------- transforms (2D affine [a b c d e f], same as SVG matrix()) ----------

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Average scale factor of a transform, used to scale stroke widths and tolerances. */
export function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Matrix => [sx, 0, 0, sy, 0, 0];

export function parseTransform(str: string | null | undefined): Matrix {
  let m = IDENTITY;
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str))) {
    const v = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Matrix;
    switch (match[1]) {
      case 'matrix': t = [v[0], v[1], v[2], v[3], v[4], v[5]]; break;
      case 'translate': t = translate(v[0] || 0, v[1] || 0); break;
      case 'scale': t = scale(v[0], v[1] ?? v[0]); break;
      case 'rotate': {
        const a = (v[0] * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        t = [c, s, -s, c, 0, 0];
        if (v.length === 3) t = multiply(multiply(translate(v[1], v[2]), t), translate(-v[1], -v[2]));
        break;
      }
      case 'skewX': t = [1, 0, Math.tan((v[0] * Math.PI) / 180), 1, 0, 0]; break;
      default: t = [1, Math.tan((v[0] * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = multiply(m, t);
  }
  return m;
}

// ---------- curve flattening ----------

export function flattenQuad(out: Point[], p0: Point, p1: Point, p2: Point, tol = TOLERANCE): void {
  const dd = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]);
  const n = Math.max(1, Math.ceil(Math.sqrt((0.25 * dd) / tol)));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
}

export function flattenCubic(out: Point[], p0: Point, p1: Point, p2: Point, p3: Point, tol = TOLERANCE): void {
  const dd = Math.max(
    Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
    Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]),
  );
  const n = Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / tol)));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]);
  }
}

// SVG arc (endpoint parameterization, spec F.6.5) → points
function flattenArc(out: Point[], p0: Point, rx: number, ry: number, phiDeg: number, largeArc: boolean, sweep: boolean, p1: Point, tol = TOLERANCE): void {
  if (rx === 0 || ry === 0) { out.push(p1); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const r = Math.max(rx, ry);
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / r));
  const n = Math.max(2, Math.ceil(Math.abs(dt) / step));
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
}

// ---------- path data ----------

/** Parses SVG path data into flattened subpaths (untransformed). */
export function parsePathData(d: string, tol = TOLERANCE): Subpath[] {
  const subpaths: Subpath[] = [];
  let i = 0;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const num = () => {
    skip();
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!m) throw new Error(`Bad path data near "${d.slice(i, i + 20)}"`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const flag = () => { skip(); return d[i++] === '1'; };
  const hasNum = () => { skip(); return i < d.length && /[-+.\d]/.test(d[i]); };

  let cur: Point = [0, 0], start: Point = [0, 0], lastCtrl: Point | null = null, lastCmd = '';
  let pts: Point[] = [];
  let open = false; // a subpath is being built
  const flush = (closed: boolean) => {
    if (open && pts.length > 1) subpaths.push({ points: pts, closed });
    pts = []; open = false;
  };

  while (true) {
    skip();
    if (i >= d.length) break;
    let cmd = d[i];
    if (/[a-zA-Z]/.test(cmd)) i++;
    else if (lastCmd) cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;
    else throw new Error('Path data must start with a command');

    if (cmd === 'Z' || cmd === 'z') {
      flush(true);
      cur = start; lastCtrl = null; lastCmd = cmd;
      continue;
    }
    do {
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const pt = (x: number, y: number): Point => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
      if (!open && C !== 'M') { pts = [cur]; open = true; }
      switch (C) {
        case 'M': cur = pt(num(), num()); start = cur; flush(false); pts = [cur]; open = true; cmd = rel ? 'l' : 'L'; lastCtrl = null; break;
        case 'L': cur = pt(num(), num()); pts.push(cur); lastCtrl = null; break;
        case 'H': cur = [rel ? cur[0] + num() : num(), cur[1]]; pts.push(cur); lastCtrl = null; break;
        case 'V': cur = [cur[0], rel ? cur[1] + num() : num()]; pts.push(cur); lastCtrl = null; break;
        case 'C': {
          const c1 = pt(num(), num()), c2 = pt(num(), num()), e = pt(num(), num());
          flattenCubic(pts, cur, c1, c2, e, tol); lastCtrl = c2; cur = e; break;
        }
        case 'S': {
          const c1: Point = lastCtrl && /[CS]/i.test(lastCmd) ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
          const c2 = pt(num(), num()), e = pt(num(), num());
          flattenCubic(pts, cur, c1, c2, e, tol); lastCtrl = c2; cur = e; break;
        }
        case 'Q': {
          const c = pt(num(), num()), e = pt(num(), num());
          flattenQuad(pts, cur, c, e, tol); lastCtrl = c; cur = e; break;
        }
        case 'T': {
          const c: Point = lastCtrl && /[QT]/i.test(lastCmd) ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
          const e = pt(num(), num());
          flattenQuad(pts, cur, c, e, tol); lastCtrl = c; cur = e; break;
        }
        case 'A': {
          const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
          const e = pt(num(), num());
          flattenArc(pts, cur, rx, ry, rot, large, sweep, e, tol); lastCtrl = null; cur = e; break;
        }
        default: throw new Error(`Unsupported path command ${cmd}`);
      }
      lastCmd = cmd;
    } while (hasNum());
  }
  flush(false);
  return subpaths;
}

/** Path data for a rounded rect (SVG <rect> semantics). */
export function rectPath(x: number, y: number, w: number, h: number, rx?: number, ry?: number): string {
  rx = Math.min(rx ?? ry ?? 0, w / 2);
  ry = Math.min(ry ?? rx, h / 2);
  if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}` +
    `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
    `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

/** Removes consecutive duplicate points and the closing duplicate. */
export function cleanPoints(points: Point[], closed: boolean): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push(p);
  }
  if (closed && out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop();
  }
  return out;
}
