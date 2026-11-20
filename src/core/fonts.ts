// Fonts embedded in the SVG (@font-face with data: URIs), plus fonts handed in through the API.
import opentype, { type Font } from 'opentype.js';
import type { FontFace } from './css.js';

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

const splitFamilies = (list: string): string[] =>
  list.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

function base64Decode(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decodes a data: URI. Returns null for anything that isn't one. */
function decodeDataUri(uri: string): Uint8Array | null {
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

/** Fetches the bytes of a font that @font-face references by URL (not a data: URI). */
export type FontLoader = (url: string) => Promise<ArrayBuffer | Uint8Array>;

// Parsed fonts are cached, so building the same SVG repeatedly (e.g. on every keystroke) doesn't re-parse them.
const embeddedCache = new Map<string, Promise<Font>>();
const loadedCache = new WeakMap<FontLoader, Map<string, Promise<Font>>>();
const bytesCache = new WeakMap<Uint8Array, Promise<Font>>();
const MAX_EMBEDDED = 64;

function cached<K>(cache: { get(k: K): Promise<Font> | undefined; set(k: K, v: Promise<Font>): unknown; delete(k: K): unknown }, key: K, make: () => Promise<Font>): Promise<Font> {
  let p = cache.get(key);
  if (!p) {
    p = make();
    p.catch(() => cache.delete(key)); // don't keep failures
    cache.set(key, p);
  }
  return p;
}

/** Parses font bytes, cached by the array's identity. */
export function parseFontCached(bytes: Uint8Array): Promise<Font> {
  return cached(bytesCache, bytes, () => parseFont(bytes));
}

/**
 * Loads every @font-face. Embedded data: URIs are always read; faces that point at a file or URL are read through
 * `loader` if one is given, and reported otherwise.
 */
export async function loadFontFaces(faces: FontFace[], library: FontLibrary, warn: (code: string, msg: string) => void, loader?: FontLoader): Promise<void> {
  for (const face of faces) {
    const urls = [...face.src.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    const embedded = urls.find((u) => /^data:/i.test(u.trim()));
    let font: Promise<Font> | null = null;
    if (embedded) {
      if (embeddedCache.size >= MAX_EMBEDDED) embeddedCache.clear();
      font = cached(embeddedCache, embedded, () => parseFont(decodeDataUri(embedded)!));
    } else if (loader && urls.length) {
      let perLoader = loadedCache.get(loader);
      if (!perLoader) loadedCache.set(loader, (perLoader = new Map()));
      const url = urls[0];
      font = cached(perLoader, url, async () => {
        const b = await loader(url);
        return parseFont(b instanceof Uint8Array ? b : new Uint8Array(b));
      });
    }
    if (!font) {
      warn('font-not-embedded', `@font-face "${face.family}" points at ${urls[0] ?? 'nothing'}; only embedded data: URIs are loaded`);
      continue;
    }
    try {
      library.add(face.family, await font, { weight: face.weight, style: face.style });
    } catch (e) {
      warn('font-invalid', `@font-face "${face.family}" could not be loaded: ${(e as Error).message}`);
    }
  }
}
