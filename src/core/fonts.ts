// Fonts embedded in the SVG (@font-face with data: URIs), plus fonts handed in through the API.
import opentype, { type Font } from 'opentype.js';
import { parseWeight, type FontFace } from './css.js';

export interface FontEntry { family: string; weight: number; style: string; font: Font }

export class FontLibrary {
  entries: FontEntry[] = [];

  add(family: string, font: Font, { weight = 400, style = 'normal' }: { weight?: number; style?: string } = {}): void {
    this.entries.push({ family: family.toLowerCase(), weight, style, font });
  }

  get families(): string[] {
    return [...new Set(this.entries.map((e) => e.family))];
  }

  /** Picks a face for a CSS font-family list, following the CSS font matching rules loosely. */
  find(familyList: string, weight = 400, style = 'normal'): Font | null {
    for (const raw of splitFamilies(familyList)) {
      const faces = this.entries.filter((e) => e.family === raw.toLowerCase());
      if (!faces.length) continue;
      const styled = faces.filter((f) => f.style === style);
      const pool = styled.length ? styled : faces;
      pool.sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight));
      return pool[0].font;
    }
    return null;
  }
}

export const splitFamilies = (list: string): string[] =>
  list.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

function base64Decode(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decodes a data: URI. Returns null for anything that isn't one. */
export function decodeDataUri(uri: string): Uint8Array | null {
  const m = /^data:([^,]*?),(.*)$/s.exec(uri.trim());
  if (!m) return null;
  return /;base64$/i.test(m[1]) ? base64Decode(m[2]) : new TextEncoder().encode(decodeURIComponent(m[2]));
}

/** Parses TTF, OTF, WOFF and WOFF2 data. WOFF2 is decompressed first (loaded on demand). */
export async function parseFont(bytes: Uint8Array): Promise<Font> {
  let data = bytes;
  const magic = String.fromCharCode(...data.slice(0, 4));
  if (magic === 'wOF2') {
    const { default: decompress } = await import('woff2-encoder/decompress');
    data = await decompress(data);
  }
  return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}

/** Loads every @font-face whose src contains a data: URI. Faces pointing at files or URLs are reported. */
export async function loadFontFaces(faces: FontFace[], library: FontLibrary, warn: (code: string, msg: string) => void): Promise<void> {
  for (const face of faces) {
    const urls = [...face.src.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    const data = urls.map(decodeDataUri).find((d): d is Uint8Array => !!d);
    if (!data) {
      warn('font-not-embedded', `@font-face "${face.family}" points at ${urls[0] ?? 'nothing'}; only embedded data: URIs are loaded`);
      continue;
    }
    try {
      library.add(face.family, await parseFont(data), { weight: face.weight, style: face.style });
    } catch (e) {
      warn('font-invalid', `@font-face "${face.family}" could not be parsed: ${(e as Error).message}`);
    }
  }
}

export { parseWeight };
