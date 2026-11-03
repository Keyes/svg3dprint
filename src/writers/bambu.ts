// Bambu Studio project (.3mf): the geometry goes into a project saved from Bambu Studio, so printer, process and
// filament presets come from that project. Every part gets its own filament slot (by colour), and the slot colours
// are set to match. Works for Bambu Studio; OrcaSlicer reads the same format.
import type { Mesh } from '../geometry.js';
import { unzip, zip } from './zip.js';

export interface BambuPart {
  name: string;
  /** "#rrggbb". Parts of the same colour share a filament slot. */
  color: string;
  mesh: Mesh;
  /** 1-based filament slot. Default: by colour, in order of first appearance across the whole project. */
  filament?: number;
}
export interface BambuObject { name: string; parts: BambuPart[] }
export interface BambuPlate {
  name?: string;
  objects: BambuObject[];
  /** PNG shown for the plate before slicing (512 × 512 recommended). */
  thumbnail?: Uint8Array;
  smallThumbnail?: Uint8Array;
}
export interface BambuOptions {
  /**
   * Prime tower on or off. Default: on only if two filaments meet on the same layer (flat multicolour);
   * stacked colours (one change per print) don't need one.
   */
  primeTower?: boolean;
  /** Use Arachne walls, which print fine detail and text better. Default true. */
  arachne?: boolean;
}

export interface ProjectInfo {
  /** Printable bed size in mm. */
  bed: [number, number];
  /** Current filament slot colours. */
  filaments: string[];
  printer: string;
}

const GAP = 8; // mm between objects
const PLATE_GAP = 1 / 5; // Bambu Studio's LOGICAL_PART_PLATE_GAP
const TOWER = [35, 20]; // footprint reserved for the prime tower, mm

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uuid = () => globalThis.crypto.randomUUID();
const num = (v: number) => {
  const s = v.toFixed(4);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
};
const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : '');

type Settings = Record<string, unknown>;

function bedOf(settings: Settings): [number, number] {
  const area = Array.isArray(settings.printable_area) ? (settings.printable_area as string[]).map((p) => p.split('x').map(Number)) : [];
  return area.length ? [Math.max(...area.map((p) => p[0])), Math.max(...area.map((p) => p[1]))] : [256, 256];
}

async function readProject(project: Uint8Array) {
  const files = await unzip(project);
  const raw = files.get('Metadata/project_settings.config');
  if (!raw) throw new Error('Not a Bambu Studio project (no Metadata/project_settings.config). Save one from Bambu Studio with File → Save Project.');
  return { files, settings: JSON.parse(text(raw)) as Settings };
}

/** Bed size, filament slots and printer of a Bambu Studio project. */
export async function projectInfo(project: Uint8Array): Promise<ProjectInfo> {
  const { settings } = await readProject(project);
  return { bed: bedOf(settings), filaments: [...((settings.filament_colour as string[]) ?? [])], printer: String(settings.printer_model ?? '') };
}

/**
 * Where objects go on a plate: centres of a grid of equal cells (object size + 8 mm), filled from the back left.
 * A single object sits in the middle of the bed. With a prime tower, the last cell is kept free for it.
 */
export function plateLayout(count: number, size: [number, number], bed: [number, number], primeTower = false): { slots: [number, number][]; capacity: number; tower: [number, number] | null } {
  const [w, h] = size;
  const cols = Math.max(1, Math.floor((bed[0] + GAP) / (w + GAP)));
  const rows = Math.max(1, Math.floor((bed[1] + GAP) / (h + GAP)));
  const x0 = (bed[0] - (cols * w + (cols - 1) * GAP)) / 2;
  const y0 = (bed[1] - (rows * h + (rows - 1) * GAP)) / 2;
  const grid: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) grid.push([x0 + c * (w + GAP) + w / 2, bed[1] - (y0 + r * (h + GAP) + h / 2)]);
  }
  const centre: [number, number] = [bed[0] / 2, bed[1] / 2];
  if (!primeTower) return { slots: count === 1 ? [centre] : grid.slice(0, count), capacity: grid.length, tower: null };
  // a single object stays in the middle if the tower fits in the front-right corner next to it
  const corner: [number, number] = [bed[0] - TOWER[0] - 10, 10];
  const clear = corner[0] > centre[0] + w / 2 + GAP || corner[1] + TOWER[1] < centre[1] - h / 2 - GAP;
  if (count === 1 && clear) return { slots: [centre], capacity: Math.max(1, grid.length - 1), tower: corner };
  let tower: [number, number] = corner;
  if (grid.length > 1) {
    const [cx, cy] = grid.pop()!; // the front-right cell holds the tower
    tower = [cx - TOWER[0] / 2, cy - h / 2 + 10];
  }
  return { slots: grid.slice(0, count), capacity: grid.length, tower };
}

function meshBounds(meshes: Mesh[]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { vertices: v } of meshes) {
    for (let i = 0; i < v.length; i += 3) {
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], v[i + a]); max[a] = Math.max(max[a], v[i + a]); }
    }
  }
  return { min, max };
}

