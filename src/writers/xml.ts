import type { Mesh } from '../geometry.js';

/** Up to 4 decimals, no trailing zeros. */
export const num = (v: number) => {
  const s = v.toFixed(4);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
};

/** 3MF `<mesh>` element; `triangleAttrs` is appended to every `<triangle>`. */
export function meshXml({ vertices, triangles }: Mesh, triangleAttrs = ''): string {
  const out: string[] = ['   <mesh>\n    <vertices>\n'];
  for (let i = 0; i < vertices.length; i += 3) out.push(`     <vertex x="${num(vertices[i])}" y="${num(vertices[i + 1])}" z="${num(vertices[i + 2])}"/>\n`);
  out.push('    </vertices>\n    <triangles>\n');
  for (let i = 0; i < triangles.length; i += 3) out.push(`     <triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"${triangleAttrs}/>\n`);
  out.push('    </triangles>\n   </mesh>\n');
  return out.join('');
}
