// Plain 3MF (core spec): one object made of one part per layer, each with its display colour.
// Slicers (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura) load it as a single multi-part object.
import type { Mesh } from '../geometry.js';
import { zip } from './zip.js';

export interface Part { name: string; color: string; mesh: Mesh }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => {
  const s = v.toFixed(4);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
};

function meshXml({ vertices, triangles }: Mesh, pid: number, pindex: number): string {
  const out: string[] = ['   <mesh>\n    <vertices>\n'];
  for (let i = 0; i < vertices.length; i += 3) out.push(`     <vertex x="${num(vertices[i])}" y="${num(vertices[i + 1])}" z="${num(vertices[i + 2])}"/>\n`);
  out.push('    </vertices>\n    <triangles>\n');
  for (let i = 0; i < triangles.length; i += 3) {
    out.push(`     <triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}" pid="${pid}" p1="${pindex}"/>\n`);
  }
  out.push('    </triangles>\n   </mesh>\n');
  return out.join('');
}

export async function to3MF(parts: Part[], { name = 'svg3dprint' }: { name?: string } = {}): Promise<Uint8Array> {
  const MATERIALS = 1;
  const objects = parts.map((p, i) => `  <object id="${i + 2}" type="model" name="${esc(p.name)}" pid="${MATERIALS}" pindex="${i}">\n${meshXml(p.mesh, MATERIALS, i)}  </object>\n`);
  const parentId = parts.length + 2;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Title">${esc(name)}</metadata>
 <metadata name="Application">svg3dprint</metadata>
 <resources>
  <basematerials id="${MATERIALS}">
${parts.map((p) => `   <base name="${esc(p.name)}" displaycolor="${p.color.toUpperCase()}FF"/>`).join('\n')}
  </basematerials>
${objects.join('')}  <object id="${parentId}" type="model" name="${esc(name)}">
   <components>
${parts.map((_, i) => `    <component objectid="${i + 2}"/>`).join('\n')}
   </components>
  </object>
 </resources>
 <build>
  <item objectid="${parentId}"/>
 </build>
</model>
`;
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
` },
    { name: '3D/3dmodel.model', data: model },
  ]);
}
