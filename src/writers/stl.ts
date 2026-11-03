import type { Mesh } from '../geometry.js';

/** Binary STL of one mesh. */
export function toSTL(mesh: Mesh, name = 'svg3dprint'): Uint8Array {
  const { vertices: v, triangles: t } = mesh;
  const count = t.length / 3;
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  const header = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buf, 0, header.length).set(header);
  dv.setUint32(80, count, true);
  let o = 84;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const f of [nx, ny, nz, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]]) {
      dv.setFloat32(o, f, true);
      o += 4;
    }
    o += 2; // attribute byte count
  }
  return new Uint8Array(buf);
}