function meshXml(id: number, { vertices, triangles }: Mesh): string {
  const parts = [`  <object id="${id}" p:UUID="${uuid()}" type="model">\n   <mesh>\n    <vertices>\n`];
  for (let i = 0; i < vertices.length; i += 3) parts.push(`     <vertex x="${num(vertices[i])}" y="${num(vertices[i + 1])}" z="${num(vertices[i + 2])}"/>\n`);
  parts.push('    </vertices>\n    <triangles>\n');
  for (let i = 0; i < triangles.length; i += 3) parts.push(`     <triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"/>\n`);
  parts.push('    </triangles>\n   </mesh>\n  </object>\n');
  return parts.join('');
}

const MODEL_HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
`;

/** Bambu Studio lays plates out in a grid; objects are placed in world coordinates. */
function plateOrigin(index: number, count: number, bed: [number, number]): [number, number] {
  const v = Math.sqrt(count);
  const cols = v > Math.round(v) ? Math.round(v) + 1 : Math.round(v);
  const row = Math.floor(index / cols), col = index % cols;
  return [col * bed[0] * (1 + PLATE_GAP), -row * bed[1] * (1 + PLATE_GAP)];
}

/** Two filaments on one layer: some object has parts of different filaments whose z ranges overlap. */
function needsPrimeTower(plates: BambuPlate[], filamentOf: (p: BambuPart) => number): boolean {
  for (const o of plates.flatMap((p) => p.objects)) {
    const ranges = o.parts.map((p) => { const b = meshBounds([p.mesh]); return { f: filamentOf(p), z0: b.min[2], z1: b.max[2] }; });
    for (const a of ranges) for (const b of ranges) if (a.f !== b.f && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6) return true;
  }
  return false;
}

/** Writes a Bambu Studio project with the given plates into a copy of `project` (a .3mf saved from Bambu Studio). */
export async function toBambu3MF(project: Uint8Array, plates: BambuPlate[], options: BambuOptions = {}): Promise<Uint8Array> {
  if (!plates.length || !plates.some((p) => p.objects.length)) throw new Error('Nothing to put on the plates');
  const { files, settings } = await readProject(project);
  const templateModel = text(files.get('3D/3dmodel.model'));
  const bed = bedOf(settings);

  // ---- filament slots by colour
  const colors: string[] = [];
  const filamentOf = (p: BambuPart) => {
    if (p.filament) return p.filament;
    const c = p.color.toLowerCase();
    if (!colors.includes(c)) colors.push(c);
    return colors.indexOf(c) + 1;
  };
  const allParts = plates.flatMap((p) => p.objects.flatMap((o) => o.parts));
  allParts.forEach(filamentOf);
  const slots = Array.isArray(settings.filament_colour) ? (settings.filament_colour as string[]).length : 1;
  const used = Math.max(...allParts.map(filamentOf));
  if (used > slots) {
    throw new Error(`The model needs ${used} filaments but the Bambu project has ${slots}. ` +
      `Open the project in Bambu Studio, add filaments until there are ${used}, save it, and use that project.`);
  }

  // ---- drop the template's geometry, thumbnails and per-object metadata
  for (const name of [...files.keys()]) {
    if (/^3D\/Objects\//.test(name) || /^Metadata\/(plate_|top_|pick_|cut_information)/.test(name)) files.delete(name);
  }

  // ---- settings
  const filamentColors = [...(settings.filament_colour as string[])];
  allParts.forEach((p) => { filamentColors[filamentOf(p) - 1] = p.color.toUpperCase(); });
  for (const key of ['filament_colour', 'filament_multi_colour']) if (Array.isArray(settings[key])) settings[key] = [...filamentColors];
  const primeTower = options.primeTower ?? needsPrimeTower(plates, filamentOf);
  const changed: string[] = [];
  const set = (key: string, value: string | number) => {
    if (!(key in settings)) return;
    const typed = typeof settings[key] === 'number' ? Number(value) : String(value);
    if (settings[key] !== typed) { settings[key] = typed; changed.push(key); }
  };
  if (options.arachne ?? true) set('wall_generator', 'arachne');
  set('enable_prime_tower', primeTower ? 1 : 0);
  const diff = settings.different_settings_to_system;
  if (Array.isArray(diff) && changed.length) {
    const own = new Set(String(diff[0] || '').split(';').filter(Boolean));
    changed.forEach((k) => own.add(k));
    diff[0] = [...own].join(';');
  }

  // ---- geometry
  const objectFiles: string[] = [], resources: string[] = [], items: string[] = [], objectConfigs: string[] = [], plateConfigs: string[] = [];
  const towerX: string[] = [], towerY: string[] = [];
  const partCount = allParts.length;
  let n = 0, nextMesh = 1;

  plates.forEach((plate, pi) => {
    const origin = plateOrigin(pi, plates.length, bed);
    const bounds = plate.objects.map((o) => meshBounds(o.parts.map((p) => p.mesh)));
    const size: [number, number] = [Math.max(...bounds.map((b) => b.max[0] - b.min[0])), Math.max(...bounds.map((b) => b.max[1] - b.min[1]))];
    const layout = plateLayout(plate.objects.length, size, bed, primeTower);
    if (plate.objects.length > layout.slots.length) throw new Error(`Plate ${pi + 1} has ${plate.objects.length} objects, but only ${layout.capacity} fit`);
    towerX.push(String(layout.tower ? layout.tower[0] : (settings.wipe_tower_x as string[] | undefined)?.[0] ?? 165));
    towerY.push(String(layout.tower ? layout.tower[1] : (settings.wipe_tower_y as string[] | undefined)?.[0] ?? 217));
    const instances: string[] = [];

    plate.objects.forEach((object, oi) => {
      n++;
      const objId = partCount + n;
      const path = `/3D/Objects/object_${n}.model`;
      const ids = object.parts.map(() => nextMesh++);
      files.set(path.slice(1), new TextEncoder().encode(MODEL_HEAD + ' <resources>\n' + object.parts.map((p, i) => meshXml(ids[i], p.mesh)).join('') + ' </resources>\n <build/>\n</model>\n'));
      objectFiles.push(path);
      resources.push(`  <object id="${objId}" p:UUID="${uuid()}" type="model">
   <components>
${ids.map((id) => `    <component p:path="${path}" objectid="${id}" p:UUID="${uuid()}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`).join('\n')}
   </components>
  </object>`);
      // centre the object's footprint on its slot and put it on the bed
      const b = bounds[oi];
      const [sx, sy] = layout.slots[oi];
      const x = origin[0] + sx - (b.min[0] + b.max[0]) / 2, y = origin[1] + sy - (b.min[1] + b.max[1]) / 2;
      items.push(`  <item objectid="${objId}" p:UUID="${uuid()}" transform="1 0 0 0 1 0 0 0 1 ${num(x)} ${num(y)} ${num(-b.min[2])}" printable="1"/>`);
      objectConfigs.push(`  <object id="${objId}">
    <metadata key="name" value="${esc(object.name)}"/>
    <metadata key="extruder" value="${filamentOf(object.parts[0])}"/>
${object.parts.map((p, i) => `    <part id="${ids[i]}" subtype="normal_part">
      <metadata key="name" value="${esc(p.name)}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="${filamentOf(p)}"/>
      <mesh_stat face_count="${p.mesh.triangles.length / 3}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>`).join('\n')}
  </object>`);
      instances.push(`    <model_instance>
      <metadata key="object_id" value="${objId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${1000 + n}"/>
    </model_instance>`);
    });

    const thumb = plate.thumbnail ? `Metadata/plate_${pi + 1}.png` : null;
    if (plate.thumbnail) {
      files.set(thumb!, plate.thumbnail);
      files.set(`Metadata/plate_${pi + 1}_small.png`, plate.smallThumbnail ?? plate.thumbnail);
    }
    plateConfigs.push(`  <plate>
    <metadata key="plater_id" value="${pi + 1}"/>
    <metadata key="plater_name" value="${esc(plate.name ?? '')}"/>
    <metadata key="locked" value="false"/>
    <metadata key="filament_map_mode" value="Auto For Flush"/>
${thumb ? `    <metadata key="thumbnail_file" value="${thumb}"/>\n` : ''}${instances.join('\n')}
  </plate>`);
  });

  if ('wipe_tower_x' in settings) settings.wipe_tower_x = towerX;
  if ('wipe_tower_y' in settings) settings.wipe_tower_y = towerY;

  // ---- main model: keep the template's metadata header (Bambu Studio recognises its own projects by it)
  const cut = templateModel.indexOf('<resources>');
  const head = cut > 0 ? templateModel.slice(0, cut) : MODEL_HEAD;
  const enc = (s: string) => new TextEncoder().encode(s);
  files.set('3D/3dmodel.model', enc(`${head}<resources>
${resources.join('\n')}
 </resources>
 <build p:UUID="${uuid()}">
${items.join('\n')}
 </build>
</model>
`));
  files.set('3D/_rels/3dmodel.model.rels', enc(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${objectFiles.map((p, i) => ` <Relationship Target="${p}" Id="rel-${i + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`).join('\n')}
</Relationships>
`));
  const hasThumb = !!plates[0].thumbnail;
  files.set('_rels/.rels', enc(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
${hasThumb ? ` <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>
 <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>
` : ''}</Relationships>
`));
  files.set('Metadata/model_settings.config', enc(`<?xml version="1.0" encoding="UTF-8"?>
<config>
${objectConfigs.join('\n')}
${plateConfigs.join('\n')}
</config>
`));
  const seq: Record<string, unknown> = {};
  plates.forEach((_, i) => { seq[`plate_${i + 1}`] = { nozzle_sequence: [], optimal_assignment: [], sequence: [] }; });
  files.set('Metadata/filament_sequence.json', enc(JSON.stringify(seq)));
  files.set('Metadata/project_settings.config', enc(JSON.stringify(settings, null, 4)));

  return zip([...files].map(([name, data]) => ({ name, data })));
}
